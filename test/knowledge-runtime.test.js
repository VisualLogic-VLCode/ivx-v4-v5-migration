import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { computeKnowledgeContentSha256 } from '../src/knowledge/contracts.js';
import { KnowledgeRuntime, createKnowledgePin } from '../src/knowledge/runtime.js';
import { ArtifactInstaller } from '../src/releases/artifact-installer.js';
import { createSignedReleaseEnvelope } from '../src/releases/release-envelope.js';
import { RuntimeRegistry } from '../src/releases/runtime-registry.js';
import { UpdateManager } from '../src/releases/update-manager.js';
import { createAppPaths } from '../src/paths.js';
import { sha256File, writePrivateJson } from '../src/fs/secure-json.js';
import { JobStore } from '../src/jobs/job-store.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';

const cli = path.resolve(import.meta.dirname, '..', 'bin', 'ivx-migrate.js');

function runCli(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, IVX_MIGRATION_HOME: home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

function card(ruleId = 'AST-GET-001') {
  return {
    schemaVersion: 1,
    ruleId,
    version: 1,
    topic: 'Callback result translation',
    status: 'CONFIRMED',
    match: {
      jsonPaths: ['/events/*/args'],
      nodeTypes: ['action'],
      astOps: ['sysutil:obj_translateData'],
      componentMethods: [],
      diagnosticCodes: ['AST_TRANSLATE_RESULT'],
      runtimeErrors: [],
      behaviorMismatches: ['callback-result-empty'],
    },
    sourcePattern: 'A V4 callback reads a service result and then translates the data.',
    targetInvariant: 'The V5 get chain retains the callback result field before obj_translateData.',
    exceptions: ['The callback explicitly ignores the service result.'],
    evidence: { level: 'HIGH', types: ['EDITOR_FIXTURE'], provenanceIds: ['public-fixture-1'] },
    permissions: { diagnosis: true, staticValidation: true, automaticRepair: false, humanConfirmationRequired: true },
  };
}

function pack(root) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.join(root, JSON.parse(result.stdout)[0].filename);
}

