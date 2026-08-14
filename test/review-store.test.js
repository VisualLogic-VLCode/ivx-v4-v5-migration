import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { createRedactedRevisionDiff } from '../src/reviews/revision-diff.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function runtimePins() {
  return {
    workflow: { version: '0.4.0', sha256: HASH_A },
    converter: { version: '1.2.1', sha256: HASH_B },
    knowledge: { version: '0.1.0', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function createCompletedJob(jobs, { sourceNid = 100, targetNid = 200, sourceWorkId = 'source-work-1', targetWorkId = 'target-work-1' } = {}) {
  let job = jobs.create({ sourceNid, mode: 'platform' });
  job = jobs.transition(job.jobId, 'UPDATE_CHECKED');
  job = jobs.transition(job.jobId, 'AUTHORIZED');
  job = jobs.transition(job.jobId, 'VERSION_CLASSIFIED');
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: sourceWorkId } } });
  job = jobs.transition(job.jobId, 'CONVERTED');
  job = jobs.transition(job.jobId, 'VALIDATED');
  job = jobs.transition(job.jobId, 'ISSUES_CLASSIFIED');
  job = jobs.transition(job.jobId, 'READY_TO_SAVE');
  job = jobs.transition(job.jobId, 'SAVE_AS_CREATED');
  job = jobs.transition(job.jobId, 'FINAL_SAVED');
  job = jobs.transition(job.jobId, 'POST_SAVE_VERIFIED');
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: targetNid, workId: targetWorkId } } });
}

function withHome(prefix, callback) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('RuntimeReviewStore persists independently and a fresh instance recovers without mutating the terminal Job', () => {
  withHome('ivx-review-recover-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const jobBefore = fs.readFileSync(jobs.statePath(job.jobId));
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const created = reviews.create({
      jobId: job.jobId,
      capability: 'WRITE',
      runtime: runtimePins(),
      targetSnapshot: { case: { nid: 200, value: 'baseline' } },
    });

    assert.equal(created.status, 'REVIEW_OPEN');
    assert.equal(fs.statSync(reviews.statePath(created.reviewId)).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(jobs.statePath(job.jobId)), jobBefore);

    const recovered = new RuntimeReviewStore(paths, { jobs: new JobStore(paths) }).recover(created.reviewId);
    assert.equal(recovered.review.reviewId, created.reviewId);
    assert.equal(recovered.review.jobId, job.jobId);
    assert.equal(recovered.resumable, true);
    assert.deepEqual(recovered.humanFindings, []);
    assert.deepEqual(fs.readFileSync(jobs.statePath(job.jobId)), jobBefore);
  });
});

test('only one write-capable review owns a target revision while read-only reviews remain allowed', () => {
  withHome('ivx-review-lease-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const input = { jobId: job.jobId, runtime: runtimePins(), targetSnapshot: { value: 1 } };
    const writer = reviews.create({ ...input, capability: 'WRITE' });
    assert.throws(() => reviews.create({ ...input, capability: 'WRITE' }), { code: 'REVIEW_WRITE_LEASE_CONFLICT' });
    assert.equal(reviews.create({ ...input, capability: 'READ_ONLY' }).capability, 'READ_ONLY');

    reviews.transition(writer.reviewId, 'ENVIRONMENT_PREFLIGHT');
    reviews.transition(writer.reviewId, 'RUNTIME_TESTING');
    reviews.transition(writer.reviewId, 'RUNTIME_PARITY_PASSED');
    assert.equal(reviews.create({ ...input, capability: 'WRITE' }).capability, 'WRITE');
  });
});

