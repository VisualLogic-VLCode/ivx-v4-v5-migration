import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('packed Workflow contains its locked Playwright runtime without registry fallback', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runtime-bundle-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packed = spawnSync(npm, ['pack', '--json', '--pack-destination', temporary], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const tarball = path.join(temporary, JSON.parse(packed.stdout)[0].filename);
    const prefix = path.join(temporary, 'install');
    const installed = spawnSync(npm, [
      'install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
      '--cache', path.join(temporary, 'empty-cache'), '--prefix', prefix, tarball,
    ], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    const entry = path.join(prefix, 'node_modules', '@visuallogic-vlcode', 'ivx-v4-v5-migration', 'src', 'index.js');
    const runtime = await import(pathToFileURL(entry).href);
    const status = await new runtime.PlaywrightRuntimeDriver().status();
    assert.equal(status.driver, 'playwright');
    assert.equal(status.driverVersion, '1.62.1');
    assert.equal(typeof status.browserInstalled, 'boolean');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
