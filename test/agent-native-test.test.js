import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as publicApi from '../src/index.js';
import { validateAgentNativeObservationBundle } from '../src/contracts/schema-v2.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { AgentNativeStore } from '../src/runtime/agent-native-store.js';

const NOW = '2026-08-18T06:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function runtimePins() {
  return {
    workflow: { version: '0.9.0', sha256: HASH_A },
    converter: { version: '1.2.5', sha256: HASH_B },
    knowledge: { version: '0.1.6', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function completedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-original' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-original' } } });
  jobs.writeArtifact(job.jobId, 'v4/app.json', { case: { nid: 100 }, stage: {}, server: {} });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', { case: { nid: 200 }, stage: {}, server: {} });
  return job;
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-native-'));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const jobs = new JobStore(paths);
  const job = completedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const review = reviews.create({ jobId: job.jobId, capability: 'WRITE', runtime: runtimePins(), targetSnapshot: { case: { nid: 200 }, stage: {}, server: {} } });
  const store = new AgentNativeStore(paths, { jobs, reviews, now: () => new Date(NOW) });
  return { temporary, paths, jobs, job, reviews, review, store };
}

function businessExploration(outcome, overrides = {}) {
  const result = outcome === 'OBSERVED_MISMATCH' ? 'MISMATCH' : outcome === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'MATCHED';
  const executionScope = outcome === 'INCONCLUSIVE' ? 'BLOCKED' : 'FULLY_EXECUTED';
  return {
    scope: overrides.scope || 'WHOLE_CASE',
    inventory: {
      smokeTestCompleted: true,
      staticArtifactsInspected: true,
      runtimeSurfaceInspected: true,
      navigationInspected: true,
      serviceCallsInspected: true,
    },
    candidateFlows: [{
      flowId: 'flow-main-read',
      summary: 'Redacted primary read-only business flow.',
      discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI', 'RUNTIME_NETWORK'],
      effectClass: 'READ_ONLY',
      executionScope,
      result,
      stepCount: 4,
      stopReason: executionScope === 'BLOCKED' ? 'The paired business result could not be observed.' : null,
      evidenceRefs: [],
    }],
    queue: {
      candidateCount: 1,
      fullyExecutedCount: executionScope === 'FULLY_EXECUTED' ? 1 : 0,
      preSubmitCount: 0,
      blockedCount: executionScope === 'BLOCKED' ? 1 : 0,
      notExecutedCount: 0,
      unknownEffectCount: 0,
      exhausted: executionScope === 'FULLY_EXECUTED',
    },
  };
}

function observation(f, overrides = {}) {
  const runId = overrides.runId || 'native-run-001';
  const outcome = overrides.outcome || 'OBSERVED_MISMATCH';
  return {
    schemaVersion: 2,
    kind: 'agent-native-observation-bundle',
    runId,
    previousRunId: overrides.previousRunId ?? null,
    repairBatchId: overrides.repairBatchId ?? null,
    reviewId: f.review.reviewId,
    jobId: f.job.jobId,
    purpose: overrides.purpose || 'INITIAL_TEST',
    subjects: {
      source: { nid: 100, workId: overrides.sourceWorkId || 'source-observed-later', url: 'https://source.example.test/play/a', origin: 'https://source.example.test' },
      target: { nid: 200, workId: overrides.targetWorkId || 'target-observed-later', url: 'https://target.example.test/play/b', origin: 'https://target.example.test' },
    },
    environment: { comparisonId: null, status: null, differences: [{ path: '/config/name', summary: 'IGNORED_FOR_NATIVE_TEST' }] },
    execution: { tools: ['agent-chosen-browser', 'agent-authored-script'], startedAt: NOW, completedAt: NOW },
    outcome,
    coverage: { businessFlows: 1, states: 8, actions: 12, assertions: 5, screenshots: 2, networkObservations: 4 },
    exploration: overrides.exploration || businessExploration(outcome),
    effects: overrides.effects || { occurred: false, systems: [], summaries: [] },
    findings: outcome === 'OBSERVED_MISMATCH'
      ? [{ findingId: 'finding-1', severity: 'ERROR', status: 'MISMATCH', summary: 'The observed V5 behavior differs from V4.', candidateCause: 'TARGET_CASE', evidenceRefs: ['screenshots/diff.png'] }]
      : outcome === 'INCONCLUSIVE'
        ? [{ findingId: 'finding-2', severity: 'WARNING', status: 'INCONCLUSIVE', summary: 'The business result could not be observed.', candidateCause: 'TEST_HARNESS', evidenceRefs: [] }]
        : [{ findingId: 'finding-3', severity: 'INFO', status: 'MATCHED', summary: 'The tested behavior matched.', candidateCause: null, evidenceRefs: [] }],
    evidenceRefs: outcome === 'OBSERVED_MISMATCH' ? ['screenshots/diff.png'] : [],
    claims: { strictParityClaimed: false, workflowRestrictionsApplied: false },
    completedAt: NOW,
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  };
}

