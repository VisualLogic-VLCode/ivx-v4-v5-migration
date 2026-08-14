import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve(import.meta.dirname, '..', 'bin', 'ivx-migrate.js');

function run(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  const payload = JSON.parse(result.stdout || result.stderr);
  return { result, payload };
}

test('CLI persists explicit Additional V5 intent and rejects retry-like ambiguity', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-additional-v5-cli-'));
  try {
    const ordinary = run(temporary, ['job', 'create', '--nid', '123']);
    assert.equal(ordinary.result.status, 0);
    assert.equal(ordinary.payload.result.input.intent, 'CREATE_V5');

    const additional = run(temporary, [
      'job', 'create', '--nid', '123',
      '--intent', 'create-additional-v5',
      '--related-job', ordinary.payload.result.jobId,
    ]);
    assert.equal(additional.result.status, 0);
    assert.equal(additional.payload.result.input.intent, 'CREATE_ADDITIONAL_V5');
    assert.deepEqual(additional.payload.result.input.relatedPriorJobIds, [ordinary.payload.result.jobId]);
    assert.notEqual(additional.payload.result.jobId, ordinary.payload.result.jobId);

    const ambiguous = run(temporary, [
      'job', 'create', '--nid', '123',
      '--related-job', ordinary.payload.result.jobId,
    ]);
    assert.notEqual(ambiguous.result.status, 0);
    assert.equal(ambiguous.payload.code, 'INVALID_MIGRATION_INTENT');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
