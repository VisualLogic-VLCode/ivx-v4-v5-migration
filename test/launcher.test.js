import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('stable Launcher delegates normally and supports explicit non-downgrading update recovery', () => {
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
    workflow: { version: '0.3.8', packagePath: runtime },
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

    const promptSetup = spawnSync(process.execPath, [
      path.join(projectRoot, 'bin', 'ivx-migrate.js'),
      'setup',
      '--prompt-token',
      '--token-file',
      path.join(temporary, 'must-not-be-read.token'),
    ], {
      env: { ...process.env, IVX_MIGRATION_HOME: temporary },
      encoding: 'utf8',
    });
    assert.equal(promptSetup.status, 1);
    assert.equal(JSON.parse(promptSetup.stderr).code, 'CLI_ARGUMENT_CONFLICT');
    assert.equal(promptSetup.stdout, '');

    const unconfirmedRecovery = spawnSync(process.execPath, [
      path.join(projectRoot, 'bin', 'ivx-migrate.js'),
      'update', 'check', '--launcher-recovery', 'WRONG_CONFIRMATION',
    ], {
      env: { ...process.env, IVX_MIGRATION_HOME: temporary },
      encoding: 'utf8',
    });
    assert.equal(unconfirmedRecovery.status, 1);
    assert.equal(JSON.parse(unconfirmedRecovery.stderr).code, 'LAUNCHER_RECOVERY_CONFIRMATION_REQUIRED');

    const recovery = spawnSync(process.execPath, [
      path.join(projectRoot, 'bin', 'ivx-migrate.js'),
      'update', 'check', '--launcher-recovery', 'RECOVER_SIGNED_RUNTIME',
    ], {
      env: { ...process.env, IVX_MIGRATION_HOME: temporary },
      encoding: 'utf8',
    });
    assert.equal(recovery.status, 1);
    assert.equal(JSON.parse(recovery.stderr).code, 'RELEASE_MANIFEST_NOT_CONFIGURED');
    assert.equal(recovery.stdout.includes('delegated'), false);

    fs.writeFileSync(path.join(temporary, 'current.json'), JSON.stringify({
      schemaVersion: 1,
      workflow: { version: '9.9.9', packagePath: runtime },
      converter: null,
      history: [],
    }));
    const downgradeRecovery = spawnSync(process.execPath, [
      path.join(projectRoot, 'bin', 'ivx-migrate.js'),
      'update', 'check', '--launcher-recovery', 'RECOVER_SIGNED_RUNTIME',
    ], {
      env: { ...process.env, IVX_MIGRATION_HOME: temporary },
      encoding: 'utf8',
    });
    assert.equal(downgradeRecovery.status, 1);
    assert.equal(JSON.parse(downgradeRecovery.stderr).code, 'LAUNCHER_RECOVERY_DOWNGRADE_FORBIDDEN');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