test('Agent Native handoff has no Workflow execution authorization, session, environment, revision, origin, or side-effect gate', () => {
  const f = fixture();
  try {
    const handoff = f.store.handoff(f.review.reviewId, {
      sourceInfo: { nid: 100, workId: 'source-current-not-baseline', url: 'https://new-source.example.test/play/a', origin: 'https://new-source.example.test' },
      targetInfo: { nid: 200, workId: 'target-current-not-baseline', url: 'https://new-target.example.test/play/b', origin: 'https://new-target.example.test' },
    });
    assert.equal(handoff.mode, 'AGENT_NATIVE');
    assert.equal(handoff.workflow.restrictionsApplied, false);
    assert.equal(handoff.workflow.authorizationRequired, false);
    assert.equal(handoff.workflow.sessionCreated, false);
    assert.equal(handoff.workflow.credentialTransport, 'AGENT_DECIDES');
    assert.equal(handoff.workflow.sideEffectPolicy, 'AGENT_DECIDES');
    assert.equal(handoff.environment.status, null);
    assert.equal(handoff.subjects.source.workId, 'source-current-not-baseline');
    assert.equal(handoff.job.root, f.jobs.jobDir(f.job.jobId));
    assert.equal(handoff.observationContract.businessFlowCoverageRequired, true);
    assert.equal(handoff.observationContract.unknownEffectRequiresInconclusive, true);
    assert.equal(handoff.observationContract.writeMayStopAtPreSubmitBoundary, true);
    assert.equal(fs.existsSync(path.join(f.reviews.reviewDir(f.review.reviewId), 'agent-direct-tests')), false);
    assert.equal(Object.hasOwn(publicApi, 'AgentDirectTestStore'), false);
    assert.equal(Object.hasOwn(publicApi, 'validateAgentDirectTestAuthorization'), false);
    assert.equal(Object.hasOwn(publicApi, 'validateAgentTestAttestation'), false);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native cannot report equivalence while an unknown candidate business flow remains unexecuted', () => {
  const f = fixture();
  try {
    const shallow = observation(f, { outcome: 'OBSERVED_EQUIVALENT' });
    shallow.coverage.businessFlows = 2;
    shallow.exploration.candidateFlows.push({
      flowId: 'flow-third-service',
      summary: 'A third service request remains unclassified.',
      discoverySources: ['RUNTIME_NETWORK'],
      effectClass: 'UNKNOWN',
      executionScope: 'NOT_EXECUTED',
      result: 'NOT_OBSERVED',
      stepCount: 0,
      stopReason: 'The service effect could not yet be classified.',
      evidenceRefs: [],
    });
    Object.assign(shallow.exploration.queue, {
      candidateCount: 2,
      notExecutedCount: 1,
      unknownEffectCount: 1,
      exhausted: false,
    });
    assert.throws(() => validateAgentNativeObservationBundle(shallow), /OBSERVED_EQUIVALENT requires an exhausted candidate-flow queue/);

    shallow.outcome = 'INCONCLUSIVE';
    shallow.findings = [{
      findingId: 'finding-third-service',
      severity: 'WARNING',
      status: 'INCONCLUSIVE',
      summary: 'Core flow coverage remains incomplete because one service effect is unknown.',
      candidateCause: 'TEST_HARNESS',
      evidenceRefs: [],
    }];
    assert.equal(validateAgentNativeObservationBundle(shallow).outcome, 'INCONCLUSIVE');
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('legacy Agent Native observations remain readable but cannot be newly submitted without business exploration', () => {
  const f = fixture();
  try {
    const legacy = observation(f);
    delete legacy.exploration;
    assert.throws(() => validateAgentNativeObservationBundle(legacy), /\$\.exploration is required/);
    const root = f.store.runDir(f.review.reviewId, legacy.runId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, 'observation.json'), `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    assert.equal(f.store.status(f.review.reviewId, legacy.runId).observation.outcome, 'OBSERVED_MISMATCH');
    assert.equal(f.reviews.diagnosisCandidates(f.review.reviewId)[0].nativeRunId, legacy.runId);
    assert.throws(() => f.store.submit(f.review.reviewId, legacy), /\$\.exploration is required/);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native archives mismatch evidence and exposes it to Diagnosis v2 without parity claims', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'diff.png'), 'redacted paired screenshot', { mode: 0o600 });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'flow-summary.json'), '{"redacted":true}\n', { mode: 0o600 });
    const bundle = observation(f);
    bundle.exploration.candidateFlows[0].evidenceRefs = ['screenshots/flow-summary.json'];
    assert.equal(validateAgentNativeObservationBundle(bundle).outcome, 'OBSERVED_MISMATCH');
    const result = f.store.submit(f.review.reviewId, bundle);
    assert.equal(result.review.status, 'AGENT_NATIVE_MISMATCH_OBSERVED');
    assert.equal(result.evidenceManifest.fileCount, 2);
    assert.deepEqual(result.evidenceManifest.entries.map((entry) => entry.path), ['screenshots/diff.png', 'screenshots/flow-summary.json']);
    const candidates = f.reviews.diagnosisCandidates(f.review.reviewId);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sourceKind, 'AGENT_NATIVE_OBSERVATION');
    assert.equal(candidates[0].nativeRunId, bundle.runId);
    assert.equal(candidates[0].evidenceRef, `artifact:agent-native/runs/${bundle.runId}/observation.json`);
    f.reviews.transition(f.review.reviewId, 'DIAGNOSING');
    const historyLength = f.reviews.load(f.review.reviewId).history.length;
    const recovered = f.store.submit(f.review.reviewId, bundle);
    assert.equal(recovered.review.status, 'DIAGNOSING');
    assert.equal(recovered.review.history.length, historyLength);
    assert.equal(recovered.evidenceManifest.sha256, result.evidenceManifest.sha256);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native resumes an interrupted immutable run before Review recording', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'diff.png'), 'redacted paired screenshot', { mode: 0o600 });
    const bundle = observation(f);
    const root = f.store.runDir(f.review.reviewId, bundle.runId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, 'observation.json'), `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
    const recovered = f.store.submit(f.review.reviewId, bundle);
    assert.equal(recovered.review.status, 'AGENT_NATIVE_MISMATCH_OBSERVED');
    assert.equal(recovered.evidenceManifest.fileCount, 1);
    assert.equal(fs.existsSync(path.join(root, 'review-recorded.json')), true);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent/LLM classification of Native evidence enters the existing managed diagnosis policy without semantic substitution', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'diff.png'), 'redacted', { mode: 0o600 });
    f.store.submit(f.review.reviewId, observation(f));
    const [candidate] = f.reviews.diagnosisCandidates(f.review.reviewId);
    const result = f.reviews.submitDiagnosis(f.review.reviewId, {
      classification: {
        schemaVersion: 2,
        kind: 'issue-classification',
        jobId: f.job.jobId,
        reviewId: f.review.reviewId,
        classifiedAt: NOW,
        createdBy: 'AGENT',
        sensitivity: 'REDACTED',
        issues: [{
          issueId: candidate.issueId,
          clusterId: 'native-cluster-1',
          cause: 'TARGET_CASE',
          responsibleParty: 'WORKFLOW_AI',
          repairTarget: 'V5_ARTIFACT',
          confidence: 0.96,
          reason: 'The Agent observed a localized target artifact mismatch.',
          evidenceRefs: [candidate.evidenceRef],
          knowledgeRuleIds: [],
          autoRepairAllowed: true,
        }],
      },
    });
    assert.equal(result.review.status, 'DIAGNOSING');
    assert.equal(result.results[0].report.evidence[0].sourceKind, 'AGENT_NATIVE_OBSERVATION');
    assert.equal(result.results[0].report.evidence[0].nativeRunId, 'native-run-001');
    assert.equal(result.results[0].decision.decision, 'AUTO_REPAIR_ALLOWED');
    assert.equal(result.results[0].cluster.cause, 'TARGET_CASE');
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('FLAKY_RUNTIME is a closed non-repair cause for linked Native observations', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'diff.png'), 'redacted', { mode: 0o600 });
    f.store.submit(f.review.reviewId, observation(f));
    const [candidate] = f.reviews.diagnosisCandidates(f.review.reviewId);
    const result = f.reviews.submitDiagnosis(f.review.reviewId, {
      classification: {
        schemaVersion: 2,
        kind: 'issue-classification',
        jobId: f.job.jobId,
        reviewId: f.review.reviewId,
        classifiedAt: NOW,
        createdBy: 'AGENT',
        sensitivity: 'REDACTED',
        issues: [{
          issueId: candidate.issueId,
          clusterId: 'native-flaky-cluster',
          cause: 'FLAKY_RUNTIME',
          responsibleParty: 'UNKNOWN',
          repairTarget: 'NONE',
          confidence: 0.9,
          reason: 'Repeated runtime observations are not stable enough for target attribution.',
          evidenceRefs: [candidate.evidenceRef],
          knowledgeRuleIds: [],
          autoRepairAllowed: false,
        }],
      },
    });
    assert.equal(result.results[0].report.reportType, 'FLAKY_RUNTIME');
    assert.equal(result.results[0].decision.decision, 'AUTO_REPAIR_STOPPED');
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native retest is linked but accepts newly observed revisions, origins, tools, and side effects as facts', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'screenshots', 'diff.png'), 'redacted', { mode: 0o600 });
    f.store.submit(f.review.reviewId, observation(f));
    const retest = observation(f, {
      runId: 'native-run-002', previousRunId: 'native-run-001', purpose: 'USER_RETEST', outcome: 'OBSERVED_EQUIVALENT',
      sourceWorkId: 'source-newer', targetWorkId: 'target-newer',
      effects: { occurred: true, systems: ['test-backend'], summaries: ['Agent observed one user-authorized test write.'] },
    });
    retest.subjects.source.url = 'https://alternate-source.example.test/path';
    retest.subjects.source.origin = 'https://alternate-source.example.test';
    const result = f.store.submit(f.review.reviewId, retest);
    assert.equal(result.review.status, 'AGENT_NATIVE_EQUIVALENCE_OBSERVED');
    assert.equal(f.store.list(f.review.reviewId).length, 2);
    assert.equal(f.store.status(f.review.reviewId, 'native-run-002').observation.effects.occurred, true);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native rejects secret-bearing fields and unsafe evidence without consuming the run id', () => {
  const f = fixture();
  try {
    const secret = { ...observation(f), cookie: 'forbidden' };
    assert.throws(() => validateAgentNativeObservationBundle(secret), /forbidden secret-bearing field/);
    assert.throws(() => f.store.submit(f.review.reviewId, observation(f)), { code: 'AGENT_NATIVE_EVIDENCE_MISSING' });
    assert.equal(fs.existsSync(f.store.runDir(f.review.reviewId, 'native-run-001')), false);
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
    fs.symlinkSync(outside, path.join(f.store.workspace(f.review.reviewId), 'escape'), 'dir');
    const unsafe = observation(f);
    unsafe.findings[0].evidenceRefs = ['escape/private.txt'];
    unsafe.evidenceRefs = ['escape/private.txt'];
    assert.throws(() => f.store.submit(f.review.reviewId, unsafe), { code: 'AGENT_NATIVE_EVIDENCE_PATH_INVALID' });
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});
