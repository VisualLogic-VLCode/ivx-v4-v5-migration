import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateBehaviorTrace,
  validateEnvironmentComparison,
  validateHumanFinding,
  validateRuntimeComparison,
  validateRuntimeReviewSession,
  validateRuntimeScenario,
} from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { createRedactedRevisionDiff, revisionValueDigest } from './revision-diff.js';
import { redactRuntimeText } from '../runtime/trace-redaction.js';
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
      if (job.runtime?.knowledge) {
        invariant(
          runtime?.knowledge?.version === job.runtime.knowledge.version
          && runtime?.knowledge?.sha256 === job.runtime.knowledge.sha256
          && runtime?.knowledge?.contentSha256 === job.runtime.knowledge.contentSha256
          && runtime?.knowledge?.schemaVersion === job.runtime.knowledge.schemaVersion,
          'KNOWLEDGE_PIN_MISMATCH',
          'Runtime Review Session must inherit the Migration Job Knowledge pin',
        );
      }
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
      for (const child of ['baselines', 'findings', 'revision-observations', 'observed-targets', 'baseline-acceptances', 'knowledge', 'environment', 'scenarios', 'cycles', 'runtime-authorizations', 'reports']) {
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

  addRuntimeScenario(reviewId, scenario) {
    validateRuntimeScenario(scenario);
    return this.#mutate(reviewId, (review) => {
      const target = this.#artifactPath(reviewId, relativeArtifactPath('scenarios', `${scenario.scenarioId}.json`));
      const existing = readJson(target, null);
      if (existing) {
        invariant(revisionValueDigest(existing) === revisionValueDigest(scenario), 'RUNTIME_SCENARIO_CONFLICT', 'Runtime Scenario id already exists with different content');
      } else {
        writePrivateJson(target, scenario);
      }
      if (!review.scenarioIds.includes(scenario.scenarioId)) review.scenarioIds.push(scenario.scenarioId);
      review.scenarioIds.sort();
      review.updatedAt = this.now().toISOString();
      return { review, scenario };
    });
  }

  listRuntimeScenarios(reviewId) {
    const review = this.load(reviewId);
    return review.scenarioIds.map((scenarioId) => validateRuntimeScenario(readJson(
      this.#artifactPath(reviewId, relativeArtifactPath('scenarios', `${scenarioId}.json`)),
    )));
  }

  runtimeCycleDir(reviewId, cycleId) {
    normalizeId(cycleId, ARTIFACT_ID_PATTERN, 'INVALID_RUNTIME_CYCLE_ID', 'Invalid runtime cycle id');
    return this.#artifactPath(reviewId, relativeArtifactPath('cycles', cycleId));
  }

  withRuntimeLease(reviewId, callback) {
    const lockPath = path.join(this.paths.locks, `${reviewId}.runtime.lock`);
    return withFileLock(
      lockPath,
      { pid: process.pid, reviewId, operation: 'runtime-cycle', at: this.now().toISOString() },
      { code: 'RUNTIME_CYCLE_LOCKED', message: `A runtime cycle is already executing for this review: ${reviewId}` },
      callback,
    );
  }

  prepareRuntimeCycle(reviewId, { scenarioIds, source, target, environmentComparison, authorization = null } = {}) {
    validateEnvironmentComparison(environmentComparison);
    return this.#mutate(reviewId, (review) => {
      invariant(environmentComparison.reviewId === reviewId, 'ENVIRONMENT_REVIEW_MISMATCH', 'Environment comparison belongs to another review');
      invariant(Array.isArray(scenarioIds) && scenarioIds.length > 0 && scenarioIds.length <= 100, 'RUNTIME_SCENARIOS_REQUIRED', 'Runtime cycle requires 1-100 scenarios');
      invariant(new Set(scenarioIds).size === scenarioIds.length, 'RUNTIME_SCENARIOS_INVALID', 'Runtime cycle scenario ids must be unique');
      const scenarios = scenarioIds.map((scenarioId) => {
        invariant(review.scenarioIds.includes(scenarioId), 'RUNTIME_SCENARIO_NOT_LINKED', `Runtime Scenario is not linked to this review: ${scenarioId}`);
        return validateRuntimeScenario(readJson(this.#artifactPath(reviewId, relativeArtifactPath('scenarios', `${scenarioId}.json`))));
      });
      invariant(review.activeCycleId === null, 'RUNTIME_CYCLE_ACTIVE', 'Another runtime cycle is already active for this review');
      invariant(source?.generation === 'V4' && positiveInteger(source.nid, 'source.nid') && nonEmptyString(source.workId, 'source.workId'), 'RUNTIME_SUBJECT_INVALID', 'Source runtime subject is invalid');
      invariant(target?.generation === 'V5' && positiveInteger(target.nid, 'target.nid') && nonEmptyString(target.workId, 'target.workId'), 'RUNTIME_SUBJECT_INVALID', 'Target runtime subject is invalid');
      invariant(source.workId === review.baseline.sourceWorkId, 'RUNTIME_SOURCE_REVISION_MISMATCH', 'Runtime source revision does not match the review baseline');
      invariant(target.nid === review.target.nid && target.workId === review.baseline.targetWorkId, 'RUNTIME_TARGET_REVISION_MISMATCH', 'Runtime target revision does not match the review baseline');
      invariant(environmentComparison.sourceRevision.nid === Number(source.nid) && environmentComparison.sourceRevision.workId === source.workId, 'RUNTIME_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the source runtime revision');
      invariant(environmentComparison.targetRevision.nid === Number(target.nid) && environmentComparison.targetRevision.workId === target.workId, 'RUNTIME_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the target runtime revision');
      const requiresAuthorization = scenarios.some((scenario) => scenario.executionPolicy.authorizationRequired);
      if (requiresAuthorization) this.#validateRuntimeAuthorization(review, scenarios, authorization);
      else invariant(authorization === null, 'RUNTIME_AUTHORIZATION_UNEXPECTED', 'READ_ONLY runtime cycles must not attach a side-effect authorization');

      invariant(['REVIEW_OPEN', 'RUNTIME_NOT_TESTED', 'AWAITING_USER_BINDING', 'BLOCKED_ENVIRONMENT', 'ENVIRONMENT_PREFLIGHT', 'TEST_OR_ENV_REPAIR', 'TARGET_UPDATED', 'BLOCKED_PLATFORM_RUNTIME'].includes(review.status), 'REVIEW_STATE_MISMATCH', 'Review is not ready to evaluate a runtime environment', { status: review.status });
      this.#writeImmutableJson(this.#artifactPath(reviewId, relativeArtifactPath('environment', `${environmentComparison.comparisonId}.json`)), environmentComparison, 'ENVIRONMENT_COMPARISON_CONFLICT');
      if (['REVIEW_OPEN', 'RUNTIME_NOT_TESTED', 'AWAITING_USER_BINDING', 'BLOCKED_ENVIRONMENT'].includes(review.status)) {
        assertReviewTransition(review.status, 'ENVIRONMENT_PREFLIGHT');
        this.#setStatus(review, 'ENVIRONMENT_PREFLIGHT', `environment-comparison:${environmentComparison.comparisonId}`);
      }
      if (environmentComparison.status === 'REQUIRES_USER_BINDING') {
        invariant(review.status === 'ENVIRONMENT_PREFLIGHT', 'REVIEW_STATE_MISMATCH', 'Environment binding decision requires environment preflight state');
        assertReviewTransition(review.status, 'AWAITING_USER_BINDING');
        this.#setStatus(review, 'AWAITING_USER_BINDING', `environment-comparison:${environmentComparison.comparisonId}`);
        return { review, blocked: true, environmentComparison, scenarios };
      }
      if (environmentComparison.status === 'BLOCKED_ENVIRONMENT') {
        invariant(review.status === 'ENVIRONMENT_PREFLIGHT', 'REVIEW_STATE_MISMATCH', 'Blocked environment decision requires environment preflight state');
        assertReviewTransition(review.status, 'BLOCKED_ENVIRONMENT');
        this.#setStatus(review, 'BLOCKED_ENVIRONMENT', `environment-comparison:${environmentComparison.comparisonId}`);
        return { review, blocked: true, environmentComparison, scenarios };
      }
      invariant(['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT'].includes(environmentComparison.status), 'RUNTIME_ENVIRONMENT_NOT_COMPARABLE', 'Runtime comparison requires an equivalent environment');
      const nextStatus = review.status === 'TARGET_UPDATED' ? 'RUNTIME_RETESTING' : 'RUNTIME_TESTING';
      invariant(['ENVIRONMENT_PREFLIGHT', 'TEST_OR_ENV_REPAIR', 'TARGET_UPDATED', 'BLOCKED_PLATFORM_RUNTIME'].includes(review.status), 'REVIEW_STATE_MISMATCH', 'Review is not ready to begin a runtime cycle', { status: review.status });
      assertReviewTransition(review.status, nextStatus);
      this.#setStatus(review, nextStatus, `runtime-cycle-started:${environmentComparison.comparisonId}`);
      const startedAt = this.now().toISOString();
      const cycleId = this.#createId('cycle', startedAt);
      review.activeCycleId = cycleId;
      const cycle = {
        schemaVersion: 1,
        kind: 'runtime-cycle',
        cycleId,
        reviewId,
        phase: 'REPORT_ONLY',
        status: 'RUNNING',
        scenarioIds: [...scenarioIds],
        source: { generation: 'V4', nid: Number(source.nid), workId: source.workId },
        target: { generation: 'V5', nid: Number(target.nid), workId: target.workId },
        environmentComparisonId: environmentComparison.comparisonId,
        authorizationId: authorization?.authorizationId || null,
        startedAt,
        completedAt: null,
        result: null,
        sensitivity: 'PRIVATE',
      };
      const directory = ensurePrivateDir(this.runtimeCycleDir(reviewId, cycleId));
      for (const child of ['traces', 'normalized', 'comparisons', 'screenshots']) ensurePrivateDir(path.join(directory, child));
      writePrivateJson(path.join(directory, 'cycle.json'), cycle);
      if (authorization) writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('runtime-authorizations', `${authorization.authorizationId}.json`)), { ...authorization, usedByCycleId: cycleId });
      return { review, blocked: false, cycle, environmentComparison, scenarios };
    });
  }

  resumeRuntimeCycle(reviewId, { sourceBaseUrl, targetBaseUrl } = {}) {
    const review = this.load(reviewId);
    invariant(review.activeCycleId, 'RUNTIME_CYCLE_NOT_ACTIVE', 'There is no active runtime cycle to resume');
    const cycle = readJson(path.join(this.runtimeCycleDir(reviewId, review.activeCycleId), 'cycle.json'), null);
    invariant(cycle?.status === 'RUNNING' && cycle.reviewId === reviewId, 'RUNTIME_CYCLE_INVALID', 'Active runtime cycle record is missing or invalid');
    const scenarios = cycle.scenarioIds.map((scenarioId) => validateRuntimeScenario(readJson(this.#artifactPath(reviewId, relativeArtifactPath('scenarios', `${scenarioId}.json`)))));
    invariant(scenarios.every((scenario) => scenario.sideEffect === 'READ_ONLY'), 'RUNTIME_SIDE_EFFECT_RECONCILIATION_REQUIRED', 'A crashed side-effect runtime cycle requires user reconciliation and a new authorization');
    const environmentComparison = validateEnvironmentComparison(readJson(this.#artifactPath(reviewId, relativeArtifactPath('environment', `${cycle.environmentComparisonId}.json`))));
    const comparisonDir = path.join(this.runtimeCycleDir(reviewId, cycle.cycleId), 'comparisons');
    const completedScenarioIds = cycle.scenarioIds.filter((scenarioId) => fs.existsSync(path.join(comparisonDir, `${scenarioId}.json`)));
    return {
      review,
      blocked: false,
      cycle,
      scenarios,
      completedScenarioIds,
      environmentComparison,
      source: { ...cycle.source, baseUrl: nonEmptyString(sourceBaseUrl, 'sourceBaseUrl', 2048) },
      target: { ...cycle.target, baseUrl: nonEmptyString(targetBaseUrl, 'targetBaseUrl', 2048) },
    };
  }

  persistRuntimeScenarioResult(reviewId, cycleId, { sourceTrace, targetTrace, sourceNormalized, targetNormalized, comparison } = {}) {
    validateBehaviorTrace(sourceTrace);
    validateBehaviorTrace(targetTrace);
    validateRuntimeComparison(comparison);
    return this.#withReviewLock(reviewId, () => {
      const review = this.load(reviewId);
      invariant(review.activeCycleId === cycleId, 'RUNTIME_CYCLE_MISMATCH', 'Runtime cycle is not active for this review');
      invariant(sourceTrace.reviewId === reviewId && targetTrace.reviewId === reviewId && comparison.reviewId === reviewId, 'RUNTIME_REVIEW_MISMATCH', 'Runtime artifacts belong to another review');
      invariant(sourceTrace.cycleId === cycleId && targetTrace.cycleId === cycleId && comparison.cycleId === cycleId, 'RUNTIME_CYCLE_MISMATCH', 'Runtime artifacts belong to another cycle');
      invariant(sourceTrace.scenarioId === targetTrace.scenarioId && sourceTrace.scenarioId === comparison.scenarioId, 'RUNTIME_SCENARIO_MISMATCH', 'Runtime artifacts do not describe the same scenario');
      const root = this.runtimeCycleDir(reviewId, cycleId);
      writePrivateJson(path.join(root, 'traces', `${sourceTrace.scenarioId}.v4.json`), sourceTrace);
      writePrivateJson(path.join(root, 'traces', `${targetTrace.scenarioId}.v5.json`), targetTrace);
      writePrivateJson(path.join(root, 'normalized', `${sourceTrace.scenarioId}.v4.json`), sourceNormalized);
      writePrivateJson(path.join(root, 'normalized', `${targetTrace.scenarioId}.v5.json`), targetNormalized);
      writePrivateJson(path.join(root, 'comparisons', `${comparison.scenarioId}.json`), comparison);
      return comparison;
    });
  }

  completeRuntimeCycle(reviewId, cycleId) {
    return this.#mutate(reviewId, (review) => {
      invariant(review.activeCycleId === cycleId, 'RUNTIME_CYCLE_MISMATCH', 'Runtime cycle is not active for this review');
      const root = this.runtimeCycleDir(reviewId, cycleId);
      const cycle = readJson(path.join(root, 'cycle.json'));
      const comparisons = cycle.scenarioIds.map((scenarioId) => validateRuntimeComparison(readJson(path.join(root, 'comparisons', `${scenarioId}.json`))));
      const status = comparisons.some((entry) => entry.status === 'MISMATCH_DETECTED')
        ? 'MISMATCH_DETECTED'
        : comparisons.some((entry) => entry.status === 'INCONCLUSIVE')
          ? 'INCONCLUSIVE'
          : 'PARITY_PASSED';
      cycle.status = 'COMPLETED';
      cycle.completedAt = this.now().toISOString();
      cycle.result = status;
      writePrivateJson(path.join(root, 'cycle.json'), cycle);
      const report = {
        schemaVersion: 1,
        kind: 'runtime-cycle-report',
        reviewId,
        cycleId,
        status,
        scenarioCount: comparisons.length,
        comparisonIds: comparisons.map((entry) => entry.comparisonId),
        completedAt: cycle.completedAt,
        phase: 'REPORT_ONLY',
        targetRepairAttempted: false,
        platformWriteAttempted: false,
        sensitivity: 'REDACTED',
      };
      writePrivateJson(path.join(root, 'report.json'), report);
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('reports', `runtime-${cycleId}.json`)), report);
      review.activeCycleId = null;
      const nextStatus = status === 'MISMATCH_DETECTED' ? 'MISMATCH_DETECTED' : status === 'PARITY_PASSED' ? 'RUNTIME_PARITY_PASSED' : 'RUNTIME_NOT_TESTED';
      assertReviewTransition(review.status, nextStatus);
      this.#setStatus(review, nextStatus, `runtime-cycle-completed:${cycleId}:${status}`);
      return { review, cycle, report, comparisons };
    });
  }

  interruptRuntimeCycle(reviewId, cycleId, error) {
    return this.#mutate(reviewId, (review) => {
      invariant(review.activeCycleId === cycleId, 'RUNTIME_CYCLE_MISMATCH', 'Runtime cycle is not active for this review');
      const root = this.runtimeCycleDir(reviewId, cycleId);
      const cycle = readJson(path.join(root, 'cycle.json'));
      cycle.status = 'INTERRUPTED';
      cycle.completedAt = this.now().toISOString();
      cycle.result = 'INCONCLUSIVE';
      writePrivateJson(path.join(root, 'cycle.json'), cycle);
      writePrivateJson(path.join(root, 'interruption.json'), {
        schemaVersion: 1,
        kind: 'runtime-cycle-interruption',
        reviewId,
        cycleId,
        code: error?.code || 'RUNTIME_DRIVER_FAILED',
        message: redactRuntimeText(error?.message || error || 'Runtime cycle interrupted', { max: 4096 }),
        interruptedAt: cycle.completedAt,
        sensitivity: 'REDACTED',
      });
      review.activeCycleId = null;
      assertReviewTransition(review.status, 'RUNTIME_NOT_TESTED');
      this.#setStatus(review, 'RUNTIME_NOT_TESTED', `runtime-cycle-interrupted:${cycleId}`);
      return { review, cycle };
    });
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
    const activeCycle = review.activeCycleId
      ? readJson(path.join(this.runtimeCycleDir(reviewId, review.activeCycleId), 'cycle.json'), null)
      : null;
    return {
      review,
      humanFindings: this.listHumanFindings(reviewId),
      latestObservation,
      activeCycle,
      resumable: !TERMINAL_REVIEW_STATES.has(review.status),
    };
  }

  recordKnowledgeUsage(reviewId, searchResult) {
    return this.#mutate(reviewId, (review) => {
      invariant(searchResult?.kind === 'knowledge-search-result' && searchResult.pin, 'KNOWLEDGE_USAGE_INVALID', 'Knowledge search result is invalid');
      const pin = review.runtime.knowledge;
      invariant(pin.version === searchResult.pin.version && pin.sha256 === searchResult.pin.sha256 && pin.contentSha256 === searchResult.pin.contentSha256, 'KNOWLEDGE_PIN_MISMATCH', 'Knowledge search result does not match the review pin');
      const ruleIds = [...new Set(searchResult.cards.map((card) => card.ruleId))].sort();
      review.runtime.knowledge.ruleIds = [...new Set([...review.runtime.knowledge.ruleIds, ...ruleIds])].sort();
      review.updatedAt = this.now().toISOString();
      const usage = {
        schemaVersion: 1,
        kind: 'knowledge-usage',
        reviewId,
        runtime: { version: pin.version, contentSha256: pin.contentSha256, schemaVersion: pin.schemaVersion },
        queryDigest: searchResult.queryDigest,
        ruleIds,
        recordedAt: review.updatedAt,
        sensitivity: 'REDACTED',
      };
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('knowledge', `usage-${searchResult.queryDigest}.json`)), usage);
      return { review, usage };
    });
  }

  writeKnowledgeFeedback(reviewId, report) {
    return this.#withReviewLock(reviewId, () => {
      const review = this.load(reviewId);
      invariant(report?.kind === 'knowledge-feedback-report' && report.runtime?.version === review.runtime.knowledge.version && report.runtime?.contentSha256 === review.runtime.knowledge.contentSha256, 'KNOWLEDGE_PIN_MISMATCH', 'Knowledge feedback does not match the review pin');
      invariant(review.runtime.knowledge.ruleIds.includes(report.rule?.ruleId), 'KNOWLEDGE_RULE_NOT_USED', 'Knowledge feedback may reference only a rule used by this review');
      normalizeId(report.feedbackId, ARTIFACT_ID_PATTERN, 'KNOWLEDGE_FEEDBACK_INVALID', 'Knowledge feedback id is invalid');
      const target = this.#artifactPath(reviewId, relativeArtifactPath('knowledge', `${report.feedbackId}.json`));
      invariant(!fs.existsSync(target), 'KNOWLEDGE_FEEDBACK_EXISTS', 'Knowledge feedback report already exists');
      writePrivateJson(target, report);
      return report;
    });
  }

  #createId(prefix, at) {
    return `${prefix}_${timestampPart(new Date(at))}_${this.randomBytes(5).toString('hex')}`;
  }

  #validateRuntimeAuthorization(review, scenarios, authorization) {
    invariant(authorization && typeof authorization === 'object' && !Array.isArray(authorization), 'RUNTIME_AUTHORIZATION_REQUIRED', 'A side-effect runtime authorization is required');
    const allowedKeys = new Set(['schemaVersion', 'kind', 'authorizationId', 'reviewId', 'scenarioIds', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity']);
    for (const key of Object.keys(authorization)) invariant(allowedKeys.has(key), 'RUNTIME_AUTHORIZATION_INVALID', `Runtime authorization field is not allowed: ${key}`);
    invariant(authorization.schemaVersion === 1 && authorization.kind === 'runtime-execution-authorization', 'RUNTIME_AUTHORIZATION_INVALID', 'Runtime authorization kind/schema is invalid');
    normalizeId(authorization.authorizationId, ARTIFACT_ID_PATTERN, 'RUNTIME_AUTHORIZATION_INVALID', 'Runtime authorization id is invalid');
    invariant(authorization.reviewId === review.reviewId, 'RUNTIME_AUTHORIZATION_INVALID', 'Runtime authorization belongs to another review');
    invariant(authorization.createdBy === 'USER' && authorization.sensitivity === 'PRIVATE', 'RUNTIME_AUTHORIZATION_INVALID', 'Runtime authorization must be private USER evidence');
    invariant(!Number.isNaN(Date.parse(authorization.createdAt)) && !Number.isNaN(Date.parse(authorization.expiresAt)) && Date.parse(authorization.expiresAt) > this.now().getTime(), 'RUNTIME_AUTHORIZATION_EXPIRED', 'Runtime authorization has expired or has an invalid date');
    const expectedIds = scenarios.map((scenario) => scenario.scenarioId).sort();
    invariant(Array.isArray(authorization.scenarioIds) && JSON.stringify([...authorization.scenarioIds].sort()) === JSON.stringify(expectedIds), 'RUNTIME_AUTHORIZATION_INVALID', 'Runtime authorization must name exactly the scenarios in this cycle');
    const hasExternal = scenarios.some((scenario) => scenario.sideEffect === 'EXTERNAL_SIDE_EFFECT');
    const expectedConfirmation = hasExternal ? 'RUN_EXTERNAL_SIDE_EFFECT_SCENARIO' : 'RUN_REVERSIBLE_SCENARIO';
    invariant(authorization.confirmation === expectedConfirmation, 'RUNTIME_AUTHORIZATION_INVALID', `Runtime authorization confirmation must be ${expectedConfirmation}`);
    const target = this.#artifactPath(review.reviewId, relativeArtifactPath('runtime-authorizations', `${authorization.authorizationId}.json`));
    invariant(!fs.existsSync(target), 'RUNTIME_AUTHORIZATION_ALREADY_USED', 'Runtime authorization is single-use and has already been consumed');
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

  #writeImmutableJson(target, value, code) {
    const existing = readJson(target, null);
    if (existing !== null) {
      invariant(revisionValueDigest(existing) === revisionValueDigest(value), code, 'Immutable review artifact id already exists with different content');
      return target;
    }
    writePrivateJson(target, value);
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
