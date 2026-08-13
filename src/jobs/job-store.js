import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createAppPaths, resolveWorkspaceReferenceDir } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError, invariant } from '../errors.js';
import { migrateJobStateV1ToV2, readJobStateCompatible } from '../contracts/compatibility.js';
import { acquireFileLock, releaseFileLock } from '../fs/file-lock.js';
import { assertTransition } from './states.js';

function createJobId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `mig_${timestamp}_${crypto.randomBytes(5).toString('hex')}`;
}

function normalizePositiveInteger(value, name, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && number > 0, 'INVALID_JOB_INPUT', `${name} must be a positive integer`);
  return number;
}

export class JobStore {
  constructor(appPaths = createAppPaths()) {
    this.paths = appPaths;
    for (const dir of [appPaths.home, appPaths.jobs, appPaths.locks, appPaths.logs]) {
      ensurePrivateDir(dir);
    }
  }

  jobDir(jobId) {
    invariant(/^mig_[a-zA-Z0-9_]+$/.test(jobId), 'INVALID_JOB_ID', 'Invalid job id');
    return path.join(this.paths.jobs, jobId);
  }

  statePath(jobId) {
    return path.join(this.jobDir(jobId), 'state.json');
  }

  create({ sourceNid, gid, workflowRuntime, converterRuntime, knowledgeRuntime, mode = 'platform', workspaceReference = false, cwd } = {}) {
    const now = new Date();
    const jobId = createJobId(now);
    const directory = ensurePrivateDir(this.jobDir(jobId));
    for (const child of ['v4', 'v5', 'reports', 'patches']) ensurePrivateDir(path.join(directory, child));
    const job = {
      schemaVersion: 1,
      jobId,
      status: 'RECEIVED',
      mode,
      input: {
        sourceNid: normalizePositiveInteger(sourceNid, 'sourceNid'),
        gid: normalizePositiveInteger(gid, 'gid', { optional: true }),
      },
      runtime: {
        workflow: workflowRuntime || null,
        converter: converterRuntime || null,
        knowledge: knowledgeRuntime || null,
      },
      source: {},
      target: {},
      issues: { summary: null },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      history: [{ status: 'RECEIVED', at: now.toISOString(), reason: 'job-created' }],
    };
    writePrivateJson(this.statePath(jobId), job);
    this.#updateRegistry(job);
    if (workspaceReference) this.writeWorkspaceReference(job, cwd);
    return job;
  }

  load(jobId) {
    const job = readJson(this.statePath(jobId));
    if (!job) throw new WorkflowError('JOB_NOT_FOUND', `Job not found: ${jobId}`);
    return job;
  }

  loadForRead(jobId) {
    return readJobStateCompatible(this.load(jobId));
  }

  createV2MigrationCopy(jobId, { relativePath = 'migrations/state.v2.json', migratedAt } = {}) {
    return this.withLock(jobId, () => {
      const sourceState = this.load(jobId);
      invariant(sourceState.schemaVersion === 1, 'JOB_MIGRATION_NOT_REQUIRED', 'Only schema-v1 Job states require a v2 migration copy');
      const root = this.jobDir(jobId);
      const target = path.resolve(root, relativePath);
      invariant(target.startsWith(`${root}${path.sep}`), 'INVALID_ARTIFACT_PATH', 'Artifact path escapes job directory');
      invariant(!fs.existsSync(target), 'JOB_MIGRATION_COPY_EXISTS', 'A v2 migration copy already exists', { relativePath });
      const migrated = migrateJobStateV1ToV2(sourceState, { migratedAt });
      this.writeArtifact(jobId, relativePath, migrated);
      return {
        sourceStatePath: this.statePath(jobId),
        migratedArtifact: relativePath,
        state: migrated,
      };
    });
  }

  transition(jobId, nextStatus, { reason, patch } = {}) {
    return this.withLock(jobId, () => {
      const job = this.load(jobId);
      assertTransition(job.status, nextStatus);
      if (patch && typeof patch === 'object') {
        for (const [key, value] of Object.entries(patch)) {
          if (['jobId', 'schemaVersion', 'createdAt', 'history'].includes(key)) {
            throw new WorkflowError('IMMUTABLE_JOB_FIELD', `Cannot patch immutable job field: ${key}`);
          }
          job[key] = value;
        }
      }
      const at = new Date().toISOString();
      job.status = nextStatus;
      job.updatedAt = at;
      job.history.push({ status: nextStatus, at, reason: reason || null });
      writePrivateJson(this.statePath(jobId), job);
      this.#updateRegistry(job);
      return job;
    });
  }

  list() {
    const registry = readJson(this.paths.registry, { schemaVersion: 1, jobs: [] });
    return Array.isArray(registry.jobs) ? registry.jobs : [];
  }

  writeArtifact(jobId, relativePath, value, { json = true, pretty = true } = {}) {
    const root = this.jobDir(jobId);
    const target = path.resolve(root, relativePath);
    invariant(target.startsWith(`${root}${path.sep}`), 'INVALID_ARTIFACT_PATH', 'Artifact path escapes job directory');
    if (json) writePrivateJson(target, value, { pretty });
    else writePrivateFile(target, value);
    return target;
  }

  writeWorkspaceReference(job, cwd = process.cwd()) {
    const refDir = ensurePrivateDir(resolveWorkspaceReferenceDir(cwd));
    const ignorePath = path.join(refDir, '.gitignore');
    if (!fs.existsSync(ignorePath)) writePrivateFile(ignorePath, '*\n!.gitignore\n');
    const reference = {
      schemaVersion: 1,
      jobId: job.jobId,
      sourceNid: job.input.sourceNid,
      gid: job.input.gid,
      status: job.status,
    };
    writePrivateJson(path.join(refDir, `${job.jobId}.json`), reference);
  }

  withLock(jobId, callback) {
    const lockPath = path.join(this.paths.locks, `${jobId}.lock`);
    const handle = acquireFileLock(
      lockPath,
      { pid: process.pid, at: new Date().toISOString() },
      { code: 'JOB_LOCKED', message: `Job is already being modified: ${jobId}` },
    );
    try {
      return callback();
    } finally {
      releaseFileLock(lockPath, handle);
    }
  }

  withOperationLease(jobId, operation, callback) {
    invariant(/^[a-z][a-z0-9-]*$/.test(operation), 'INVALID_OPERATION', 'Invalid operation lease name');
    const lockPath = path.join(this.paths.locks, `${jobId}.${operation}.lock`);
    const handle = acquireFileLock(
      lockPath,
      { pid: process.pid, operation, at: new Date().toISOString() },
      { code: 'JOB_OPERATION_LOCKED', message: `Job operation is already running: ${operation}` },
    );
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

  #updateRegistry(job) {
    const registry = readJson(this.paths.registry, { schemaVersion: 1, jobs: [] });
    const entry = {
      jobId: job.jobId,
      sourceNid: job.input.sourceNid,
      gid: job.input.gid,
      status: job.status,
      updatedAt: job.updatedAt,
    };
    const index = registry.jobs.findIndex((item) => item.jobId === job.jobId);
    if (index >= 0) registry.jobs[index] = entry;
    else registry.jobs.unshift(entry);
    writePrivateJson(this.paths.registry, registry);
  }
}
