import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { PlaywrightRuntimeDriver } from '../src/runtime/playwright-driver.js';
import { MACOS_RUNTIME_TAKEOVER_SCRIPT, waitForVisibleRuntimeTakeover } from '../src/runtime/visible-takeover.js';

test('native macOS runtime takeover dialog script compiles without opening the dialog', { skip: process.platform !== 'darwin' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runtime-dialog-'));
  try {
    const output = path.join(temporary, 'takeover.scpt');
    const result = spawnSync('/usr/bin/osacompile', ['-o', output, '-e', MACOS_RUNTIME_TAKEOVER_SCRIPT], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.statSync(output).isFile(), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('visible takeover is explicit and cancellation fails closed', () => {
  assert.deepEqual(waitForVisibleRuntimeTakeover({ platform: 'darwin', runProcess: () => ({ status: 0, stdout: '', stderr: '' }) }), { completed: true });
  assert.throws(() => waitForVisibleRuntimeTakeover({
    platform: 'darwin',
    runProcess: () => ({ status: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' }),
  }), { code: 'RUNTIME_VISIBLE_TAKEOVER_CANCELLED' });
  assert.throws(() => waitForVisibleRuntimeTakeover({ platform: 'linux', runProcess: () => { throw new Error('must not run'); } }), { code: 'RUNTIME_VISIBLE_TAKEOVER_UNAVAILABLE' });
});

test('browser installer invokes the locked package CLI without relying on an unexported subpath', () => {
  const calls = [];
  const driver = new PlaywrightRuntimeDriver({
    runProcess(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(driver.installBrowser(), { driverVersion: '1.62.1', browserEngine: 'chromium', installed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0].endsWith('/node_modules/playwright/cli.js'), true);
  assert.deepEqual(calls[0].args.slice(1), ['install', 'chromium']);
});

test('browser authentication capture persists private storage state without returning its contents', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runtime-auth-state-'));
  const appPaths = createAppPaths(path.join(temporary, 'home'));
  const privateCookie = 'private-cookie-value';
  let takeoverCount = 0;
  const context = {
    pages: () => [],
    newPage: async () => ({ goto: async () => {} }),
    storageState: async () => ({ cookies: [{ name: 'session', value: privateCookie, domain: 'example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }),
    close: async () => {},
  };
  const playwright = { chromium: { launchPersistentContext: async () => context, executablePath: () => '/fake/chromium' } };
  try {
    const driver = new PlaywrightRuntimeDriver({
      playwright,
      appPaths,
      onTakeover: async () => { takeoverCount += 1; },
    });
    const result = await driver.captureAuthentication({ url: 'https://example.test/' });
    const statePath = path.join(appPaths.browserAuth, 'storage-state.json');
    assert.deepEqual(result, { authState: 'AVAILABLE', origin: 'https://example.test' });
    assert.equal(JSON.stringify(result).includes(privateCookie), false);
    assert.equal(fs.readFileSync(statePath, 'utf8').includes(privateCookie), true);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(statePath)).mode & 0o777, 0o700);
    assert.equal(takeoverCount, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
