import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateBehaviorTrace,
  validateAutomaticRepairDecision,
  validateDiagnosisReport,
  validateDiagnosticSaveEligibility,
  validateEnvironmentComparison,
  validateHumanFinding,
  validateIssueClassificationV2,
  validateIssueCluster,
  validateRepairAttempt,
  validateRepairBatch,
  validateRepairBudget,
  validateRepairProposal,
  validateRuntimeComparison,
  validateRuntimeReviewSession,
  validateRuntimeScenario,
  validateSaveableCheckpoint,
  validateTargetRepairAuthorization,
} from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, sha256File, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { createRuntimeIssueCandidates, evaluateDiagnosis } from '../diagnosis/diagnosis-engine.js';
import { createRedactedRevisionDiff, revisionValueDigest } from './revision-diff.js';
import { redactRuntimeText } from '../runtime/trace-redaction.js';
import { validateConvertedCase } from '../validation/basic-validator.js';
import { applyRepairPatch } from '../workflow/patch-policy.js';
import { assertRepairableCluster, evaluateRepairCandidate, repairPatchDigest } from '../repair/repair-engine.js';
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
      for (const child of ['baselines', 'findings', 'revision-observations', 'observed-targets', 'baseline-acceptances', 'knowledge', 'environment', 'scenarios', 'cycles', 'runtime-authorizations', 'repair-authorizations', 'reports', 'issues', 'issues/diagnoses', 'issues/clusters', 'issues/budgets', 'issues/decisions', 'issues/eligibility', 'repairs', 'repairs/proposals', 'repairs/attempts', 'repairs/batches', 'repairs/candidates', 'checkpoints', 'checkpoints/artifacts']) {
        ensurePrivateDir(path.join(directory, child));
      }
      const baselinePath = this.#writeBaselineSnapshot(reviewId, targetWorkId, targetSnapshot);
      const sourceCase = readJson(path.join(this.jobs.jobDir(jobId), 'v4', 'app.json'), null);
      const converterOutput = job.target?.artifact
        ? readJson(path.join(this.jobs.jobDir(jobId), job.target.artifact), null)
        : null;
      const sessionBudget = validateRepairBudget({
        schemaVersion: 2,
        kind: 'repair-budget',
        budgetId: `budget-session-${revisionValueDigest(reviewId).slice(0, 20)}`,
        reviewId,
        scope: 'REVIEW_SESSION',
        clusterId: null,
        attempts: null,
        targetRevisions: { baseLimit: 10, used: 0, extensionLimit: 5, extensionUsed: 0 },
        status: 'ACTIVE',
        updatedAt: at,
        createdAt: at,
        createdBy: 'CLI',
        sensitivity: 'REDACTED',
      });
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'budgets', `${sessionBudget.budgetId}.json`)), sessionBudget);
      review.repairBudgetIds.push(sessionBudget.budgetId);
      const baselineValidation = sourceCase
        ? validateConvertedCase({ v4CaseJson: sourceCase, v5CaseJson: targetSnapshot })
        : { passed: true, summary: { issueCount: 0, blockerCount: 0 } };
      this.#writeCheckpoint(reviewId, {
        checkpointType: 'CONFIRMED_TARGET_REVISION',
        artifact: path.relative(this.reviewDir(reviewId), baselinePath).split(path.sep).join('/'),
        sha256: revisionValueDigest(targetSnapshot),
        targetNid,
        targetWorkId,
        staticValidation: baselineValidation.summary,
        createdAt: at,
      });
      if (converterOutput && sourceCase) {
        const converterArtifact = this.#artifactPath(reviewId, relativeArtifactPath('checkpoints', 'artifacts', 'converter-output.json'));
        writePrivateJson(converterArtifact, converterOutput);
        const converterValidation = validateConvertedCase({ v4CaseJson: sourceCase, v5CaseJson: converterOutput });
        this.#writeCheckpoint(reviewId, {
          checkpointType: 'CONVERTER_OUTPUT',
          artifact: path.relative(this.reviewDir(reviewId), converterArtifact).split(path.sep).join('/'),
          sha256: revisionValueDigest(converterOutput),
          targetNid: null,
          targetWorkId: null,
          staticValidation: converterValidation.summary,
          createdAt: at,
        });
      }
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
      if (['AUTO_REPAIR_STOPPED', 'RUNTIME_REPAIR_EXHAUSTED'].includes(review.status)) {
        assertReviewTransition(review.status, 'AWAITING_HUMAN_EVIDENCE');
        this.#setStatus(review, 'AWAITING_HUMAN_EVIDENCE', `human-finding-received:${findingId}`);
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `human-finding-continues-diagnosis:${findingId}`);
      } else if (review.status === 'AWAITING_HUMAN_EVIDENCE') {
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

  diagnosisCandidates(reviewId) {
    this.load(reviewId);
    const cyclesDir = this.#artifactPath(reviewId, 'cycles');
    if (!fs.existsSync(cyclesDir)) return [];
    const entries = [];
    for (const cycleId of fs.readdirSync(cyclesDir).sort()) {
      const cycleDir = path.join(cyclesDir, cycleId);
      const cycleStat = fs.lstatSync(cycleDir, { throwIfNoEntry: false });
      invariant(cycleStat?.isDirectory() && !cycleStat.isSymbolicLink(), 'DIAGNOSIS_EVIDENCE_INVALID', 'Runtime cycle evidence directory is unsafe');
      const comparisonsDir = path.join(cyclesDir, cycleId, 'comparisons');
      if (!fs.existsSync(comparisonsDir)) continue;
      const comparisonsStat = fs.lstatSync(comparisonsDir);
      invariant(comparisonsStat.isDirectory() && !comparisonsStat.isSymbolicLink(), 'DIAGNOSIS_EVIDENCE_INVALID', 'Runtime comparison evidence directory is unsafe');
      for (const file of fs.readdirSync(comparisonsDir).filter((name) => name.endsWith('.json')).sort()) {
        const fileStat = fs.lstatSync(path.join(comparisonsDir, file));
        invariant(fileStat.isFile() && !fileStat.isSymbolicLink(), 'DIAGNOSIS_EVIDENCE_INVALID', 'Runtime comparison evidence file is unsafe');
        const comparison = validateRuntimeComparison(readJson(path.join(comparisonsDir, file)));
        entries.push({ comparison, artifact: relativeArtifactPath('cycles', cycleId, 'comparisons', file) });
      }
    }
    return createRuntimeIssueCandidates(entries);
  }

  submitDiagnosis(reviewId, { classification, eligibilityContext } = {}) {
    return this.#mutate(reviewId, (review) => {
      invariant(['MISMATCH_DETECTED', 'DIAGNOSING', 'AWAITING_HUMAN_EVIDENCE', 'BLOCKED_PLATFORM_RUNTIME'].includes(review.status), 'REVIEW_STATE_MISMATCH', 'Review is not ready for Diagnosis v2', { status: review.status });
      validateIssueClassificationV2(classification);
      invariant(classification.createdBy === 'AGENT' && classification.sensitivity === 'REDACTED', 'DIAGNOSIS_PROVENANCE_INVALID', 'Root Cause Classification must be a redacted AGENT artifact');
      for (const issue of classification.issues) {
        for (const evidenceRef of issue.evidenceRefs) this.#assertDiagnosisEvidenceRef(reviewId, evidenceRef);
        invariant(issue.knowledgeRuleIds.every((ruleId) => review.runtime.knowledge.ruleIds.includes(ruleId)), 'DIAGNOSIS_KNOWLEDGE_RULE_NOT_USED', 'Classification may cite only Knowledge rules retrieved by this review', { issueId: issue.issueId });
      }
      const candidates = this.diagnosisCandidates(reviewId);
      invariant(candidates.length > 0, 'DIAGNOSIS_CANDIDATES_REQUIRED', 'Diagnosis requires at least one failed or inconclusive runtime assertion');
      if (eligibilityContext?.checkpoint) this.#assertDiagnosticCheckpoint(review, eligibilityContext.checkpoint);
      const existingBudgets = new Map();
      for (const budgetId of review.repairBudgetIds) {
        const budget = validateRepairBudget(readJson(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'budgets', `${budgetId}.json`))));
        if (budget.scope === 'ISSUE_CLUSTER') existingBudgets.set(budget.clusterId, budget);
      }
      const job = this.jobs.load(review.jobId);
      const diagnosis = evaluateDiagnosis({
        review,
        job,
        classification,
        candidates,
        eligibilityContext,
        existingBudgets,
        now: this.now,
        randomBytes: this.randomBytes,
      });
      const diagnosisDir = ensurePrivateDir(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'diagnoses', diagnosis.diagnosisId)));
      writePrivateJson(path.join(diagnosisDir, 'classification.json'), diagnosis.classification);
      const summary = {
        schemaVersion: 1,
        kind: 'diagnosis-summary',
        diagnosisId: diagnosis.diagnosisId,
        reviewId,
        classificationSha256: diagnosis.classificationSha256,
        clusterIds: diagnosis.results.map((entry) => entry.cluster.clusterId),
        reportIds: diagnosis.results.map((entry) => entry.report.reportId),
        createdAt: diagnosis.createdAt,
        sensitivity: 'REDACTED',
      };
      for (const result of diagnosis.results) {
        validateIssueCluster(result.cluster);
        validateRepairBudget(result.budget);
        validateAutomaticRepairDecision(result.decision);
        validateDiagnosticSaveEligibility(result.eligibility);
        validateDiagnosisReport(result.report);
        writePrivateJson(path.join(diagnosisDir, `${result.cluster.clusterId}.json`), {
          cluster: result.cluster,
          budget: result.budget,
          decision: result.decision,
          eligibility: result.eligibility,
          report: result.report,
        });
        writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'clusters', `${result.cluster.clusterId}.${diagnosis.diagnosisId}.json`)), result.cluster);
        const budgetPath = this.#artifactPath(reviewId, relativeArtifactPath('issues', 'budgets', `${result.budget.budgetId}.json`));
        if (!fs.existsSync(budgetPath)) writePrivateJson(budgetPath, result.budget);
        writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'decisions', `${result.decision.decisionId}.json`)), result.decision);
        writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('issues', 'eligibility', `${result.eligibility.eligibilityId}.json`)), result.eligibility);
        const reportBase = `${result.report.reportType.toLowerCase()}-${result.report.reportId}`;
        writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('reports', `${reportBase}.json`)), result.report);
        writePrivateFile(this.#artifactPath(reviewId, relativeArtifactPath('reports', `${reportBase}.md`)), result.markdown);
        if (!review.issueClusterIds.includes(result.cluster.clusterId)) review.issueClusterIds.push(result.cluster.clusterId);
        if (!review.repairBudgetIds.includes(result.budget.budgetId)) review.repairBudgetIds.push(result.budget.budgetId);
      }
      writePrivateJson(path.join(diagnosisDir, 'summary.json'), summary);
      review.issueClusterIds.sort();
      review.repairBudgetIds.sort();
      if (review.status === 'MISMATCH_DETECTED' || review.status === 'AWAITING_HUMAN_EVIDENCE' || review.status === 'BLOCKED_PLATFORM_RUNTIME') {
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `diagnosis-submitted:${diagnosis.diagnosisId}`);
      } else {
        review.updatedAt = diagnosis.createdAt;
        review.history.push({ status: review.status, at: diagnosis.createdAt, reason: `diagnosis-submitted:${diagnosis.diagnosisId}` });
      }
      return { review, summary, results: diagnosis.results.map(({ markdown, ...entry }) => entry) };
    });
  }

  listDiagnoses(reviewId) {
    this.load(reviewId);
    const root = this.#artifactPath(reviewId, relativeArtifactPath('issues', 'diagnoses'));
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).sort().map((diagnosisId) => readJson(path.join(root, diagnosisId, 'summary.json')));
  }

  currentDiagnosticCheckpoint(reviewId) {
    const review = this.load(reviewId);
    const target = this.#baselineSnapshotPath(reviewId, review.baseline.targetWorkId);
    return {
      kind: 'CONFIRMED_TARGET_REVISION',
      artifact: path.relative(this.reviewDir(reviewId), target).split(path.sep).join('/'),
      sha256: sha256File(target),
      targetNid: review.target.nid,
      targetWorkId: review.baseline.targetWorkId,
    };
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
      let repairBatch = null;
      if (review.status === 'TARGET_UPDATED') {
        repairBatch = this.#latestRepairBatchByState(reviewId, ['READBACK_VERIFIED']);
        invariant(repairBatch, 'REPAIR_RUNTIME_RETEST_REQUIRED', 'Updated target revision has no verified Repair Batch');
        invariant(repairBatch.affectedScenarioIds.every((scenarioId) => scenarioIds.includes(scenarioId)), 'REPAIR_AFFECTED_SCENARIOS_INCOMPLETE', 'Runtime retest must include every scenario affected by the Repair Batch', {
          requiredScenarioIds: repairBatch.affectedScenarioIds,
        });
      }
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
      if (repairBatch) {
        repairBatch.state = 'RUNTIME_TESTING';
        repairBatch.updatedAt = startedAt;
        writePrivateJson(this.#batchPath(reviewId, repairBatch.batchId), repairBatch);
      }
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
      if (review.status === 'RUNTIME_RETESTING') {
        const repairBatch = this.#latestRepairBatchByState(reviewId, ['RUNTIME_TESTING']);
        invariant(repairBatch && repairBatch.affectedScenarioIds.every((scenarioId) => cycle.scenarioIds.includes(scenarioId)), 'REPAIR_RUNTIME_RETEST_MISMATCH', 'Runtime cycle does not close the pending Repair Batch affected scenarios');
        repairBatch.state = status === 'PARITY_PASSED' ? 'RUNTIME_VERIFIED' : 'RUNTIME_FAILED';
        repairBatch.updatedAt = cycle.completedAt;
        writePrivateJson(this.#batchPath(reviewId, repairBatch.batchId), repairBatch);
      }
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
      if (review.status === 'RUNTIME_RETESTING') {
        const repairBatch = this.#latestRepairBatchByState(reviewId, ['RUNTIME_TESTING']);
        if (repairBatch) {
          repairBatch.state = 'READBACK_VERIFIED';
          repairBatch.updatedAt = cycle.completedAt;
          writePrivateJson(this.#batchPath(reviewId, repairBatch.batchId), repairBatch);
        }
      }
      review.activeCycleId = null;
      const interruptedStatus = review.status === 'RUNTIME_RETESTING' ? 'TARGET_UPDATED' : 'RUNTIME_NOT_TESTED';
      assertReviewTransition(review.status, interruptedStatus);
      this.#setStatus(review, interruptedStatus, `runtime-cycle-interrupted:${cycleId}`);
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
      diagnoses: this.listDiagnoses(reviewId),
      repairAuthorizations: this.listRepairAuthorizations(reviewId),
      repairAttempts: this.listRepairAttempts(reviewId),
      repairBatches: this.listRepairBatches(reviewId),
      saveableCheckpoints: this.listSaveableCheckpoints(reviewId),
      resumable: !TERMINAL_REVIEW_STATES.has(review.status),
    };
  }

  withRepairLease(reviewId, callback) {
    const lockPath = path.join(this.paths.locks, `${reviewId}.repair.lock`);
    return withFileLock(
      lockPath,
      { pid: process.pid, reviewId, operation: 'target-repair', at: this.now().toISOString() },
      { code: 'TARGET_REPAIR_LOCKED', message: `A target repair operation is already executing for this review: ${reviewId}` },
      callback,
    );
  }

  authorizeTargetRepair(reviewId, authorization) {
    validateTargetRepairAuthorization(authorization);
    return this.#mutate(reviewId, (review) => {
      invariant(review.capability === 'WRITE', 'REVIEW_WRITE_CAPABILITY_REQUIRED', 'Target repair requires a WRITE-capable Runtime Review Session');
      invariant(authorization.reviewId === reviewId, 'REPAIR_AUTHORIZATION_MISMATCH', 'Target repair authorization belongs to another review');
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'REPAIR_AUTHORIZATION_EXPIRED', 'Target repair authorization has expired');
      invariant(Date.parse(authorization.createdAt) <= this.now().getTime() + 5 * 60 * 1000, 'REPAIR_AUTHORIZATION_INVALID', 'Target repair authorization creation time is in the future');
      for (const clusterId of authorization.clusterIds) {
        invariant(review.issueClusterIds.includes(clusterId), 'REPAIR_CLUSTER_NOT_LINKED', `Issue Cluster is not linked to this review: ${clusterId}`);
        const budget = this.#clusterBudget(reviewId, review, clusterId);
        invariant(budget.status !== 'FROZEN', 'REPAIR_BUDGET_FROZEN', `Repair budget is frozen for Issue Cluster ${clusterId}`);
        if (authorization.scope === 'EXTENSION') {
          invariant(budget.attempts.automaticUsed >= budget.attempts.automaticLimit, 'REPAIR_EXTENSION_NOT_AVAILABLE', `Initial repair attempts are not exhausted for Issue Cluster ${clusterId}`);
          invariant(budget.attempts.extensionUsed < budget.attempts.extensionLimit, 'REPAIR_BUDGET_EXHAUSTED', `Repair extension is exhausted for Issue Cluster ${clusterId}`);
          budget.status = 'ACTIVE';
          budget.updatedAt = this.now().toISOString();
          writePrivateJson(this.#budgetPath(reviewId, budget.budgetId), budget);
        }
      }
      const target = this.#artifactPath(reviewId, relativeArtifactPath('repair-authorizations', `${authorization.authorizationId}.json`));
      invariant(!fs.existsSync(target), 'REPAIR_AUTHORIZATION_EXISTS', `Target repair authorization already exists: ${authorization.authorizationId}`);
      writePrivateJson(target, authorization);
      if (authorization.scope === 'EXTENSION') {
        const sessionBudget = this.#sessionBudget(reviewId, review);
        if (sessionBudget.targetRevisions.used >= sessionBudget.targetRevisions.baseLimit) {
          for (const batch of this.listRepairBatches(reviewId).filter((entry) => entry.state === 'LOCAL_VALIDATED')) {
            if (batch.clusterIds.every((clusterId) => authorization.clusterIds.includes(clusterId))) {
              batch.authorizationId = authorization.authorizationId;
              batch.updatedAt = this.now().toISOString();
              writePrivateJson(this.#batchPath(reviewId, batch.batchId), batch);
            }
          }
        }
      }
      if (authorization.scope === 'EXTENSION' && ['AUTO_REPAIR_STOPPED', 'RUNTIME_REPAIR_EXHAUSTED'].includes(review.status)) {
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `repair-extension-authorized:${authorization.authorizationId}`);
      } else {
        review.updatedAt = this.now().toISOString();
        review.history.push({ status: review.status, at: review.updatedAt, reason: `target-repair-authorized:${authorization.authorizationId}` });
      }
      return { review, authorization };
    });
  }

  listRepairAuthorizations(reviewId) {
    this.load(reviewId);
    return this.#listArtifacts(reviewId, 'repair-authorizations').map(validateTargetRepairAuthorization);
  }

  listRepairAttempts(reviewId) {
    this.load(reviewId);
    return this.#listArtifacts(reviewId, relativeArtifactPath('repairs', 'attempts')).map(validateRepairAttempt);
  }

  listRepairBatches(reviewId) {
    this.load(reviewId);
    return this.#listArtifacts(reviewId, relativeArtifactPath('repairs', 'batches')).map(validateRepairBatch);
  }

  loadRepairBatch(reviewId, batchId) {
    this.load(reviewId);
    return this.#repairBatch(reviewId, batchId);
  }

  readRepairCandidate(reviewId, batchId) {
    const batch = this.loadRepairBatch(reviewId, batchId);
    const candidate = readJson(this.#artifactPath(reviewId, batch.candidate.artifact));
    invariant(revisionValueDigest(candidate) === batch.candidate.sha256, 'TARGET_REPAIR_CANDIDATE_CORRUPT', 'Repair candidate does not match its checkpoint digest');
    return candidate;
  }

  listSaveableCheckpoints(reviewId) {
    this.load(reviewId);
    return this.#listArtifacts(reviewId, 'checkpoints').map(validateSaveableCheckpoint);
  }

  submitRepairProposal(reviewId, proposal) {
    validateRepairProposal(proposal);
    return this.#mutate(reviewId, (review) => {
      invariant(review.capability === 'WRITE', 'REVIEW_WRITE_CAPABILITY_REQUIRED', 'Target repair requires a WRITE-capable Runtime Review Session');
      invariant(review.status === 'DIAGNOSING', 'REVIEW_STATE_MISMATCH', 'Runtime Review Session must be DIAGNOSING before a target repair proposal');
      invariant(proposal.reviewId === reviewId, 'REPAIR_PROPOSAL_MISMATCH', 'Repair Proposal belongs to another review');
      const authorization = this.#repairAuthorization(reviewId, proposal.authorizationId);
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'REPAIR_AUTHORIZATION_EXPIRED', 'Target repair authorization has expired');
      invariant(proposal.clusterIds.every((clusterId) => authorization.clusterIds.includes(clusterId)), 'REPAIR_AUTHORIZATION_SCOPE_MISMATCH', 'Repair Proposal contains a cluster outside the authorization scope');
      invariant(proposal.baseTarget.nid === review.target.nid && proposal.baseTarget.workId === review.baseline.targetWorkId, 'TARGET_REPAIR_BASELINE_MISMATCH', 'Repair Proposal does not target the current confirmed revision');
      const baselinePath = this.#baselineSnapshotPath(reviewId, review.baseline.targetWorkId);
      const base = readJson(baselinePath);
      const baseSha256 = revisionValueDigest(base);
      invariant(proposal.baseTarget.sha256 === baseSha256, 'TARGET_REPAIR_BASELINE_MISMATCH', 'Repair Proposal baseline content hash does not match the confirmed target');
      this.#assertEquivalentRepairEnvironment(reviewId, review);
      const sourceCase = readJson(path.join(this.jobs.jobDir(review.jobId), 'v4', 'app.json'), null);
      invariant(sourceCase, 'REPAIR_SOURCE_SNAPSHOT_MISSING', 'Runtime Review cannot statically validate repairs without its immutable V4 source snapshot');
      const clusters = proposal.clusterIds.map((clusterId) => this.#latestCluster(reviewId, clusterId));
      const attempts = this.listRepairAttempts(reviewId);
      for (const cluster of clusters) {
        assertRepairableCluster(cluster, proposal);
        const usedByAuthorization = attempts.filter((attempt) => attempt.authorizationId === authorization.authorizationId && attempt.clusterIds.includes(cluster.clusterId)).length;
        invariant(usedByAuthorization < authorization.maxAttemptsPerCluster, 'REPAIR_AUTHORIZATION_ALLOWANCE_EXHAUSTED', `Authorization attempt allowance is exhausted for Issue Cluster ${cluster.clusterId}`);
        const budget = this.#clusterBudget(reviewId, review, cluster.clusterId);
        if (authorization.scope === 'INITIAL') {
          invariant(budget.attempts.automaticUsed < budget.attempts.automaticLimit, 'REPAIR_INITIAL_BUDGET_EXHAUSTED', `Initial repair budget is exhausted for Issue Cluster ${cluster.clusterId}`);
        } else {
          invariant(budget.attempts.automaticUsed >= budget.attempts.automaticLimit && budget.attempts.extensionUsed < budget.attempts.extensionLimit, 'REPAIR_EXTENSION_BUDGET_UNAVAILABLE', `Repair extension budget is unavailable for Issue Cluster ${cluster.clusterId}`);
        }
      }
      for (const evidenceRef of proposal.evidenceRefs) this.#assertDiagnosisEvidenceRef(reviewId, evidenceRef);
      invariant(proposal.knowledgeRuleIds.every((ruleId) => review.runtime.knowledge.ruleIds.includes(ruleId)), 'REPAIR_KNOWLEDGE_RULE_NOT_USED', 'Repair Proposal may cite only Knowledge rules retrieved by this review');
      const requiredScenarioIds = [...new Set(clusters.flatMap((cluster) => this.#clusterScenarioIds(reviewId, cluster)))].sort();
      invariant(requiredScenarioIds.every((scenarioId) => proposal.affectedScenarioIds.includes(scenarioId)), 'REPAIR_AFFECTED_SCENARIOS_INCOMPLETE', 'Repair Proposal must include every originating failed runtime scenario', { requiredScenarioIds });
      invariant(proposal.affectedScenarioIds.every((scenarioId) => review.scenarioIds.includes(scenarioId)), 'REPAIR_SCENARIO_NOT_LINKED', 'Repair Proposal references a scenario not linked to this review');

      const proposalPath = this.#artifactPath(reviewId, relativeArtifactPath('repairs', 'proposals', `${proposal.proposalId}.json`));
      invariant(!fs.existsSync(proposalPath), 'REPAIR_PROPOSAL_EXISTS', `Repair Proposal already exists: ${proposal.proposalId}`);
      const candidate = applyRepairPatch(base, proposal.patch);
      const baseValidation = validateConvertedCase({ v4CaseJson: sourceCase, v5CaseJson: base });
      const candidateValidation = validateConvertedCase({ v4CaseJson: sourceCase, v5CaseJson: candidate });
      const checkpoints = this.listSaveableCheckpoints(reviewId);
      const evaluation = evaluateRepairCandidate({
        proposal,
        base,
        baseValidation,
        candidateValidation,
        priorAttempts: attempts.filter((attempt) => attempt.clusterIds.some((clusterId) => proposal.clusterIds.includes(clusterId))),
        historicalCheckpointSha256s: checkpoints.filter((checkpoint) => checkpoint.checkpointType !== 'CONVERTER_OUTPUT').map((checkpoint) => checkpoint.sha256),
      });
      writePrivateJson(proposalPath, proposal);
      assertReviewTransition(review.status, 'REPAIR_PROPOSED');
      this.#setStatus(review, 'REPAIR_PROPOSED', `repair-proposed:${proposal.proposalId}`);
      assertReviewTransition(review.status, 'LOCAL_VALIDATING');
      this.#setStatus(review, 'LOCAL_VALIDATING', `repair-local-validation:${proposal.proposalId}`);
      const createdAt = this.now().toISOString();
      const attemptId = `attempt-${revisionValueDigest({ proposalId: proposal.proposalId, createdAt }).slice(0, 20)}`;
      const batchId = `batch-${revisionValueDigest({ attemptId, clusterIds: proposal.clusterIds }).slice(0, 20)}`;
      const baseCheckpoint = this.#confirmedCheckpoint(reviewId, review.baseline.targetWorkId);
      let checkpoint = null;
      if (evaluation.validationPassed) {
        const candidateArtifact = relativeArtifactPath('repairs', 'candidates', `${attemptId}.json`);
        writePrivateJson(this.#artifactPath(reviewId, candidateArtifact), candidate);
        checkpoint = this.#writeCheckpoint(reviewId, {
          checkpointType: 'STATICALLY_SAFE_CANDIDATE',
          artifact: candidateArtifact,
          sha256: evaluation.candidateSha256,
          targetNid: null,
          targetWorkId: null,
          sourceAttemptId: attemptId,
          sourceBatchId: batchId,
          staticValidation: candidateValidation.summary,
          createdAt,
        });
      }
      const outcome = evaluation.stopReason
        ? 'AUTO_REPAIR_STOPPED'
        : evaluation.validationPassed
          ? 'LOCAL_VALIDATION_PASSED'
          : 'LOCAL_VALIDATION_FAILED';
      const attempt = validateRepairAttempt({
        schemaVersion: 2,
        kind: 'repair-attempt',
        attemptId,
        reviewId,
        proposalId: proposal.proposalId,
        authorizationId: authorization.authorizationId,
        clusterIds: [...proposal.clusterIds].sort(),
        patchSha256: repairPatchDigest(proposal.patch),
        baseCheckpointId: baseCheckpoint.checkpointId,
        candidateCheckpointId: checkpoint?.checkpointId || null,
        outcome,
        stopReason: evaluation.stopReason,
        validation: {
          passed: candidateValidation.passed,
          issueCount: candidateValidation.summary.issueCount,
          blockerCount: candidateValidation.summary.blockerCount,
          newHighSeverityIssueIds: evaluation.newHighSeverityIssueIds,
        },
        scope: evaluation.metrics,
        createdAt,
        createdBy: 'CLI',
        sensitivity: 'REDACTED',
      });
      writePrivateJson(this.#artifactPath(reviewId, relativeArtifactPath('repairs', 'attempts', `${attemptId}.json`)), attempt);
      for (const cluster of clusters) {
        const budget = this.#clusterBudget(reviewId, review, cluster.clusterId);
        if (authorization.scope === 'INITIAL') budget.attempts.automaticUsed += 1;
        else budget.attempts.extensionUsed += 1;
        if (evaluation.stopReason) budget.status = 'FROZEN';
        else if (budget.attempts.extensionUsed >= budget.attempts.extensionLimit) budget.status = 'EXHAUSTED';
        else if (budget.attempts.automaticUsed >= budget.attempts.automaticLimit && authorization.scope === 'INITIAL') budget.status = 'PAUSED';
        else budget.status = 'ACTIVE';
        budget.updatedAt = createdAt;
        writePrivateJson(this.#budgetPath(reviewId, budget.budgetId), budget);
      }
      let batch = null;
      if (checkpoint) {
        batch = validateRepairBatch({
          schemaVersion: 2,
          kind: 'repair-batch',
          batchId,
          reviewId,
          attemptIds: [attemptId],
          clusterIds: [...proposal.clusterIds].sort(),
          state: 'LOCAL_VALIDATED',
          authorizationId: authorization.authorizationId,
          expectedTarget: { nid: review.target.nid, workId: review.baseline.targetWorkId, sha256: baseSha256 },
          candidate: { checkpointId: checkpoint.checkpointId, artifact: checkpoint.artifact, sha256: checkpoint.sha256 },
          affectedScenarioIds: [...proposal.affectedScenarioIds].sort(),
          write: { requestedAt: null, outcome: 'NOT_ATTEMPTED', observedWorkId: null, observedSha256: null, errorCode: null },
          createdAt,
          updatedAt: createdAt,
          createdBy: 'CLI',
          sensitivity: 'PRIVATE',
        });
        writePrivateJson(this.#batchPath(reviewId, batchId), batch);
        assertReviewTransition(review.status, 'READY_TO_UPDATE_TARGET');
        this.#setStatus(review, 'READY_TO_UPDATE_TARGET', `repair-batch-local-validation-passed:${batchId}`);
      } else if (evaluation.stopReason || clusters.every((cluster) => this.#clusterBudget(reviewId, review, cluster.clusterId).status !== 'ACTIVE')) {
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `repair-attempt-not-safe:${attemptId}`);
        assertReviewTransition(review.status, 'AUTO_REPAIR_STOPPED');
        this.#setStatus(review, 'AUTO_REPAIR_STOPPED', `automatic-repair-stopped:${evaluation.stopReason || 'BUDGET_PAUSED'}`);
      } else {
        assertReviewTransition(review.status, 'DIAGNOSING');
        this.#setStatus(review, 'DIAGNOSING', `repair-local-validation-failed:${attemptId}`);
      }
      return { review, proposal, attempt, checkpoint, batch, validation: candidateValidation };
    });
  }

  prepareTargetRepairWrite(reviewId, batchId) {
    return this.#mutate(reviewId, (review) => {
      invariant(review.status === 'READY_TO_UPDATE_TARGET', 'REVIEW_STATE_MISMATCH', 'Review is not ready for a target update');
      const batch = this.#repairBatch(reviewId, batchId);
      invariant(batch.state === 'LOCAL_VALIDATED', 'TARGET_REPAIR_REPLAY_FORBIDDEN', 'Only a locally validated, never-written Repair Batch may start a target write');
      invariant(batch.expectedTarget.nid === review.target.nid && batch.expectedTarget.workId === review.baseline.targetWorkId, 'TARGET_REPAIR_BASELINE_MISMATCH', 'Repair Batch does not match the current target revision');
      const baseline = readJson(this.#baselineSnapshotPath(reviewId, review.baseline.targetWorkId));
      invariant(revisionValueDigest(baseline) === batch.expectedTarget.sha256, 'TARGET_REPAIR_BASELINE_MISMATCH', 'Confirmed baseline content no longer matches the Repair Batch');
      this.#assertEquivalentRepairEnvironment(reviewId, review);
      const authorization = this.#repairAuthorization(reviewId, batch.authorizationId);
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'REPAIR_AUTHORIZATION_EXPIRED', 'Target repair authorization expired before the write');
      const sessionBudget = this.#sessionBudget(reviewId, review);
      const usingExtension = sessionBudget.targetRevisions.used >= sessionBudget.targetRevisions.baseLimit;
      if (usingExtension) {
        invariant(authorization.scope === 'EXTENSION', 'TARGET_REVISION_EXTENSION_AUTHORIZATION_REQUIRED', 'The initial 10 target revisions are exhausted; an extension authorization is required');
        invariant(sessionBudget.targetRevisions.extensionUsed < sessionBudget.targetRevisions.extensionLimit, 'TARGET_REVISION_BUDGET_EXHAUSTED', 'Target revision extension budget is exhausted');
      }
      const writesByAuthorization = this.listRepairBatches(reviewId).filter((entry) => entry.authorizationId === authorization.authorizationId && ['READBACK_VERIFIED', 'RUNTIME_TESTING', 'RUNTIME_VERIFIED', 'RUNTIME_FAILED'].includes(entry.state)).length;
      invariant(writesByAuthorization < authorization.maxTargetRevisions, 'REPAIR_AUTHORIZATION_ALLOWANCE_EXHAUSTED', 'Target revision allowance is exhausted for this authorization');
      const candidate = readJson(this.#artifactPath(reviewId, batch.candidate.artifact));
      invariant(revisionValueDigest(candidate) === batch.candidate.sha256, 'TARGET_REPAIR_CANDIDATE_CORRUPT', 'Repair candidate does not match its checkpoint digest');
      batch.state = 'WRITE_REQUESTED';
      batch.write = { requestedAt: this.now().toISOString(), outcome: 'REQUESTED', observedWorkId: null, observedSha256: null, errorCode: null };
      batch.updatedAt = batch.write.requestedAt;
      writePrivateJson(this.#batchPath(reviewId, batchId), batch);
      review.updatedAt = batch.updatedAt;
      review.history.push({ status: review.status, at: review.updatedAt, reason: `target-repair-write-requested:${batchId}` });
      return { review, batch, candidate, baseline };
    });
  }

  resetTargetRepairPreflight(reviewId, batchId, { errorCode = 'TARGET_REPAIR_PREFLIGHT_FAILED' } = {}) {
    return this.#mutate(reviewId, (review) => {
      const batch = this.#repairBatch(reviewId, batchId);
      invariant(batch.state === 'WRITE_REQUESTED', 'TARGET_REPAIR_PREFLIGHT_INVALID', 'Repair Batch is not in target-write preflight');
      batch.state = 'LOCAL_VALIDATED';
      batch.write = { requestedAt: null, outcome: 'NOT_ATTEMPTED', observedWorkId: null, observedSha256: null, errorCode };
      batch.updatedAt = this.now().toISOString();
      writePrivateJson(this.#batchPath(reviewId, batchId), batch);
      review.updatedAt = batch.updatedAt;
      review.history.push({ status: review.status, at: review.updatedAt, reason: `target-repair-preflight-failed:${batchId}:${errorCode}` });
      return { review, batch };
    });
  }

  confirmTargetRepairWrite(reviewId, batchId, { observedWorkId, observedSnapshot } = {}) {
    return this.#mutate(reviewId, (review) => {
      const batch = this.#repairBatch(reviewId, batchId);
      invariant(['WRITE_REQUESTED', 'WRITE_OUTCOME_UNKNOWN'].includes(batch.state), 'TARGET_REPAIR_CONFIRMATION_INVALID', 'Repair Batch is not awaiting write confirmation');
      const workId = nonEmptyString(observedWorkId, 'observedWorkId');
      invariant(workId !== batch.expectedTarget.workId, 'TARGET_REPAIR_REVISION_NOT_ADVANCED', 'Verified target repair must advance the platform workId revision');
      assertSnapshot(observedSnapshot, 'observedSnapshot');
      const observedSha256 = revisionValueDigest(observedSnapshot);
      invariant(observedSha256 === batch.candidate.sha256, 'TARGET_REPAIR_READBACK_MISMATCH', 'Target read-back does not match the statically validated repair candidate');
      this.#writeBaselineSnapshot(reviewId, workId, observedSnapshot);
      const sessionBudget = this.#sessionBudget(reviewId, review);
      if (sessionBudget.targetRevisions.used < sessionBudget.targetRevisions.baseLimit) sessionBudget.targetRevisions.used += 1;
      else sessionBudget.targetRevisions.extensionUsed += 1;
      sessionBudget.status = sessionBudget.targetRevisions.extensionUsed >= sessionBudget.targetRevisions.extensionLimit
        && sessionBudget.targetRevisions.used >= sessionBudget.targetRevisions.baseLimit ? 'EXHAUSTED' : 'ACTIVE';
      sessionBudget.updatedAt = this.now().toISOString();
      writePrivateJson(this.#budgetPath(reviewId, sessionBudget.budgetId), sessionBudget);
      const candidateCheckpoint = this.listSaveableCheckpoints(reviewId).find((entry) => entry.checkpointId === batch.candidate.checkpointId);
      invariant(candidateCheckpoint, 'SAVEABLE_CHECKPOINT_MISSING', 'Repair Batch candidate checkpoint is missing');
      const checkpoint = this.#writeCheckpoint(reviewId, {
        checkpointType: 'CONFIRMED_TARGET_REVISION',
        artifact: path.relative(this.reviewDir(reviewId), this.#baselineSnapshotPath(reviewId, workId)).split(path.sep).join('/'),
        sha256: observedSha256,
        targetNid: review.target.nid,
        targetWorkId: workId,
        sourceAttemptId: batch.attemptIds[0] || null,
        sourceBatchId: batchId,
        staticValidation: candidateCheckpoint.staticValidation,
        createdAt: sessionBudget.updatedAt,
      });
      review.target.workId = workId;
      review.baseline.targetWorkId = workId;
      batch.state = 'READBACK_VERIFIED';
      batch.write = { ...batch.write, outcome: 'VERIFIED', observedWorkId: workId, observedSha256, errorCode: null };
      batch.updatedAt = sessionBudget.updatedAt;
      writePrivateJson(this.#batchPath(reviewId, batchId), batch);
      if (review.status === 'BLOCKED_PLATFORM_RUNTIME') {
        assertReviewTransition(review.status, 'TARGET_UPDATED');
      } else {
        invariant(review.status === 'READY_TO_UPDATE_TARGET', 'REVIEW_STATE_MISMATCH', 'Review is not ready to confirm a target update');
        assertReviewTransition(review.status, 'TARGET_UPDATED');
      }
      this.#setStatus(review, 'TARGET_UPDATED', `target-repair-readback-verified:${batchId}`);
      return { review, batch, checkpoint, sessionBudget };
    });
  }

  markTargetRepairUncertain(reviewId, batchId, { observedWorkId, observedSnapshot, errorCode = 'PLATFORM_NETWORK_FAILED' } = {}) {
    return this.#mutate(reviewId, (review) => {
      const batch = this.#repairBatch(reviewId, batchId);
      invariant(['WRITE_REQUESTED', 'WRITE_OUTCOME_UNKNOWN'].includes(batch.state), 'TARGET_REPAIR_CONFIRMATION_INVALID', 'Repair Batch is not awaiting a write result');
      const observedSha256 = observedSnapshot === undefined || observedSnapshot === null ? null : revisionValueDigest(observedSnapshot);
      const baselineStillPresent = observedWorkId === batch.expectedTarget.workId && observedSha256 === batch.expectedTarget.sha256;
      batch.state = baselineStillPresent ? 'WRITE_OUTCOME_UNKNOWN' : 'RECONCILIATION_REQUIRED';
      batch.write = {
        ...batch.write,
        outcome: baselineStillPresent ? 'UNKNOWN' : 'RECONCILIATION_REQUIRED',
        observedWorkId: observedWorkId || null,
        observedSha256,
        errorCode,
      };
      batch.updatedAt = this.now().toISOString();
      writePrivateJson(this.#batchPath(reviewId, batchId), batch);
      if (!baselineStillPresent && observedWorkId && observedSnapshot) {
        const observedArtifact = relativeArtifactPath('observed-targets', `repair-${batchId}.json`);
        writePrivateJson(this.#artifactPath(reviewId, observedArtifact), observedSnapshot);
        if (review.status !== 'TARGET_EXTERNALLY_MODIFIED') {
          assertReviewTransition(review.status, 'TARGET_EXTERNALLY_MODIFIED');
          this.#setStatus(review, 'TARGET_EXTERNALLY_MODIFIED', `target-repair-cas-or-readback-drift:${batchId}`);
        } else {
          review.updatedAt = batch.updatedAt;
          review.history.push({ status: review.status, at: review.updatedAt, reason: `target-repair-drift-refreshed:${batchId}` });
        }
      } else {
        if (review.status !== 'BLOCKED_PLATFORM_RUNTIME') {
          assertReviewTransition(review.status, 'BLOCKED_PLATFORM_RUNTIME');
          this.#setStatus(review, 'BLOCKED_PLATFORM_RUNTIME', `target-repair-write-outcome-unknown:${batchId}`);
        } else {
          review.updatedAt = batch.updatedAt;
          review.history.push({ status: review.status, at: review.updatedAt, reason: `target-repair-write-still-unknown:${batchId}` });
        }
      }
      return { review, batch };
    });
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

  #listArtifacts(reviewId, relativeDirectory) {
    const directory = this.#artifactPath(reviewId, relativeDirectory);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const target = path.join(directory, file);
        const stat = fs.lstatSync(target);
        invariant(stat.isFile() && !stat.isSymbolicLink(), 'REVIEW_ARTIFACT_INVALID', 'Review artifact collection contains an unsafe entry');
        return { file, value: readJson(target) };
      })
      .sort((left, right) => {
        const byTime = String(left.value.createdAt || left.value.updatedAt).localeCompare(String(right.value.createdAt || right.value.updatedAt));
        return byTime || left.file.localeCompare(right.file);
      })
      .map((entry) => entry.value);
  }

  #budgetPath(reviewId, budgetId) {
    return this.#artifactPath(reviewId, relativeArtifactPath('issues', 'budgets', `${budgetId}.json`));
  }

  #batchPath(reviewId, batchId) {
    return this.#artifactPath(reviewId, relativeArtifactPath('repairs', 'batches', `${batchId}.json`));
  }

  #repairAuthorization(reviewId, authorizationId) {
    const authorization = readJson(this.#artifactPath(reviewId, relativeArtifactPath('repair-authorizations', `${authorizationId}.json`)), null);
    invariant(authorization, 'REPAIR_AUTHORIZATION_NOT_FOUND', `Target repair authorization not found: ${authorizationId}`);
    return validateTargetRepairAuthorization(authorization);
  }

  #repairBatch(reviewId, batchId) {
    normalizeId(batchId, ARTIFACT_ID_PATTERN, 'INVALID_REPAIR_BATCH_ID', 'Invalid Repair Batch id');
    const batch = readJson(this.#batchPath(reviewId, batchId), null);
    invariant(batch, 'REPAIR_BATCH_NOT_FOUND', `Repair Batch not found: ${batchId}`);
    return validateRepairBatch(batch);
  }

  #latestRepairBatchByState(reviewId, states) {
    const allowed = new Set(states);
    return this.#listArtifacts(reviewId, relativeArtifactPath('repairs', 'batches'))
      .map(validateRepairBatch)
      .filter((batch) => allowed.has(batch.state))
      .at(-1) || null;
  }

  #assertEquivalentRepairEnvironment(reviewId, review) {
    const comparisons = this.#listArtifacts(reviewId, 'environment').filter((entry) => entry?.kind === 'environment-comparison');
    const latest = comparisons.at(-1);
    invariant(latest, 'REPAIR_ENVIRONMENT_COMPARISON_REQUIRED', 'Target repair requires a persisted Environment Comparison');
    validateEnvironmentComparison(latest);
    invariant(['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT'].includes(latest.status), 'REPAIR_ENVIRONMENT_NOT_EQUIVALENT', 'Target repair is paused because the runtime environment is not equivalent');
    invariant(latest.targetRevision.nid === review.target.nid && latest.targetRevision.workId === review.baseline.targetWorkId, 'REPAIR_ENVIRONMENT_REVISION_MISMATCH', 'Target repair Environment Comparison is stale for the current target revision');
    invariant(latest.sourceRevision.workId === review.baseline.sourceWorkId, 'REPAIR_ENVIRONMENT_REVISION_MISMATCH', 'Target repair Environment Comparison is stale for the source revision');
    return latest;
  }

  #clusterBudget(reviewId, review, clusterId) {
    for (const budgetId of review.repairBudgetIds) {
      const budget = validateRepairBudget(readJson(this.#budgetPath(reviewId, budgetId)));
      if (budget.scope === 'ISSUE_CLUSTER' && budget.clusterId === clusterId) return budget;
    }
    throw new WorkflowError('REPAIR_BUDGET_NOT_FOUND', `Repair budget not found for Issue Cluster ${clusterId}`);
  }

  #sessionBudget(reviewId, review) {
    for (const budgetId of review.repairBudgetIds) {
      const budget = validateRepairBudget(readJson(this.#budgetPath(reviewId, budgetId)));
      if (budget.scope === 'REVIEW_SESSION') return budget;
    }
    throw new WorkflowError('REPAIR_BUDGET_NOT_FOUND', 'Review Session target revision budget is missing');
  }

  #latestCluster(reviewId, clusterId) {
    const directory = this.#artifactPath(reviewId, relativeArtifactPath('issues', 'clusters'));
    const clusters = fs.readdirSync(directory)
      .filter((file) => file.startsWith(`${clusterId}.`) && file.endsWith('.json'))
      .map((file) => validateIssueCluster(readJson(path.join(directory, file))))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    invariant(clusters.length > 0, 'REPAIR_CLUSTER_NOT_FOUND', `Issue Cluster artifact not found: ${clusterId}`);
    return clusters.at(-1);
  }

  #clusterScenarioIds(reviewId, cluster) {
    const scenarioIds = [];
    for (const evidenceRef of cluster.evidenceRefs) {
      if (!evidenceRef.startsWith('artifact:cycles/') || !evidenceRef.includes('/comparisons/')) continue;
      const relativePath = evidenceRef.slice('artifact:'.length);
      const comparison = validateRuntimeComparison(readJson(this.#artifactPath(reviewId, relativePath)));
      scenarioIds.push(comparison.scenarioId);
    }
    return [...new Set(scenarioIds)].sort();
  }

  #writeCheckpoint(reviewId, {
    checkpointType,
    artifact,
    sha256,
    targetNid,
    targetWorkId,
    sourceAttemptId = null,
    sourceBatchId = null,
    staticValidation,
    createdAt,
  }) {
    const artifactValue = readJson(this.#artifactPath(reviewId, artifact), null);
    invariant(artifactValue !== null && revisionValueDigest(artifactValue) === sha256, 'SAVEABLE_CHECKPOINT_CONTENT_MISMATCH', 'Saveable Checkpoint artifact does not match its canonical SHA-256');
    const checkpointId = `checkpoint-${revisionValueDigest({ checkpointType, sha256, targetWorkId, sourceAttemptId, sourceBatchId }).slice(0, 20)}`;
    const checkpoint = validateSaveableCheckpoint({
      schemaVersion: 2,
      kind: 'saveable-checkpoint',
      checkpointId,
      reviewId,
      checkpointType,
      artifact,
      sha256,
      targetNid,
      targetWorkId,
      sourceAttemptId,
      sourceBatchId,
      staticValidation: {
        passed: staticValidation.passed ?? Number(staticValidation.blockerCount || 0) === 0,
        issueCount: Number(staticValidation.issueCount || 0),
        blockerCount: Number(staticValidation.blockerCount || 0),
      },
      createdAt,
      createdBy: 'CLI',
      sensitivity: 'PRIVATE',
    });
    this.#writeImmutableJson(this.#artifactPath(reviewId, relativeArtifactPath('checkpoints', `${checkpointId}.json`)), checkpoint, 'SAVEABLE_CHECKPOINT_CONFLICT');
    return checkpoint;
  }

  #confirmedCheckpoint(reviewId, workId) {
    const checkpoint = this.listSaveableCheckpoints(reviewId)
      .filter((entry) => entry.checkpointType === 'CONFIRMED_TARGET_REVISION' && entry.targetWorkId === workId)
      .at(-1);
    invariant(checkpoint, 'SAVEABLE_CHECKPOINT_MISSING', 'Confirmed target revision has no Saveable Checkpoint');
    return checkpoint;
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

  #assertDiagnosisEvidenceRef(reviewId, evidenceRef) {
    invariant(typeof evidenceRef === 'string' && evidenceRef.startsWith('artifact:'), 'DIAGNOSIS_EVIDENCE_INVALID', 'Diagnosis evidence must be an artifact:<relative-path> reference');
    const relativePath = evidenceRef.slice('artifact:'.length);
    invariant(relativePath && !path.isAbsolute(relativePath) && !relativePath.split('/').includes('..'), 'DIAGNOSIS_EVIDENCE_INVALID', 'Diagnosis evidence path is unsafe');
    const allowedRoots = new Set(['cycles', 'environment', 'findings', 'knowledge', 'revision-observations', 'reports']);
    invariant(allowedRoots.has(relativePath.split('/')[0]), 'DIAGNOSIS_EVIDENCE_INVALID', 'Diagnosis evidence root is not allowed');
    this.#assertPrivateRegularArtifact(reviewId, relativePath, 'DIAGNOSIS_EVIDENCE_MISSING', 'Diagnosis evidence must reference an existing regular review artifact', { evidenceRef });
  }

  #assertDiagnosticCheckpoint(review, checkpoint) {
    invariant(typeof checkpoint.artifact === 'string' && !path.isAbsolute(checkpoint.artifact) && !checkpoint.artifact.split('/').includes('..'), 'DIAGNOSTIC_CHECKPOINT_INVALID', 'Diagnostic checkpoint path is unsafe');
    invariant(['baselines', 'observed-targets'].includes(checkpoint.artifact.split('/')[0]), 'DIAGNOSTIC_CHECKPOINT_INVALID', 'Runtime Review diagnostic checkpoints must be confirmed target snapshots');
    const target = this.#assertPrivateRegularArtifact(review.reviewId, checkpoint.artifact, 'DIAGNOSTIC_CHECKPOINT_INVALID', 'Diagnostic checkpoint file is missing or unsafe');
    invariant(sha256File(target) === checkpoint.sha256, 'DIAGNOSTIC_CHECKPOINT_INVALID', 'Diagnostic checkpoint file does not match its SHA-256');
    invariant(checkpoint.kind === 'CONFIRMED_TARGET_REVISION' && checkpoint.targetNid === review.target.nid && checkpoint.targetWorkId === review.baseline.targetWorkId, 'DIAGNOSTIC_CHECKPOINT_INVALID', 'Diagnostic checkpoint does not match the confirmed target revision');
  }

  #assertPrivateRegularArtifact(reviewId, relativePath, code, message, details = undefined) {
    const root = this.reviewDir(reviewId);
    let current = root;
    for (const segment of relativePath.split('/')) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current, { throwIfNoEntry: false });
      invariant(stat && !stat.isSymbolicLink(), code, message, details);
    }
    const stat = fs.lstatSync(current);
    invariant(stat.isFile() && !stat.isSymbolicLink(), code, message, details);
    return current;
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
