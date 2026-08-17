import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateRuntimeExplorationAuthorization,
  validateRuntimeExplorationPlan,
  validateRuntimeExplorationReport,
} from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, sha256Buffer, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { RuntimeReviewStore } from '../reviews/review-store.js';
import { createJobArtifactManifest } from './job-artifact-manifest.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EQUIVALENT_ENVIRONMENTS = new Set(['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT']);
const PROFILE_LIMITS = Object.freeze({
  QUICK: { maxStates: 12, maxActions: 40, maxDepth: 3, maxDurationMs: 5 * 60_000, maxScreenshots: 24 },
  STANDARD: { maxStates: 60, maxActions: 300, maxDepth: 7, maxDurationMs: 20 * 60_000, maxScreenshots: 120 },
  DEEP: { maxStates: 250, maxActions: 1500, maxDepth: 12, maxDurationMs: 60 * 60_000, maxScreenshots: 500 },
});
const PROFILE_COVERAGE_MINIMUMS = Object.freeze({
  QUICK: { minStates: 5, minExecutedControls: 3 },
  STANDARD: { minStates: 20, minExecutedControls: 12 },
  DEEP: { minStates: 75, minExecutedControls: 50 },
});

function digest(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value)));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function identifier(value, name) {
  invariant(typeof value === 'string' && ID_PATTERN.test(value), 'EXPLORATION_ID_INVALID', `${name} is invalid`);
  return value;
}

function immutableJson(target, value, code = 'EXPLORATION_ARTIFACT_CONFLICT') {
  const existing = readJson(target, null);
  if (existing !== null) {
    invariant(digest(existing) === digest(value), code, 'Immutable exploration artifact already exists with different content');
    return existing;
  }
  writePrivateJson(target, value);
  return value;
}

export class RuntimeExplorationStore {
  constructor(appPaths = createAppPaths(), {
    jobs,
    reviews,
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
  } = {}) {
    this.paths = appPaths;
    this.jobs = jobs || new JobStore(appPaths);
    this.reviews = reviews || new RuntimeReviewStore(appPaths, { jobs: this.jobs });
    this.now = now;
    this.randomBytes = randomBytes;
    ensurePrivateDir(this.paths.locks);
  }

  static limitsForProfile(profile) {
    const limits = PROFILE_LIMITS[profile];
    invariant(limits, 'EXPLORATION_PROFILE_INVALID', `Unknown exploration profile: ${profile || ''}`);
    return { ...limits };
  }

  authorizationDir(reviewId) {
    return ensurePrivateDir(path.join(this.reviews.reviewDir(reviewId), 'exploration-authorizations'));
  }

  explorationBaseDir(reviewId) {
    return ensurePrivateDir(path.join(this.reviews.reviewDir(reviewId), 'explorations'));
  }

  explorationDir(reviewId, explorationId) {
    identifier(explorationId, 'explorationId');
    return path.join(this.explorationBaseDir(reviewId), explorationId);
  }

