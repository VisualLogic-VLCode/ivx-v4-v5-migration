import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { extractWorkRouting } from '../src/platform/http-adapter.js';
import { RefreshApplyOrchestrator } from '../src/refresh/refresh-apply-orchestrator.js';
import { RefreshStore } from '../src/refresh/refresh-store.js';
import { revisionValueDigest } from '../src/reviews/revision-diff.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';

const NOW = new Date('2026-08-14T04:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const sourceNid = 110;
const targetNid = 220;
const runtime = {
  workflow: { version: '0.6.0', sha256: HASH_A },
  converter: { version: '1.2.2', sha256: HASH_B },
  knowledge: { version: '0.1.4', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
};
const source = { case: { id: 'source', type: 'ih5-case' }, stage: { id: 'stage', type: 'stage' }, server: { id: 'server', type: 'server' } };
const baseline = { case: { id: 'target', type: 'ih5-case', value: 'old' }, stage: { id: 'stage', type: 'stage' }, server: { id: 'server', type: 'server' } };
const candidate = { case: { id: 'target', type: 'ih5-case', value: 'new' }, stage: { id: 'stage', type: 'stage' }, server: { id: 'server', type: 'server' } };

class FakeAdapter {
  constructor() {
    this.sourceInfo = { nid: sourceNid, workId: 'source-work-1', gid: 0, memberType: 3 };
    this.targetInfo = { nid: targetNid, workId: 'target-work-1', gid: 0, memberType: 3, previewDomain: 'preview.example' };
    this.sourceWork = structuredClone(source);
    this.targetWork = structuredClone(baseline);
    this.config = { customVars: { env: 'test' } };
    this.settings = { previewDomain: 'preview.example', previewPath: '/case' };
    this.saveCalls = 0;
    this.failMode = null;
    this.postWriteReadFailures = 0;
  }
  async getCurrentUser() { return { id: 1 }; }
  async preflightTargetUpdate() { return { allowed: true, decision: 'ALLOWED', reason: 'TEST', target: structuredClone(this.targetInfo) }; }
  async getCaseInfo(nid) { return structuredClone(nid === sourceNid ? this.sourceInfo : this.targetInfo); }
  async loadWork({ nid }) { return structuredClone(nid === sourceNid ? this.sourceWork : this.targetWork); }
  async getWorkEnvironment() {
    if (this.targetInfo.workId !== 'target-work-1' && this.postWriteReadFailures > 0) {
      this.postWriteReadFailures -= 1;
      throw Object.assign(new Error('read-back unavailable'), { code: 'PLATFORM_NETWORK_FAILED' });
    }
    return { workInfo: structuredClone(this.targetInfo), config: structuredClone(this.config), settings: structuredClone(this.settings) };
  }
  async saveWork({ work }) {
    this.saveCalls += 1;
    if (this.failMode === 'REJECTED') {
      throw Object.assign(new Error('platform denied target update'), {
        code: 'PLATFORM_PERMISSION_DENIED',
        details: { outcome: 'REJECTED_BY_PLATFORM' },
      });
    }
    if (this.failMode !== 'NO_WRITE') {
      this.targetWork = structuredClone(work);
      this.targetInfo.workId = 'target-work-2';
    }
    if (this.failMode === 'REJECTED_AFTER_WRITE') {
      throw Object.assign(new Error('contradictory platform denial after target change'), {
        code: 'PLATFORM_PERMISSION_DENIED',
        details: { outcome: 'REJECTED_BY_PLATFORM' },
      });
    }
    if (this.failMode) throw Object.assign(new Error('response lost'), { code: 'PLATFORM_NETWORK_FAILED' });
    return { workId: this.targetInfo.workId };
  }
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: targetNid, workId: 'target-work-1' } } });
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-refresh-apply-'));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const store = new RefreshStore(paths, { now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const jobs = new JobStore(paths);
  const lineage = createCompletedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs, now: () => new Date(NOW) });
  const adapter = new FakeAdapter();
  const refresh = store.create({ sourceNid, targetNid, lineageJobId: lineage.jobId, runtime });
  store.writeArtifact(refresh.refreshId, 'source/app.v4.json', source, { pretty: false });
  store.writeArtifact(refresh.refreshId, 'candidate/app.v5.json', candidate, { pretty: false });
  const routing = extractWorkRouting(adapter.targetInfo, adapter.settings);
  const plan = {
    schemaVersion: 2,
    kind: 'refresh-plan',
    planId: 'plan-1',
    refreshId: refresh.refreshId,
    source: { nid: sourceNid, gid: null, workId: adapter.sourceInfo.workId, sha256: revisionValueDigest(source), classificationArtifact: 'reports/source-version.json' },
    target: {
      nid: targetNid,
      workId: adapter.targetInfo.workId,
      sha256: revisionValueDigest(baseline),
      configSha256: revisionValueDigest(adapter.config),
      settingsSha256: revisionValueDigest(adapter.settings),
      routingSha256: revisionValueDigest(routing),
      lineageJobId: refresh.target.lineageJobId,
      classificationArtifact: 'reports/target-version.json',
    },
    runtime,
    candidate: { artifact: 'candidate/app.v5.json', sha256: revisionValueDigest(candidate), validationArtifact: 'reports/validation.json', structuralValidationPassed: true, issueCount: 0, blockerCount: 0 },
    identityRewrite: { sourceNid, targetNid },
    configurationPolicy: 'PRESERVE_TARGET_CONFIGURATION',
    diagnostics: { manifestArtifact: 'reports/diagnostics-manifest.json', converterDiagnosticsArtifact: null, sha256: HASH_A, total: 0 },
    expiresAt: '2026-08-14T11:00:00.000Z',
    createdAt: NOW.toISOString(),
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
  const planned = store.setPlan(refresh.refreshId, plan);
  const authorization = {
    schemaVersion: 2,
    kind: 'refresh-authorization',
    authorizationId: 'auth-1',
    refreshId: refresh.refreshId,
    planId: plan.planId,
    planSha256: planned.planSha256,
    source: { workId: plan.source.workId, sha256: plan.source.sha256 },
    target: {
      nid: plan.target.nid,
      workId: plan.target.workId,
      sha256: plan.target.sha256,
      configSha256: plan.target.configSha256,
      settingsSha256: plan.target.settingsSha256,
      routingSha256: plan.target.routingSha256,
    },
    candidateSha256: plan.candidate.sha256,
    diagnosticsSha256: plan.diagnostics.sha256,
    maxTargetRevisions: 1,
    confirmation: 'REFRESH_EXISTING_V5',
    expiresAt: '2026-08-14T11:00:00.000Z',
    createdAt: NOW.toISOString(),
    createdBy: 'USER',
    sensitivity: 'PRIVATE',
  };
  store.authorize(refresh.refreshId, authorization);
  const orchestrator = new RefreshApplyOrchestrator({ refreshes: store, reviews, adapter, runtime });
  return { temporary, store, jobs, reviews, lineage, adapter, refresh, plan, authorization, orchestrator };
}

