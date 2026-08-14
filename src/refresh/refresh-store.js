import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateRefreshAuthorization,
  validateRefreshJob,
  validateRefreshJournal,
  validateRefreshPlan,
} from '../contracts/schema-v2.js';
import { WorkflowError, invariant } from '../errors.js';
import { acquireFileLock, releaseFileLock, withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { createAppPaths } from '../paths.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';
import { assertRefreshTransition } from './states.js';

const REFRESH_ID_PATTERN = /^rfr_[A-Za-z0-9_]+$/;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLAN_PATH = 'refresh-plan.json';
const JOURNAL_PATH = 'refresh-journal.json';

function positiveInteger(value, name, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && number > 0, 'INVALID_REFRESH_INPUT', `${name} must be a positive integer`);
  return number;
}

function createRefreshId(now, randomBytes) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `rfr_${timestamp}_${randomBytes(5).toString('hex')}`;
}

function sameValue(left, right) {
  return revisionValueDigest(left) === revisionValueDigest(right);
}

export class RefreshStore {
  constructor(appPaths = createAppPaths(), { now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
    this.paths = appPaths;
    this.now = now;
    this.randomBytes = randomBytes;
    for (const directory of [appPaths.home, appPaths.refreshes, appPaths.locks]) ensurePrivateDir(directory);
  }

  create({ sourceNid, gid, targetNid, lineageJobId, runtime } = {}) {
    return this.#withRegistryLock(() => {
      invariant(/^mig_[A-Za-z0-9_]+$/.test(lineageJobId), 'INVALID_REFRESH_INPUT', 'lineageJobId must be a Migration Job id');
      const at = this.now().toISOString();
      const refreshId = createRefreshId(this.now(), this.randomBytes);
      const refresh = validateRefreshJob({
        schemaVersion: 2,
        kind: 'existing-target-refresh',
        refreshId,
        status: 'REFRESH_PREPARING',
        source: { nid: positiveInteger(sourceNid, 'sourceNid'), gid: positiveInteger(gid, 'gid', { optional: true }) },
        target: { nid: positiveInteger(targetNid, 'targetNid'), lineageJobId },
        runtime,
        plan: { planId: null, planSha256: null, artifact: null, authorizationId: null },
        result: { targetWorkId: null, targetSha256: null, newReviewId: null, supersededReviewIds: [] },
        history: [{ status: 'REFRESH_PREPARING', at, reason: 'refresh-created' }],
        createdAt: at,
        updatedAt: at,
        createdBy: 'CLI',
        sensitivity: 'PRIVATE',
      });
      const directory = ensurePrivateDir(this.refreshDir(refreshId));
      for (const child of ['source', 'target-baseline', 'candidate', 'reports', 'authorizations', 'target-readbacks']) ensurePrivateDir(path.join(directory, child));
      writePrivateJson(this.statePath(refreshId), refresh);
      this.#updateRegistry(refresh);
      return refresh;
    });
  }

  refreshDir(refreshId) {
    invariant(typeof refreshId === 'string' && REFRESH_ID_PATTERN.test(refreshId), 'INVALID_REFRESH_ID', 'Invalid Refresh id');
    return path.join(this.paths.refreshes, refreshId);
  }

  statePath(refreshId) {
    return path.join(this.refreshDir(refreshId), 'state.json');
  }

  load(refreshId) {
    const value = readJson(this.statePath(refreshId), null);
    if (!value) throw new WorkflowError('REFRESH_NOT_FOUND', `Refresh not found: ${refreshId}`);
    return validateRefreshJob(value);
  }

  list({ sourceNid, targetNid } = {}) {
    let values = this.#readRegistry().refreshes;
    if (sourceNid !== undefined) values = values.filter((entry) => entry.sourceNid === Number(sourceNid));
    if (targetNid !== undefined) values = values.filter((entry) => entry.targetNid === Number(targetNid));
    return values;
  }

  writeArtifact(refreshId, relativePath, value, { json = true, pretty = true } = {}) {
    const root = this.refreshDir(refreshId);
    const target = path.resolve(root, relativePath);
    invariant(target.startsWith(`${root}${path.sep}`), 'INVALID_ARTIFACT_PATH', 'Refresh artifact path escapes its directory');
    if (json) writePrivateJson(target, value, { pretty });
    else writePrivateFile(target, value);
    return target;
  }

  loadArtifact(refreshId, relativePath) {
    const root = this.refreshDir(refreshId);
    const target = path.resolve(root, relativePath);
    invariant(target.startsWith(`${root}${path.sep}`), 'INVALID_ARTIFACT_PATH', 'Refresh artifact path escapes its directory');
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    invariant(stat?.isFile() && !stat.isSymbolicLink(), 'REFRESH_ARTIFACT_INVALID', 'Refresh artifact is missing or unsafe');
    const value = readJson(target, null);
    invariant(value !== null, 'REFRESH_ARTIFACT_INVALID', 'Refresh artifact is not valid JSON');
    return value;
  }

  setPlan(refreshId, plan) {
    validateRefreshPlan(plan);
    return this.#mutate(refreshId, (refresh) => {
      invariant(refresh.status === 'REFRESH_PREPARING', 'REFRESH_STATE_MISMATCH', 'Refresh is not preparing a plan');
      invariant(plan.refreshId === refreshId, 'REFRESH_PLAN_MISMATCH', 'Refresh Plan belongs to a different Refresh');
      invariant(plan.source.nid === refresh.source.nid && plan.source.gid === refresh.source.gid, 'REFRESH_PLAN_MISMATCH', 'Refresh Plan source does not match the Refresh');
      invariant(plan.target.nid === refresh.target.nid && plan.target.lineageJobId === refresh.target.lineageJobId, 'REFRESH_PLAN_MISMATCH', 'Refresh Plan target lineage does not match the Refresh');
      invariant(sameValue(plan.runtime, refresh.runtime), 'REFRESH_PLAN_MISMATCH', 'Refresh Plan runtime pins do not match the Refresh');
      const target = path.join(this.refreshDir(refreshId), PLAN_PATH);
      invariant(!fs.existsSync(target), 'REFRESH_PLAN_EXISTS', 'Refresh Plan is immutable and already exists');
      writePrivateJson(target, plan);
      const planSha256 = revisionValueDigest(plan);
      refresh.plan = { planId: plan.planId, planSha256, artifact: PLAN_PATH, authorizationId: null };
      this.#setStatus(refresh, 'AWAITING_REFRESH_AUTHORIZATION', 'refresh-plan-ready');
      return { refresh, plan, planSha256 };
    });
  }

  loadPlan(refreshId) {
    const refresh = this.load(refreshId);
    invariant(refresh.plan.artifact === PLAN_PATH, 'REFRESH_PLAN_MISSING', 'Refresh has no immutable plan');
    const plan = validateRefreshPlan(readJson(path.join(this.refreshDir(refreshId), PLAN_PATH), null));
    invariant(revisionValueDigest(plan) === refresh.plan.planSha256, 'REFRESH_PLAN_CORRUPT', 'Refresh Plan does not match its persisted digest');
    return plan;
  }

  authorize(refreshId, authorization) {
    validateRefreshAuthorization(authorization);
    return this.#mutate(refreshId, (refresh) => {
      invariant(refresh.status === 'AWAITING_REFRESH_AUTHORIZATION', 'REFRESH_STATE_MISMATCH', 'Refresh is not awaiting authorization');
      const plan = this.loadPlan(refreshId);
      invariant(authorization.refreshId === refreshId && authorization.planId === plan.planId, 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh Authorization references a different plan');
      invariant(authorization.planSha256 === refresh.plan.planSha256, 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh Authorization plan digest does not match');
      invariant(sameValue(authorization.source, { workId: plan.source.workId, sha256: plan.source.sha256 }), 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh Authorization source pin does not match');
      invariant(sameValue(authorization.target, {
        nid: plan.target.nid,
        workId: plan.target.workId,
        sha256: plan.target.sha256,
        configSha256: plan.target.configSha256,
        settingsSha256: plan.target.settingsSha256,
        routingSha256: plan.target.routingSha256,
      }), 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh Authorization target baseline does not match');
      invariant(authorization.candidateSha256 === plan.candidate.sha256 && authorization.diagnosticsSha256 === plan.diagnostics.sha256, 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh Authorization candidate or diagnostics digest does not match');
      const relativePath = path.join('authorizations', `${authorization.authorizationId}.json`);
      const target = path.join(this.refreshDir(refreshId), relativePath);
      invariant(!fs.existsSync(target), 'REFRESH_AUTHORIZATION_EXISTS', 'Refresh Authorization id already exists');
      writePrivateJson(target, authorization);
      refresh.plan.authorizationId = authorization.authorizationId;
      this.#setStatus(refresh, 'REFRESH_READY_TO_APPLY', `refresh-authorized:${authorization.authorizationId}`);
      return { refresh, plan, authorization };
    });
  }

  loadAuthorization(refreshId, authorizationId) {
    invariant(typeof authorizationId === 'string' && ARTIFACT_ID_PATTERN.test(authorizationId), 'INVALID_REFRESH_AUTHORIZATION_ID', 'Invalid Refresh Authorization id');
    const value = readJson(path.join(this.refreshDir(refreshId), 'authorizations', `${authorizationId}.json`), null);
    invariant(value, 'REFRESH_AUTHORIZATION_NOT_FOUND', `Refresh Authorization not found: ${authorizationId}`);
    return validateRefreshAuthorization(value);
  }

  prepareApply(refreshId, authorizationId) {
    const refresh = this.load(refreshId);
    invariant(refresh.status === 'REFRESH_READY_TO_APPLY', 'REFRESH_STATE_MISMATCH', 'Refresh is not ready to apply');
    invariant(refresh.plan.authorizationId === authorizationId, 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh does not reference this Authorization');
    const plan = this.loadPlan(refreshId);
    const authorization = this.loadAuthorization(refreshId, authorizationId);
    invariant(Date.parse(plan.expiresAt) > this.now().getTime(), 'REFRESH_PLAN_EXPIRED', 'Refresh Plan expired before apply');
    invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'REFRESH_AUTHORIZATION_EXPIRED', 'Refresh Authorization expired before apply');
    const candidate = readJson(path.join(this.refreshDir(refreshId), plan.candidate.artifact), null);
    invariant(candidate && revisionValueDigest(candidate) === plan.candidate.sha256, 'REFRESH_CANDIDATE_CORRUPT', 'Refresh candidate does not match its plan digest');
    invariant(!fs.existsSync(path.join(this.refreshDir(refreshId), JOURNAL_PATH)), 'REFRESH_REPLAY_FORBIDDEN', 'A Refresh write journal already exists; use reconcile instead of replay');
    return { refresh, plan, authorization, candidate };
  }

  markWriteRequested(refreshId, authorizationId) {
    return this.#mutate(refreshId, (refresh) => {
      invariant(refresh.status === 'REFRESH_READY_TO_APPLY', 'REFRESH_STATE_MISMATCH', 'Refresh is not ready to write');
      const plan = this.loadPlan(refreshId);
      invariant(refresh.plan.authorizationId === authorizationId, 'REFRESH_AUTHORIZATION_MISMATCH', 'Refresh does not reference this Authorization');
      const journalPath = path.join(this.refreshDir(refreshId), JOURNAL_PATH);
      invariant(!fs.existsSync(journalPath), 'REFRESH_REPLAY_FORBIDDEN', 'Refresh write journal already exists');
      const at = this.now().toISOString();
      const journal = validateRefreshJournal({
        schemaVersion: 2,
        kind: 'refresh-journal',
        refreshId,
        planId: plan.planId,
        planSha256: refresh.plan.planSha256,
        authorizationId,
        phase: 'WRITE_REQUESTED',
        expectedTarget: {
          nid: plan.target.nid,
          workId: plan.target.workId,
          sha256: plan.target.sha256,
          configSha256: plan.target.configSha256,
          settingsSha256: plan.target.settingsSha256,
          routingSha256: plan.target.routingSha256,
        },
        candidateSha256: plan.candidate.sha256,
        write: { requestedAt: at, responseWorkId: null, observedWorkId: null, observedSha256: null, errorCode: null },
        attempts: [{ operation: 'target-refresh-write', status: 'REQUESTED', at, errorCode: null }],
        createdAt: at,
        updatedAt: at,
        createdBy: 'CLI',
        sensitivity: 'PRIVATE',
      });
      writePrivateJson(journalPath, journal);
      this.#setStatus(refresh, 'REFRESH_WRITE_REQUESTED', `refresh-write-requested:${authorizationId}`);
      return { refresh, plan, journal };
    });
  }

  loadJournal(refreshId) {
    const value = readJson(path.join(this.refreshDir(refreshId), JOURNAL_PATH), null);
    invariant(value, 'REFRESH_JOURNAL_NOT_FOUND', 'Refresh write journal does not exist');
    return validateRefreshJournal(value);
  }

  recordWriteUnknown(refreshId, { observedWorkId = null, observedSha256 = null, errorCode = 'PLATFORM_NETWORK_FAILED' } = {}) {
    return this.#mutateJournal(refreshId, ['REFRESH_WRITE_REQUESTED'], 'REFRESH_RECONCILIATION_REQUIRED', (journal, at) => {
      journal.phase = observedWorkId && observedSha256 ? 'RECONCILIATION_REQUIRED' : 'WRITE_OUTCOME_UNKNOWN';
      journal.write = { ...journal.write, observedWorkId, observedSha256, errorCode };
      journal.attempts.push({ operation: 'target-refresh-readback', status: 'OUTCOME_UNKNOWN', at, errorCode });
    });
  }

  adoptWriteJournalForReconciliation(refreshId, errorCode = 'REFRESH_PROCESS_INTERRUPTED') {
    const refresh = this.load(refreshId);
    if (refresh.status === 'REFRESH_RECONCILIATION_REQUIRED') {
      return { refresh, journal: this.loadJournal(refreshId) };
    }
    return this.#mutateJournal(refreshId, ['REFRESH_READY_TO_APPLY', 'REFRESH_WRITE_REQUESTED'], 'REFRESH_RECONCILIATION_REQUIRED', (journal, at) => {
      journal.phase = 'WRITE_OUTCOME_UNKNOWN';
      journal.write = { ...journal.write, errorCode };
      journal.attempts.push({ operation: 'target-refresh-recovery', status: 'OUTCOME_UNKNOWN', at, errorCode });
    });
  }

  confirmWrite(refreshId, { observedWorkId, observedSnapshot, responseWorkId = null } = {}) {
    invariant(typeof observedWorkId === 'string' && observedWorkId, 'REFRESH_READBACK_INVALID', 'Observed target workId is required');
    invariant(observedSnapshot && typeof observedSnapshot === 'object', 'REFRESH_READBACK_INVALID', 'Observed target snapshot is required');
    const observedSha256 = revisionValueDigest(observedSnapshot);
    return this.#mutateJournal(refreshId, ['REFRESH_WRITE_REQUESTED', 'REFRESH_RECONCILIATION_REQUIRED'], 'TARGET_REFRESHED', (journal, at, refresh) => {
      invariant(observedWorkId !== journal.expectedTarget.workId, 'REFRESH_REVISION_NOT_ADVANCED', 'Confirmed Refresh must advance the target workId');
      invariant(observedSha256 === journal.candidateSha256, 'REFRESH_READBACK_MISMATCH', 'Target read-back does not match the Refresh candidate');
      journal.phase = 'READBACK_VERIFIED';
      journal.write = { ...journal.write, responseWorkId, observedWorkId, observedSha256, errorCode: null };
      journal.attempts.push({ operation: 'target-refresh-readback', status: 'VERIFIED', at, errorCode: null });
      const readbackArtifactName = `${revisionValueDigest(observedWorkId)}.json`;
      this.writeArtifact(refreshId, path.join('target-readbacks', readbackArtifactName), observedSnapshot, { pretty: false });
      refresh.result.targetWorkId = observedWorkId;
      refresh.result.targetSha256 = observedSha256;
    });
  }

  markPlanStale(refreshId, reason) {
    return this.#transition(refreshId, 'REFRESH_PLAN_STALE', reason || 'refresh-plan-stale');
  }

  markTargetDrifted(refreshId, { observedWorkId = null, observedSha256 = null, errorCode = 'REFRESH_TARGET_DRIFTED' } = {}) {
    return this.#mutateJournal(refreshId, ['REFRESH_RECONCILIATION_REQUIRED'], 'REFRESH_TARGET_DRIFTED', (journal, at) => {
      journal.phase = 'TARGET_DRIFTED';
      journal.write = { ...journal.write, observedWorkId, observedSha256, errorCode };
      journal.attempts.push({ operation: 'target-refresh-reconcile', status: 'TARGET_DRIFTED', at, errorCode });
    });
  }

  markBaselineStillPresent(refreshId) {
    return this.#mutateJournal(refreshId, ['REFRESH_RECONCILIATION_REQUIRED'], 'REFRESH_OUTCOME_UNKNOWN', (journal, at) => {
      journal.phase = 'BASELINE_STILL_PRESENT';
      journal.write = { ...journal.write, observedWorkId: journal.expectedTarget.workId, observedSha256: journal.expectedTarget.sha256, errorCode: 'REFRESH_OUTCOME_UNKNOWN' };
      journal.attempts.push({ operation: 'target-refresh-reconcile', status: 'BASELINE_STILL_PRESENT', at, errorCode: 'REFRESH_OUTCOME_UNKNOWN' });
    });
  }

  block(refreshId, reason) {
    return this.#transition(refreshId, 'REFRESH_BLOCKED', reason || 'refresh-blocked');
  }

  recordReviewSuccession(refreshId, { newReviewId, supersededReviewIds = [] } = {}) {
    return this.#mutate(refreshId, (refresh) => {
      invariant(refresh.status === 'TARGET_REFRESHED', 'REFRESH_STATE_MISMATCH', 'Review succession requires a confirmed Refresh');
      invariant(/^rev_[A-Za-z0-9_]+$/.test(newReviewId), 'INVALID_REVIEW_ID', 'newReviewId is invalid');
      invariant(Array.isArray(supersededReviewIds) && supersededReviewIds.every((id) => /^rev_[A-Za-z0-9_]+$/.test(id)), 'INVALID_REVIEW_ID', 'supersededReviewIds are invalid');
      const normalizedSupersededIds = [...new Set(supersededReviewIds)].sort();
      if (refresh.result.newReviewId !== null) {
        invariant(
          refresh.result.newReviewId === newReviewId && sameValue(refresh.result.supersededReviewIds, normalizedSupersededIds),
          'REFRESH_REVIEW_SUCCESSION_CONFLICT',
          'Refresh Review succession was already recorded with different Review ids',
        );
        return refresh;
      }
      refresh.result.newReviewId = newReviewId;
      refresh.result.supersededReviewIds = normalizedSupersededIds;
      const at = this.now().toISOString();
      refresh.updatedAt = at;
      refresh.history.push({ status: refresh.status, at, reason: `review-succession-recorded:${newReviewId}` });
      return refresh;
    });
  }

  withOperationLease(refreshId, operation, callback) {
    invariant(/^[a-z][a-z0-9-]*$/.test(operation), 'INVALID_OPERATION', 'Invalid Refresh operation lease name');
    const lockPath = path.join(this.paths.locks, `${refreshId}.${operation}.lock`);
    const handle = acquireFileLock(lockPath, { pid: process.pid, operation, at: this.now().toISOString() }, {
      code: 'REFRESH_OPERATION_LOCKED',
      message: `Refresh operation is already running: ${operation}`,
    });
    const release = () => releaseFileLock(lockPath, handle);
    try {
      const result = callback();
      if (result && typeof result.then === 'function') return result.finally(release);
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  #transition(refreshId, status, reason) {
    return this.#mutate(refreshId, (refresh) => {
      this.#setStatus(refresh, status, reason);
      return refresh;
    });
  }

  #mutateJournal(refreshId, fromStatuses, nextStatus, update) {
    return this.#mutate(refreshId, (refresh) => {
      invariant(fromStatuses.includes(refresh.status), 'REFRESH_STATE_MISMATCH', `Refresh must be in ${fromStatuses.join(' or ')}`);
      const journal = this.loadJournal(refreshId);
      const at = this.now().toISOString();
      update(journal, at, refresh);
      journal.updatedAt = at;
      journal.attempts = journal.attempts.slice(-100);
      validateRefreshJournal(journal);
      writePrivateJson(path.join(this.refreshDir(refreshId), JOURNAL_PATH), journal);
      this.#setStatus(refresh, nextStatus, journal.write.errorCode || journal.phase);
      return { refresh, journal };
    });
  }

  #mutate(refreshId, callback) {
    const lockPath = path.join(this.paths.locks, `${refreshId}.lock`);
    return withFileLock(lockPath, { pid: process.pid, at: this.now().toISOString() }, {
      code: 'REFRESH_LOCKED',
      message: `Refresh is already being modified: ${refreshId}`,
    }, () => {
      const refresh = this.load(refreshId);
      const result = callback(refresh);
      validateRefreshJob(refresh);
      writePrivateJson(this.statePath(refreshId), refresh);
      this.#withRegistryLock(() => this.#updateRegistry(refresh));
      return result;
    });
  }

  #setStatus(refresh, status, reason) {
    assertRefreshTransition(refresh.status, status);
    const at = this.now().toISOString();
    refresh.status = status;
    refresh.updatedAt = at;
    refresh.history.push({ status, at, reason: reason || null });
  }

  #readRegistry() {
    const value = readJson(this.paths.refreshRegistry, { schemaVersion: 1, refreshes: [] });
    invariant(value?.schemaVersion === 1 && Array.isArray(value.refreshes), 'REFRESH_REGISTRY_INVALID', 'Refresh registry is invalid');
    return value;
  }

  #updateRegistry(refresh) {
    const registry = this.#readRegistry();
    const entry = {
      refreshId: refresh.refreshId,
      sourceNid: refresh.source.nid,
      gid: refresh.source.gid,
      targetNid: refresh.target.nid,
      lineageJobId: refresh.target.lineageJobId,
      status: refresh.status,
      updatedAt: refresh.updatedAt,
    };
    const index = registry.refreshes.findIndex((item) => item.refreshId === refresh.refreshId);
    if (index >= 0) registry.refreshes[index] = entry;
    else registry.refreshes.unshift(entry);
    writePrivateJson(this.paths.refreshRegistry, registry);
    return registry;
  }

  #withRegistryLock(callback) {
    const lockPath = path.join(this.paths.locks, 'refresh-registry.lock');
    return withFileLock(lockPath, { pid: process.pid, at: this.now().toISOString() }, {
      code: 'REFRESH_REGISTRY_LOCKED',
      message: 'Refresh registry is already being modified',
    }, callback);
  }
}
