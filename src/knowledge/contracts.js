import fs from 'node:fs';
import path from 'node:path';
import { invariant } from '../errors.js';
import { sha256Buffer, sha256File } from '../fs/secure-json.js';

export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const KNOWLEDGE_CARD_STATUSES = Object.freeze([
  'CONFIRMED',
  'PENDING_RUNTIME',
  'ADVISORY_ONLY',
  'EXECUTABLE_REPAIR',
]);
export const KNOWLEDGE_QUERY_FIELDS = Object.freeze([
  'jsonPaths',
  'nodeTypes',
  'astOps',
  'componentMethods',
  'diagnosticCodes',
  'runtimeErrors',
  'behaviorMismatches',
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SECRET_KEY = /^(?:token|accessToken|refreshToken|bearerToken|cookie|authorization|password|secret|clientSecret|secretKey|privateKey|certificatePassword|apiKey|accessKey)$/i;

function object(value, name) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'KNOWLEDGE_SCHEMA_INVALID', `${name} must be an object`);
  return value;
}

function exactKeys(value, required, allowed, name) {
  object(value, name);
  for (const key of required) invariant(Object.hasOwn(value, key), 'KNOWLEDGE_SCHEMA_INVALID', `${name}.${key} is required`);
  for (const key of Object.keys(value)) invariant(allowed.includes(key), 'KNOWLEDGE_SCHEMA_INVALID', `${name}.${key} is not allowed`);
}

function string(value, name, max = 4096) {
  invariant(typeof value === 'string' && value.trim() && value.length <= max, 'KNOWLEDGE_SCHEMA_INVALID', `${name} must be a non-empty string no longer than ${max} characters`);
  return value;
}

function stringArray(value, name, maxItems = 100, maxLength = 1024) {
  invariant(Array.isArray(value) && value.length <= maxItems, 'KNOWLEDGE_SCHEMA_INVALID', `${name} must contain at most ${maxItems} items`);
  const normalized = value.map((entry, index) => string(entry, `${name}[${index}]`, maxLength));
  invariant(new Set(normalized).size === normalized.length, 'KNOWLEDGE_SCHEMA_INVALID', `${name} must not contain duplicates`);
  return normalized;
}

function assertNoSecretKeys(value, location = '$', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoSecretKeys(entry, `${location}[${index}]`, seen));
  for (const [key, child] of Object.entries(value)) {
    invariant(!SECRET_KEY.test(key.replace(/[^A-Za-z0-9]/g, '')), 'KNOWLEDGE_SECRET_FIELD_FORBIDDEN', `${location}.${key} is a forbidden secret-bearing field`);
    assertNoSecretKeys(child, `${location}.${key}`, seen);
  }
}

