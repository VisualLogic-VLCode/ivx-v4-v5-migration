import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { invariant } from '../errors.js';
import { sha256Buffer } from '../fs/secure-json.js';
import { RuntimeRegistry } from '../releases/runtime-registry.js';
import { validateKnowledgeCard, validateKnowledgePackage, validateKnowledgeQuery, KNOWLEDGE_QUERY_FIELDS } from './contracts.js';

function pinFromDescriptor(descriptor) {
  invariant(descriptor?.kind === 'knowledge', 'KNOWLEDGE_RUNTIME_NOT_INSTALLED', 'No Knowledge Runtime is active');
  return {
    version: descriptor.version,
    sha256: descriptor.artifactSha256,
    contentSha256: descriptor.contentSha256,
    schemaVersion: descriptor.knowledgeSchemaVersion,
    ruleIds: [],
  };
}

function normalizeTerm(value) {
  return String(value).trim().toLocaleLowerCase('en-US');
}

function queryDigest(query) {
  const canonical = Object.fromEntries(KNOWLEDGE_QUERY_FIELDS.map((field) => [field, [...(query[field] || [])].sort()]));
  return sha256Buffer(Buffer.from(JSON.stringify(canonical), 'utf8'));
}

function scoreCard(card, query) {
  let score = 0;
  const matchedFields = [];
  for (const field of KNOWLEDGE_QUERY_FIELDS) {
    const requested = (query[field] || []).map(normalizeTerm);
    const candidates = card.match[field].map(normalizeTerm);
    let fieldScore = 0;
    for (const term of requested) {
      if (candidates.includes(term)) fieldScore += 4;
      else if (candidates.some((candidate) => candidate.includes(term) || term.includes(candidate))) fieldScore += 1;
    }
    if (fieldScore > 0) matchedFields.push(field);
    score += fieldScore;
  }
  return { score, matchedFields };
}

function publicCard(card, matchedFields) {
  return {
    ruleId: card.ruleId,
    version: card.version,
    topic: card.topic,
    status: card.status,
    sourcePattern: card.sourcePattern,
    targetInvariant: card.targetInvariant,
    exceptions: card.exceptions,
    evidence: { level: card.evidence.level, types: card.evidence.types },
    permissions: card.permissions,
    matchedFields,
  };
}

export class KnowledgeRuntime {
  constructor({ registry = new RuntimeRegistry() } = {}) {
    this.registry = registry;
  }

  activePin() {
    return pinFromDescriptor(this.registry.readCurrent().knowledge);
  }

  load(pin = this.activePin()) {
    invariant(pin && typeof pin === 'object', 'KNOWLEDGE_PIN_REQUIRED', 'A pinned Knowledge Runtime is required');
    const descriptor = this.registry.descriptor('knowledge', pin.version);
    invariant(descriptor, 'KNOWLEDGE_RUNTIME_NOT_INSTALLED', `Pinned Knowledge Runtime ${pin.version} is not installed`);
    const expectedRoot = this.registry.runtimeDir('knowledge', pin.version);
    invariant(path.resolve(descriptor.packagePath) === path.resolve(expectedRoot) && !fs.lstatSync(expectedRoot).isSymbolicLink(), 'KNOWLEDGE_RUNTIME_PATH_INVALID', 'Pinned Knowledge Runtime path is invalid');
    invariant(descriptor.artifactSha256 === pin.sha256 && descriptor.contentSha256 === pin.contentSha256 && descriptor.knowledgeSchemaVersion === pin.schemaVersion, 'KNOWLEDGE_PIN_MISMATCH', 'Installed Knowledge Runtime does not match the pinned version and digests');
    const verified = validateKnowledgePackage(descriptor.packagePath, {
      knowledgeSchemaVersion: descriptor.knowledgeSchemaVersion,
      contentSha256: descriptor.contentSha256,
      compatibleWorkflow: descriptor.compatibility.workflow,
      compatibleConverter: descriptor.compatibility.converter,
      compatibleAgentProtocol: descriptor.compatibility.agentProtocol,
    }, descriptor.version);
    const cards = fs.readFileSync(path.join(descriptor.packagePath, 'rules.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => validateKnowledgeCard(JSON.parse(line)));
    return { descriptor, manifest: verified.manifest, cards };
  }

  search(query, { pin = this.activePin(), limit = 5 } = {}) {
    validateKnowledgeQuery(query);
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 20, 'KNOWLEDGE_QUERY_INVALID', 'Knowledge result limit must be between 1 and 20');
    const runtime = this.load(pin);
    const ranked = runtime.cards
      .map((card) => ({ card, ...scoreCard(card, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.card.ruleId.localeCompare(right.card.ruleId));
    const matches = ranked
      .slice(0, limit)
      .map((entry) => ({ score: entry.score, ...publicCard(entry.card, entry.matchedFields) }));
    return {
      schemaVersion: 1,
      kind: 'knowledge-search-result',
      pin: { ...pin, ruleIds: matches.map((entry) => entry.ruleId) },
      queryDigest: queryDigest(query),
      resultCount: matches.length,
      truncated: ranked.length > limit,
      cards: matches,
    };
  }

  createFeedback(input, { pin = this.activePin() } = {}) {
    invariant(input && typeof input === 'object' && !Array.isArray(input), 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback must be an object');
    const allowed = ['ruleId', 'summary', 'evidenceRefs', 'suggestedStatus'];
    for (const key of Object.keys(input)) invariant(allowed.includes(key), 'KNOWLEDGE_FEEDBACK_INVALID', `Knowledge feedback field is not allowed: ${key}`);
    invariant(typeof input.ruleId === 'string' && input.ruleId, 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback ruleId is required');
    invariant(typeof input.summary === 'string' && input.summary.trim() && input.summary.length <= 8192, 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback summary is invalid');
    invariant(Array.isArray(input.evidenceRefs) && input.evidenceRefs.length > 0 && input.evidenceRefs.length <= 100, 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback requires 1-100 evidence references');
    for (const reference of input.evidenceRefs) invariant(typeof reference === 'string' && reference && reference.length <= 1024 && !path.isAbsolute(reference) && !reference.includes('..'), 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback evidence references must be safe local artifact references');
    invariant(['CONFIRMED', 'PENDING_RUNTIME', 'ADVISORY_ONLY', 'EXECUTABLE_REPAIR', 'RETRACT'].includes(input.suggestedStatus), 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback suggestedStatus is invalid');
    const runtime = this.load(pin);
    const card = runtime.cards.find((entry) => entry.ruleId === input.ruleId);
    invariant(card, 'KNOWLEDGE_RULE_NOT_FOUND', `Knowledge rule is not present in pinned runtime: ${input.ruleId}`);
    return {
      schemaVersion: 1,
      kind: 'knowledge-feedback-report',
      feedbackId: `knowledge-feedback-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
      runtime: { version: pin.version, contentSha256: pin.contentSha256, schemaVersion: pin.schemaVersion },
      rule: { ruleId: card.ruleId, version: card.version, currentStatus: card.status },
      summary: input.summary,
      evidenceRefs: [...new Set(input.evidenceRefs)],
      suggestedStatus: input.suggestedStatus,
      createdAt: new Date().toISOString(),
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
    };
  }
}

export { pinFromDescriptor as createKnowledgePin };
