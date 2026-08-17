import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateEnvironmentGate } from '../src/environment/environment-gate.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { RuntimeExplorationStore } from '../src/runtime/exploration-store.js';
import { createJobArtifactManifest } from '../src/runtime/job-artifact-manifest.js';

const NOW = '2026-08-17T02:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function runtimePins() {
  return {
    workflow: { version: '0.6.2', sha256: HASH_A },
    converter: { version: '1.2.2', sha256: HASH_B },
    knowledge: { version: '0.1.4', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
  jobs.writeArtifact(job.jobId, 'v4/app.json', { case: { nid: 100 }, stage: {}, server: {} });
  jobs.writeArtifact(job.jobId, 'v5/app.json', { case: { nid: 200 }, stage: {}, server: {} });
  return job;
}

function createFixture(temporary) {
  const paths = createAppPaths(temporary);
  const jobs = new JobStore(paths);
  const job = createCompletedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const review = reviews.create({ jobId: job.jobId, runtime: runtimePins(), targetSnapshot: { case: { nid: 200 }, stage: {}, server: {} } });
  const evaluation = evaluateEnvironmentGate({
    reviewId: review.reviewId,
    sourceManifestId: 'env-source-1',
    targetManifestId: 'env-target-1',
    comparisonId: 'env-comparison-1',
    source: { revision: { nid: 100, workId: 'source-work-1' }, workInfo: {}, config: {}, settings: {} },
    target: { revision: { nid: 200, workId: 'target-work-1' }, workInfo: {}, config: {}, settings: {} },
    evaluatedAt: NOW,
  });
  reviews.recordEnvironmentEvaluation(review.reviewId, evaluation);
  const store = new RuntimeExplorationStore(paths, { jobs, reviews, now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  return { paths, jobs, review, reviews, store, evaluation };
}

function plan(fixture, authorization, explorationId = 'exploration-1') {
  return {
    schemaVersion: 2,
    kind: 'runtime-exploration-plan',
    explorationId,
    reviewId: fixture.review.reviewId,
    jobId: fixture.review.jobId,
    profile: authorization.profile,
    startPath: '$SUBJECT_URL',
    strategy: 'SAFE_BFS',
    limits: authorization.limits,
    coverageGoal: { minStates: 5, minExecutedControls: 3, requireVisual: true },
    seedPaths: [],
    knowledgeRuleIds: [],
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
  };
}

test('authorization exposes the exact Job tree but only driver-use authentication and is claimed once', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-exploration-store-'));
  try {
    const fixture = createFixture(temporary);
    const originalReview = fs.readFileSync(fixture.reviews.statePath(fixture.review.reviewId));
    const authorization = fixture.store.authorize(fixture.review.reviewId, {
      environmentComparisonId: fixture.evaluation.comparison.comparisonId,
      profile: 'QUICK',
      expiresAt: '2026-08-17T04:00:00.000Z',
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
    });
    const context = fixture.store.context(fixture.review.reviewId, authorization.authorizationId);
    assert.equal(context.authorizationState, 'AVAILABLE');
    assert.equal(context.credentialAccess, 'DRIVER_USE_ONLY');
    assert.equal(context.job.root, fixture.jobs.jobDir(fixture.review.jobId));
    assert.equal(context.job.manifest.entries.some((entry) => entry.path === 'v4/app.json'), true);
    assert.equal(JSON.stringify(context).toLowerCase().includes('platformtoken'), false);

    const prepared = fixture.store.prepare(fixture.review.reviewId, { authorizationId: authorization.authorizationId, plan: plan(fixture, authorization) });
    assert.equal(prepared.state.status, 'READY');
    assert.equal(fixture.store.context(fixture.review.reviewId, authorization.authorizationId).authorizationState, 'CLAIMED');
    assert.throws(() => fixture.store.prepare(fixture.review.reviewId, {
      authorizationId: authorization.authorizationId,
      plan: plan(fixture, authorization, 'exploration-2'),
    }), { code: 'EXPLORATION_AUTHORIZATION_ALREADY_USED' });
    assert.deepEqual(fs.readFileSync(fixture.reviews.statePath(fixture.review.reviewId)), originalReview);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('exploration checkpoints resume and complete without changing Review activeCycleId', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-exploration-resume-'));
  try {
    const fixture = createFixture(temporary);
    const authorization = fixture.store.authorize(fixture.review.reviewId, {
      environmentComparisonId: fixture.evaluation.comparison.comparisonId,
      profile: 'QUICK',
      expiresAt: '2026-08-17T04:00:00.000Z',
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
    });
    const prepared = fixture.store.prepare(fixture.review.reviewId, { authorizationId: authorization.authorizationId, plan: plan(fixture, authorization) });
    fixture.store.markRunning(fixture.review.reviewId, 'exploration-1');
    const checkpoint = fixture.store.checkpoint(fixture.review.reviewId, 'exploration-1', { queue: [{ pathId: 'root', actions: [] }], visited: [] });
    assert.equal(checkpoint.sequence, 1);
    fixture.store.interrupt(fixture.review.reviewId, 'exploration-1', new Error('temporary browser failure'));
    assert.equal(fixture.store.markRunning(fixture.review.reviewId, 'exploration-1').status, 'RUNNING');
    const completedAt = '2026-08-17T02:01:00.000Z';
    const report = {
      schemaVersion: 2,
      kind: 'runtime-exploration-report',
      explorationId: 'exploration-1',
      reviewId: fixture.review.reviewId,
      jobId: fixture.review.jobId,
      authorizationId: authorization.authorizationId,
      planSha256: prepared.claim.planSha256,
      jobManifestSha256: prepared.manifest.sha256,
      status: 'EXPLORATION_PARITY_PASSED',
      environment: { comparisonId: fixture.evaluation.comparison.comparisonId, status: fixture.evaluation.comparison.status, mode: 'EQUIVALENT_ONLY' },
      coverage: { states: 2, paths: 1, discoveredControls: 1, eligibleControls: 1, executedControls: 1, skippedControls: 0, blockedActions: 0, visualCheckpoints: 2, mismatches: 0, goalSatisfied: true, queueExhausted: true, budgetExhausted: false },
      pathResults: [{ pathId: 'root', depth: 0, status: 'MATCHED', sourceFingerprint: HASH_A, targetFingerprint: HASH_A, visualStatus: 'MATCHED', evidenceRef: 'explorations/exploration-1/paths/root/result.json' }],
      stopReason: null,
      claims: { parityClaimed: true, strictParityClaimed: true, converterAttributionAllowed: true, automaticRepairAllowed: false, targetRepairAttempted: false, platformWriteAttempted: false },
      startedAt: NOW,
      completedAt,
      createdAt: completedAt,
      createdBy: 'CLI',
      sensitivity: 'REDACTED',
    };
    assert.equal(fixture.store.complete(fixture.review.reviewId, 'exploration-1', report).state.status, 'COMPLETED');
    assert.equal(fixture.reviews.load(fixture.review.reviewId).activeCycleId, null);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Job manifest rejects symlinks instead of granting indirect filesystem reads', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-exploration-manifest-'));
  try {
    const fixture = createFixture(temporary);
    fs.symlinkSync('/etc/hosts', path.join(fixture.jobs.jobDir(fixture.review.jobId), 'v4', 'unsafe-link'));
    assert.throws(() => createJobArtifactManifest({ jobs: fixture.jobs, jobId: fixture.review.jobId }), { code: 'JOB_ARTIFACT_SYMLINK_FORBIDDEN' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('authorization freezes the exact Job tree and rejects trivial profile coverage', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-exploration-freeze-'));
  try {
    const fixture = createFixture(temporary);
    const authorization = fixture.store.authorize(fixture.review.reviewId, {
      environmentComparisonId: fixture.evaluation.comparison.comparisonId,
      profile: 'QUICK',
      expiresAt: '2026-08-17T04:00:00.000Z',
      sourceOrigin: 'https://source.example.test',
      targetOrigin: 'https://target.example.test',
    });
    const weakPlan = plan(fixture, authorization);
    weakPlan.coverageGoal = { minStates: 1, minExecutedControls: 0, requireVisual: true };
    assert.throws(() => fixture.store.prepare(fixture.review.reviewId, { authorizationId: authorization.authorizationId, plan: weakPlan }), { code: 'EXPLORATION_COVERAGE_GOAL_TOO_LOW' });
    fixture.jobs.writeArtifact(fixture.review.jobId, 'reports/late-artifact.json', { changed: true });
    assert.throws(() => fixture.store.context(fixture.review.reviewId, authorization.authorizationId), { code: 'EXPLORATION_JOB_ARTIFACTS_CHANGED' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
