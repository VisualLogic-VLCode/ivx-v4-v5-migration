import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateHumanFinding, validateRuntimeReviewSession } from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { createRedactedRevisionDiff, revisionValueDigest } from './revision-diff.js';
import { assertReviewTransition, TERMINAL_REVIEW_STATES } from './states.js';

const REVIEWABLE_JOB_STATES = new Set(['SUCCEEDED', 'DIAGNOSTIC_COPY_CREATED']);
const REVIEW_ID_PATTERN = /^rev_[A-Za-z0-9_]+$/;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function timestampPart(now) {
  return now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function normalizeId(value, pattern, code, message) {
  invariant(typeof value === 'string' && pattern.test(value), code, message);
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && number > 0, 'INVALID_REVIEW_INPUT', `${name} must be a positive integer`);
  return number;
}

function nonEmptyString(value, name, max = 256) {
  invariant(typeof value === 'string' && value.trim() && value.length <= max, 'INVALID_REVIEW_INPUT', `${name} must be a non-empty string no longer than ${max} characters`);
  return value;
}

function assertSnapshot(value, name = 'targetSnapshot') {
  invariant(value !== undefined && value !== null && typeof value === 'object', 'INVALID_REVIEW_INPUT', `${name} must be a JSON object or array`);
  return value;
}

function relativeArtifactPath(...segments) {
  return segments.join('/');
}

