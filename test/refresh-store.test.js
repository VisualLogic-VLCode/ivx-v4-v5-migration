import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { RefreshStore } from '../src/refresh/refresh-store.js';
import { revisionValueDigest } from '../src/reviews/revision-diff.js';

const NOW = new Date('2026-08-14T04:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const runtime = {
  workflow: { version: '0.6.0', sha256: HASH_A },
  converter: { version: '1.2.2', sha256: HASH_B },
  knowledge: { version: '0.1.4', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
};

function createPlan(refresh) {
  return {
    schemaVersion: 2,
    kind: 'refresh-plan',
    planId: 'plan-1',
    refreshId: refresh.refreshId,
    source: { nid: 11064050, gid: null, workId: 'source-work-2', sha256: HASH_A, classificationArtifact: 'reports/source-version.json' },
    target: {
      nid: 12229365,
      workId: 'target-work-1',
      sha256: HASH_B,
      configSha256: HASH_C,
      settingsSha256: HASH_A,
      routingSha256: HASH_B,
      lineageJobId: 'mig_20260814040000_abcde',
      classificationArtifact: 'reports/target-version.json',
    },
    runtime,
    candidate: { artifact: 'candidate/app.v5.json', sha256: HASH_C, validationArtifact: 'reports/validation.json', structuralValidationPassed: true, issueCount: 0, blockerCount: 0 },
    identityRewrite: { sourceNid: 11064050, targetNid: 12229365 },
    configurationPolicy: 'PRESERVE_TARGET_CONFIGURATION',
    diagnostics: { manifestArtifact: 'reports/diagnostics-manifest.json', converterDiagnosticsArtifact: null, sha256: HASH_A, total: 0 },
    expiresAt: '2026-08-14T11:00:00.000Z',
    createdAt: NOW.toISOString(),
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
}

function createAuthorization(refresh, plan, planSha256) {
  return {
    schemaVersion: 2,
    kind: 'refresh-authorization',
    authorizationId: 'auth-1',
    refreshId: refresh.refreshId,
    planId: plan.planId,
    planSha256,
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
}

function setupStore() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-refresh-store-'));
  const store = new RefreshStore(createAppPaths(temporary), {
    now: () => new Date(NOW),
    randomBytes: () => Buffer.from('1234567890', 'hex'),
  });
  const refresh = store.create({
    sourceNid: 11064050,
    targetNid: 12229365,
    lineageJobId: 'mig_20260814040000_abcde',
    runtime,
  });
  const candidate = { case: { nid: 12229365 }, stage: {}, server: {} };
  const plan = createPlan(refresh);
  plan.candidate.sha256 = revisionValueDigest(candidate);
  store.writeArtifact(refresh.refreshId, plan.candidate.artifact, candidate, { pretty: false });
  const planned = store.setPlan(refresh.refreshId, plan);
  const authorization = createAuthorization(refresh, plan, planned.planSha256);
  return { temporary, store, refresh, plan, candidate, authorization };
}

test('RefreshStore persists an immutable plan and exact single-write authorization', () => {
  const setup = setupStore();
  try {
    const { store, refresh, plan, authorization } = setup;
    assert.equal(store.load(refresh.refreshId).status, 'AWAITING_REFRESH_AUTHORIZATION');
    assert.throws(() => store.setPlan(refresh.refreshId, plan), { code: 'REFRESH_STATE_MISMATCH' });
    const authorized = store.authorize(refresh.refreshId, authorization);
    assert.equal(authorized.refresh.status, 'REFRESH_READY_TO_APPLY');
    assert.equal(store.prepareApply(refresh.refreshId, authorization.authorizationId).candidate.case.nid, 12229365);
    const requested = store.markWriteRequested(refresh.refreshId, authorization.authorizationId);
    assert.equal(requested.refresh.status, 'REFRESH_WRITE_REQUESTED');
    assert.throws(() => store.prepareApply(refresh.refreshId, authorization.authorizationId), { code: 'REFRESH_STATE_MISMATCH' });
    assert.equal(fs.statSync(store.statePath(refresh.refreshId)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});

test('RefreshStore rejects an authorization id before using it as an artifact path', () => {
  const setup = setupStore();
  try {
    assert.throws(
      () => setup.store.loadAuthorization(setup.refresh.refreshId, '../../outside'),
      { code: 'INVALID_REFRESH_AUTHORIZATION_ID' },
    );
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});

test('RefreshStore never turns an unchanged unknown outcome into an automatic replay', () => {
  const setup = setupStore();
  try {
    const { store, refresh, authorization } = setup;
    store.authorize(refresh.refreshId, authorization);
    store.markWriteRequested(refresh.refreshId, authorization.authorizationId);
    store.recordWriteUnknown(refresh.refreshId, { observedWorkId: 'target-work-1', observedSha256: HASH_B });
    const result = store.markBaselineStillPresent(refresh.refreshId);
    assert.equal(result.refresh.status, 'REFRESH_OUTCOME_UNKNOWN');
    assert.equal(result.journal.phase, 'BASELINE_STILL_PRESENT');
    assert.throws(() => store.markWriteRequested(refresh.refreshId, authorization.authorizationId), { code: 'REFRESH_STATE_MISMATCH' });
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});

test('RefreshStore records an exact-baseline platform rejection as blocked, not unknown', () => {
  const setup = setupStore();
  try {
    const { store, refresh, authorization, plan } = setup;
    store.authorize(refresh.refreshId, authorization);
    store.markWriteRequested(refresh.refreshId, authorization.authorizationId);
    const result = store.recordWriteRejected(refresh.refreshId, {
      observedWorkId: plan.target.workId,
      observedSha256: plan.target.sha256,
      errorCode: 'PLATFORM_PERMISSION_DENIED',
    });
    assert.equal(result.refresh.status, 'REFRESH_BLOCKED');
    assert.equal(result.journal.phase, 'WRITE_REJECTED');
    assert.equal(result.journal.attempts.at(-1).status, 'REJECTED_BY_PLATFORM');
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});

test('RefreshStore confirms only a revision-advanced candidate read-back', () => {
  const setup = setupStore();
  try {
    const { store, refresh, authorization, candidate } = setup;
    store.authorize(refresh.refreshId, authorization);
    store.markWriteRequested(refresh.refreshId, authorization.authorizationId);
    assert.throws(() => store.confirmWrite(refresh.refreshId, { observedWorkId: 'target-work-1', observedSnapshot: candidate }), { code: 'REFRESH_REVISION_NOT_ADVANCED' });
    const confirmed = store.confirmWrite(refresh.refreshId, { observedWorkId: 'target-work-2', observedSnapshot: candidate });
    assert.equal(confirmed.refresh.status, 'TARGET_REFRESHED');
    assert.equal(confirmed.refresh.result.targetWorkId, 'target-work-2');
    assert.equal(store.list({ targetNid: 12229365 })[0].refreshId, refresh.refreshId);
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});

test('RefreshStore never uses an observed platform workId as an artifact path', () => {
  const setup = setupStore();
  try {
    const { store, refresh, authorization, candidate } = setup;
    store.authorize(refresh.refreshId, authorization);
    store.markWriteRequested(refresh.refreshId, authorization.authorizationId);
    const observedWorkId = '../../platform-controlled-work-id';
    const confirmed = store.confirmWrite(refresh.refreshId, { observedWorkId, observedSnapshot: candidate });
    const readbackDirectory = path.join(store.refreshDir(refresh.refreshId), 'target-readbacks');
    const artifacts = fs.readdirSync(readbackDirectory);
    assert.equal(confirmed.refresh.result.targetWorkId, observedWorkId);
    assert.equal(artifacts.length, 1);
    assert.match(artifacts[0], /^[a-f0-9]{64}\.json$/);
    assert.equal(fs.existsSync(path.join(store.refreshDir(refresh.refreshId), 'platform-controlled-work-id.json')), false);
  } finally {
    fs.rmSync(setup.temporary, { recursive: true, force: true });
  }
});