  authorize(reviewId, {
    environmentComparisonId,
    environmentMode = 'EQUIVALENT_ONLY',
    profile = 'STANDARD',
    limits = undefined,
    expiresAt = undefined,
    sourceOrigin,
    targetOrigin,
  } = {}) {
    return this.#withLock(reviewId, () => {
      const review = this.reviews.load(reviewId);
      const job = this.jobs.loadForRead(review.jobId).state;
      const environment = this.reviews.loadEnvironmentComparison(reviewId, environmentComparisonId);
      invariant(environment.sourceRevision.nid === Number(job.input.sourceNid) && environment.sourceRevision.workId === review.baseline.sourceWorkId, 'EXPLORATION_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the V4 review baseline');
      invariant(environment.targetRevision.nid === review.target.nid && environment.targetRevision.workId === review.baseline.targetWorkId, 'EXPLORATION_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the V5 review baseline');
      const equivalent = EQUIVALENT_ENVIRONMENTS.has(environment.status);
      invariant(equivalent || environmentMode === 'ALLOW_DIAGNOSTIC', 'EXPLORATION_ENVIRONMENT_AUTHORIZATION_REQUIRED', 'A non-equivalent environment can run only as explicitly authorized diagnostic exploration');
      invariant(!equivalent || environmentMode === 'EQUIVALENT_ONLY', 'EXPLORATION_ENVIRONMENT_MODE_INVALID', 'Equivalent environments must use EQUIVALENT_ONLY mode');
      const at = this.now();
      const expiry = expiresAt || new Date(at.getTime() + 2 * 60 * 60_000).toISOString();
      const manifest = createJobArtifactManifest({ jobs: this.jobs, jobId: review.jobId, now: this.now });
      const authorization = validateRuntimeExplorationAuthorization({
        schemaVersion: 2,
        kind: 'runtime-exploration-authorization',
        authorizationId: `explore-auth-${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${this.randomBytes(5).toString('hex')}`,
        reviewId,
        jobId: review.jobId,
        jobManifestSha256: manifest.sha256,
        source: { nid: Number(job.input.sourceNid), workId: review.baseline.sourceWorkId },
        target: { nid: review.target.nid, workId: review.baseline.targetWorkId },
        origins: { source: sourceOrigin, target: targetOrigin },
        scope: { jobArtifacts: 'COMPLETE_READ_ONLY', authenticatedSession: 'DRIVER_USE_ONLY', execution: 'AUTONOMOUS_READ_ONLY' },
        environment: { comparisonId: environment.comparisonId, status: environment.status },
        environmentMode,
        profile,
        limits: limits || RuntimeExplorationStore.limitsForProfile(profile),
        confirmation: 'RUN_AUTONOMOUS_READ_ONLY_EXPLORATION',
        expiresAt: expiry,
        createdAt: at.toISOString(),
        createdBy: 'USER',
        sensitivity: 'PRIVATE',
      });
      immutableJson(path.join(this.authorizationDir(reviewId), `${authorization.authorizationId}.json`), authorization, 'EXPLORATION_AUTHORIZATION_CONFLICT');
      immutableJson(this.#authorizedManifestPath(reviewId, authorization.authorizationId), manifest, 'EXPLORATION_JOB_MANIFEST_CONFLICT');
      return authorization;
    });
  }

  context(reviewId, authorizationId) {
    const authorization = this.loadAuthorization(reviewId, authorizationId);
    invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'EXPLORATION_AUTHORIZATION_EXPIRED', 'Exploration authorization has expired');
    const claim = readJson(this.#claimPath(reviewId, authorizationId), null);
    const manifest = readJson(this.#authorizedManifestPath(reviewId, authorizationId), null);
    invariant(manifest && manifest.sha256 === authorization.jobManifestSha256, 'EXPLORATION_JOB_MANIFEST_MISSING', 'Authorized Job artifact manifest is missing or invalid');
    const currentManifest = createJobArtifactManifest({ jobs: this.jobs, jobId: authorization.jobId, now: this.now });
    invariant(currentManifest.sha256 === manifest.sha256, 'EXPLORATION_JOB_ARTIFACTS_CHANGED', 'Job artifacts changed after exploration authorization; create a new authorization');
    const environmentPath = path.join(this.reviews.reviewDir(reviewId), 'environment', `${authorization.environment.comparisonId}.json`);
    invariant(fs.existsSync(environmentPath), 'EXPLORATION_ENVIRONMENT_MISSING', 'Authorized environment comparison is missing');
    return {
      schemaVersion: 1,
      kind: 'runtime-exploration-context',
      authorization,
      authorizationState: claim ? 'CLAIMED' : 'AVAILABLE',
      claim,
      job: { root: manifest.root, manifest },
      environmentComparisonPath: environmentPath,
      planTarget: path.join(this.explorationBaseDir(reviewId), '<explorationId>', 'plan.json'),
      credentialAccess: 'DRIVER_USE_ONLY',
    };
  }

  prepare(reviewId, { authorizationId, plan } = {}) {
    validateRuntimeExplorationPlan(plan);
    return this.#withLock(reviewId, () => {
      const authorization = this.loadAuthorization(reviewId, authorizationId);
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'EXPLORATION_AUTHORIZATION_EXPIRED', 'Exploration authorization has expired');
      invariant(plan.reviewId === reviewId && plan.jobId === authorization.jobId, 'EXPLORATION_PLAN_SCOPE_MISMATCH', 'Exploration Plan belongs to another Review or Job');
      invariant(plan.profile === authorization.profile && same(plan.limits, authorization.limits), 'EXPLORATION_PLAN_LIMIT_MISMATCH', 'Exploration Plan must use the authorized profile and exact limits');
      const coverageMinimum = PROFILE_COVERAGE_MINIMUMS[authorization.profile];
      invariant(
        plan.coverageGoal.minStates >= Math.min(coverageMinimum.minStates, authorization.limits.maxStates)
          && plan.coverageGoal.minExecutedControls >= Math.min(coverageMinimum.minExecutedControls, authorization.limits.maxActions),
        'EXPLORATION_COVERAGE_GOAL_TOO_LOW',
        `Exploration Plan coverage goal is below the ${authorization.profile} minimum`,
        { minimum: coverageMinimum },
      );
      invariant(Date.parse(plan.createdAt) >= Date.parse(authorization.createdAt) && Date.parse(plan.createdAt) < Date.parse(authorization.expiresAt), 'EXPLORATION_PLAN_TIME_INVALID', 'Exploration Plan must be created during the authorization window');
      const manifest = readJson(this.#authorizedManifestPath(reviewId, authorizationId), null);
      invariant(manifest && manifest.sha256 === authorization.jobManifestSha256, 'EXPLORATION_JOB_MANIFEST_MISSING', 'Authorized Job artifact manifest is missing or invalid');
      const currentManifest = createJobArtifactManifest({ jobs: this.jobs, jobId: authorization.jobId, now: this.now });
      invariant(currentManifest.sha256 === manifest.sha256, 'EXPLORATION_JOB_ARTIFACTS_CHANGED', 'Job artifacts changed after exploration authorization; create a new authorization');
      const planSha256 = digest(plan);
      const claim = {
        schemaVersion: 1,
        kind: 'runtime-exploration-authorization-claim',
        authorizationId,
        explorationId: plan.explorationId,
        planSha256,
        jobManifestSha256: manifest.sha256,
        claimedAt: this.now().toISOString(),
        createdBy: 'CLI',
        sensitivity: 'PRIVATE',
      };
      const existingClaim = readJson(this.#claimPath(reviewId, authorizationId), null);
      if (existingClaim) {
        invariant(existingClaim.explorationId === plan.explorationId && existingClaim.planSha256 === planSha256 && existingClaim.jobManifestSha256 === manifest.sha256, 'EXPLORATION_AUTHORIZATION_ALREADY_USED', 'Exploration authorization was already claimed by a different immutable Plan or Job snapshot');
      } else {
        immutableJson(this.#claimPath(reviewId, authorizationId), claim, 'EXPLORATION_AUTHORIZATION_ALREADY_USED');
      }
      const root = ensurePrivateDir(this.explorationDir(reviewId, plan.explorationId));
      for (const child of ['paths', 'screenshots', 'diffs']) ensurePrivateDir(path.join(root, child));
      immutableJson(path.join(root, 'authorization.json'), authorization);
      immutableJson(path.join(root, 'plan.json'), plan);
      immutableJson(path.join(root, 'job-manifest.json'), manifest);
      const environment = this.reviews.loadEnvironmentComparison(reviewId, authorization.environment.comparisonId);
      immutableJson(path.join(root, 'environment-comparison.json'), environment);
      const existingState = readJson(path.join(root, 'state.json'), null);
      const state = existingState || {
        schemaVersion: 1,
        kind: 'runtime-exploration-state',
        explorationId: plan.explorationId,
        reviewId,
        jobId: authorization.jobId,
        authorizationId,
        status: 'READY',
        checkpointSequence: 0,
        startedAt: null,
        updatedAt: this.now().toISOString(),
        completedAt: null,
        interruption: null,
        createdBy: 'CLI',
        sensitivity: 'PRIVATE',
      };
      if (!existingState) writePrivateJson(path.join(root, 'state.json'), state);
      return { authorization, claim: existingClaim || claim, plan, manifest, environment, state, root };
    });
  }

  loadAuthorization(reviewId, authorizationId) {
    identifier(authorizationId, 'authorizationId');
    const value = readJson(path.join(this.authorizationDir(reviewId), `${authorizationId}.json`), null);
    if (!value) throw new WorkflowError('EXPLORATION_AUTHORIZATION_NOT_FOUND', `Exploration authorization not found: ${authorizationId}`);
    return validateRuntimeExplorationAuthorization(value);
  }

  load(reviewId, explorationId) {
    const root = this.explorationDir(reviewId, explorationId);
    const state = readJson(path.join(root, 'state.json'), null);
    if (!state) throw new WorkflowError('EXPLORATION_NOT_FOUND', `Runtime exploration not found: ${explorationId}`);
    return {
      root,
      state,
      authorization: validateRuntimeExplorationAuthorization(readJson(path.join(root, 'authorization.json'))),
      plan: validateRuntimeExplorationPlan(readJson(path.join(root, 'plan.json'))),
      manifest: readJson(path.join(root, 'job-manifest.json')),
      environment: this.reviews.loadEnvironmentComparison(reviewId, readJson(path.join(root, 'authorization.json')).environment.comparisonId),
      checkpoint: readJson(path.join(root, 'checkpoint.json'), null),
      report: readJson(path.join(root, 'report.json'), null),
    };
  }

  markRunning(reviewId, explorationId) {
    return this.#mutateState(reviewId, explorationId, (state) => {
      const loaded = this.load(reviewId, explorationId);
      invariant(Date.parse(loaded.authorization.expiresAt) > this.now().getTime(), 'EXPLORATION_AUTHORIZATION_EXPIRED', 'Exploration authorization has expired');
      invariant(['READY', 'INTERRUPTED'].includes(state.status), 'EXPLORATION_STATE_INVALID', 'Exploration is not ready to run or resume');
      state.status = 'RUNNING';
      state.startedAt ||= this.now().toISOString();
      state.interruption = null;
    });
  }

  checkpoint(reviewId, explorationId, checkpoint) {
    return this.#withLock(reviewId, () => {
      const loaded = this.load(reviewId, explorationId);
      invariant(loaded.state.status === 'RUNNING', 'EXPLORATION_STATE_INVALID', 'Only a running exploration can checkpoint');
      const next = { ...checkpoint, explorationId, sequence: loaded.state.checkpointSequence + 1, updatedAt: this.now().toISOString() };
      writePrivateJson(path.join(loaded.root, 'checkpoint.json'), next);
      loaded.state.checkpointSequence = next.sequence;
      loaded.state.updatedAt = next.updatedAt;
      writePrivateJson(path.join(loaded.root, 'state.json'), loaded.state);
      return next;
    });
  }

  complete(reviewId, explorationId, report) {
    validateRuntimeExplorationReport(report);
    return this.#withLock(reviewId, () => {
      const loaded = this.load(reviewId, explorationId);
      invariant(loaded.state.status === 'RUNNING', 'EXPLORATION_STATE_INVALID', 'Only a running exploration can complete');
      invariant(report.explorationId === explorationId && report.reviewId === reviewId && report.authorizationId === loaded.authorization.authorizationId, 'EXPLORATION_REPORT_SCOPE_MISMATCH', 'Exploration Report belongs to another execution');
      immutableJson(path.join(loaded.root, 'report.json'), report, 'EXPLORATION_REPORT_CONFLICT');
      loaded.state.status = 'COMPLETED';
      loaded.state.completedAt = report.completedAt;
      loaded.state.updatedAt = report.completedAt;
      writePrivateJson(path.join(loaded.root, 'state.json'), loaded.state);
      return { state: loaded.state, report };
    });
  }

  interrupt(reviewId, explorationId, error) {
    return this.#mutateState(reviewId, explorationId, (state) => {
      invariant(state.status === 'RUNNING', 'EXPLORATION_STATE_INVALID', 'Only a running exploration can be interrupted');
      state.status = 'INTERRUPTED';
      state.interruption = { code: error?.code || 'EXPLORATION_INTERRUPTED', message: String(error?.message || error || 'Interrupted').slice(0, 1024), at: this.now().toISOString() };
    });
  }

  withLease(reviewId, explorationId, callback) {
    const lockPath = path.join(this.paths.locks, `${reviewId}.${identifier(explorationId, 'explorationId')}.exploration-run.lock`);
    return withFileLock(lockPath, { pid: process.pid, reviewId, explorationId, operation: 'runtime-exploration', at: this.now().toISOString() }, {
      code: 'EXPLORATION_RUN_LOCKED',
      message: `Runtime exploration is already executing: ${explorationId}`,
    }, callback);
  }

  #claimPath(reviewId, authorizationId) {
    return path.join(this.authorizationDir(reviewId), `${identifier(authorizationId, 'authorizationId')}.claim.json`);
  }

  #authorizedManifestPath(reviewId, authorizationId) {
    return path.join(this.authorizationDir(reviewId), `${identifier(authorizationId, 'authorizationId')}.job-manifest.json`);
  }

  #mutateState(reviewId, explorationId, callback) {
    return this.#withLock(reviewId, () => {
      const loaded = this.load(reviewId, explorationId);
      callback(loaded.state);
      loaded.state.updatedAt = this.now().toISOString();
      writePrivateJson(path.join(loaded.root, 'state.json'), loaded.state);
      return loaded.state;
    });
  }

  #withLock(reviewId, callback) {
    this.reviews.load(reviewId);
    const lockPath = path.join(this.paths.locks, `${reviewId}.exploration.lock`);
    return withFileLock(lockPath, { pid: process.pid, reviewId, operation: 'runtime-exploration-store', at: this.now().toISOString() }, {
      code: 'EXPLORATION_STORE_LOCKED',
      message: `Runtime exploration metadata is already being modified: ${reviewId}`,
    }, callback);
  }
}
