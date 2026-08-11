import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('stable Launcher delegates to the activated managed Workflow runtime', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-launcher-'));
  const runtime = path.join(temporary, 'workflows', '9.9.9');
  fs.mkdirSync(path.join(runtime, 'src'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(runtime, 'src', 'cli.js'), `
    export async function runCli(argv) {
      process.stdout.write(JSON.stringify({ delegated: true, argv }) + '\\n');
      return 0;
    }
  `);
  fs.writeFileSync(path.join(temporary, 'current.json'), JSON.stringify({
    schemaVersion: 1,
    workflow: { version: '9.9.9', packagePath: runtime },
    converter: null,
    history: [],
  }));
  try {
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin', 'ivx-migrate.js'), 'version'], {
      env: { ...process.env, IVX_MIGRATION_HOME: temporary },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { delegated: true, argv: ['version'] });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
