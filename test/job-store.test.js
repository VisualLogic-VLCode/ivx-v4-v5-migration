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