export class RuntimeReviewStore {
  constructor(appPaths = createAppPaths(), { jobs, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
    this.paths = appPaths;
    this.jobs = jobs || new JobStore(appPaths);
    this.now = now;
    this.randomBytes = randomBytes;
    for (const directory of [appPaths.home, appPaths.reviews, appPaths.locks]) ensurePrivateDir(directory);
  }

  create({ jobId, capability = 'READ_ONLY', runtime, targetSnapshot, createdBy = 'CLI' } = {}) {
    return this.#withRegistryLock(() => {
      const job = this.jobs.load(jobId);
      invariant(REVIEWABLE_JOB_STATES.has(job.status), 'JOB_NOT_REVIEWABLE', 'Runtime review requires a completed V5 target Job', {
        jobId,
        status: job.status,
      });
      const targetNid = positiveInteger(job.target?.nid, 'job.target.nid');
      const targetWorkId = nonEmptyString(job.target?.workId, 'job.target.workId');
      const sourceWorkId = nonEmptyString(job.source?.workId, 'job.source.workId');
      assertSnapshot(targetSnapshot);
      invariant(['READ_ONLY', 'WRITE'].includes(capability), 'INVALID_REVIEW_CAPABILITY', 'capability must be READ_ONLY or WRITE');
      const registry = this.#readRegistry();
      if (capability === 'WRITE') this.#assertNoWriteConflict(registry, { targetNid, targetWorkId });
      const at = this.now().toISOString();
      const reviewId = this.#createId('rev', at);
      const review = {
        schemaVersion: 2,
        kind: 'runtime-review-session',
        reviewId,
        jobId,
        target: { nid: targetNid, workId: targetWorkId },
        capability,
        status: 'REVIEW_OPEN',
        runtime,
        baseline: { sourceWorkId, targetWorkId },
        activeCycleId: null,
        issueClusterIds: [],
        scenarioIds: [],
        humanFindingIds: [],
        repairBudgetIds: [],
        history: [{ status: 'REVIEW_OPEN', at, reason: 'review-created' }],
        createdAt: at,
        updatedAt: at,
        createdBy,
        sensitivity: 'PRIVATE',
      };
      validateRuntimeReviewSession(review);
      const directory = ensurePrivateDir(this.reviewDir(reviewId));
      for (const child of ['baselines', 'findings', 'revision-observations', 'observed-targets', 'baseline-acceptances']) {
        ensurePrivateDir(path.join(directory, child));
      }
      this.#writeBaselineSnapshot(reviewId, targetWorkId, targetSnapshot);
      writePrivateJson(this.statePath(reviewId), review);
      this.#updateRegistryValue(registry, review);
      return review;
    });
  }

  reviewDir(reviewId) {
    normalizeId(reviewId, REVIEW_ID_PATTERN, 'INVALID_REVIEW_ID', 'Invalid review id');
    return path.join(this.paths.reviews, reviewId);
  }

  statePath(reviewId) {
    return path.join(this.reviewDir(reviewId), 'state.json');
  }

  load(reviewId) {
    const state = readJson(this.statePath(reviewId), null);
    if (!state) throw new WorkflowError('REVIEW_NOT_FOUND', `Runtime Review Session not found: ${reviewId}`);
    return validateRuntimeReviewSession(state);
  }

  list({ jobId, targetNid } = {}) {
    let reviews = this.#readRegistry().reviews;
    if (jobId !== undefined) reviews = reviews.filter((entry) => entry.jobId === jobId);
    if (targetNid !== undefined) reviews = reviews.filter((entry) => entry.targetNid === Number(targetNid));
    return reviews;
  }

  transition(reviewId, nextStatus, { reason } = {}) {
    return this.#mutate(reviewId, (review) => {
      assertReviewTransition(review.status, nextStatus);
      this.#setStatus(review, nextStatus, reason || null);
      return review;
    });
  }

  submitHumanFinding(reviewId, input = {}) {
    return this.#mutate(reviewId, (review) => {
      const createdAt = this.now().toISOString();
      const findingId = input.findingId || this.#createId('finding', createdAt);
      normalizeId(findingId, ARTIFACT_ID_PATTERN, 'INVALID_FINDING_ID', 'Invalid finding id');
      invariant(!review.humanFindingIds.includes(findingId), 'HUMAN_FINDING_EXISTS', `Human Finding already exists: ${findingId}`);
      const finding = {
        schemaVersion: 2,
        kind: 'human-finding',
        findingId,
        reviewId,
        issueId: input.issueId ?? null,
        clusterId: input.clusterId ?? null,
        symptom: input.symptom,
        reproductionSteps: input.reproductionSteps || [],
        v4Observation: input.v4Observation ?? null,
        v5Observation: input.v5Observation ?? null,
        locations: input.locations || [],
        suggestedCause: input.suggestedCause ?? null,
        confidenceNote: input.confidenceNote ?? null,
        targetManuallyEdited: input.targetManuallyEdited === true,
        targetRevision: input.targetRevision ?? null,
        requests: input.requests || [],
        createdAt,
        createdBy: 'USER',
        sensitivity: 'PRIVATE',
      };
      validateHumanFinding(finding);
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('findings', `${findingId}.json`)), finding);
      review.humanFindingIds.push(findingId);
      if (review.status === 'AWAITING_HUMAN_EVIDENCE') {
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `human-finding-received:${findingId}`);
      } else {
        review.updatedAt = createdAt;
      }
      return { review, finding };
    });
  }

  listHumanFindings(reviewId) {
    const review = this.load(reviewId);
    return review.humanFindingIds.map((findingId) => validateHumanFinding(readJson(
      this.#artifactPath(reviewId, relativeArtifactPath('findings', `${findingId}.json`)),
    )));
  }

  observeTargetRevision(reviewId, { currentWorkId, targetSnapshot } = {}) {
    return this.#mutate(reviewId, (review) => {
      const observedWorkId = nonEmptyString(currentWorkId, 'currentWorkId');
      assertSnapshot(targetSnapshot);
      const baselineSnapshot = readJson(this.#baselineSnapshotPath(reviewId, review.baseline.targetWorkId));
      const diff = createRedactedRevisionDiff(baselineSnapshot, targetSnapshot);
      const baselineSha256 = revisionValueDigest(baselineSnapshot);
      const observedSha256 = revisionValueDigest(targetSnapshot);
      const changed = review.baseline.targetWorkId !== observedWorkId || baselineSha256 !== observedSha256;
      if (changed && TERMINAL_REVIEW_STATES.has(review.status)) {
        throw new WorkflowError('REVIEW_ALREADY_TERMINAL', 'A terminal review cannot adopt a new target revision; create a new Runtime Review Session', {
          reviewId,
          status: review.status,
        });
      }
      const createdAt = this.now().toISOString();
      const observationId = this.#createId('observation', createdAt);
      const observedArtifact = relativeArtifactPath('observed-targets', `${observationId}.json`);
      writePrivateJson(this.#artifactPath(reviewId, observedArtifact), targetSnapshot);
      const observation = {
        schemaVersion: 1,
        kind: 'target-revision-observation',
        observationId,
        reviewId,
        baseline: { workId: review.baseline.targetWorkId, sha256: baselineSha256 },
        observed: { workId: observedWorkId, sha256: observedSha256, artifact: observedArtifact },
        changed,
        diff,
        createdAt,
        sensitivity: 'REDACTED',
      };
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('revision-observations', `${observationId}.json`)), observation);
      if (changed) {
        if (review.status !== 'TARGET_EXTERNALLY_MODIFIED') {
          assertReviewTransition(review.status, 'TARGET_EXTERNALLY_MODIFIED');
          this.#setStatus(review, 'TARGET_EXTERNALLY_MODIFIED', `target-revision-drift:${observationId}`);
        } else {
          review.updatedAt = createdAt;
          review.history.push({ status: review.status, at: createdAt, reason: `target-revision-drift-refreshed:${observationId}` });
        }
      } else {
        review.updatedAt = createdAt;
      }
      return { review, observation };
    });
  }

  acceptExternalRevision(reviewId, { observationId, findingId } = {}) {
    return this.#mutate(reviewId, (review, registry) => {
      invariant(review.status === 'TARGET_EXTERNALLY_MODIFIED', 'REVIEW_STATE_MISMATCH', 'Review must be paused for an externally modified target');
      normalizeId(observationId, ARTIFACT_ID_PATTERN, 'INVALID_OBSERVATION_ID', 'Invalid observation id');
      normalizeId(findingId, ARTIFACT_ID_PATTERN, 'INVALID_FINDING_ID', 'Invalid finding id');
      invariant(review.humanFindingIds.includes(findingId), 'HUMAN_FINDING_NOT_LINKED', 'Human Finding is not linked to this review');
      const finding = validateHumanFinding(readJson(this.#artifactPath(reviewId, relativeArtifactPath('findings', `${findingId}.json`))));
      invariant(finding.createdBy === 'USER' && finding.targetManuallyEdited && finding.requests.includes('ACCEPT_TARGET_REVISION'), 'TARGET_BASELINE_USER_ASSERTION_REQUIRED', 'A matching USER Human Finding with ACCEPT_TARGET_REVISION is required');
      const observation = readJson(this.#artifactPath(reviewId, relativeArtifactPath('revision-observations', `${observationId}.json`)), null);
      invariant(observation?.kind === 'target-revision-observation' && observation.reviewId === reviewId, 'REVISION_OBSERVATION_INVALID', 'Revision observation is missing or belongs to another review');
      invariant(observation.changed === true, 'REVISION_OBSERVATION_UNCHANGED', 'Cannot accept an unchanged target revision');
      invariant(observation.baseline.workId === review.baseline.targetWorkId, 'REVISION_OBSERVATION_STALE', 'Revision observation was created against an older baseline');
      invariant(finding.targetRevision === observation.observed.workId, 'TARGET_BASELINE_ASSERTION_MISMATCH', 'Human Finding revision does not match the observed target revision');
      if (review.capability === 'WRITE') {
        this.#assertNoWriteConflict(registry, {
          reviewId,
          targetNid: review.target.nid,
          targetWorkId: observation.observed.workId,
        });
      }
      const observedSnapshot = readJson(this.#artifactPath(reviewId, observation.observed.artifact));
      invariant(revisionValueDigest(observedSnapshot) === observation.observed.sha256, 'REVISION_OBSERVATION_CONTENT_MISMATCH', 'Observed target snapshot no longer matches its audit digest');
      this.#writeBaselineSnapshot(reviewId, observation.observed.workId, observedSnapshot);
      const acceptedAt = this.now().toISOString();
      const acceptanceId = this.#createId('acceptance', acceptedAt);
      const acceptance = {
        schemaVersion: 1,
        kind: 'target-baseline-acceptance',
        acceptanceId,
        reviewId,
        fromWorkId: review.baseline.targetWorkId,
        toWorkId: observation.observed.workId,
        observationId,
        findingId,
        acceptedAt,
        createdBy: 'USER',
        sensitivity: 'PRIVATE',
      };
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('baseline-acceptances', `${acceptanceId}.json`)), acceptance);
      review.target.workId = observation.observed.workId;
      review.baseline.targetWorkId = observation.observed.workId;
      assertReviewTransition(review.status, 'LOCAL_VALIDATING');
      this.#setStatus(review, 'LOCAL_VALIDATING', `external-target-baseline-accepted:${acceptanceId}`);
      return { review, acceptance };
    });
  }

  recover(reviewId) {
    const review = this.load(reviewId);
    const observationDirectory = path.join(this.reviewDir(reviewId), 'revision-observations');
    const observations = fs.readdirSync(observationDirectory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => readJson(path.join(observationDirectory, file)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.observationId.localeCompare(right.observationId));
    const latestObservation = observations.at(-1) || null;
    return {
      review,
      humanFindings: this.listHumanFindings(reviewId),
      latestObservation,
      resumable: !TERMINAL_REVIEW_STATES.has(review.status),
    };
  }

  #createId(prefix, at) {
    return `${prefix}_${timestampPart(new Date(at))}_${this.randomBytes(5).toString('hex')}`;
  }

  #artifactPath(reviewId, relativePath) {
    const root = this.reviewDir(reviewId);
    const target = path.resolve(root, relativePath);
    invariant(target.startsWith(`${root}${path.sep}`), 'INVALID_ARTIFACT_PATH', 'Artifact path escapes review directory');
    return target;
  }

  #baselineSnapshotPath(reviewId, workId) {
    const key = revisionValueDigest(workId);
    return this.#artifactPath(reviewId, relativeArtifactPath('baselines', `${key}.json`));
  }

  #writeBaselineSnapshot(reviewId, workId, snapshot) {
    const target = this.#baselineSnapshotPath(reviewId, workId);
    const existing = readJson(target, null);
    if (existing !== null) {
      invariant(revisionValueDigest(existing) === revisionValueDigest(snapshot), 'BASELINE_REVISION_COLLISION', 'The same target workId resolves to different baseline content');
      return target;
    }
    writePrivateJson(target, snapshot);
    return target;
  }

  #mutate(reviewId, callback) {
    return this.#withRegistryLock(() => this.#withReviewLock(reviewId, () => {
      const registry = this.#readRegistry();
      const review = this.load(reviewId);
      const result = callback(review, registry);
      const state = result?.review || result;
      validateRuntimeReviewSession(state);
      writePrivateJson(this.statePath(reviewId), state);
      this.#updateRegistryValue(registry, state);
      return result;
    }));
  }

  #setStatus(review, status, reason) {
    const at = this.now().toISOString();
    review.status = status;
    review.updatedAt = at;
    review.history.push({ status, at, reason });
  }

  #assertNoWriteConflict(registry, { reviewId = null, targetNid, targetWorkId }) {
    const conflict = registry.reviews.find((entry) => (
      entry.reviewId !== reviewId
      && entry.capability === 'WRITE'
      && !TERMINAL_REVIEW_STATES.has(entry.status)
      && entry.targetNid === targetNid
      && entry.targetWorkId === targetWorkId
    ));
    invariant(!conflict, 'REVIEW_WRITE_LEASE_CONFLICT', 'Another write-capable review already owns this target revision', {
      conflictingReviewId: conflict?.reviewId || null,
      targetNid,
      targetWorkId,
    });
  }

  #readRegistry() {
    const registry = readJson(this.paths.reviewRegistry, { schemaVersion: 1, reviews: [] });
    invariant(registry?.schemaVersion === 1 && Array.isArray(registry.reviews), 'REVIEW_REGISTRY_INVALID', 'Review registry is invalid');
    return registry;
  }

  #updateRegistryValue(registry, review) {
    const entry = {
      reviewId: review.reviewId,
      jobId: review.jobId,
      targetNid: review.target.nid,
      targetWorkId: review.baseline.targetWorkId,
      capability: review.capability,
      status: review.status,
      updatedAt: review.updatedAt,
    };
    const index = registry.reviews.findIndex((candidate) => candidate.reviewId === review.reviewId);
    if (index >= 0) registry.reviews[index] = entry;
    else registry.reviews.unshift(entry);
    writePrivateJson(this.paths.reviewRegistry, registry);
  }

  #withRegistryLock(callback) {
    const lockPath = path.join(this.paths.locks, 'review-registry.lock');
    return withFileLock(
      lockPath,
      { pid: process.pid, operation: 'review-registry', at: this.now().toISOString() },
      { code: 'REVIEW_REGISTRY_LOCKED', message: 'Runtime Review registry is already being modified' },
      callback,
    );
  }

  #withReviewLock(reviewId, callback) {
    const lockPath = path.join(this.paths.locks, `${reviewId}.review.lock`);
    return withFileLock(
      lockPath,
      { pid: process.pid, reviewId, at: this.now().toISOString() },
      { code: 'REVIEW_LOCKED', message: `Runtime Review Session is already being modified: ${reviewId}` },
      callback,
    );
  }
}
