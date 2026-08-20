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
  const exploration = deepReadOnlyExploration();
  exploration.scope = overrides.scope || 'WHOLE_CASE';
  if (outcome === 'OBSERVED_MISMATCH') exploration.candidateFlows[0].result = 'MISMATCH';
  if (outcome === 'INCONCLUSIVE') {
    Object.assign(exploration.candidateFlows[0], {
      executionScope: 'BLOCKED',
      verificationDepth: 'NONE',
      effectObservation: 'UNKNOWN',
      postconditionObserved: false,
      result: 'INCONCLUSIVE',
      stopReason: 'The paired business result could not be observed.',
      blocker: {
        kind: 'TEST_HARNESS',
        unblockingDisposition: 'ATTEMPTED',
        attemptCount: 1,
        summary: 'The Agent attempted bounded recovery but could not observe the business result.',
        evidenceRefs: [],
      },
    });
    exploration.coverageAssessment = {
      status: 'BLOCKED', inventoryComplete: true, surfaceReconciled: true,
      coveredUnitCount: 0, gapUnitCount: 1, criticalGapCount: 1, importantGapCount: 0, edgeGapCount: 0,
      residualGapUnitIds: ['unit-main-page'], unresolvedInventory: [],
    };
    Object.assign(exploration.queue, { fullyExecutedCount: 0, blockedCount: 1, exhausted: false });
  }
  return exploration;
}

