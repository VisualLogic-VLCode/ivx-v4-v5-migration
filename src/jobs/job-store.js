import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createAppPaths, resolveWorkspaceReferenceDir } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError, invariant } from '../errors.js';
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

  create({ sourceNid, gid, workflowRuntime, converterRuntime, mode = 'platform', workspaceReference = false, cwd } = {}) {
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
    let handle;
    try {
      handle = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new WorkflowError('JOB_LOCKED', `Job is already being modified: ${jobId}`);
      }
      throw error;
    }
    try {
      return callback();
    } finally {
      try { fs.closeSync(handle); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
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
