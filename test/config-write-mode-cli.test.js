import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');

function run(home, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
}

test('CLI write-mode gate requires explicit confirmation and can always be closed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-write-mode-cli-'));
  try {
    const rejected = run(temporary, ['config', 'write-mode', '--mode', 'explicit']);
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).code, 'LIVE_WRITE_CONFIRMATION_REQUIRED');
    const opened = run(temporary, ['config', 'write-mode', '--mode', 'explicit', '--confirm', 'ENABLE_LIVE_WRITES']);
    assert.equal(opened.status, 0, opened.stderr || opened.stdout);
    assert.equal(JSON.parse(opened.stdout).result.writeMode, 'explicit');
    const closed = run(temporary, ['config', 'write-mode', '--mode', 'disabled']);
    assert.equal(closed.status, 0, closed.stderr || closed.stdout);
    assert.equal(JSON.parse(closed.stdout).result.writeMode, 'disabled');
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'config.json'), 'utf8')).platform.writeMode, 'disabled');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