test('Refresh apply performs one existing-target write and confirms preserved config by read-back', async () => {
  const context = fixture();
  try {
    const result = await context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId);
    assert.equal(result.refresh.status, 'TARGET_REFRESHED');
    assert.equal(result.refresh.result.targetWorkId, 'target-work-2');
    assert.equal(result.review.refreshId, context.refresh.refreshId);
    assert.equal(result.review.capability, 'WRITE');
    assert.equal(result.review.baseline.sourceWorkId, 'source-work-1');
    assert.equal(result.review.baseline.targetWorkId, 'target-work-2');
    assert.equal(context.store.load(context.refresh.refreshId).result.newReviewId, result.review.reviewId);
    assert.equal(context.adapter.saveCalls, 1);
    assert.deepEqual(context.adapter.targetWork, candidate);
    assert.deepEqual(context.adapter.config, { customVars: { env: 'test' } });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh apply supersedes the old write-capable Review and creates a fresh write Review', async () => {
  const context = fixture();
  const oldReview = context.reviews.create({
    jobId: context.lineage.jobId,
    capability: 'WRITE',
    runtime,
    targetSnapshot: baseline,
  });
  try {
    const result = await context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId);
    assert.deepEqual(result.supersededReviewIds, [oldReview.reviewId]);
    assert.equal(context.reviews.load(oldReview.reviewId).status, 'REVIEW_SUPERSEDED_BY_REFRESH');
    assert.equal(context.reviews.load(oldReview.reviewId).capability, 'READ_ONLY');
    assert.equal(result.review.capability, 'WRITE');
    assert.equal(result.review.status, 'REVIEW_OPEN');
    const finalizedAgain = await context.orchestrator.finalize(context.refresh.refreshId);
    assert.equal(finalizedAgain.review.reviewId, result.review.reviewId);
    assert.deepEqual(finalizedAgain.supersededReviewIds, [oldReview.reviewId]);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh apply confirms a lost response by candidate read-back without replay', async () => {
  const context = fixture();
  context.adapter.failMode = 'AFTER_WRITE';
  try {
    const result = await context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId);
    assert.equal(result.refresh.status, 'TARGET_REFRESHED');
    assert.equal(context.adapter.saveCalls, 1);
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_STATE_MISMATCH' });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh apply invalidates the plan before writing when the source drifts', async () => {
  const context = fixture();
  context.adapter.sourceInfo.workId = 'source-work-2';
  context.adapter.sourceWork.case.changed = true;
  try {
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_PLAN_STALE' });
    assert.equal(context.adapter.saveCalls, 0);
    assert.equal(context.store.load(context.refresh.refreshId).status, 'REFRESH_PLAN_STALE');
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh unknown write with the original baseline requires reconcile and never auto-replays', async () => {
  const context = fixture();
  context.adapter.failMode = 'NO_WRITE';
  try {
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_WRITE_OUTCOME_UNKNOWN' });
    assert.equal(context.store.load(context.refresh.refreshId).status, 'REFRESH_RECONCILIATION_REQUIRED');
    const reconciled = await context.orchestrator.reconcile(context.refresh.refreshId);
    assert.equal(reconciled.refresh.status, 'REFRESH_OUTCOME_UNKNOWN');
    assert.equal(context.adapter.saveCalls, 1);
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_STATE_MISMATCH' });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh platform permission rejection with exact baseline blocks without unknown reconciliation', async () => {
  const context = fixture();
  context.adapter.failMode = 'REJECTED';
  try {
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'TARGET_PERMISSION_DENIED' });
    assert.equal(context.store.load(context.refresh.refreshId).status, 'REFRESH_BLOCKED');
    const journal = context.store.loadJournal(context.refresh.refreshId);
    assert.equal(journal.phase, 'WRITE_REJECTED');
    assert.equal(journal.write.observedWorkId, context.plan.target.workId);
    assert.equal(context.adapter.saveCalls, 1);
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_STATE_MISMATCH' });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh candidate read-back wins over a contradictory rejection response', async () => {
  const context = fixture();
  context.adapter.failMode = 'REJECTED_AFTER_WRITE';
  try {
    const result = await context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId);
    assert.equal(result.refresh.status, 'TARGET_REFRESHED');
    assert.equal(context.store.loadJournal(context.refresh.refreshId).phase, 'READBACK_VERIFIED');
    assert.equal(context.adapter.saveCalls, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh reconcile confirms a previously unreadable candidate and finalizes Review succession without replay', async () => {
  const context = fixture();
  const oldReview = context.reviews.create({
    jobId: context.lineage.jobId,
    capability: 'WRITE',
    runtime,
    targetSnapshot: baseline,
  });
  context.adapter.failMode = 'AFTER_WRITE';
  context.adapter.postWriteReadFailures = 1;
  try {
    await assert.rejects(context.orchestrator.run(context.refresh.refreshId, context.authorization.authorizationId), { code: 'REFRESH_WRITE_OUTCOME_UNKNOWN' });
    assert.equal(context.store.load(context.refresh.refreshId).status, 'REFRESH_RECONCILIATION_REQUIRED');
    const reconciled = await context.orchestrator.reconcile(context.refresh.refreshId);
    assert.equal(reconciled.refresh.status, 'TARGET_REFRESHED');
    assert.equal(reconciled.review.status, 'REVIEW_OPEN');
    assert.equal(reconciled.review.capability, 'WRITE');
    assert.deepEqual(reconciled.supersededReviewIds, [oldReview.reviewId]);
    assert.equal(context.reviews.load(oldReview.reviewId).status, 'REVIEW_SUPERSEDED_BY_REFRESH');
    assert.equal(context.adapter.saveCalls, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh reconcile adopts a write-ahead journal after interruption before state persistence', async () => {
  const context = fixture();
  try {
    const readyState = context.store.load(context.refresh.refreshId);
    context.store.markWriteRequested(context.refresh.refreshId, context.authorization.authorizationId);
    fs.writeFileSync(context.store.statePath(context.refresh.refreshId), JSON.stringify(readyState), { mode: 0o600 });

    const reconciled = await context.orchestrator.reconcile(context.refresh.refreshId);
    assert.equal(reconciled.refresh.status, 'REFRESH_OUTCOME_UNKNOWN');
    assert.equal(context.adapter.saveCalls, 0);
    assert.throws(
      () => context.store.prepareApply(context.refresh.refreshId, context.authorization.authorizationId),
      { code: 'REFRESH_STATE_MISMATCH' },
    );
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});
