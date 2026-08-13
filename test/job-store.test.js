import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';

test('JobStore persists private state and enforces transitions', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-store-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    const job = store.create({ sourceNid: 123, gid: 9, workflowRuntime: { version: '1.0.0' } });
    assert.equal(job.status, 'RECEIVED');
    const mode = fs.statSync(store.statePath(job.jobId)).mode & 0o777;
    assert.equal(mode, 0o600);
    store.transition(job.jobId, 'UPDATE_CHECKED');
    assert.equal(store.load(job.jobId).status, 'UPDATE_CHECKED');
    assert.throws(() => store.transition(job.jobId, 'CONVERTED'), /Cannot transition/);
    assert.equal(store.list()[0].jobId, job.jobId);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('JobStore never accepts an invalid source nid', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-input-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    assert.throws(() => store.create({ sourceNid: 0 }), /sourceNid must be a positive integer/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('classified issue states can enter only the dedicated diagnostic-save state', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-diagnostic-save-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    for (const issueStatus of ['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW']) {
      let job = store.create({ sourceNid: 123, mode: 'platform' });
      for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED', 'SOURCE_LOADED', 'CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', issueStatus]) {
        job = store.transition(job.jobId, status);
      }
      assert.throws(() => store.transition(job.jobId, 'READY_TO_SAVE'), /Cannot transition/);
      job = store.transition(job.jobId, 'READY_TO_SAVE_DIAGNOSTIC_COPY');
      assert.equal(job.status, 'READY_TO_SAVE_DIAGNOSTIC_COPY');
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('JobStore reclaims a dead-process operation lease but not a live lease', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-lock-'));
  try {
    const paths = createAppPaths(path.join(temporary, 'home'));
    const jobs = new JobStore(paths);
    const job = jobs.create({ sourceNid: 123 });
    const lockPath = path.join(paths.locks, `${job.jobId}.save-as.lock`);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, operation: 'save-as' }), { mode: 0o600 });
    assert.equal(await jobs.withOperationLease(job.jobId, 'save-as', async () => 'recovered'), 'recovered');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, operation: 'save-as' }), { mode: 0o600 });
    await assert.rejects(
      Promise.resolve().then(() => jobs.withOperationLease(job.jobId, 'save-as', async () => 'not-run')),
      { code: 'JOB_OPERATION_LOCKED' },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
