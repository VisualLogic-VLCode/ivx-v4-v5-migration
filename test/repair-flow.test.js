import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateTargetRepairAuthorization } from '../src/contracts/schema-v2.js';
import { runtimeIssueId } from '../src/diagnosis/diagnosis-engine.js';
import { writePrivateJson } from '../src/fs/secure-json.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { evaluateRepairCandidate, repairPatchDigest } from '../src/repair/repair-engine.js';
import { TargetUpdateOrchestrator } from '../src/repair/target-update-orchestrator.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { revisionValueDigest } from '../src/reviews/revision-diff.js';
import { AgentNativeStore } from '../src/runtime/agent-native-store.js';

const NOW = '2030-01-01T00:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function sourceV4() {
  return {
    case: { id: 'case-root', type: 'ih5-case', title: 'source', events: { list: [{ tree: { type: 'root' } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
}

function targetV5(title = 'wrong') {
  return {
    case: { id: 'case-root', type: 'ih5-case', title, events: { list: [{ ast: { op: 'val', val: true } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
}

function runtimePins() {
  return {
    workflow: { version: '0.4.0', sha256: HASH_A },
    converter: { version: '1.2.1', sha256: HASH_B },
    knowledge: { version: '0.1.1', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function scenario() {
  return {
    schemaVersion: 2,
    kind: 'runtime-scenario',
    scenarioId: 'scenario-repair',
    version: 1,
    name: 'Repair regression scenario',
    source: { type: 'DETERMINISTIC', reference: 'fixture:repair' },
    sideEffect: 'READ_ONLY',
    executionPolicy: { mode: 'UNATTENDED', authorizationRequired: false, cleanupRequired: false },
    networkPolicy: { unsafeRequests: 'BLOCK' },
    artifactPolicy: { screenshots: 'OFF', nativePlaywrightTrace: false },
    preconditions: [],
    actions: [{ stepId: 'open', type: 'OPEN_PAGE', input: '/preview' }],
    assertions: [{
      assertionId: 'title-equal',
      observation: { name: 'title', category: 'UI', capture: 'TEXT', target: { strategy: 'TEST_ID', value: 'title' } },
      comparator: 'V4_V5_EQUAL',
    }],
    cleanup: [],
    knowledgeRuleIds: [],
    createdAt: NOW,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

function comparison(reviewId, status = 'MISMATCH_DETECTED', cycleId = 'cycle-original') {
  const passed = status === 'PARITY_PASSED';
  return {
    schemaVersion: 2,
    kind: 'runtime-comparison',
    comparisonId: `${cycleId}-comparison`,
    reviewId,
    cycleId,
    scenarioId: 'scenario-repair',
    sourceTraceId: `${cycleId}-v4`,
    targetTraceId: `${cycleId}-v5`,
    environment: { comparisonId: `${cycleId}-environment`, status: 'ENVIRONMENT_EQUIVALENT' },
    status,
    assertions: [{
      assertionId: 'title-equal',
      status: passed ? 'PASSED' : 'FAILED',
      reasonCode: passed ? 'NORMALIZED_VALUES_EQUAL' : 'NORMALIZED_VALUES_DIFFER',
      sourceObservationIds: ['source-title'],
      targetObservationIds: ['target-title'],
      normalizations: [],
    }],
    coverage: { total: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1, inconclusive: 0 },
    runtime: { driver: 'playwright', driverVersion: '1.62.1', sourceBrowserVersion: '140', targetBrowserVersion: '140', modes: ['UNATTENDED'], humanTakeover: false },
    evaluatedAt: NOW,
    createdAt: NOW,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

function environmentComparison(reviewId, targetWorkId) {
  return {
    schemaVersion: 2,
    kind: 'environment-comparison',
    comparisonId: `environment-${targetWorkId}`,
    reviewId,
    sourceManifestId: 'source-environment',
    targetManifestId: 'target-environment',
    sourceRevision: { nid: 100, workId: 'source-work-1' },
    targetRevision: { nid: 200, workId: targetWorkId },
    status: 'ENVIRONMENT_EQUIVALENT',
    fields: [],
    normalizedPaths: [],
    requiredBindingPaths: [],
    blockedPaths: [],
    evaluatedAt: NOW,
    createdAt: NOW,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

function completedJob(jobs) {
  const source = sourceV4();
  const target = targetV5();
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  jobs.writeArtifact(job.jobId, 'v4/app.json', source, { pretty: false });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', target, { pretty: false });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1', inputSha256: revisionValueDigest(source) } } });
  job = jobs.transition(job.jobId, 'CONVERTED', { patch: { target: { artifact: 'v5/app.v5.json', outputSha256: revisionValueDigest(target) } } });
  for (const status of ['VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1', artifact: 'v5/app.v5.json' } } });
}

function fixture(prefix) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const jobs = new JobStore(paths);
  const job = completedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW) });
  const review = reviews.create({ jobId: job.jobId, capability: 'WRITE', runtime: runtimePins(), targetSnapshot: targetV5() });
  reviews.addRuntimeScenario(review.reviewId, scenario());
  reviews.transition(review.reviewId, 'ENVIRONMENT_PREFLIGHT');
  reviews.transition(review.reviewId, 'RUNTIME_TESTING');
  reviews.transition(review.reviewId, 'MISMATCH_DETECTED');
  writePrivateJson(path.join(reviews.reviewDir(review.reviewId), 'environment', 'diagnosis-environment.json'), environmentComparison(review.reviewId, 'target-work-1'));
  const mismatch = comparison(review.reviewId);
  const evidenceFile = path.join(reviews.runtimeCycleDir(review.reviewId, mismatch.cycleId), 'comparisons', 'scenario-repair.json');
  writePrivateJson(evidenceFile, mismatch);
  const evidenceRef = `artifact:cycles/${mismatch.cycleId}/comparisons/scenario-repair.json`;
  const issueId = runtimeIssueId(mismatch.comparisonId, 'title-equal');
  const diagnosed = reviews.submitDiagnosis(review.reviewId, {
    classification: {
      schemaVersion: 2,
      kind: 'issue-classification',
      jobId: job.jobId,
      reviewId: review.reviewId,
      classifiedAt: NOW,
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
      issues: [{
        issueId,
        clusterId: 'cluster-title',
        cause: 'TARGET_CASE',
        responsibleParty: 'WORKFLOW_AI',
        repairTarget: 'V5_ARTIFACT',
        confidence: 0.96,
        reason: 'The target title is locally inconsistent with the reproduced V4 behavior.',
        evidenceRefs: [evidenceRef],
        knowledgeRuleIds: [],
        autoRepairAllowed: true,
      }],
    },
  });
  const authorization = {
    schemaVersion: 2,
    kind: 'target-repair-authorization',
    authorizationId: 'authorization-initial',
    reviewId: review.reviewId,
    scope: 'INITIAL',
    clusterIds: ['cluster-title'],
    maxAttemptsPerCluster: 3,
    maxTargetRevisions: 10,
    confirmation: 'AUTHORIZE_TARGET_REPAIR',
    expiresAt: '2030-01-01T01:00:00.000Z',
    createdAt: NOW,
    createdBy: 'USER',
    sensitivity: 'PRIVATE',
  };
  reviews.authorizeTargetRepair(review.reviewId, authorization);
  const proposal = {
    schemaVersion: 2,
    kind: 'repair-proposal',
    proposalId: 'proposal-title',
    reviewId: review.reviewId,
    authorizationId: authorization.authorizationId,
    clusterIds: ['cluster-title'],
    baseTarget: { nid: 200, workId: 'target-work-1', sha256: revisionValueDigest(targetV5()) },
    patch: [{ op: 'replace', path: '/case/title', value: 'fixed' }],
    affectedScenarioIds: ['scenario-repair'],
    evidenceRefs: [evidenceRef],
    knowledgeRuleIds: [],
    confidence: 0.96,
    rationale: 'Replace the one target-only value linked to the failed assertion.',
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  };
  const repair = reviews.submitRepairProposal(review.reviewId, proposal);
  return { temporary, paths, jobs, job, reviews, review: repair.review, diagnosed, repair };
}

class FaultAdapter {
  constructor(mode = 'success') {
    this.mode = mode;
    this.workId = mode === 'cas-drift' ? 'external-work-2' : 'target-work-1';
    this.snapshot = mode === 'cas-drift' ? targetV5('external') : targetV5();
    this.saveCalls = 0;
  }

  async getCaseInfo() { return { workId: this.workId }; }
  async loadWork() { return structuredClone(this.snapshot); }
  async saveWork({ work }) {
    this.saveCalls += 1;
    if (this.mode === 'unchanged-then-throw') {
      const error = new Error('connection lost');
      error.code = 'PLATFORM_NETWORK_FAILED';
      throw error;
    }
    this.snapshot = structuredClone(work);
    this.workId = 'target-work-2';
    if (this.mode === 'applied-then-throw') {
      const error = new Error('response lost');
      error.code = 'PLATFORM_NETWORK_FAILED';
      throw error;
    }
    return { workId: this.workId };
  }
}

class PreflightFailureAdapter extends FaultAdapter {
  async getCaseInfo() {
    const error = new Error('metadata unavailable');
    error.code = 'PLATFORM_NETWORK_FAILED';
    throw error;
  }
}

class RevisionAdapter extends FaultAdapter {
  constructor() {
    super('success');
    this.revision = 1;
  }

  async saveWork({ work }) {
    this.saveCalls += 1;
    this.revision += 1;
    this.snapshot = structuredClone(work);
    this.workId = `target-work-${this.revision}`;
    return { workId: this.workId };
  }
}

function mismatchAndDiagnose(value, targetWorkId) {
  const prepared = value.reviews.prepareRuntimeCycle(value.review.reviewId, {
    scenarioIds: ['scenario-repair'],
    source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
    target: { generation: 'V5', nid: 200, workId: targetWorkId },
    environmentComparison: environmentComparison(value.review.reviewId, targetWorkId),
  });
  writePrivateJson(path.join(value.reviews.runtimeCycleDir(value.review.reviewId, prepared.cycle.cycleId), 'comparisons', 'scenario-repair.json'), comparison(value.review.reviewId, 'MISMATCH_DETECTED', prepared.cycle.cycleId));
  value.reviews.completeRuntimeCycle(value.review.reviewId, prepared.cycle.cycleId);
  const candidates = value.reviews.diagnosisCandidates(value.review.reviewId);
  return value.reviews.submitDiagnosis(value.review.reviewId, {
    classification: {
      schemaVersion: 2,
      kind: 'issue-classification',
      jobId: value.job.jobId,
      reviewId: value.review.reviewId,
      classifiedAt: NOW,
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
      issues: candidates.map((candidate) => ({
        issueId: candidate.issueId,
        clusterId: 'cluster-title',
        cause: 'TARGET_CASE',
        responsibleParty: 'WORKFLOW_AI',
        repairTarget: 'V5_ARTIFACT',
        confidence: 0.96,
        reason: 'The reproduced mismatch remains isolated to the target title.',
        evidenceRefs: [candidate.evidenceRef],
        knowledgeRuleIds: [],
        autoRepairAllowed: true,
      })),
    },
  });
}

function submitNextProposal(value, adapter, diagnosis, authorizationId, sequence) {
  const cluster = diagnosis.results[0].cluster;
  return value.reviews.submitRepairProposal(value.review.reviewId, {
    schemaVersion: 2,
    kind: 'repair-proposal',
    proposalId: `proposal-title-${sequence}`,
    reviewId: value.review.reviewId,
    authorizationId,
    clusterIds: ['cluster-title'],
    baseTarget: { nid: 200, workId: adapter.workId, sha256: revisionValueDigest(adapter.snapshot) },
    patch: [{ op: 'replace', path: '/case/title', value: `fixed-${sequence}` }],
    affectedScenarioIds: ['scenario-repair'],
    evidenceRefs: cluster.evidenceRefs,
    knowledgeRuleIds: [],
    confidence: 0.96,
    rationale: `Bounded repair attempt ${sequence} uses the accumulated runtime evidence.`,
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  });
}

function nativeObservation(value, { runId, previousRunId = null, purpose = 'INITIAL_TEST', repairBatchId = null, outcome = 'OBSERVED_MISMATCH' }) {
  const result = outcome === 'OBSERVED_MISMATCH' ? 'MISMATCH' : 'MATCHED';
  return {
    schemaVersion: 2,
    kind: 'agent-native-observation-bundle',
    runId,
    previousRunId,
    repairBatchId,
    reviewId: value.review.reviewId,
    jobId: value.job.jobId,
    purpose,
    subjects: {
      source: { nid: 100, workId: 'source-work-1', url: 'https://source.test/play', origin: 'https://source.test' },
      target: { nid: 200, workId: 'target-work-2', url: 'https://target.test/play', origin: 'https://target.test' },
    },
    environment: { comparisonId: null, status: null, differences: [] },
    execution: { tools: ['agent-native-browser'], startedAt: NOW, completedAt: NOW },
    outcome,
    coverage: { businessFlows: 1, states: 2, actions: 2, assertions: 1, screenshots: 0, networkObservations: 0 },
    exploration: {
      scope: purpose === 'REPAIR_REGRESSION' ? 'AFFECTED_FLOWS' : 'WHOLE_CASE',
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
          unitId: 'unit-repair-target',
          kind: 'INTERACTION',
          summary: 'Redacted affected business interaction.',
          criticality: 'CORE',
          discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI'],
          disposition: 'MAPPED_TO_FLOW',
          reason: null,
          evidenceRefs: [],
        }],
        summary: { unitCount: 1, mappedCount: 1, excludedCount: 0, deferredCount: 0, reconciled: true },
      },
      candidateFlows: [{
        flowId: 'flow-repair-target',
        summary: 'Redacted affected business flow.',
        criticality: 'CORE',
        coverageUnitIds: ['unit-repair-target'],
        discoverySources: ['STATIC_ARTIFACT', 'RUNTIME_UI'],
        preconditionSummary: 'The repaired target is loaded at the affected business state.',
        expectedResultSummary: 'The paired affected interaction produces the same visible business result.',
        effectClass: 'READ_ONLY',
        executionScope: 'FULLY_EXECUTED',
        verificationDepth: 'READ_ONLY_RESULT',
        effectObservation: 'NONE',
        postconditionObserved: true,
        result,
        stepCount: 2,
        stopReason: null,
        blocker: null,
        evidenceRefs: [],
      }],
      coverageAssessment: {
        status: 'COMPLETE', inventoryComplete: true, surfaceReconciled: true,
        coveredUnitCount: 1, gapUnitCount: 0, criticalGapCount: 0, importantGapCount: 0, edgeGapCount: 0,
        residualGapUnitIds: [], unresolvedInventory: [],
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
    },
    effects: { occurred: false, systems: [], summaries: [] },
    findings: outcome === 'OBSERVED_MISMATCH'
      ? [{ findingId: `${runId}-finding`, severity: 'ERROR', status: 'MISMATCH', summary: 'Observed mismatch.', candidateCause: 'TARGET_CASE', evidenceRefs: [] }]
      : [{ findingId: `${runId}-finding`, severity: 'INFO', status: 'MATCHED', summary: 'Observed equivalent behavior after repair.', candidateCause: null, evidenceRefs: [] }],
    evidenceRefs: [],
    claims: { strictParityClaimed: false, workflowRestrictionsApplied: false, wholeCaseObservedEquivalentClaimed: outcome === 'OBSERVED_EQUIVALENT' },
    completedAt: NOW,
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  };
}

test('bounded target repair writes with CAS/read-back and closes only after affected-scenario retest', async () => {
  const value = fixture('ivx-target-repair-success-');
  try {
    assert.equal(value.repair.review.status, 'READY_TO_UPDATE_TARGET');
    assert.equal(value.repair.attempt.outcome, 'LOCAL_VALIDATION_PASSED');
    assert.equal(value.repair.checkpoint.checkpointType, 'STATICALLY_SAFE_CANDIDATE');
    const adapter = new FaultAdapter();
    const updated = await new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId);
    assert.equal(updated.review.status, 'TARGET_UPDATED');
    assert.equal(updated.review.baseline.targetWorkId, 'target-work-2');
    assert.equal(adapter.saveCalls, 1);
    assert.equal(updated.sessionBudget.targetRevisions.used, 1);
    const blockedRetestEnvironment = environmentComparison(value.review.reviewId, 'target-work-2');
    blockedRetestEnvironment.comparisonId = 'environment-target-work-2-risk-retest';
    blockedRetestEnvironment.status = 'BLOCKED_ENVIRONMENT';
    blockedRetestEnvironment.fields = [{
      path: '/settings/unknownRuntimeFlag',
      policy: null,
      sourcePresence: 'PRESENT',
      targetPresence: 'PRESENT',
      equivalent: null,
      disposition: 'BLOCKED',
      bindingAssertionId: null,
    }];
    blockedRetestEnvironment.blockedPaths = ['/settings/unknownRuntimeFlag'];
    assert.throws(() => value.reviews.prepareRuntimeCycle(value.review.reviewId, {
      scenarioIds: ['scenario-repair'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-2' },
      environmentComparison: blockedRetestEnvironment,
      riskAcceptance: {
        schemaVersion: 2,
        kind: 'environment-risk-acceptance',
        acceptanceId: 'risk-repair-retest-forbidden',
        reviewId: value.review.reviewId,
        sourceRevision: { nid: 100, workId: 'source-work-1' },
        targetRevision: { nid: 200, workId: 'target-work-2' },
        acceptedPaths: ['/settings/unknownRuntimeFlag'],
        scenarioIds: ['scenario-repair'],
        purpose: 'DIAGNOSTIC_RUNTIME_ONLY',
        confirmation: 'ACCEPT_ENVIRONMENT_RISK',
        expiresAt: '2030-01-01T01:00:00.000Z',
        createdAt: NOW,
        createdBy: 'USER',
        sensitivity: 'PRIVATE',
      },
    }), { code: 'REPAIR_ENVIRONMENT_NOT_EQUIVALENT' });
    assert.throws(() => value.reviews.prepareRuntimeCycle(value.review.reviewId, {
      scenarioIds: [],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-2' },
      environmentComparison: environmentComparison(value.review.reviewId, 'target-work-2'),
    }), { code: 'RUNTIME_SCENARIOS_REQUIRED' });
    const prepared = value.reviews.prepareRuntimeCycle(value.review.reviewId, {
      scenarioIds: ['scenario-repair'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-2' },
      environmentComparison: environmentComparison(value.review.reviewId, 'target-work-2'),
    });
    writePrivateJson(path.join(value.reviews.runtimeCycleDir(value.review.reviewId, prepared.cycle.cycleId), 'comparisons', 'scenario-repair.json'), comparison(value.review.reviewId, 'PARITY_PASSED', prepared.cycle.cycleId));
    const completed = value.reviews.completeRuntimeCycle(value.review.reviewId, prepared.cycle.cycleId);
    assert.equal(completed.review.status, 'RUNTIME_PARITY_PASSED');
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'RUNTIME_VERIFIED');
    assert.equal(value.reviews.recover(value.review.reviewId).saveableCheckpoints.some((entry) => entry.targetWorkId === 'target-work-2'), true);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('a linked Agent Native repair regression closes a read-back-verified Repair Batch without a managed Runtime Cycle', async () => {
  const value = fixture('ivx-target-repair-native-retest-');
  try {
    const adapter = new FaultAdapter();
    const updated = await new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId);
    assert.equal(updated.review.status, 'TARGET_UPDATED');
    assert.equal(updated.batch.state, 'READBACK_VERIFIED');
    const cycleCountBefore = fs.readdirSync(path.join(value.reviews.reviewDir(value.review.reviewId), 'cycles')).length;
    const native = new AgentNativeStore(value.paths, { jobs: value.jobs, reviews: value.reviews, now: () => new Date(NOW) });
    native.submit(value.review.reviewId, nativeObservation(value, { runId: 'native-before-regression' }));
    const completed = native.submit(value.review.reviewId, nativeObservation(value, {
      runId: 'native-repair-regression',
      previousRunId: 'native-before-regression',
      purpose: 'REPAIR_REGRESSION',
      repairBatchId: value.repair.batch.batchId,
      outcome: 'OBSERVED_EQUIVALENT',
    }));
    assert.equal(completed.review.status, 'AGENT_NATIVE_EQUIVALENCE_OBSERVED');
    assert.equal(completed.repairBatch.state, 'RUNTIME_VERIFIED');
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'RUNTIME_VERIFIED');
    assert.equal(fs.readdirSync(path.join(value.reviews.reviewDir(value.review.reviewId), 'cycles')).length, cycleCountBefore);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('lost write response is confirmed by read-back and never replayed', async () => {
  const value = fixture('ivx-target-repair-readback-');
  try {
    const adapter = new FaultAdapter('applied-then-throw');
    const result = await new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId);
    assert.equal(result.review.status, 'TARGET_UPDATED');
    assert.equal(result.batch.write.outcome, 'VERIFIED');
    assert.equal(adapter.saveCalls, 1);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('failed preflight performs no write and leaves the validated batch resumable', async () => {
  const value = fixture('ivx-target-repair-preflight-');
  try {
    const adapter = new PreflightFailureAdapter();
    await assert.rejects(new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId), { code: 'TARGET_REPAIR_PREFLIGHT_FAILED' });
    assert.equal(adapter.saveCalls, 0);
    assert.equal(value.reviews.load(value.review.reviewId).status, 'READY_TO_UPDATE_TARGET');
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'LOCAL_VALIDATED');
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('repair authorization is short-lived and a newly blocked environment closes the write gate', async () => {
  const value = fixture('ivx-target-repair-environment-');
  try {
    assert.throws(() => validateTargetRepairAuthorization({
      schemaVersion: 2,
      kind: 'target-repair-authorization',
      authorizationId: 'authorization-too-long',
      reviewId: value.review.reviewId,
      scope: 'INITIAL',
      clusterIds: ['cluster-title'],
      maxAttemptsPerCluster: 3,
      maxTargetRevisions: 10,
      confirmation: 'AUTHORIZE_TARGET_REPAIR',
      expiresAt: '2030-01-01T09:00:00.000Z',
      createdAt: NOW,
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    }), /cannot last longer than 8 hours/);

    const blocked = environmentComparison(value.review.reviewId, 'target-work-1');
    blocked.comparisonId = 'environment-target-work-1-blocked';
    blocked.status = 'BLOCKED_ENVIRONMENT';
    blocked.fields = [{
      path: '/settings/unknownRuntimeFlag',
      policy: null,
      sourcePresence: 'PRESENT',
      targetPresence: 'PRESENT',
      equivalent: null,
      disposition: 'BLOCKED',
      bindingAssertionId: null,
    }];
    blocked.blockedPaths = ['/settings/unknownRuntimeFlag'];
    blocked.evaluatedAt = '2030-01-01T00:00:01.000Z';
    blocked.createdAt = blocked.evaluatedAt;
    writePrivateJson(path.join(value.reviews.reviewDir(value.review.reviewId), 'environment', 'zz-blocked-environment.json'), blocked);

    const adapter = new FaultAdapter();
    await assert.rejects(
      new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId),
      { code: 'REPAIR_ENVIRONMENT_NOT_EQUIVALENT' },
    );
    assert.equal(adapter.saveCalls, 0);
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'LOCAL_VALIDATED');
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('per-cluster 3+2 budget pauses after three attempts and requires a separate extension lease', async () => {
  const value = fixture('ivx-target-repair-budget-');
  try {
    const adapter = new RevisionAdapter();
    const orchestrator = new TargetUpdateOrchestrator({ reviews: value.reviews, adapter });
    let repair = value.repair;
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await orchestrator.run(value.review.reviewId, repair.batch.batchId);
      const diagnosis = mismatchAndDiagnose(value, adapter.workId);
      if (sequence < 3) {
        assert.equal(diagnosis.results[0].decision.decision, 'AUTO_REPAIR_ALLOWED');
        assert.equal(diagnosis.results[0].decision.remainingAttempts, 3 - sequence);
        repair = submitNextProposal(value, adapter, diagnosis, 'authorization-initial', sequence + 1);
      } else {
        assert.equal(diagnosis.results[0].decision.decision, 'AUTO_REPAIR_PAUSED');
        assert.equal(diagnosis.results[0].decision.reasonCode, 'REPAIR_EXTENSION_AUTHORIZATION_REQUIRED');
        assert.equal(diagnosis.results[0].decision.remainingAttempts, 2);
        assert.throws(() => submitNextProposal(value, adapter, diagnosis, 'authorization-initial', 4), { code: 'REPAIR_AUTHORIZATION_ALLOWANCE_EXHAUSTED' });
        const extension = {
          schemaVersion: 2,
          kind: 'target-repair-authorization',
          authorizationId: 'authorization-extension',
          reviewId: value.review.reviewId,
          scope: 'EXTENSION',
          clusterIds: ['cluster-title'],
          maxAttemptsPerCluster: 2,
          maxTargetRevisions: 5,
          confirmation: 'AUTHORIZE_REPAIR_EXTENSION',
          expiresAt: '2030-01-01T01:00:00.000Z',
          createdAt: NOW,
          createdBy: 'USER',
          sensitivity: 'PRIVATE',
        };
        value.reviews.authorizeTargetRepair(value.review.reviewId, extension);
        const extended = submitNextProposal(value, adapter, diagnosis, extension.authorizationId, 4);
        assert.equal(extended.attempt.outcome, 'LOCAL_VALIDATION_PASSED');
      }
    }
    const clusterBudget = value.reviews.recover(value.review.reviewId).review.repairBudgetIds
      .map((budgetId) => JSON.parse(fs.readFileSync(path.join(value.reviews.reviewDir(value.review.reviewId), 'issues', 'budgets', `${budgetId}.json`), 'utf8')))
      .find((budget) => budget.scope === 'ISSUE_CLUSTER');
    assert.deepEqual(clusterBudget.attempts, { automaticLimit: 3, automaticUsed: 3, extensionLimit: 2, extensionUsed: 1 });
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('review 10+5 revision budget cannot use an initial lease after the base allowance', async () => {
  const value = fixture('ivx-target-repair-revision-budget-');
  try {
    const budgetDirectory = path.join(value.reviews.reviewDir(value.review.reviewId), 'issues', 'budgets');
    const budgets = fs.readdirSync(budgetDirectory).filter((file) => file.endsWith('.json')).map((file) => ({ file, value: JSON.parse(fs.readFileSync(path.join(budgetDirectory, file), 'utf8')) }));
    const session = budgets.find((entry) => entry.value.scope === 'REVIEW_SESSION');
    session.value.targetRevisions.used = 10;
    session.value.updatedAt = NOW;
    writePrivateJson(path.join(budgetDirectory, session.file), session.value);
    const cluster = budgets.find((entry) => entry.value.scope === 'ISSUE_CLUSTER');
    cluster.value.attempts.automaticUsed = 3;
    cluster.value.status = 'PAUSED';
    cluster.value.updatedAt = NOW;
    writePrivateJson(path.join(budgetDirectory, cluster.file), cluster.value);

    const adapter = new RevisionAdapter();
    const orchestrator = new TargetUpdateOrchestrator({ reviews: value.reviews, adapter });
    await assert.rejects(orchestrator.run(value.review.reviewId, value.repair.batch.batchId), { code: 'TARGET_REVISION_EXTENSION_AUTHORIZATION_REQUIRED' });
    assert.equal(adapter.saveCalls, 0);
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'LOCAL_VALIDATED');
    value.reviews.authorizeTargetRepair(value.review.reviewId, {
      schemaVersion: 2,
      kind: 'target-repair-authorization',
      authorizationId: 'authorization-revision-extension',
      reviewId: value.review.reviewId,
      scope: 'EXTENSION',
      clusterIds: ['cluster-title'],
      maxAttemptsPerCluster: 2,
      maxTargetRevisions: 5,
      confirmation: 'AUTHORIZE_REPAIR_EXTENSION',
      expiresAt: '2030-01-01T01:00:00.000Z',
      createdAt: NOW,
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    });
    const result = await orchestrator.run(value.review.reviewId, value.repair.batch.batchId);
    assert.equal(result.sessionBudget.targetRevisions.used, 10);
    assert.equal(result.sessionBudget.targetRevisions.extensionUsed, 1);
    assert.equal(adapter.saveCalls, 1);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('unknown unchanged write is blocked for reconciliation without replay', async () => {
  const value = fixture('ivx-target-repair-unknown-');
  try {
    const adapter = new FaultAdapter('unchanged-then-throw');
    const orchestrator = new TargetUpdateOrchestrator({ reviews: value.reviews, adapter });
    await assert.rejects(orchestrator.run(value.review.reviewId, value.repair.batch.batchId), { code: 'TARGET_REPAIR_WRITE_OUTCOME_UNKNOWN' });
    assert.equal(value.reviews.load(value.review.reviewId).status, 'BLOCKED_PLATFORM_RUNTIME');
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'WRITE_OUTCOME_UNKNOWN');
    const reconciled = await orchestrator.reconcile(value.review.reviewId, value.repair.batch.batchId);
    assert.equal(reconciled.reconciled, false);
    assert.equal(adapter.saveCalls, 1);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('CAS drift forbids overwrite and preserves the externally edited target', async () => {
  const value = fixture('ivx-target-repair-cas-');
  try {
    const adapter = new FaultAdapter('cas-drift');
    await assert.rejects(new TargetUpdateOrchestrator({ reviews: value.reviews, adapter }).run(value.review.reviewId, value.repair.batch.batchId), { code: 'TARGET_REPAIR_CAS_MISMATCH' });
    assert.equal(adapter.saveCalls, 0);
    assert.equal(value.reviews.load(value.review.reviewId).status, 'TARGET_EXTERNALLY_MODIFIED');
    assert.equal(value.reviews.loadRepairBatch(value.review.reviewId, value.repair.batch.batchId).state, 'RECONCILIATION_REQUIRED');
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test('repair engine detects repeated patches, oscillation, scope growth, and high-severity regressions', () => {
  const base = { case: { a: 1, b: 2, c: 3 }, stage: {}, server: {} };
  const proposal = { patch: [{ op: 'replace', path: '/case/a', value: 2 }] };
  const repeated = evaluateRepairCandidate({
    proposal,
    base,
    baseValidation: { issues: [] },
    candidateValidation: { passed: true, issues: [] },
    priorAttempts: [{ patchSha256: repairPatchDigest(proposal.patch), scope: { distinctPathCount: 1 } }],
  });
  assert.equal(repeated.stopReason, 'REPEATED_PATCH');
  const candidateSha256 = revisionValueDigest({ case: { a: 2, b: 2, c: 3 }, stage: {}, server: {} });
  const oscillation = evaluateRepairCandidate({ proposal, base, baseValidation: { issues: [] }, candidateValidation: { passed: true, issues: [] }, historicalCheckpointSha256s: [candidateSha256] });
  assert.equal(oscillation.stopReason, 'CANDIDATE_OSCILLATION');
  const growthProposal = { patch: [
    { op: 'replace', path: '/case/a', value: 2 },
    { op: 'replace', path: '/case/b', value: 3 },
    { op: 'replace', path: '/case/c', value: 4 },
  ] };
  const growth = evaluateRepairCandidate({ growthProposal, proposal: growthProposal, base, baseValidation: { issues: [] }, candidateValidation: { passed: true, issues: [] }, priorAttempts: [{ patchSha256: HASH_A, scope: { distinctPathCount: 1 } }, { patchSha256: HASH_B, scope: { distinctPathCount: 2 } }] });
  assert.equal(growth.stopReason, 'REPAIR_SCOPE_GROWTH');
  const regression = evaluateRepairCandidate({
    proposal,
    base,
    baseValidation: { issues: [] },
    candidateValidation: { passed: false, issues: [{ issueId: 'new-blocker', rule: 'NEW', severity: 'BLOCKER', evidence: { path: '/case/a' } }] },
  });
  assert.equal(regression.stopReason, 'NEW_HIGH_SEVERITY_REGRESSION');
});

test('automatic-repair stop keeps diagnosis artifacts and Human Finding resumes the same review', () => {
  const value = fixture('ivx-target-repair-human-');
  try {
    value.reviews.transition(value.review.reviewId, 'TARGET_UPDATED');
    value.reviews.transition(value.review.reviewId, 'RUNTIME_RETESTING');
    value.reviews.transition(value.review.reviewId, 'MISMATCH_DETECTED');
    value.reviews.transition(value.review.reviewId, 'DIAGNOSING');
    value.reviews.transition(value.review.reviewId, 'AUTO_REPAIR_STOPPED');
    const eligibilityBefore = fs.readdirSync(path.join(value.reviews.reviewDir(value.review.reviewId), 'issues', 'eligibility')).sort();
    const submitted = value.reviews.submitHumanFinding(value.review.reviewId, {
      symptom: 'The user localized the remaining mismatch to the title binding.',
      reproductionSteps: ['Open preview'],
      locations: ['/case/title'],
      requests: ['RECLASSIFY'],
    });
    assert.equal(submitted.review.status, 'DIAGNOSING');
    assert.deepEqual(fs.readdirSync(path.join(value.reviews.reviewDir(value.review.reviewId), 'issues', 'eligibility')).sort(), eligibilityBefore);
    assert.equal(value.reviews.recover(value.review.reviewId).humanFindings.length, 1);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});