function safeRelativePath(value, name) {
  string(value, name, 1024);
  invariant(!path.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\\'), 'KNOWLEDGE_SCHEMA_INVALID', `${name} must be a safe POSIX relative path`);
  return value;
}

export function computeKnowledgeContentSha256(files) {
  const normalized = [...files]
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .sort()
    .join('');
  return sha256Buffer(Buffer.from(normalized, 'utf8'));
}

export function validateKnowledgeManifest(manifest) {
  exactKeys(
    manifest,
    ['schemaVersion', 'kind', 'version', 'knowledgeSchemaVersion', 'contentSha256', 'compatibility', 'files'],
    ['schemaVersion', 'kind', 'version', 'knowledgeSchemaVersion', 'contentSha256', 'compatibility', 'files'],
    'manifest',
  );
  invariant(manifest.schemaVersion === 1 && manifest.kind === 'ivx-v4-v5-knowledge-runtime', 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge manifest identity is invalid');
  invariant(SEMVER_PATTERN.test(manifest.version), 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge manifest version is invalid');
  invariant(manifest.knowledgeSchemaVersion === KNOWLEDGE_SCHEMA_VERSION, 'KNOWLEDGE_SCHEMA_UNSUPPORTED', 'Knowledge schema version is unsupported');
  invariant(SHA256_PATTERN.test(manifest.contentSha256), 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge contentSha256 is invalid');
  exactKeys(manifest.compatibility, ['workflow', 'converter', 'agentProtocol'], ['workflow', 'converter', 'agentProtocol'], 'manifest.compatibility');
  string(manifest.compatibility.workflow, 'manifest.compatibility.workflow', 128);
  string(manifest.compatibility.converter, 'manifest.compatibility.converter', 128);
  exactKeys(manifest.compatibility.agentProtocol, ['min', 'max'], ['min', 'max'], 'manifest.compatibility.agentProtocol');
  invariant(Number.isSafeInteger(manifest.compatibility.agentProtocol.min) && manifest.compatibility.agentProtocol.min >= 1, 'KNOWLEDGE_SCHEMA_INVALID', 'Agent protocol minimum is invalid');
  invariant(Number.isSafeInteger(manifest.compatibility.agentProtocol.max) && manifest.compatibility.agentProtocol.max >= manifest.compatibility.agentProtocol.min, 'KNOWLEDGE_SCHEMA_INVALID', 'Agent protocol maximum is invalid');
  invariant(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000, 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge manifest files must be a non-empty bounded array');
  const paths = new Set();
  for (const [index, entry] of manifest.files.entries()) {
    exactKeys(entry, ['path', 'sha256'], ['path', 'sha256'], `manifest.files[${index}]`);
    safeRelativePath(entry.path, `manifest.files[${index}].path`);
    invariant(!paths.has(entry.path), 'KNOWLEDGE_SCHEMA_INVALID', `Duplicate Knowledge file path: ${entry.path}`);
    invariant(SHA256_PATTERN.test(entry.sha256), 'KNOWLEDGE_SCHEMA_INVALID', `Invalid SHA-256 for ${entry.path}`);
    paths.add(entry.path);
  }
  for (const required of ['rules.jsonl', 'provenance.json']) invariant(paths.has(required), 'KNOWLEDGE_SCHEMA_INVALID', `Knowledge manifest must include ${required}`);
  invariant(computeKnowledgeContentSha256(manifest.files) === manifest.contentSha256, 'KNOWLEDGE_CONTENT_INTEGRITY_FAILED', 'Knowledge manifest content digest is invalid');
  assertNoSecretKeys(manifest);
  return manifest;
}

function validateMatch(match) {
  exactKeys(match, KNOWLEDGE_QUERY_FIELDS, KNOWLEDGE_QUERY_FIELDS, 'card.match');
  for (const field of KNOWLEDGE_QUERY_FIELDS) stringArray(match[field], `card.match.${field}`, 100, 512);
}

export function validateKnowledgeCard(card) {
  exactKeys(
    card,
    ['schemaVersion', 'ruleId', 'version', 'topic', 'status', 'match', 'sourcePattern', 'targetInvariant', 'exceptions', 'evidence', 'permissions'],
    ['schemaVersion', 'ruleId', 'version', 'topic', 'status', 'match', 'sourcePattern', 'targetInvariant', 'exceptions', 'evidence', 'permissions'],
    'card',
  );
  invariant(card.schemaVersion === KNOWLEDGE_SCHEMA_VERSION, 'KNOWLEDGE_SCHEMA_UNSUPPORTED', 'Knowledge Card schemaVersion is unsupported');
  invariant(typeof card.ruleId === 'string' && ID_PATTERN.test(card.ruleId), 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge Card ruleId is invalid');
  invariant(Number.isSafeInteger(card.version) && card.version >= 1, 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge Card version is invalid');
  string(card.topic, 'card.topic', 256);
  invariant(KNOWLEDGE_CARD_STATUSES.includes(card.status), 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge Card status is invalid');
  validateMatch(card.match);
  string(card.sourcePattern, 'card.sourcePattern', 4096);
  string(card.targetInvariant, 'card.targetInvariant', 4096);
  stringArray(card.exceptions, 'card.exceptions', 100, 2048);
  exactKeys(card.evidence, ['level', 'types', 'provenanceIds'], ['level', 'types', 'provenanceIds'], 'card.evidence');
  invariant(['HIGH', 'MEDIUM', 'LOW'].includes(card.evidence.level), 'KNOWLEDGE_SCHEMA_INVALID', 'Knowledge evidence level is invalid');
  stringArray(card.evidence.types, 'card.evidence.types', 20, 128);
  stringArray(card.evidence.provenanceIds, 'card.evidence.provenanceIds', 100, 128);
  exactKeys(card.permissions, ['diagnosis', 'staticValidation', 'automaticRepair', 'humanConfirmationRequired'], ['diagnosis', 'staticValidation', 'automaticRepair', 'humanConfirmationRequired'], 'card.permissions');
  for (const key of ['diagnosis', 'staticValidation', 'automaticRepair', 'humanConfirmationRequired']) {
    invariant(typeof card.permissions[key] === 'boolean', 'KNOWLEDGE_SCHEMA_INVALID', `card.permissions.${key} must be boolean`);
  }
  if (card.permissions.automaticRepair) {
    invariant(card.status === 'EXECUTABLE_REPAIR' && card.permissions.humanConfirmationRequired, 'KNOWLEDGE_SCHEMA_INVALID', 'Automatic repair knowledge must be EXECUTABLE_REPAIR and require human confirmation');
  }
  assertNoSecretKeys(card);
  return card;
}

export function validateKnowledgeQuery(query) {
  exactKeys(query, [], KNOWLEDGE_QUERY_FIELDS, 'query');
  let count = 0;
  for (const field of KNOWLEDGE_QUERY_FIELDS) {
    const values = query[field] === undefined ? [] : stringArray(query[field], `query.${field}`, 20, 512);
    count += values.length;
  }
  invariant(count > 0 && count <= 50, 'KNOWLEDGE_QUERY_INVALID', 'Knowledge query must contain 1-50 bounded terms');
  assertNoSecretKeys(query);
  return query;
}

function listPayloadFiles(root) {
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      invariant(!stat.isSymbolicLink(), 'KNOWLEDGE_PACKAGE_INVALID', `Knowledge package contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) visit(absolute, relative);
      else {
        invariant(stat.isFile(), 'KNOWLEDGE_PACKAGE_INVALID', `Knowledge package contains an unsupported entry: ${relative}`);
        if (!['package.json', 'manifest.json', '.ivx-runtime.json'].includes(relative)) files.push(relative);
      }
    }
  }
  visit(root);
  return files.sort();
}

export function validateKnowledgePackage(packageRoot, descriptor, version) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  for (const forbidden of ['scripts', 'bin', 'main', 'exports', 'dependencies', 'optionalDependencies', 'peerDependencies']) {
    invariant(!Object.hasOwn(packageJson, forbidden), 'KNOWLEDGE_PACKAGE_EXECUTABLE_FORBIDDEN', `Knowledge package must not declare ${forbidden}`);
  }
  const manifest = validateKnowledgeManifest(JSON.parse(fs.readFileSync(path.join(packageRoot, 'manifest.json'), 'utf8')));
  invariant(manifest.version === version, 'RUNTIME_VERSION_MISMATCH', 'Knowledge manifest version differs from its release descriptor');
  invariant(descriptor.knowledgeSchemaVersion === manifest.knowledgeSchemaVersion, 'KNOWLEDGE_DESCRIPTOR_MISMATCH', 'Knowledge schema version differs between channel and package');
  invariant(descriptor.contentSha256 === manifest.contentSha256, 'KNOWLEDGE_DESCRIPTOR_MISMATCH', 'Knowledge content digest differs between channel and package');
  invariant(descriptor.compatibleWorkflow === manifest.compatibility.workflow, 'KNOWLEDGE_DESCRIPTOR_MISMATCH', 'Knowledge Workflow compatibility differs between channel and package');
  invariant(descriptor.compatibleConverter === manifest.compatibility.converter, 'KNOWLEDGE_DESCRIPTOR_MISMATCH', 'Knowledge Converter compatibility differs between channel and package');
  invariant(JSON.stringify(descriptor.compatibleAgentProtocol) === JSON.stringify(manifest.compatibility.agentProtocol), 'KNOWLEDGE_DESCRIPTOR_MISMATCH', 'Knowledge Agent protocol compatibility differs between channel and package');
  const declared = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  for (const relative of declared.keys()) {
    invariant(
      relative === 'rules.jsonl'
      || relative === 'provenance.json'
      || ['index/', 'books/', 'vocab/'].some((prefix) => relative.startsWith(prefix)),
      'KNOWLEDGE_PACKAGE_INVALID',
      `Knowledge package path is outside the public runtime layout: ${relative}`,
    );
  }
  const actualPaths = listPayloadFiles(packageRoot);
  invariant(JSON.stringify(actualPaths) === JSON.stringify([...declared.keys()].sort()), 'KNOWLEDGE_PACKAGE_INVALID', 'Knowledge package files differ from the signed internal manifest');
  for (const [relative, expected] of declared) {
    invariant(sha256File(path.join(packageRoot, relative)) === expected, 'KNOWLEDGE_CONTENT_INTEGRITY_FAILED', `Knowledge file hash mismatch: ${relative}`);
  }
  const rulesPath = path.join(packageRoot, 'rules.jsonl');
  invariant(fs.statSync(rulesPath).size <= 20 * 1024 * 1024, 'KNOWLEDGE_PACKAGE_INVALID', 'Knowledge rules.jsonl exceeds 20 MiB');
  const lines = fs.readFileSync(rulesPath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  invariant(lines.length > 0 && lines.length <= 50000, 'KNOWLEDGE_PACKAGE_INVALID', 'Knowledge rules.jsonl must contain 1-50000 cards');
  const ruleIds = new Set();
  for (const [index, line] of lines.entries()) {
    invariant(Buffer.byteLength(line) <= 64 * 1024, 'KNOWLEDGE_PACKAGE_INVALID', `Knowledge Card line ${index + 1} exceeds 64 KiB`);
    let card;
    try { card = JSON.parse(line); } catch {
      invariant(false, 'KNOWLEDGE_PACKAGE_INVALID', `Knowledge Card line ${index + 1} is not valid JSON`);
    }
    validateKnowledgeCard(card);
    invariant(!ruleIds.has(card.ruleId), 'KNOWLEDGE_PACKAGE_INVALID', `Duplicate Knowledge ruleId: ${card.ruleId}`);
    ruleIds.add(card.ruleId);
  }
  object(JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8')), 'provenance');
  return { manifest, cardCount: lines.length };
}