test('source revision reconciliation is content-guarded, auditable, and idempotent before environment evidence', () => {
  withHome('ivx-review-source-reconcile-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const source = { case: { id: 'source-root', value: 1 }, stage: {}, server: {} };
    jobs.writeArtifact(job.jobId, 'v4/app.json', source, { pretty: false });
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const created = reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: runtimePins(),
      targetSnapshot: { value: 'target' },
    });

    const first = reviews.reconcileSourceRevision(created.reviewId, {
      currentWorkId: 'source-work-2',
      sourceSnapshot: structuredClone(source),
    });
    assert.equal(first.reconciled, true);
    assert.equal(first.review.baseline.sourceWorkId, 'source-work-2');
    assert.equal(first.reconciliation.fromWorkId, 'source-work-1');
    assert.equal(first.reconciliation.toWorkId, 'source-work-2');
    assert.equal(first.reconciliation.outcome, 'CONTENT_EQUIVALENT');
    assert.match(first.reconciliation.expectedContentSha256, /^[a-f0-9]{64}$/);
    assert.match(first.reconciliation.currentContentSha256, /^[a-f0-9]{64}$/);
    assert.equal(first.reconciliation.expectedContentSha256, first.reconciliation.currentContentSha256);
    assert.equal(reviews.listSourceReconciliations(created.reviewId).length, 1);

    const repeated = reviews.reconcileSourceRevision(created.reviewId, {
      currentWorkId: 'source-work-2',
      sourceSnapshot: structuredClone(source),
    });
    assert.equal(repeated.reconciled, false);
    assert.equal(reviews.listSourceReconciliations(created.reviewId).length, 1);

    assert.throws(() => reviews.reconcileSourceRevision(created.reviewId, {
      currentWorkId: 'source-work-3',
      sourceSnapshot: { ...source, case: { ...source.case, value: 2 } },
    }), { code: 'REVIEW_SOURCE_CONTENT_CHANGED' });
    assert.equal(reviews.load(created.reviewId).baseline.sourceWorkId, 'source-work-2');
    assert.equal(reviews.listSourceReconciliations(created.reviewId).length, 1);
    assert.equal(reviews.recover(created.reviewId).sourceReconciliations.length, 1);
  });
});

test('source revision reconciliation refuses to mutate a Review after environment evidence exists', () => {
  withHome('ivx-review-source-reconcile-late-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const source = { case: { id: 'source-root', value: 1 }, stage: {}, server: {} };
    jobs.writeArtifact(job.jobId, 'v4/app.json', source, { pretty: false });
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const created = reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: runtimePins(),
      targetSnapshot: { value: 'target' },
    });
    fs.writeFileSync(path.join(reviews.reviewDir(created.reviewId), 'environment', 'existing.json'), '{}', { mode: 0o600 });
    assert.throws(() => reviews.reconcileSourceRevision(created.reviewId, {
      currentWorkId: 'source-work-2',
      sourceSnapshot: structuredClone(source),
    }), { code: 'REVIEW_SOURCE_RECONCILIATION_UNSAFE' });
    assert.equal(reviews.load(created.reviewId).baseline.sourceWorkId, 'source-work-1');
  });
});

test('review registry lock reclaims a dead owner and rejects a live owner', () => {
  withHome('ivx-review-lock-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const lockPath = path.join(paths.locks, 'review-registry.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647 }), { mode: 0o600 });
    assert.equal(reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: runtimePins(),
      targetSnapshot: { value: 1 },
    }).status, 'REVIEW_OPEN');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    assert.throws(() => reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: runtimePins(),
      targetSnapshot: { value: 1 },
    }), { code: 'REVIEW_REGISTRY_LOCKED' });
  });
});

test('Human Finding is durable evidence and resumes diagnosis without accepting a target revision', () => {
  withHome('ivx-review-finding-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const review = reviews.create({ jobId: job.jobId, capability: 'WRITE', runtime: runtimePins(), targetSnapshot: { value: 1 } });
    for (const status of ['ENVIRONMENT_PREFLIGHT', 'RUNTIME_TESTING', 'MISMATCH_DETECTED', 'DIAGNOSING', 'AUTO_REPAIR_STOPPED', 'AWAITING_HUMAN_EVIDENCE']) {
      reviews.transition(review.reviewId, status);
    }
    const submitted = reviews.submitHumanFinding(review.reviewId, {
      symptom: 'The result differs after the action.',
      reproductionSteps: ['Open page', 'Run action'],
      v4Observation: 'Success',
      v5Observation: 'Empty',
      locations: ['bid:action-1'],
      targetManuallyEdited: true,
      targetRevision: 'target-work-2',
      requests: ['RECLASSIFY', 'ACCEPT_TARGET_REVISION'],
    });
    assert.equal(submitted.review.status, 'DIAGNOSING');
    assert.equal(submitted.review.baseline.targetWorkId, 'target-work-1');
    assert.equal(submitted.finding.createdBy, 'USER');
    assert.equal(submitted.finding.sensitivity, 'PRIVATE');
    assert.equal(reviews.listHumanFindings(review.reviewId)[0].findingId, submitted.finding.findingId);
  });
});

