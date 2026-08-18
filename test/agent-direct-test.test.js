import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  validateAgentDirectTestAuthorization,
  validateAgentTestAttestation,
} from '../src/contracts/schema-v2.js';
import { evaluateEnvironmentGate } from '../src/environment/environment-gate.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { AgentDirectTestStore } from '../src/runtime/agent-direct-test-store.js';

const NOW = '2026-08-17T08:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function runtimePins() {
  return {
    workflow: { version: '0.8.0', sha256: HASH_A },
    converter: { version: '1.2.5', sha256: HASH_B },
    knowledge: { version: '0.1.6', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function completedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
  jobs.writeArtifact(job.jobId, 'v4/app.json', { case: { nid: 100 }, stage: {}, server: {} });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', { case: { nid: 200 }, stage: {}, server: {} });
  return job;
}

function fixture(root) {
  const paths = createAppPaths(root);
  const jobs = new JobStore(paths);
  const job = completedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const review = reviews.create({ jobId: job.jobId, runtime: runtimePins(), targetSnapshot: { case: { nid: 200 }, stage: {}, server: {} } });
  const evaluation = evaluateEnvironmentGate({
    reviewId: review.reviewId,
    sourceManifestId: 'env-source-direct-1',
    targetManifestId: 'env-target-direct-1',
    comparisonId: 'env-comparison-direct-1',
    source: { revision: { nid: 100, workId: 'source-work-1' }, workInfo: {}, config: {}, settings: {} },
    target: { revision: { nid: 200, workId: 'target-work-1' }, workInfo: {}, config: {}, settings: {} },
    evaluatedAt: NOW,
  });
  reviews.recordEnvironmentEvaluation(review.reviewId, evaluation);
  const store = new AgentDirectTestStore(paths, { jobs, reviews, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  return { paths, jobs, job, reviews, review, evaluation, store };
}

function attestation(f, authorization, sessionId, evidenceRefs = []) {
  return {
    schemaVersion: 2,
    kind: 'agent-test-attestation',
    attestationId: 'agent-attestation-1',
    sessionId,
    authorizationId: authorization.authorizationId,
    reviewId: f.review.reviewId,
    jobId: f.job.jobId,
    sourceRevision: authorization.source,
    targetRevision: authorization.target,
    environment: authorization.environment,
    capability: authorization.capability,
    executor: { kind: 'LOCAL_AI_AGENT', product: 'Codex', tools: ['browser-control', 'local-analysis'] },
    outcome: 'AGENT_ATTESTED_PARITY_OBSERVED',
    coverage: { businessFlows: 2, states: 8, actions: 6, assertions: 4, screenshots: 1, networkObservations: 2 },
    effects: { attempted: false, operationCount: 0, systems: [], objectTypes: [], actionClasses: [] },
    findings: [],
    evidenceRefs,
    claims: { parityObserved: true, strictParityClaimed: false, workflowDriverUsed: false, targetModifiedByTest: false },
    completedAt: NOW,
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  };
}

test('Agent Direct read-only session hands full control to the Agent and archives an attestation without changing Review state', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-direct-'));
  try {
    const f = fixture(temporary);
    const reviewBefore = fs.readFileSync(f.reviews.statePath(f.review.reviewId));
    const authorization = f.store.authorize(f.review.reviewId, {
      environmentComparisonId: f.evaluation.comparison.comparisonId,
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    assert.equal(validateAgentDirectTestAuthorization(authorization).capability, 'AGENT_DIRECT_READ_ONLY');
    assert.equal(authorization.scope.workflowDriver, 'NOT_PROVIDED');
    assert.equal(authorization.scope.browserControl, 'AGENT_DIRECT');
    const context = f.store.start(f.review.reviewId, authorization.authorizationId, {
      sourceBaseUrl: 'https://source.example.test/play/source',
      targetBaseUrl: 'https://target.example.test/play/target',
    });
    assert.equal(context.workflowExecution.browserDriver, 'NOT_PROVIDED');
    assert.equal(context.workflowExecution.actionPlanner, 'NOT_PROVIDED');
    assert.equal(context.credentialPolicy.access, 'AGENT_LOCAL_USE');
    assert.deepEqual(context.credentialPolicy, {
      access: 'AGENT_LOCAL_USE',
      valuesIncluded: false,
      userDirectInput: 'EPHEMERAL_BROWSER_USE_ALLOWED',
      browserUse: 'AUTHORIZED_SUBJECTS_ONLY',
      agentToolTransport: 'MINIMUM_BROWSER_OPERATION_ONLY',
      workflowAccess: 'FORBIDDEN',
      persistence: 'FORBIDDEN',
      reporting: 'FORBIDDEN',
      reuse: 'CURRENT_AGENT_TASK_ONLY',
    });
    assert.equal(context.job.root, f.jobs.jobDir(f.job.jobId));
    assert.equal(context.job.manifest.entries.some((entry) => entry.path === 'v4/app.json'), true);
    fs.mkdirSync(path.join(context.session.workspaceRoot, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(context.session.workspaceRoot, 'screenshots', 'paired-root.png'), Buffer.from('redacted-image-evidence'), { mode: 0o600 });
    const report = attestation(f, authorization, context.session.sessionId, ['screenshots/paired-root.png']);
    assert.equal(validateAgentTestAttestation(report).outcome, 'AGENT_ATTESTED_PARITY_OBSERVED');
    const submitted = f.store.submit(f.review.reviewId, context.session.sessionId, {
      attestation: report,
      currentSourceWorkId: authorization.source.workId,
      currentTargetWorkId: authorization.target.workId,
    });
    assert.equal(submitted.state.status, 'COMPLETED');
    assert.equal(submitted.evidenceManifest.fileCount, 1);
    assert.match(submitted.evidenceManifest.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.store.start(f.review.reviewId, authorization.authorizationId, {
      sourceBaseUrl: 'https://source.example.test/play/source',
      targetBaseUrl: 'https://target.example.test/play/target',
    }), context);
    assert.deepEqual(fs.readFileSync(f.reviews.statePath(f.review.reviewId)), reviewBefore);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Agent Direct authorization freezes Job artifacts and side-effect capability remains fail-closed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-direct-guards-'));
  try {
    const f = fixture(temporary);
    assert.throws(() => f.store.authorize(f.review.reviewId, {
      environmentComparisonId: f.evaluation.comparison.comparisonId,
      capability: 'AGENT_DIRECT_SIDE_EFFECT',
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
    }), { code: 'AGENT_DIRECT_SIDE_EFFECT_NOT_ENABLED' });
    const authorization = f.store.authorize(f.review.reviewId, {
      environmentComparisonId: f.evaluation.comparison.comparisonId,
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    f.jobs.writeArtifact(f.job.jobId, 'reports/late-agent-test-artifact.json', { changed: true });
    assert.throws(() => f.store.start(f.review.reviewId, authorization.authorizationId, {
      sourceBaseUrl: 'https://source.example.test/play/source',
      targetBaseUrl: 'https://target.example.test/play/target',
    }), { code: 'AGENT_TEST_JOB_ARTIFACTS_CHANGED' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Agent Test Attestation rejects secrets, strict parity, Workflow-driver use, and read-only effects', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-direct-contract-'));
  try {
    const f = fixture(temporary);
    const authorization = f.store.authorize(f.review.reviewId, {
      environmentComparisonId: f.evaluation.comparison.comparisonId,
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    const base = attestation(f, authorization, 'agent-test-session-1');
    assert.throws(() => validateAgentTestAttestation({ ...base, cookie: 'forbidden' }), /forbidden secret-bearing field/);
    assert.throws(() => validateAgentTestAttestation({ ...base, claims: { ...base.claims, strictParityClaimed: true } }), /strict parity/);
    assert.throws(() => validateAgentTestAttestation({ ...base, claims: { ...base.claims, workflowDriverUsed: true } }), /Workflow-driver/);
    assert.throws(() => validateAgentTestAttestation({ ...base, effects: { attempted: true, operationCount: 1, systems: ['platform'], objectTypes: ['record'], actionClasses: ['create'] } }), /Read-only/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Agent Direct evidence cannot be missing or escape the private workspace through a symlink', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-direct-evidence-'));
  try {
    const f = fixture(temporary);
    const authorization = f.store.authorize(f.review.reviewId, {
      environmentComparisonId: f.evaluation.comparison.comparisonId,
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    const context = f.store.start(f.review.reviewId, authorization.authorizationId, {
      sourceBaseUrl: 'https://source.example.test/play/source',
      targetBaseUrl: 'https://target.example.test/play/target',
    });
    assert.throws(() => f.store.submit(f.review.reviewId, context.session.sessionId, {
      attestation: attestation(f, authorization, context.session.sessionId, ['missing.txt']),
      currentSourceWorkId: authorization.source.workId,
      currentTargetWorkId: authorization.target.workId,
    }), { code: 'AGENT_TEST_EVIDENCE_MISSING' });
    const outside = path.join(temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.txt'), 'must not be archived');
    fs.symlinkSync(outside, path.join(context.session.workspaceRoot, 'escape'), 'dir');
    assert.throws(() => f.store.submit(f.review.reviewId, context.session.sessionId, {
      attestation: attestation(f, authorization, context.session.sessionId, ['escape/private.txt']),
      currentSourceWorkId: authorization.source.workId,
      currentTargetWorkId: authorization.target.workId,
    }), { code: 'AGENT_TEST_EVIDENCE_PATH_INVALID' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Agent adapters default to Agent Native without a Workflow authorization, Session, credential probe, or readiness budget', () => {
  for (const relative of ['agents/codex/SKILL.md', 'agents/claude/SKILL.md']) {
    const skill = fs.readFileSync(path.resolve(import.meta.dirname, '..', relative), 'utf8');
    assert.match(skill, /Agent Native is the default runtime-test mode/);
    assert.match(skill, /ask exactly once whether.*runtime testing/);
    assert.match(skill, /testing, diagnosis, or automatic repair.*do not ask again/);
    assert.match(skill, /agent-native-handoff-platform/);
    assert.match(skill, /creates no authorization.*Session/);
    assert.match(skill, /workflowRestrictionsApplied:false/);
    assert.match(skill, /Workflow does not require a sentinel/);
    assert.match(skill, /does not.*impose.*readiness budget/);
    assert.match(skill, /previousRunId/);
    assert.match(skill, /repairBatchId/);
    assert.match(skill, /FLAKY_RUNTIME/);
    assert.match(skill, /legacy\/audit/);
    assert.doesNotMatch(skill, /RUN_AGENT_DIRECT_READ_ONLY_TEST/);
    assert.doesNotMatch(skill, /default 300-second business-root readiness budget/);
  }
});