function createKnowledgePackage(root, version, { cards = [card()], compatibleWorkflow = '>=1.0.0 <2.0.0', compatibleConverter = '>=1.0.0 <2.0.0', extraFile = null, tamperAfterManifest = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: '@test/ivx-v4-v5-knowledge',
    version,
    files: ['manifest.json', 'rules.jsonl', 'provenance.json', 'books', 'vocab', 'index'],
  }));
  fs.writeFileSync(path.join(root, 'rules.jsonl'), `${cards.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'provenance.json'), JSON.stringify({ schemaVersion: 1, publicEvidence: cards.map((entry) => entry.ruleId) }));
  fs.mkdirSync(path.join(root, 'books'));
  fs.writeFileSync(path.join(root, 'books', 'overview.md'), '# Public reviewed guidance\n');
  if (extraFile) {
    fs.mkdirSync(path.dirname(path.join(root, extraFile)), { recursive: true });
    fs.writeFileSync(path.join(root, extraFile), 'forbidden maintainer material\n');
  }
  const payloadPaths = ['rules.jsonl', 'provenance.json', 'books/overview.md', ...(extraFile ? [extraFile] : [])];
  const files = payloadPaths.map((relative) => ({ path: relative, sha256: sha256File(path.join(root, relative)) }));
  const manifest = {
    schemaVersion: 1,
    kind: 'ivx-v4-v5-knowledge-runtime',
    version,
    knowledgeSchemaVersion: 1,
    contentSha256: computeKnowledgeContentSha256(files),
    compatibility: { workflow: compatibleWorkflow, converter: compatibleConverter, agentProtocol: { min: 4, max: 4 } },
    files,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  if (tamperAfterManifest) fs.appendFileSync(path.join(root, 'rules.jsonl'), `${JSON.stringify(card('TAMPERED-RULE'))}\n`);
  return { tarball: pack(root), manifest };
}

function knowledgeDescriptor(value) {
  return {
    packageName: '@test/ivx-v4-v5-knowledge',
    artifact: { url: value.tarball, sha256: sha256File(value.tarball) },
    compatibleWorkflow: value.manifest.compatibility.workflow,
    compatibleConverter: value.manifest.compatibility.converter,
    compatibleAgentProtocol: value.manifest.compatibility.agentProtocol,
    knowledgeSchemaVersion: 1,
    contentSha256: value.manifest.contentSha256,
  };
}

function seedBaseRuntimes(registry) {
  const workflow = {
    schemaVersion: 1, kind: 'workflow', version: '1.0.0', packageName: '@test/workflow', artifactSha256: 'a'.repeat(64), packagePath: registry.runtimeDir('workflow', '1.0.0'),
    compatibility: { workflow: null, converter: '>=1.0.0 <2.0.0', agentProtocolVersion: 4, agentProtocol: null }, capabilities: {}, installedAt: new Date().toISOString(),
  };
  const converter = {
    schemaVersion: 1, kind: 'converter', version: '1.0.0', packageName: '@test/converter', artifactSha256: 'b'.repeat(64), packagePath: registry.runtimeDir('converter', '1.0.0'),
    compatibility: { workflow: '>=1.0.0 <2.0.0', converter: null, agentProtocolVersion: null, agentProtocol: null }, capabilities: {}, installedAt: new Date().toISOString(),
  };
  for (const descriptor of [workflow, converter]) {
    fs.mkdirSync(descriptor.packagePath, { recursive: true });
    writePrivateJson(path.join(descriptor.packagePath, '.ivx-runtime.json'), descriptor);
  }
  fs.mkdirSync(path.join(workflow.packagePath, 'src'));
  fs.writeFileSync(path.join(workflow.packagePath, 'src', 'cli.js'), `export { runCli } from ${JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, '..', 'src', 'cli.js')).href)};\n`);
  registry.activateSet({ workflow: '1.0.0', converter: '1.0.0' });
}

function releasePayload(kind, latest, versions, revoked = []) {
  return { schemaVersion: 1, kind, channel: 'stable', latest, minimumSupported: null, revoked, versions };
}

function writeSigned(file, payload, privateKey) {
  fs.writeFileSync(file, JSON.stringify(createSignedReleaseEnvelope(payload, privateKey)));
}

function baseChannels(temporary, privateKey) {
  const workflow = path.join(temporary, 'workflow.json');
  const converter = path.join(temporary, 'converter.json');
  writeSigned(workflow, releasePayload('workflow', '1.0.0', {
    '1.0.0': { packageName: '@test/workflow', artifact: { url: 'https://example.invalid/workflow.tgz', sha256: 'a'.repeat(64) }, compatibleConverter: '>=1.0.0 <2.0.0', agentProtocolVersion: 4 },
  }), privateKey);
  writeSigned(converter, releasePayload('converter', '1.0.0', {
    '1.0.0': { packageName: '@test/converter', artifact: { url: 'https://example.invalid/converter.tgz', sha256: 'b'.repeat(64) }, compatibleWorkflow: '>=1.0.0 <2.0.0' },
  }), privateKey);
  return { workflow, converter };
}

function completeJob(jobs, knowledge) {
  let job = jobs.create({
    sourceNid: 100,
    mode: 'platform',
    workflowRuntime: { version: '1.0.0' },
    converterRuntime: { version: '1.0.0' },
    knowledgeRuntime: knowledge,
  });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
}

test('signed Knowledge Runtime installs, validates internal hashes, and exposes only bounded relevant cards', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-knowledge-install-'));
  try {
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    seedBaseRuntimes(registry);
    const value = createKnowledgePackage(path.join(temporary, 'knowledge-1.0.0'), '1.0.0');
    const installed = await new ArtifactInstaller({ appPaths: paths, registry }).install('knowledge', '1.0.0', knowledgeDescriptor(value));
    assert.equal(installed.cardCount, 1);
    assert.equal(registry.readCurrent().knowledge.version, '1.0.0');
    const runtime = new KnowledgeRuntime({ registry });
    const result = runtime.search({ diagnosticCodes: ['AST_TRANSLATE_RESULT'] }, { limit: 3 });
    assert.equal(result.resultCount, 1);
    assert.equal(result.cards[0].ruleId, 'AST-GET-001');
    assert.equal(Object.hasOwn(result.cards[0].evidence, 'provenanceIds'), false);
    assert.deepEqual(result.pin.ruleIds, ['AST-GET-001']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Knowledge package rejects maintainer-only layout and executable package surfaces', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-knowledge-layout-'));
  try {
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    seedBaseRuntimes(registry);
    const value = createKnowledgePackage(path.join(temporary, 'knowledge-1.0.0'), '1.0.0', { extraFile: 'maintainer-source/private-notes.md' });
    await assert.rejects(new ArtifactInstaller({ appPaths: paths, registry }).install('knowledge', '1.0.0', knowledgeDescriptor(value)), { code: 'KNOWLEDGE_PACKAGE_INVALID' });
    assert.equal(registry.readCurrent().knowledge, null);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('signed Knowledge updates are atomic, version-pinned searches survive activation changes, and rollback is verified', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-knowledge-update-'));
  try {
    const baseKeys = crypto.generateKeyPairSync('ed25519');
    const knowledgeKeys = crypto.generateKeyPairSync('ed25519');
    const basePrivatePem = baseKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const basePublicPem = baseKeys.publicKey.export({ type: 'spki', format: 'pem' });
    const knowledgePrivatePem = knowledgeKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const knowledgePublicPem = knowledgeKeys.publicKey.export({ type: 'spki', format: 'pem' });
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    seedBaseRuntimes(registry);
    const installer = new ArtifactInstaller({ appPaths: paths, registry });
    const v1 = createKnowledgePackage(path.join(temporary, 'knowledge-1.0.0'), '1.0.0');
    const v2 = createKnowledgePackage(path.join(temporary, 'knowledge-1.1.0'), '1.1.0', { cards: [card('AST-GET-002')] });
    const channels = baseChannels(temporary, basePrivatePem);
    const knowledgeChannel = path.join(temporary, 'knowledge.json');
    writeSigned(knowledgeChannel, releasePayload('knowledge', '1.0.0', { '1.0.0': knowledgeDescriptor(v1) }), knowledgePrivatePem);
    const config = {
      releaseManifests: { ...channels, knowledge: knowledgeChannel }, releasePublicKeyPem: basePublicPem, releasePublicKeys: { knowledge: knowledgePublicPem }, allowUnsignedLocalManifests: false,
      update: { channel: 'stable', workflowPolicy: 'prompt', converterPolicy: 'prompt', knowledgePolicy: 'prompt' },
    };
    const manager = new UpdateManager({ config, registry, installer, bundledWorkflowVersion: '1.0.0', bundledAgentProtocolVersion: 4 });
    await manager.apply({ kinds: ['knowledge'] });
    const pinnedV1 = createKnowledgePin(registry.readCurrent().knowledge);
    assert.equal(new KnowledgeRuntime({ registry }).search({ diagnosticCodes: ['AST_TRANSLATE_RESULT'] }, { pin: pinnedV1 }).cards[0].ruleId, 'AST-GET-001');

    writeSigned(knowledgeChannel, releasePayload('knowledge', '1.1.0', {
      '1.0.0': knowledgeDescriptor(v1), '1.1.0': knowledgeDescriptor(v2),
    }), knowledgePrivatePem);
    const update = await manager.apply({ kinds: ['knowledge'] });
    assert.equal(update.current.knowledge.version, '1.1.0');
    assert.equal(new KnowledgeRuntime({ registry }).search({ diagnosticCodes: ['AST_TRANSLATE_RESULT'] }, { pin: pinnedV1 }).cards[0].ruleId, 'AST-GET-001');
    assert.equal((await manager.rollback('knowledge')).knowledge.version, '1.0.0');

    registry.activate('knowledge', '1.1.0');
    writeSigned(knowledgeChannel, releasePayload('knowledge', '1.1.0', {
      '1.0.0': knowledgeDescriptor(v1), '1.1.0': knowledgeDescriptor(v2),
    }, ['1.0.0']), knowledgePrivatePem);
    await assert.rejects(manager.rollback('knowledge'), { code: 'RUNTIME_ROLLBACK_REVOKED' });
    assert.equal(registry.readCurrent().knowledge.version, '1.1.0');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('corrupt or incompatible Knowledge candidates never replace the active runtime', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-knowledge-safe-fail-'));
  try {
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    seedBaseRuntimes(registry);
    const installer = new ArtifactInstaller({ appPaths: paths, registry });
    const good = createKnowledgePackage(path.join(temporary, 'knowledge-1.0.0'), '1.0.0');
    await installer.install('knowledge', '1.0.0', knowledgeDescriptor(good));
    const incompatible = createKnowledgePackage(path.join(temporary, 'knowledge-2.0.0'), '2.0.0', { compatibleWorkflow: '>=2.0.0 <3.0.0' });
    await assert.rejects(installer.install('knowledge', '2.0.0', knowledgeDescriptor(incompatible)), { code: 'RUNTIME_VERSION_INCOMPATIBLE' });
    assert.equal(registry.readCurrent().knowledge.version, '1.0.0');

    const corruptedDescriptor = knowledgeDescriptor(good);
    corruptedDescriptor.artifact.sha256 = 'f'.repeat(64);
    await assert.rejects(installer.install('knowledge', '1.0.1', corruptedDescriptor), { code: 'RUNTIME_INTEGRITY_FAILED' });
    assert.equal(registry.readCurrent().knowledge.version, '1.0.0');

    const internallyCorrupt = createKnowledgePackage(path.join(temporary, 'knowledge-1.1.0-corrupt'), '1.1.0', { tamperAfterManifest: true });
    await assert.rejects(installer.install('knowledge', '1.1.0', knowledgeDescriptor(internallyCorrupt)), { code: 'KNOWLEDGE_CONTENT_INTEGRITY_FAILED' });
    assert.equal(registry.readCurrent().knowledge.version, '1.0.0');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Migration Job and Runtime Review keep immutable Knowledge pins, used rule IDs, and redacted feedback', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-knowledge-audit-'));
  try {
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    seedBaseRuntimes(registry);
    const value = createKnowledgePackage(path.join(temporary, 'knowledge-1.0.0'), '1.0.0');
    await new ArtifactInstaller({ appPaths: paths, registry }).install('knowledge', '1.0.0', knowledgeDescriptor(value));
    const pin = createKnowledgePin(registry.readCurrent().knowledge);
    const jobs = new JobStore(paths);
    const job = completeJob(jobs, pin);
    assert.deepEqual(job.runtime.knowledge, pin);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const review = reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: {
        workflow: { version: '1.0.0', sha256: 'a'.repeat(64) },
        converter: { version: '1.0.0', sha256: 'b'.repeat(64) },
        knowledge: pin,
      },
      targetSnapshot: { case: { nid: 200 } },
    });
    const knowledge = new KnowledgeRuntime({ registry });
    const search = knowledge.search({ behaviorMismatches: ['callback-result-empty'] }, { pin });
    const usage = reviews.recordKnowledgeUsage(review.reviewId, search);
    assert.deepEqual(usage.review.runtime.knowledge.ruleIds, ['AST-GET-001']);
    const feedback = knowledge.createFeedback({
      ruleId: 'AST-GET-001',
      summary: 'The reviewed runtime trace contradicts the current invariant in this bounded scenario.',
      evidenceRefs: ['traces/trace-1.json'],
      suggestedStatus: 'PENDING_RUNTIME',
    }, { pin });
    assert.equal(reviews.writeKnowledgeFeedback(review.reviewId, feedback).sensitivity, 'REDACTED');
    assert.equal(jobs.load(job.jobId).runtime.knowledge.contentSha256, pin.contentSha256);

    const queryFile = path.join(temporary, 'query.json');
    fs.writeFileSync(queryFile, JSON.stringify({ diagnosticCodes: ['AST_TRANSLATE_RESULT'] }));
    const cliSearch = runCli(paths.home, ['knowledge', 'search', '--review', review.reviewId, '--file', queryFile]);
    assert.deepEqual(cliSearch.cards.map((entry) => entry.ruleId), ['AST-GET-001']);
    assert.equal(JSON.stringify(cliSearch).includes('public-fixture-1'), false);
    const feedbackFile = path.join(temporary, 'feedback.json');
    fs.writeFileSync(feedbackFile, JSON.stringify({
      ruleId: 'AST-GET-001',
      summary: 'A second bounded review also needs maintainer confirmation.',
      evidenceRefs: ['traces/trace-2.json'],
      suggestedStatus: 'PENDING_RUNTIME',
    }));
    assert.equal(runCli(paths.home, ['knowledge', 'feedback', '--review', review.reviewId, '--file', feedbackFile]).kind, 'knowledge-feedback-report');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