test('external target drift produces a redacted diff and requires separate matching USER evidence before baseline acceptance', () => {
  withHome('ivx-review-baseline-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const review = reviews.create({
      jobId: job.jobId,
      capability: 'WRITE',
      runtime: runtimePins(),
      targetSnapshot: { value: 1, password: 'old-private-value' },
    });
    const observed = reviews.observeTargetRevision(review.reviewId, {
      currentWorkId: 'target-work-2',
      targetSnapshot: { value: 2, password: 'new-private-value' },
    });
    assert.equal(observed.review.status, 'TARGET_EXTERNALLY_MODIFIED');
    assert.equal(observed.observation.changed, true);
    assert.equal(JSON.stringify(observed.observation).includes('new-private-value'), false);
    assert.equal(JSON.stringify(observed.observation).includes('old-private-value'), false);
    assert.match(JSON.stringify(observed.observation.diff), /redacted/);

    const finding = reviews.submitHumanFinding(review.reviewId, {
      symptom: 'User manually repaired the target.',
      reproductionSteps: ['Edit target in the editor'],
      targetManuallyEdited: true,
      targetRevision: 'target-work-2',
      requests: ['ACCEPT_TARGET_REVISION'],
    }).finding;
    const accepted = reviews.acceptExternalRevision(review.reviewId, {
      observationId: observed.observation.observationId,
      findingId: finding.findingId,
    });
    assert.equal(accepted.review.status, 'LOCAL_VALIDATING');
    assert.equal(accepted.review.baseline.targetWorkId, 'target-work-2');
    assert.equal(accepted.review.target.workId, 'target-work-2');
    assert.equal(accepted.acceptance.createdBy, 'USER');

    const recovered = new RuntimeReviewStore(paths, { jobs: new JobStore(paths) }).recover(review.reviewId);
    assert.equal(recovered.review.baseline.targetWorkId, 'target-work-2');
    const unchanged = reviews.observeTargetRevision(review.reviewId, {
      currentWorkId: 'target-work-2',
      targetSnapshot: { value: 2, password: 'new-private-value' },
    });
    assert.equal(unchanged.observation.changed, false);
    assert.equal(unchanged.review.status, 'LOCAL_VALIDATING');
  });
});

test('baseline acceptance refuses a conflicting write lease on the externally observed revision', () => {
  withHome('ivx-review-accept-conflict-', (temporary) => {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const oldJob = createCompletedJob(jobs, { sourceNid: 100, targetNid: 200, targetWorkId: 'target-work-1' });
    const newJob = createCompletedJob(jobs, { sourceNid: 101, targetNid: 200, targetWorkId: 'target-work-2' });
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const oldReview = reviews.create({ jobId: oldJob.jobId, capability: 'WRITE', runtime: runtimePins(), targetSnapshot: { value: 1 } });
    reviews.create({ jobId: newJob.jobId, capability: 'WRITE', runtime: runtimePins(), targetSnapshot: { value: 2 } });
    const observed = reviews.observeTargetRevision(oldReview.reviewId, { currentWorkId: 'target-work-2', targetSnapshot: { value: 2 } });
    const finding = reviews.submitHumanFinding(oldReview.reviewId, {
      symptom: 'Manual edit confirmed.',
      reproductionSteps: ['Edit'],
      targetManuallyEdited: true,
      targetRevision: 'target-work-2',
      requests: ['ACCEPT_TARGET_REVISION'],
    }).finding;
    assert.throws(() => reviews.acceptExternalRevision(oldReview.reviewId, {
      observationId: observed.observation.observationId,
      findingId: finding.findingId,
    }), { code: 'REVIEW_WRITE_LEASE_CONFLICT' });
    assert.equal(reviews.load(oldReview.reviewId).baseline.targetWorkId, 'target-work-1');
  });
});

test('redacted revision diff is bounded and does not expose dynamic object keys or values', () => {
  const before = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`person-${index}@example.test`, `old-${index}`]));
  const after = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`person-${index}@example.test`, `new-${index}`]));
  const diff = createRedactedRevisionDiff(before, after, { maxChanges: 3 });
  const serialized = JSON.stringify(diff);
  assert.equal(diff.changes.length, 3);
  assert.equal(diff.truncated, true);
  assert.equal(serialized.includes('@example.test'), false);
  assert.equal(serialized.includes('new-0'), false);
  assert.match(serialized, /redacted/);
});
