import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { MIGRATION_INTENTS } from '../src/jobs/intents.js';

test('JobStore persists private state and enforces transitions', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-store-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    const job = store.create({ sourceNid: 123, gid: 9, workflowRuntime: { version: '1.0.0' } });
    assert.equal(job.status, 'RECEIVED');
    assert.equal(job.input.intent, MIGRATION_INTENTS.CREATE_V5);
    assert.deepEqual(job.input.relatedPriorJobIds, []);
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

test('JobStore persists an explicit Additional V5 intent without changing ordinary defaults', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-job-additional-v5-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    const prior = store.create({ sourceNid: 123 });
    const additional = store.create({
      sourceNid: 123,
      intent: MIGRATION_INTENTS.CREATE_ADDITIONAL_V5,
      relatedPriorJobIds: [prior.jobId],
    });
    assert.equal(additional.input.intent, MIGRATION_INTENTS.CREATE_ADDITIONAL_V5);
    assert.deepEqual(additional.input.relatedPriorJobIds, [prior.jobId]);
    assert.equal(store.list()[0].intent, MIGRATION_INTENTS.CREATE_ADDITIONAL_V5);
    assert.throws(() => store.create({ sourceNid: 123, intent: 'RETRY' }), { code: 'INVALID_MIGRATION_INTENT' });
    assert.throws(() => store.create({ sourceNid: 123, relatedPriorJobIds: ['not-a-job'] }), { code: 'INVALID_MIGRATION_INTENT' });
    assert.throws(
      () => store.create({ sourceNid: 123, relatedPriorJobIds: [prior.jobId] }),
      { code: 'INVALID_MIGRATION_INTENT' },
    );
    const unrelated = store.create({ sourceNid: 456 });
    assert.throws(
      () => store.create({ sourceNid: 123, intent: MIGRATION_INTENTS.CREATE_ADDITIONAL_V5, relatedPriorJobIds: [unrelated.jobId] }),
      { code: 'RELATED_JOB_SOURCE_MISMATCH' },
    );
    const differentGroup = store.create({ sourceNid: 123, gid: 9 });
    assert.throws(
      () => store.create({ sourceNid: 123, intent: MIGRATION_INTENTS.CREATE_ADDITIONAL_V5, relatedPriorJobIds: [differentGroup.jobId] }),
      { code: 'RELATED_JOB_SOURCE_MISMATCH' },
    );
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
