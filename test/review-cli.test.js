import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');

function runCli(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  job = jobs.transition(job.jobId, 'UPDATE_CHECKED');
  job = jobs.transition(job.jobId, 'AUTHORIZED');
  job = jobs.transition(job.jobId, 'VERSION_CLASSIFIED');
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  job = jobs.transition(job.jobId, 'CONVERTED');
  job = jobs.transition(job.jobId, 'VALIDATED');
  job = jobs.transition(job.jobId, 'ISSUES_CLASSIFIED');
  job = jobs.transition(job.jobId, 'READY_TO_SAVE');
  job = jobs.transition(job.jobId, 'SAVE_AS_CREATED');
  job = jobs.transition(job.jobId, 'FINAL_SAVED');
  job = jobs.transition(job.jobId, 'POST_SAVE_VERIFIED');
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
}

test('review CLI creates and recovers a local session across independent processes', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-review-cli-'));
  try {
    const paths = createAppPaths(temporary);
    const job = createCompletedJob(new JobStore(paths));
    const runtimeFile = path.join(temporary, 'runtime-pins.json');
    const targetFile = path.join(temporary, 'target-readback.json');
    fs.writeFileSync(runtimeFile, JSON.stringify({
      workflow: { version: '0.4.0', sha256: 'a'.repeat(64) },
      converter: { version: '1.2.1', sha256: 'b'.repeat(64) },
      knowledge: { version: '0.1.0', sha256: 'c'.repeat(64), contentSha256: 'd'.repeat(64), schemaVersion: 1, ruleIds: [] },
    }));
    fs.writeFileSync(targetFile, JSON.stringify({ case: { nid: 200, value: 'baseline' } }));

    const created = runCli(temporary, [
      'review', 'create', '--job', job.jobId, '--capability', 'WRITE',
      '--runtime-file', runtimeFile, '--target-file', targetFile,
    ]);
    assert.equal(created.status, 'REVIEW_OPEN');
    assert.equal(created.capability, 'WRITE');

    const recovered = runCli(temporary, ['review', 'recover', '--review', created.reviewId]);
    assert.equal(recovered.review.reviewId, created.reviewId);
    assert.equal(recovered.review.jobId, job.jobId);
    assert.equal(recovered.resumable, true);

    const listed = runCli(temporary, ['review', 'list', '--job', job.jobId]);
    assert.equal(listed.reviews.length, 1);
    assert.equal(listed.reviews[0].reviewId, created.reviewId);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