function deepReadOnlyExploration() {
  return {
    scope: 'WHOLE_CASE',
    inventory: {
      smokeTestCompleted: true,
      staticArtifactsInspected: true,
      runtimeSurfaceInspected: true,
      navigationInspected: true,
      serviceCallsInspected: true,
    },
    sideEffectPolicy: { mode: 'NOT_AUTHORIZED', scopeSummary: null },
    surfaceInventory: {
      units: [{
        unitId: 'unit-main-page',
        kind: 'PAGE_VIEW',
        summary: 'Redacted primary business page.',
        criticality: 'CORE',
        discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI'],
        disposition: 'MAPPED_TO_FLOW',
        reason: null,
        evidenceRefs: [],
      }],
      summary: { unitCount: 1, mappedCount: 1, excludedCount: 0, deferredCount: 0, reconciled: true },
    },
    candidateFlows: [{
      flowId: 'flow-main-read',
      summary: 'Redacted primary read-only business flow.',
      criticality: 'CORE',
      coverageUnitIds: ['unit-main-page'],
      discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI', 'RUNTIME_NETWORK'],
      preconditionSummary: 'The paired applications are initialized with equivalent user context.',
      expectedResultSummary: 'The same business page and data state are observable.',
      effectClass: 'READ_ONLY',
      executionScope: 'FULLY_EXECUTED',
      verificationDepth: 'READ_ONLY_RESULT',
      effectObservation: 'NONE',
      postconditionObserved: true,
      result: 'MATCHED',
      stepCount: 4,
      stopReason: null,
      blocker: null,
      evidenceRefs: [],
    }],
    coverageAssessment: {
      status: 'COMPLETE',
      inventoryComplete: true,
      surfaceReconciled: true,
      coveredUnitCount: 1,
      gapUnitCount: 0,
      criticalGapCount: 0,
      importantGapCount: 0,
      edgeGapCount: 0,
      residualGapUnitIds: [],
      unresolvedInventory: [],
    },
    queue: {
      candidateCount: 1,
      fullyExecutedCount: 1,
      preSubmitCount: 0,
      blockedCount: 0,
      notExecutedCount: 0,
      unknownEffectCount: 0,
      exhausted: true,
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
    claims: { strictParityClaimed: false, workflowRestrictionsApplied: false, wholeCaseObservedEquivalentClaimed: false },
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
    assert.equal(handoff.observationContract.surfaceReconciliationRequired, true);
    assert.equal(handoff.observationContract.coverageDepthRequired, true);
    assert.equal(handoff.observationContract.observedOutcomeSeparatedFromCoverageStatus, true);
    assert.equal(handoff.observationContract.authorizedSideEffectTestingSupported, true);
    assert.equal(handoff.observationContract.postWriteEvidenceRequired, true);
    assert.equal(handoff.observationContract.writeMayStopAtPreSubmitBoundary, true);
    assert.equal(fs.existsSync(path.join(f.reviews.reviewDir(f.review.reviewId), 'agent-direct-tests')), false);
    assert.equal(Object.hasOwn(publicApi, 'AgentDirectTestStore'), false);
    assert.equal(Object.hasOwn(publicApi, 'validateAgentDirectTestAuthorization'), false);
    assert.equal(Object.hasOwn(publicApi, 'validateAgentTestAttestation'), false);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('Agent Native separates matched observed behavior from partial coverage with an unknown unexecuted flow', () => {
  const f = fixture();
  try {
    const shallow = observation(f, { outcome: 'OBSERVED_EQUIVALENT' });
    shallow.coverage.businessFlows = 2;
    shallow.exploration.surfaceInventory.units.push({
      unitId: 'unit-third-service',
      kind: 'EVENT_SERVICE',
      summary: 'A third service call remains unclassified.',
      criticality: 'IMPORTANT',
      discoverySources: ['RUNTIME_NETWORK'],
      disposition: 'MAPPED_TO_FLOW',
      reason: null,
      evidenceRefs: [],
    });
    Object.assign(shallow.exploration.surfaceInventory.summary, { unitCount: 2, mappedCount: 2 });
    shallow.exploration.candidateFlows.push({
      flowId: 'flow-third-service',
      summary: 'A third service request remains unclassified.',
      criticality: 'IMPORTANT',
      coverageUnitIds: ['unit-third-service'],
      discoverySources: ['RUNTIME_NETWORK'],
      preconditionSummary: 'The business page has reached the state that emits the third request.',
      expectedResultSummary: 'The request effect and paired business result can be classified.',
      effectClass: 'UNKNOWN',
      executionScope: 'NOT_EXECUTED',
      verificationDepth: 'NONE',
      effectObservation: 'UNKNOWN',
      postconditionObserved: false,
      result: 'NOT_OBSERVED',
      stepCount: 0,
      stopReason: 'The service effect could not yet be classified.',
      blocker: {
        kind: 'UNKNOWN',
        unblockingDisposition: 'NOT_AVAILABLE',
        attemptCount: 0,
        summary: 'Available evidence is insufficient to classify the request safely.',
        evidenceRefs: [],
      },
      evidenceRefs: [],
    });
    shallow.exploration.coverageAssessment = {
      status: 'PARTIAL', inventoryComplete: true, surfaceReconciled: true,
      coveredUnitCount: 1, gapUnitCount: 1, criticalGapCount: 0, importantGapCount: 1, edgeGapCount: 0,
      residualGapUnitIds: ['unit-third-service'], unresolvedInventory: [],
    };
    Object.assign(shallow.exploration.queue, {
      candidateCount: 2,
      notExecutedCount: 1,
      unknownEffectCount: 1,
      exhausted: false,
    });
    assert.equal(validateAgentNativeObservationBundle(shallow).exploration.coverageAssessment.status, 'PARTIAL');
    shallow.claims.wholeCaseObservedEquivalentClaimed = true;
    assert.throws(() => validateAgentNativeObservationBundle(shallow), /whole-case observed equivalence requires COMPLETE coverage/);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('current Agent Native observations reconcile the discovered business surface before claiming whole-case observed equivalence', () => {
  const f = fixture();
  try {
    const bundle = observation(f, { outcome: 'OBSERVED_EQUIVALENT', exploration: deepReadOnlyExploration() });
    bundle.claims.wholeCaseObservedEquivalentClaimed = true;
    assert.equal(validateAgentNativeObservationBundle(bundle).exploration.coverageAssessment.status, 'COMPLETE');

    const unmapped = structuredClone(bundle);
    unmapped.exploration.candidateFlows[0].coverageUnitIds = [];
    assert.throws(() => validateAgentNativeObservationBundle(unmapped), /coverageUnitIds must contain at least one unit/);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('matched pre-submit behavior remains partial coverage and cannot claim a whole-case equivalent write closure', () => {
  const f = fixture();
  try {
    const exploration = deepReadOnlyExploration();
    exploration.surfaceInventory.units = [
      {
        unitId: 'unit-form', kind: 'INTERACTION', summary: 'Redacted form interaction.', criticality: 'CORE',
        discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI'], disposition: 'MAPPED_TO_FLOW', reason: null, evidenceRefs: [],
      },
      {
        unitId: 'unit-write-result', kind: 'WRITE_POSTCONDITION', summary: 'Redacted persisted business state.', criticality: 'CORE',
        discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_NETWORK'], disposition: 'MAPPED_TO_FLOW', reason: null, evidenceRefs: [],
      },
    ];
    exploration.surfaceInventory.summary = { unitCount: 2, mappedCount: 2, excludedCount: 0, deferredCount: 0, reconciled: true };
    Object.assign(exploration.candidateFlows[0], {
      flowId: 'flow-save',
      summary: 'Redacted save flow observed only to the submit boundary.',
      coverageUnitIds: ['unit-form', 'unit-write-result'],
      effectClass: 'WRITE',
      executionScope: 'PRE_SUBMIT_BOUNDARY',
      verificationDepth: 'PRE_SUBMIT',
      effectObservation: 'NONE',
      postconditionObserved: false,
      stopReason: 'User did not authorize a business write.',
    });
    exploration.coverageAssessment = {
      status: 'PARTIAL', inventoryComplete: true, surfaceReconciled: true,
      coveredUnitCount: 1, gapUnitCount: 1, criticalGapCount: 1, importantGapCount: 0, edgeGapCount: 0,
      residualGapUnitIds: ['unit-write-result'], unresolvedInventory: [],
    };
    Object.assign(exploration.queue, { fullyExecutedCount: 0, preSubmitCount: 1 });
    const bundle = observation(f, { outcome: 'OBSERVED_EQUIVALENT', exploration });
    bundle.claims.wholeCaseObservedEquivalentClaimed = false;
    assert.equal(validateAgentNativeObservationBundle(bundle).exploration.coverageAssessment.status, 'PARTIAL');

    bundle.claims.wholeCaseObservedEquivalentClaimed = true;
    assert.throws(() => validateAgentNativeObservationBundle(bundle), /whole-case observed equivalence requires COMPLETE coverage/);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('a fully executed WRITE flow requires user authorization and post-write result evidence', () => {
  const f = fixture();
  try {
    const exploration = deepReadOnlyExploration();
    exploration.sideEffectPolicy = { mode: 'USER_AUTHORIZED', scopeSummary: 'User authorized this bounded paired business write test.' };
    exploration.surfaceInventory.units[0].kind = 'WRITE_POSTCONDITION';
    Object.assign(exploration.candidateFlows[0], {
      flowId: 'flow-write',
      summary: 'Redacted write flow with persistent result verification.',
      coverageUnitIds: ['unit-main-page'],
      effectClass: 'WRITE',
      verificationDepth: 'POST_WRITE_RESULT',
      effectObservation: 'OCCURRED',
      postconditionObserved: true,
      evidenceRefs: ['runtime/write-result.json'],
    });
    const bundle = observation(f, { outcome: 'OBSERVED_EQUIVALENT', exploration });
    bundle.effects = { occurred: true, systems: ['primary-business-system'], summaries: ['A redacted persistent state change was observed and reread.'] };
    bundle.claims.wholeCaseObservedEquivalentClaimed = true;
    assert.equal(validateAgentNativeObservationBundle(bundle).effects.occurred, true);

    const unauthorized = structuredClone(bundle);
    unauthorized.exploration.sideEffectPolicy = { mode: 'NOT_AUTHORIZED', scopeSummary: null };
    assert.throws(() => validateAgentNativeObservationBundle(unauthorized), /fully executed WRITE flow requires USER_AUTHORIZED side-effect scope/);

    const noEvidence = structuredClone(bundle);
    noEvidence.exploration.candidateFlows[0].evidenceRefs = [];
    assert.throws(() => validateAgentNativeObservationBundle(noEvidence), /post-write result evidence/);
  } finally {
    fs.rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('legacy Agent Native observations remain readable but cannot be newly submitted without business exploration', () => {
  const f = fixture();
  try {
    const legacy = observation(f);
    delete legacy.exploration;
    delete legacy.claims.wholeCaseObservedEquivalentClaimed;
    assert.throws(() => validateAgentNativeObservationBundle(legacy), /\$\.exploration is required/);
    const root = f.store.runDir(f.review.reviewId, legacy.runId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, 'observation.json'), `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    assert.equal(f.store.status(f.review.reviewId, legacy.runId).observation.outcome, 'OBSERVED_MISMATCH');
    assert.equal(f.reviews.diagnosisCandidates(f.review.reviewId)[0].nativeRunId, legacy.runId);
    assert.throws(() => f.store.submit(f.review.reviewId, legacy), /\$\.exploration is required/);

    const legacy11 = observation(f, { runId: 'native-run-011' });
    legacy11.exploration = {
      scope: 'WHOLE_CASE',
      inventory: {
        smokeTestCompleted: true,
        staticArtifactsInspected: true,
        runtimeSurfaceInspected: true,
        navigationInspected: true,
        serviceCallsInspected: true,
      },
      candidateFlows: [{
        flowId: 'flow-legacy-011',
        summary: 'Stored 0.11.0 candidate flow.',
        discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI'],
        effectClass: 'READ_ONLY',
        executionScope: 'FULLY_EXECUTED',
        result: 'MISMATCH',
        stepCount: 2,
        stopReason: null,
        evidenceRefs: [],
      }],
      queue: {
        candidateCount: 1, fullyExecutedCount: 1, preSubmitCount: 0, blockedCount: 0,
        notExecutedCount: 0, unknownEffectCount: 0, exhausted: true,
      },
    };
    delete legacy11.claims.wholeCaseObservedEquivalentClaimed;
    assert.throws(() => validateAgentNativeObservationBundle(legacy11), /sideEffectPolicy is required/);
    const legacy11Root = f.store.runDir(f.review.reviewId, legacy11.runId);
    fs.mkdirSync(legacy11Root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacy11Root, 'observation.json'), `${JSON.stringify(legacy11, null, 2)}\n`, { mode: 0o600 });
    assert.equal(f.store.status(f.review.reviewId, legacy11.runId).observation.exploration.candidateFlows[0].flowId, 'flow-legacy-011');
    assert.throws(() => f.store.submit(f.review.reviewId, legacy11), /sideEffectPolicy is required/);
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
    fs.writeFileSync(path.join(workspace, 'screenshots', 'unit-summary.json'), '{"redacted":true}\n', { mode: 0o600 });
    const bundle = observation(f);
    bundle.exploration.surfaceInventory.units[0].evidenceRefs = ['screenshots/unit-summary.json'];
    bundle.exploration.candidateFlows[0].evidenceRefs = ['screenshots/flow-summary.json'];
    assert.equal(validateAgentNativeObservationBundle(bundle).outcome, 'OBSERVED_MISMATCH');
    const result = f.store.submit(f.review.reviewId, bundle);
    assert.equal(result.review.status, 'AGENT_NATIVE_MISMATCH_OBSERVED');
    assert.equal(result.evidenceManifest.fileCount, 3);
    assert.deepEqual(result.evidenceManifest.entries.map((entry) => entry.path), ['screenshots/diff.png', 'screenshots/flow-summary.json', 'screenshots/unit-summary.json']);
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

test('Agent Native archives blocker recovery evidence and validates its unblocking disposition', () => {
  const f = fixture();
  try {
    const workspace = f.store.workspace(f.review.reviewId);
    fs.mkdirSync(path.join(workspace, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'runtime', 'blocker.json'), '{"redacted":true}\n', { mode: 0o600 });
    const bundle = observation(f, { outcome: 'INCONCLUSIVE' });
    bundle.exploration.candidateFlows[0].blocker.evidenceRefs = ['runtime/blocker.json'];
    assert.equal(f.store.submit(f.review.reviewId, bundle).evidenceManifest.fileCount, 1);

    const invalid = observation(f, { runId: 'native-run-invalid-blocker', outcome: 'INCONCLUSIVE' });
    invalid.exploration.candidateFlows[0].blocker.attemptCount = 0;
    assert.throws(() => validateAgentNativeObservationBundle(invalid), /attemptCount must be positive/);
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
    fs.mkdirSync(path.join(workspace, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'runtime', 'write-result.json'), '{"redacted":true}\n', { mode: 0o600 });
    const writeExploration = deepReadOnlyExploration();
    writeExploration.sideEffectPolicy = { mode: 'USER_AUTHORIZED', scopeSummary: 'User authorized this bounded retest write.' };
    writeExploration.surfaceInventory.units[0].kind = 'WRITE_POSTCONDITION';
    Object.assign(writeExploration.candidateFlows[0], {
      effectClass: 'WRITE',
      verificationDepth: 'POST_WRITE_RESULT',
      effectObservation: 'OCCURRED',
      evidenceRefs: ['runtime/write-result.json'],
    });
    const retest = observation(f, {
      runId: 'native-run-002', previousRunId: 'native-run-001', purpose: 'USER_RETEST', outcome: 'OBSERVED_EQUIVALENT',
      sourceWorkId: 'source-newer', targetWorkId: 'target-newer',
      exploration: writeExploration,
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
