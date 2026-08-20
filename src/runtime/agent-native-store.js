import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateAgentNativeObservationBundle } from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, sha256File, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { RuntimeReviewStore } from '../reviews/review-store.js';
import { createJobArtifactManifest } from './job-artifact-manifest.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_EVIDENCE_FILES = 2_000;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024 * 1024;

function identifier(value, name) {
  invariant(typeof value === 'string' && ID_PATTERN.test(value), 'AGENT_NATIVE_ID_INVALID', `${name} is invalid`);
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function immutableJson(target, value, code = 'AGENT_NATIVE_ARTIFACT_CONFLICT') {
  const existing = readJson(target, null);
  if (existing !== null) {
    invariant(digest(existing) === digest(value), code, 'Immutable Agent Native artifact already exists with different content');
    return existing;
  }
  writePrivateJson(target, value);
  return value;
}

function reviewRecord(observation) {
  return {
    schemaVersion: 1,
    kind: 'agent-native-review-record',
    runId: observation.runId,
    reviewId: observation.reviewId,
    outcome: observation.outcome,
    recordedAt: observation.createdAt,
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
}

function portable(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function evidenceManifest(workspaceRoot, refs, { runId, now }) {
  const uniqueRefs = [...new Set(refs)].sort();
  invariant(uniqueRefs.length <= MAX_EVIDENCE_FILES, 'AGENT_NATIVE_EVIDENCE_LIMIT_EXCEEDED', 'Agent Native evidence exceeds the file limit');
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  const entries = [];
  let totalBytes = 0;
  for (const relative of uniqueRefs) {
    invariant(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'AGENT_NATIVE_EVIDENCE_PATH_INVALID', 'Agent Native evidence reference must be a safe relative path', { path: relative });
    const absolute = path.resolve(root, relative);
    invariant(absolute.startsWith(`${root}${path.sep}`), 'AGENT_NATIVE_EVIDENCE_PATH_INVALID', 'Agent Native evidence escapes its workspace', { path: relative });
    let stat;
    let real;
    try {
      stat = fs.lstatSync(absolute);
      real = fs.realpathSync(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new WorkflowError('AGENT_NATIVE_EVIDENCE_MISSING', 'Agent Native evidence file does not exist', { path: relative });
      throw error;
    }
    invariant(real.startsWith(`${realRoot}${path.sep}`), 'AGENT_NATIVE_EVIDENCE_PATH_INVALID', 'Agent Native evidence resolves outside its workspace', { path: relative });
    invariant(stat.isFile() && !stat.isSymbolicLink(), 'AGENT_NATIVE_EVIDENCE_UNSAFE', 'Agent Native evidence must be a regular non-symlink file', { path: relative });
    totalBytes += stat.size;
    invariant(totalBytes <= MAX_EVIDENCE_BYTES, 'AGENT_NATIVE_EVIDENCE_LIMIT_EXCEEDED', 'Agent Native evidence exceeds the byte limit');
    entries.push({ path: portable(relative), size: stat.size, sha256: sha256File(absolute) });
  }
  return {
    schemaVersion: 1,
    kind: 'agent-native-evidence-manifest',
    runId,
    entries,
    fileCount: entries.length,
    totalBytes,
    sha256: digest(entries),
    createdAt: now().toISOString(),
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
}

function advisoryEnvironment(comparison) {
  if (!comparison) return { comparisonId: null, status: null, differences: [] };
  return {
    comparisonId: comparison.comparisonId,
    status: comparison.status,
    differences: comparison.fields
      .filter((field) => !['EQUIVALENT', 'NORMALIZED', 'IGNORED'].includes(field.disposition))
      .map((field) => ({ path: field.path, summary: field.disposition })),
  };
}

export class AgentNativeStore {
  constructor(appPaths = createAppPaths(), { jobs, reviews, now = () => new Date() } = {}) {
    this.paths = appPaths;
    this.jobs = jobs || new JobStore(appPaths);
    this.reviews = reviews || new RuntimeReviewStore(appPaths, { jobs: this.jobs });
    this.now = now;
    ensurePrivateDir(this.paths.locks);
  }

  root(reviewId) {
    this.reviews.load(reviewId);
    return ensurePrivateDir(path.join(this.reviews.reviewDir(reviewId), 'agent-native'));
  }

  workspace(reviewId) {
    return ensurePrivateDir(path.join(this.root(reviewId), 'workspace'));
  }

  runsDir(reviewId) {
    return ensurePrivateDir(path.join(this.root(reviewId), 'runs'));
  }

  runDir(reviewId, runId) {
    identifier(runId, 'runId');
    return path.join(this.runsDir(reviewId), runId);
  }

  handoff(reviewId, { sourceInfo, targetInfo } = {}) {
    const review = this.reviews.load(reviewId);
    const job = this.jobs.loadForRead(review.jobId).state;
    invariant(Number(sourceInfo?.nid) === Number(job.input.sourceNid), 'AGENT_NATIVE_SOURCE_MISMATCH', 'Agent Native source facts do not match the Review Job');
    invariant(Number(targetInfo?.nid) === Number(review.target.nid), 'AGENT_NATIVE_TARGET_MISMATCH', 'Agent Native target facts do not match the Review');
    const manifest = createJobArtifactManifest({ jobs: this.jobs, jobId: review.jobId, now: this.now });
    const environment = this.reviews.latestEnvironmentComparison(reviewId);
    return {
      schemaVersion: 1,
      kind: 'agent-native-handoff',
      mode: 'AGENT_NATIVE',
      review: { reviewId, jobId: review.jobId, capability: review.capability, status: review.status },
      job: { root: manifest.root, manifest },
      workspaceRoot: this.workspace(reviewId),
      subjects: {
        source: { nid: Number(sourceInfo.nid), workId: sourceInfo.workId || null, url: sourceInfo.url || null, origin: sourceInfo.origin || null },
        target: { nid: Number(targetInfo.nid), workId: targetInfo.workId || null, url: targetInfo.url || null, origin: targetInfo.origin || null },
      },
      environment: advisoryEnvironment(environment),
      workflow: {
        restrictionsApplied: false,
        authorizationRequired: false,
        sessionCreated: false,
        browserDriver: 'NOT_PROVIDED',
        actionPlanner: 'NOT_PROVIDED',
        credentialTransport: 'AGENT_DECIDES',
        sideEffectPolicy: 'AGENT_DECIDES',
      },
      observationContract: {
        kind: 'agent-native-observation-bundle',
        outcomes: ['OBSERVED_EQUIVALENT', 'OBSERVED_MISMATCH', 'INCONCLUSIVE'],
        strictParityClaimAllowed: false,
        secretsAllowed: false,
        businessFlowCoverageRequired: true,
        surfaceReconciliationRequired: true,
        coverageDepthRequired: true,
        completeInventoryRequiredForEquivalent: true,
        observedOutcomeSeparatedFromCoverageStatus: true,
        authorizedSideEffectTestingSupported: true,
        sideEffectAuthorizationRecordedByAgent: true,
        postWriteEvidenceRequired: true,
        writeMayStopAtPreSubmitBoundary: true,
      },
    };
  }

  submit(reviewId, observation) {
    validateAgentNativeObservationBundle(observation);
    return this.#withLock(reviewId, () => {
      const review = this.reviews.load(reviewId);
      const job = this.jobs.loadForRead(review.jobId).state;
      invariant(observation.reviewId === reviewId && observation.jobId === review.jobId, 'AGENT_NATIVE_SCOPE_MISMATCH', 'Agent Native Observation belongs to another Review or Job');
      invariant(observation.subjects.source.nid === Number(job.input.sourceNid) && observation.subjects.target.nid === review.target.nid, 'AGENT_NATIVE_SCOPE_MISMATCH', 'Agent Native Observation subject nids do not match the Review');
      if (observation.previousRunId !== null) this.status(reviewId, observation.previousRunId);
      if (observation.purpose !== 'INITIAL_TEST') invariant(observation.previousRunId !== null, 'AGENT_NATIVE_PREVIOUS_RUN_REQUIRED', 'Retest and repair regression observations must link a previous run');
      const root = this.runDir(reviewId, observation.runId);
      const allRefs = [
        ...observation.evidenceRefs,
        ...observation.findings.flatMap((finding) => finding.evidenceRefs),
        ...(observation.exploration?.surfaceInventory?.units || []).flatMap((unit) => unit.evidenceRefs),
        ...(observation.exploration?.candidateFlows || []).flatMap((flow) => flow.evidenceRefs),
        ...(observation.exploration?.candidateFlows || []).flatMap((flow) => flow.blocker?.evidenceRefs || []),
      ];
      if (fs.existsSync(root)) {
        const stat = fs.lstatSync(root);
        invariant(stat.isDirectory() && !stat.isSymbolicLink(), 'AGENT_NATIVE_RUN_UNSAFE', `Agent Native run path is not a safe directory: ${observation.runId}`);
        const existing = readJson(path.join(root, 'observation.json'), null);
        if (existing === null) immutableJson(path.join(root, 'observation.json'), observation);
        else invariant(digest(existing) === digest(observation), 'AGENT_NATIVE_RUN_EXISTS', `Agent Native run already exists with different content: ${observation.runId}`);
        let manifest = readJson(path.join(root, 'evidence-manifest.json'), null);
        if (manifest === null) {
          manifest = evidenceManifest(this.workspace(reviewId), allRefs, { runId: observation.runId, now: this.now });
          immutableJson(path.join(root, 'evidence-manifest.json'), manifest);
        }
        const recordPath = path.join(root, 'review-recorded.json');
        if (readJson(recordPath, null) !== null) {
          immutableJson(recordPath, reviewRecord(observation));
          return {
            observation,
            evidenceManifest: manifest,
            review: this.reviews.load(reviewId),
            repairBatch: observation.repairBatchId === null ? null : this.reviews.loadRepairBatch(reviewId, observation.repairBatchId),
          };
        }
        const reviewResult = this.reviews.recordAgentNativeObservation(reviewId, observation);
        immutableJson(recordPath, reviewRecord(observation));
        return { observation, evidenceManifest: manifest, review: reviewResult.review, repairBatch: reviewResult.repairBatch };
      }
      const manifest = evidenceManifest(this.workspace(reviewId), allRefs, { runId: observation.runId, now: this.now });
      ensurePrivateDir(root);
      immutableJson(path.join(root, 'observation.json'), observation);
      immutableJson(path.join(root, 'evidence-manifest.json'), manifest);
      const reviewResult = this.reviews.recordAgentNativeObservation(reviewId, observation);
      immutableJson(path.join(root, 'review-recorded.json'), reviewRecord(observation));
      return { observation, evidenceManifest: manifest, review: reviewResult.review, repairBatch: reviewResult.repairBatch };
    });
  }

  status(reviewId, runId) {
    const root = this.runDir(reviewId, runId);
    const observation = readJson(path.join(root, 'observation.json'), null);
    if (!observation) throw new WorkflowError('AGENT_NATIVE_RUN_NOT_FOUND', `Agent Native run not found: ${runId}`);
    return {
      observation: validateAgentNativeObservationBundle(observation, { allowLegacyExploration: true }),
      evidenceManifest: readJson(path.join(root, 'evidence-manifest.json'), null),
    };
  }

  list(reviewId) {
    const root = this.runsDir(reviewId);
    return fs.readdirSync(root).sort().map((runId) => this.status(reviewId, runId).observation);
  }

  #withLock(reviewId, callback) {
    return withFileLock(
      path.join(this.paths.locks, `${reviewId}.agent-native.lock`),
      { pid: process.pid, reviewId, operation: 'agent-native', at: this.now().toISOString() },
      { code: 'AGENT_NATIVE_LOCKED', message: `Agent Native state is locked for Review ${reviewId}` },
      callback,
    );
  }
}
