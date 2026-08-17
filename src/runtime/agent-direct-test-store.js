import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateAgentDirectTestAuthorization,
  validateAgentTestAttestation,
} from '../contracts/schema-v2.js';
import { invariant, WorkflowError } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';
import { ensurePrivateDir, readJson, sha256File, writePrivateJson } from '../fs/secure-json.js';
import { JobStore } from '../jobs/job-store.js';
import { createAppPaths } from '../paths.js';
import { RuntimeReviewStore } from '../reviews/review-store.js';
import { createJobArtifactManifest } from './job-artifact-manifest.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EQUIVALENT_ENVIRONMENTS = new Set(['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT']);
const MAX_EVIDENCE_FILES = 1_000;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024 * 1024;

function identifier(value, name) {
  invariant(typeof value === 'string' && ID_PATTERN.test(value), 'AGENT_TEST_ID_INVALID', `${name} is invalid`);
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function immutableJson(target, value, code = 'AGENT_TEST_ARTIFACT_CONFLICT') {
  const existing = readJson(target, null);
  if (existing !== null) {
    invariant(digest(existing) === digest(value), code, 'Immutable Agent Direct Test artifact already exists with different content');
    return existing;
  }
  writePrivateJson(target, value);
  return value;
}

function parseBaseUrl(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new WorkflowError('AGENT_TEST_SUBJECT_URL_INVALID', `${name} must be an absolute URL`); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  invariant((parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) && !parsed.username && !parsed.password, 'AGENT_TEST_SUBJECT_URL_INVALID', `${name} must be HTTPS without credentials, except HTTP loopback tests`);
  parsed.hash = '';
  return parsed;
}

function portable(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function evidenceManifest(workspaceRoot, refs, { sessionId, now }) {
  const uniqueRefs = [...new Set(refs)].sort();
  invariant(uniqueRefs.length <= MAX_EVIDENCE_FILES, 'AGENT_TEST_EVIDENCE_LIMIT_EXCEEDED', 'Agent Test evidence exceeds the file limit');
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  const entries = [];
  let totalBytes = 0;
  for (const relative of uniqueRefs) {
    invariant(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'AGENT_TEST_EVIDENCE_PATH_INVALID', 'Agent Test evidence reference must be a safe relative path', { path: relative });
    const absolute = path.resolve(root, relative);
    invariant(absolute.startsWith(`${root}${path.sep}`), 'AGENT_TEST_EVIDENCE_PATH_INVALID', 'Agent Test evidence escapes its workspace', { path: relative });
    let stat;
    let real;
    try {
      stat = fs.lstatSync(absolute);
      real = fs.realpathSync(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new WorkflowError('AGENT_TEST_EVIDENCE_MISSING', 'Agent Test evidence file does not exist', { path: relative });
      throw error;
    }
    invariant(real.startsWith(`${realRoot}${path.sep}`), 'AGENT_TEST_EVIDENCE_PATH_INVALID', 'Agent Test evidence resolves outside its workspace', { path: relative });
    invariant(stat.isFile() && !stat.isSymbolicLink(), 'AGENT_TEST_EVIDENCE_UNSAFE', 'Agent Test evidence must be a regular non-symlink file', { path: relative });
    totalBytes += stat.size;
    invariant(totalBytes <= MAX_EVIDENCE_BYTES, 'AGENT_TEST_EVIDENCE_LIMIT_EXCEEDED', 'Agent Test evidence exceeds the byte limit');
    entries.push({ path: portable(relative), size: stat.size, sha256: sha256File(absolute) });
  }
  const createdAt = now().toISOString();
  return {
    schemaVersion: 1,
    kind: 'agent-test-evidence-manifest',
    sessionId,
    entries,
    fileCount: entries.length,
    totalBytes,
    sha256: digest(entries),
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
}

export class AgentDirectTestStore {
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

  authorizationDir(reviewId) {
    return ensurePrivateDir(path.join(this.reviews.reviewDir(reviewId), 'agent-direct-tests', 'authorizations'));
  }

  sessionsDir(reviewId) {
    return ensurePrivateDir(path.join(this.reviews.reviewDir(reviewId), 'agent-direct-tests', 'sessions'));
  }

  sessionDir(reviewId, sessionId) {
    identifier(sessionId, 'sessionId');
    return path.join(this.sessionsDir(reviewId), sessionId);
  }

  authorize(reviewId, {
    environmentComparisonId,
    environmentMode = 'EQUIVALENT_ONLY',
    capability = 'AGENT_DIRECT_READ_ONLY',
    expiresAt,
    sourceOrigin,
    targetOrigin,
    sideEffectScope,
  } = {}) {
    return this.#withLock(reviewId, () => {
      invariant(capability !== 'AGENT_DIRECT_SIDE_EFFECT', 'AGENT_DIRECT_SIDE_EFFECT_NOT_ENABLED', 'Agent Direct side-effect testing is reserved but not enabled in this Workflow release');
      const review = this.reviews.load(reviewId);
      invariant(review.status !== 'REVIEW_SUPERSEDED_BY_REFRESH', 'AGENT_TEST_REVIEW_SUPERSEDED', 'A superseded Review cannot start a new Agent Direct Test');
      invariant(review.activeCycleId === null, 'AGENT_TEST_REVIEW_BUSY', 'Agent Direct Test requires no active Runtime Cycle');
      const job = this.jobs.loadForRead(review.jobId).state;
      const environment = this.reviews.loadEnvironmentComparison(reviewId, environmentComparisonId);
      invariant(environment.sourceRevision.nid === Number(job.input.sourceNid) && environment.sourceRevision.workId === review.baseline.sourceWorkId, 'AGENT_TEST_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the V4 Review baseline');
      invariant(environment.targetRevision.nid === review.target.nid && environment.targetRevision.workId === review.baseline.targetWorkId, 'AGENT_TEST_ENVIRONMENT_REVISION_MISMATCH', 'Environment comparison does not match the V5 Review baseline');
      invariant(EQUIVALENT_ENVIRONMENTS.has(environment.status) && environmentMode === 'EQUIVALENT_ONLY', 'AGENT_TEST_ENVIRONMENT_NOT_EQUIVALENT', 'Agent Direct read-only testing currently requires an equivalent Environment Gate');
      const at = this.now();
      const manifest = createJobArtifactManifest({ jobs: this.jobs, jobId: review.jobId, now: this.now });
      const authorization = validateAgentDirectTestAuthorization({
        schemaVersion: 2,
        kind: 'agent-direct-test-authorization',
        authorizationId: `agent-test-auth-${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${this.randomBytes(5).toString('hex')}`,
        reviewId,
        jobId: review.jobId,
        jobManifestSha256: manifest.sha256,
        source: { nid: Number(job.input.sourceNid), workId: review.baseline.sourceWorkId },
        target: { nid: review.target.nid, workId: review.baseline.targetWorkId },
        origins: { source: sourceOrigin, target: targetOrigin },
        environment: { comparisonId: environment.comparisonId, status: environment.status, mode: environmentMode },
        capability,
        scope: {
          jobArtifacts: 'COMPLETE_READ_ONLY',
          browserControl: 'AGENT_DIRECT',
          toolChoice: 'AGENT_CONTROLLED',
          codeExecution: 'AGENT_CONTROLLED',
          credentialAccess: 'AGENT_LOCAL_USE',
          workflowDriver: 'NOT_PROVIDED',
        },
        sideEffectScope: sideEffectScope || {
          enabled: false,
          systems: [],
          objectTypes: [],
          actionClasses: [],
          maxOperations: 0,
          testDataPrefix: null,
          nonRecoverabilityAccepted: false,
        },
        confirmation: 'RUN_AGENT_DIRECT_READ_ONLY_TEST',
        expiresAt: expiresAt || new Date(at.getTime() + 2 * 60 * 60_000).toISOString(),
        createdAt: at.toISOString(),
        createdBy: 'USER',
        sensitivity: 'PRIVATE',
      });
      immutableJson(this.#authorizationPath(reviewId, authorization.authorizationId), authorization, 'AGENT_TEST_AUTHORIZATION_CONFLICT');
      immutableJson(this.#manifestPath(reviewId, authorization.authorizationId), manifest, 'AGENT_TEST_JOB_MANIFEST_CONFLICT');
      return authorization;
    });
  }

  start(reviewId, authorizationId, { sourceBaseUrl, targetBaseUrl } = {}) {
    return this.#withLock(reviewId, () => {
      const authorization = this.loadAuthorization(reviewId, authorizationId);
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'AGENT_TEST_AUTHORIZATION_EXPIRED', 'Agent Direct Test authorization has expired');
      const manifest = this.#loadAndVerifyManifest(reviewId, authorization);
      const sourceUrl = parseBaseUrl(sourceBaseUrl, 'sourceBaseUrl');
      const targetUrl = parseBaseUrl(targetBaseUrl, 'targetBaseUrl');
      invariant(sourceUrl.origin === authorization.origins.source && targetUrl.origin === authorization.origins.target, 'AGENT_TEST_ORIGIN_MISMATCH', 'Agent Direct Test subject URL origin does not match the authorization');
      const claim = readJson(this.#claimPath(reviewId, authorizationId), null);
      let sessionId = claim?.sessionId;
      if (!sessionId) {
        const at = this.now();
        sessionId = `agent-test-${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${this.randomBytes(5).toString('hex')}`;
        immutableJson(this.#claimPath(reviewId, authorizationId), {
          schemaVersion: 1,
          kind: 'agent-direct-test-authorization-claim',
          authorizationId,
          sessionId,
          jobManifestSha256: manifest.sha256,
          claimedAt: at.toISOString(),
          createdBy: 'CLI',
          sensitivity: 'PRIVATE',
        }, 'AGENT_TEST_AUTHORIZATION_ALREADY_USED');
      }
      const root = ensurePrivateDir(this.sessionDir(reviewId, sessionId));
      const workspaceRoot = ensurePrivateDir(path.join(root, 'workspace'));
      const statePath = path.join(root, 'state.json');
      const existingState = readJson(statePath, null);
      const state = existingState || {
        schemaVersion: 1,
        kind: 'agent-direct-test-session-state',
        sessionId,
        reviewId,
        jobId: authorization.jobId,
        authorizationId,
        status: 'CONTEXT_READY',
        attestationId: null,
        startedAt: this.now().toISOString(),
        completedAt: null,
        createdBy: 'CLI',
        sensitivity: 'PRIVATE',
      };
      if (!existingState) writePrivateJson(statePath, state);
      const context = {
        schemaVersion: 1,
        kind: 'agent-test-context',
        authorization,
        session: { sessionId, status: 'CONTEXT_READY', workspaceRoot },
        job: { root: manifest.root, manifest },
        subjects: {
          source: { ...authorization.source, baseUrl: sourceUrl.toString() },
          target: { ...authorization.target, baseUrl: targetUrl.toString() },
        },
        environmentComparisonPath: path.join(this.reviews.reviewDir(reviewId), 'environment', `${authorization.environment.comparisonId}.json`),
        credentialPolicy: {
          access: 'AGENT_LOCAL_USE',
          valuesIncluded: false,
          userDirectInput: 'EPHEMERAL_BROWSER_USE_ALLOWED',
          browserUse: 'AUTHORIZED_SUBJECTS_ONLY',
          agentToolTransport: 'MINIMUM_BROWSER_OPERATION_ONLY',
          workflowAccess: 'FORBIDDEN',
          persistence: 'FORBIDDEN',
          reporting: 'FORBIDDEN',
          reuse: 'CURRENT_AGENT_TASK_ONLY',
        },
        workflowExecution: { browserDriver: 'NOT_PROVIDED', actionPlanner: 'NOT_PROVIDED', readinessDetector: 'NOT_PROVIDED' },
      };
      immutableJson(path.join(root, 'context.json'), context, 'AGENT_TEST_CONTEXT_CONFLICT');
      return context;
    });
  }

  submit(reviewId, sessionId, { attestation, currentSourceWorkId, currentTargetWorkId } = {}) {
    validateAgentTestAttestation(attestation);
    return this.#withLock(reviewId, () => {
      const root = this.sessionDir(reviewId, sessionId);
      const statePath = path.join(root, 'state.json');
      const state = readJson(statePath, null);
      invariant(state, 'AGENT_TEST_SESSION_NOT_FOUND', `Agent Direct Test Session not found: ${sessionId}`);
      invariant(['CONTEXT_READY', 'COMPLETED'].includes(state.status), 'AGENT_TEST_SESSION_STATE_INVALID', 'Agent Direct Test Session cannot accept an attestation in its current state');
      const authorization = this.loadAuthorization(reviewId, state.authorizationId);
      invariant(Date.parse(authorization.expiresAt) > this.now().getTime(), 'AGENT_TEST_AUTHORIZATION_EXPIRED', 'Agent Direct Test authorization expired before attestation submission');
      this.#loadAndVerifyManifest(reviewId, authorization);
      invariant(attestation.sessionId === sessionId && attestation.authorizationId === authorization.authorizationId && attestation.reviewId === reviewId && attestation.jobId === authorization.jobId, 'AGENT_TEST_ATTESTATION_SCOPE_MISMATCH', 'Agent Test Attestation belongs to another session, authorization, Review, or Job');
      invariant(JSON.stringify(attestation.sourceRevision) === JSON.stringify(authorization.source) && JSON.stringify(attestation.targetRevision) === JSON.stringify(authorization.target), 'AGENT_TEST_ATTESTATION_REVISION_MISMATCH', 'Agent Test Attestation revisions do not match the authorization');
      invariant(JSON.stringify(attestation.environment) === JSON.stringify(authorization.environment) && attestation.capability === authorization.capability, 'AGENT_TEST_ATTESTATION_SCOPE_MISMATCH', 'Agent Test Attestation environment or capability does not match the authorization');
      invariant(currentSourceWorkId === authorization.source.workId && currentTargetWorkId === authorization.target.workId, 'AGENT_TEST_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed before Agent Test submission');
      invariant(Date.parse(attestation.completedAt) >= Date.parse(authorization.createdAt) && Date.parse(attestation.completedAt) <= Date.parse(authorization.expiresAt), 'AGENT_TEST_ATTESTATION_TIME_INVALID', 'Agent Test Attestation must complete during the authorization window');
      const allRefs = [...attestation.evidenceRefs, ...attestation.findings.flatMap((finding) => finding.evidenceRefs)];
      const manifest = evidenceManifest(path.join(root, 'workspace'), allRefs, { sessionId, now: this.now });
      immutableJson(path.join(root, 'attestation.json'), attestation, 'AGENT_TEST_ATTESTATION_CONFLICT');
      immutableJson(path.join(root, 'evidence-manifest.json'), manifest, 'AGENT_TEST_EVIDENCE_MANIFEST_CONFLICT');
      const completed = {
        ...state,
        status: 'COMPLETED',
        attestationId: attestation.attestationId,
        completedAt: attestation.completedAt,
      };
      writePrivateJson(statePath, completed);
      return { authorization, state: completed, attestation, evidenceManifest: manifest };
    });
  }

  status(reviewId, sessionId) {
    const root = this.sessionDir(reviewId, sessionId);
    const state = readJson(path.join(root, 'state.json'), null);
    if (!state) throw new WorkflowError('AGENT_TEST_SESSION_NOT_FOUND', `Agent Direct Test Session not found: ${sessionId}`);
    return {
      state,
      attestation: readJson(path.join(root, 'attestation.json'), null),
      evidenceManifest: readJson(path.join(root, 'evidence-manifest.json'), null),
    };
  }

  list(reviewId) {
    this.reviews.load(reviewId);
    const root = this.sessionsDir(reviewId);
    return fs.readdirSync(root).sort().map((sessionId) => readJson(path.join(root, sessionId, 'state.json'), null)).filter(Boolean);
  }

  loadAuthorization(reviewId, authorizationId) {
    identifier(authorizationId, 'authorizationId');
    const authorization = readJson(this.#authorizationPath(reviewId, authorizationId), null);
    if (!authorization) throw new WorkflowError('AGENT_TEST_AUTHORIZATION_NOT_FOUND', `Agent Direct Test Authorization not found: ${authorizationId}`);
    return validateAgentDirectTestAuthorization(authorization);
  }

  #loadAndVerifyManifest(reviewId, authorization) {
    const manifest = readJson(this.#manifestPath(reviewId, authorization.authorizationId), null);
    invariant(manifest && manifest.sha256 === authorization.jobManifestSha256, 'AGENT_TEST_JOB_MANIFEST_MISSING', 'Authorized Job manifest is missing or invalid');
    const current = createJobArtifactManifest({ jobs: this.jobs, jobId: authorization.jobId, now: this.now });
    invariant(current.sha256 === manifest.sha256, 'AGENT_TEST_JOB_ARTIFACTS_CHANGED', 'Job artifacts changed after Agent Direct Test authorization; create a new authorization');
    return manifest;
  }

  #authorizationPath(reviewId, authorizationId) {
    identifier(authorizationId, 'authorizationId');
    return path.join(this.authorizationDir(reviewId), `${authorizationId}.json`);
  }

  #manifestPath(reviewId, authorizationId) {
    identifier(authorizationId, 'authorizationId');
    return path.join(this.authorizationDir(reviewId), `${authorizationId}.job-manifest.json`);
  }

  #claimPath(reviewId, authorizationId) {
    identifier(authorizationId, 'authorizationId');
    return path.join(this.authorizationDir(reviewId), `${authorizationId}.claim.json`);
  }

  #withLock(reviewId, callback) {
    return withFileLock(
      path.join(this.paths.locks, `${reviewId}.agent-direct-test.lock`),
      { pid: process.pid, reviewId, operation: 'agent-direct-test', at: this.now().toISOString() },
      {
        code: 'AGENT_DIRECT_TEST_LOCKED',
        message: `Agent Direct Test state is locked for Review ${reviewId}`,
      },
      callback,
    );
  }
}
