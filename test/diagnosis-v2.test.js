import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateDiagnosis, runtimeIssueId } from '../src/diagnosis/diagnosis-engine.js';
import { writePrivateJson } from '../src/fs/secure-json.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-13T10:00:00.000Z';

const CAUSE_CONTRACT = Object.freeze({
  CONVERTER: ['CONVERTER_MAINTAINER', 'NONE'],
  SOURCE_DATA: ['WORKFLOW_AI', 'V5_ARTIFACT'],
  TARGET_CASE: ['WORKFLOW_AI', 'V5_ARTIFACT'],
  TEST_HARNESS: ['WORKFLOW_AI', 'RUNTIME_SCENARIO'],
  ENVIRONMENT_CONFIGURATION: ['USER', 'ENVIRONMENT_BINDING'],
  PLATFORM_RUNTIME: ['PLATFORM_MAINTAINER', 'NONE'],
  KNOWLEDGE_GAP: ['KNOWLEDGE_MAINTAINER', 'KNOWLEDGE_RULE'],
  AUTHORIZATION: ['USER', 'AUTHORIZATION_PREREQUISITE'],
  UNKNOWN: ['UNKNOWN', 'NONE'],
});

function runtimePins() {
  return {
    workflow: { version: '0.4.0', sha256: HASH_A },
    converter: { version: '1.2.1', sha256: HASH_B },
    knowledge: { version: '0.1.0', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
}

function runtimeComparison(reviewId, { comparisonId = 'comparison-1', cycleId = 'cycle-1', assertionId = 'assert-result' } = {}) {
  return {
    schemaVersion: 2,
    kind: 'runtime-comparison',
    comparisonId,
    reviewId,
    cycleId,
    scenarioId: 'scenario-1',
    sourceTraceId: 'trace-v4',
    targetTraceId: 'trace-v5',
    environment: { comparisonId: 'env-1', status: 'ENVIRONMENT_EQUIVALENT' },
    status: 'MISMATCH_DETECTED',
    assertions: [{
      assertionId,
      status: 'FAILED',
      reasonCode: 'NORMALIZED_VALUES_DIFFER',
      sourceObservationIds: ['obs-v4'],
      targetObservationIds: ['obs-v5'],
      normalizations: [],
    }],
    coverage: { total: 1, passed: 0, failed: 1, inconclusive: 0 },
    runtime: {
      driver: 'playwright',
      driverVersion: '1.62.1',
      sourceBrowserVersion: '140',
      targetBrowserVersion: '140',
      modes: ['UNATTENDED'],
      humanTakeover: false,
    },
    evaluatedAt: NOW,
    createdAt: NOW,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

function classification({ jobId, reviewId, issueId, evidenceRef, cause = 'CONVERTER', confidence = 0.98, autoRepairAllowed = false, clusterId = 'cluster-1', reason = 'A repeatable target mismatch was observed.' } = {}) {
  const [responsibleParty, repairTarget] = CAUSE_CONTRACT[cause];
  return {
    schemaVersion: 2,
    kind: 'issue-classification',
    jobId,
    reviewId,
    classifiedAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
    issues: [{
      issueId,
      clusterId,
      cause,
      responsibleParty,
      repairTarget,
      confidence,
      reason,
      evidenceRefs: [evidenceRef],
      knowledgeRuleIds: [],
      autoRepairAllowed,
    }],
  };
}

function prepareReview(prefix) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const jobs = new JobStore(paths);
  const job = createCompletedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const review = reviews.create({ jobId: job.jobId, capability: 'READ_ONLY', runtime: runtimePins(), targetSnapshot: { value: 'baseline' } });
  reviews.transition(review.reviewId, 'ENVIRONMENT_PREFLIGHT');
  reviews.transition(review.reviewId, 'RUNTIME_TESTING');
  reviews.transition(review.reviewId, 'MISMATCH_DETECTED');
  const comparison = runtimeComparison(review.reviewId);
  const comparisonDir = path.join(reviews.runtimeCycleDir(review.reviewId, comparison.cycleId), 'comparisons');
  writePrivateJson(path.join(comparisonDir, 'scenario-1.json'), comparison);
  const evidenceRef = `artifact:cycles/${comparison.cycleId}/comparisons/scenario-1.json`;
  const issueId = runtimeIssueId(comparison.comparisonId, comparison.assertions[0].assertionId);
  return { temporary, paths, jobs, job, reviews, review, comparison, evidenceRef, issueId };
}

function eligibilityContext(reviews, reviewId, overrides = {}) {
  return {
    checkpoint: reviews.currentDiagnosticCheckpoint(reviewId),
    prerequisites: {
      authentication: 'SATISFIED',
      serverPermission: 'SATISFIED',
      userAuthorization: 'SATISFIED',
      platformWritePath: 'SATISFIED',
      revisionSafety: 'SATISFIED',
      writeOutcomeKnown: 'SATISFIED',
      ...overrides,
    },
  };
}

test('Diagnosis v2 persists Converter report and independent eligible diagnostic-save decision without writes', () => {
  const fixture = prepareReview('ivx-diagnosis-converter-');
  try {
    const jobBefore = fs.readFileSync(fixture.jobs.statePath(fixture.job.jobId));
    const targetBefore = fs.readdirSync(fixture.paths.reviews, { recursive: true }).sort();
    const result = fixture.reviews.submitDiagnosis(fixture.review.reviewId, {
      classification: classification({ ...fixture, jobId: fixture.job.jobId, reviewId: fixture.review.reviewId, reason: 'token=private-value converter output differs.' }),
      eligibilityContext: eligibilityContext(fixture.reviews, fixture.review.reviewId),
    });
    assert.equal(result.review.status, 'DIAGNOSING');
    assert.equal(result.results[0].decision.decision, 'AUTO_REPAIR_STOPPED');
    assert.equal(result.results[0].eligibility.status, 'DIAGNOSTIC_SAVE_ELIGIBLE');
    assert.equal(result.results[0].report.reportType, 'CONVERTER_DEFECT');
    assert.equal(result.results[0].report.summary.includes('private-value'), false);
    assert.deepEqual(fs.readFileSync(fixture.jobs.statePath(fixture.job.jobId)), jobBefore);
    assert.equal(result.results[0].report.repairTarget, 'NONE');
    assert.equal(fixture.reviews.listDiagnoses(fixture.review.reviewId).length, 1);
    assert.equal(fixture.reviews.recover(fixture.review.reviewId).diagnoses.length, 1);
    const after = fs.readdirSync(fixture.paths.reviews, { recursive: true }).sort();
    assert.ok(after.length > targetBefore.length);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('classification policy rejects Agent-selected repair permission and missing evidence', () => {
  const fixture = prepareReview('ivx-diagnosis-policy-');
  try {
    const unsafe = classification({ ...fixture, jobId: fixture.job.jobId, reviewId: fixture.review.reviewId, autoRepairAllowed: true });
    assert.throws(() => fixture.reviews.submitDiagnosis(fixture.review.reviewId, { classification: unsafe }), /autoRepairAllowed/);
    const missing = classification({ ...fixture, jobId: fixture.job.jobId, reviewId: fixture.review.reviewId });
    missing.issues[0].evidenceRefs = ['artifact:cycles/missing/comparisons/missing.json'];
    assert.throws(() => fixture.reviews.submitDiagnosis(fixture.review.reviewId, { classification: missing }), { code: 'DIAGNOSIS_EVIDENCE_MISSING' });
    const reportDir = path.join(fixture.reviews.reviewDir(fixture.review.reviewId), 'reports');
    fs.symlinkSync('/etc/hosts', path.join(reportDir, 'external-evidence.json'));
    const symlinked = classification({ ...fixture, jobId: fixture.job.jobId, reviewId: fixture.review.reviewId });
    symlinked.issues[0].evidenceRefs.push('artifact:reports/external-evidence.json');
    assert.throws(() => fixture.reviews.submitDiagnosis(fixture.review.reviewId, { classification: symlinked }), { code: 'DIAGNOSIS_EVIDENCE_MISSING' });
    assert.equal(fixture.reviews.load(fixture.review.reviewId).status, 'MISMATCH_DETECTED');
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test('calibration fixtures produce closed repair decisions and every maintainer report type', () => {
  const calibration = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'diagnosis', 'calibration.json'), 'utf8'));
  const review = {
    reviewId: 'rev_20260813100000_abcde',
    jobId: 'mig_20260813100000_abcde',
    target: { nid: 200, workId: 'target-work-1' },
    baseline: { sourceWorkId: 'source-work-1', targetWorkId: 'target-work-1' },
    runtime: runtimePins(),
  };
  const job = { input: { sourceNid: 100 } };
  for (const [index, sample] of calibration.entries()) {
    const comparisonId = `comparison-${index}`;
    const assertionId = `assert-${index}`;
    const issueId = runtimeIssueId(comparisonId, assertionId);
    const evidenceRef = `artifact:cycles/cycle-${index}/comparisons/scenario.json`;
    const input = classification({
      jobId: review.jobId,
      reviewId: review.reviewId,
      issueId,
      evidenceRef,
      cause: sample.cause,
      confidence: sample.confidence,
      autoRepairAllowed: sample.autoRepairAllowed,
      clusterId: `cluster-${index}`,
    });
    const evaluated = evaluateDiagnosis({
      review,
      job,
      classification: input,
      candidates: [{ issueId, comparisonId, assertionId, status: 'FAILED', reasonCode: 'DIFFER', evidenceRef }],
      now: () => new Date(NOW),
      randomBytes: () => Buffer.from(String(index).padStart(10, '0'), 'hex'),
    });
    assert.equal(evaluated.results[0].decision.decision, sample.decision, sample.name);
    assert.equal(evaluated.results[0].report.cause, sample.cause, sample.name);
    assert.equal(evaluated.results[0].report.sensitivity, 'REDACTED');
  }
  assert.equal(new Set(calibration.map((entry) => entry.cause)).size, 9);
});

test('Diagnostic Save Eligibility remains orthogonal to a repairable target diagnosis', () => {
  const fixture = prepareReview('ivx-diagnosis-orthogonal-');
  try {
    const result = fixture.reviews.submitDiagnosis(fixture.review.reviewId, {
      classification: classification({
        ...fixture,
        jobId: fixture.job.jobId,
        reviewId: fixture.review.reviewId,
        cause: 'TARGET_CASE',
        confidence: 0.95,
        autoRepairAllowed: true,
      }),
      eligibilityContext: eligibilityContext(fixture.reviews, fixture.review.reviewId, { userAuthorization: 'MISSING' }),
    });
    assert.equal(result.results[0].decision.decision, 'AUTO_REPAIR_ALLOWED');
    assert.equal(result.results[0].eligibility.status, 'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH');
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});
