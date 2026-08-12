import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { MAX_TOKEN_FILE_BYTES } from '../src/platform/token-source.js';
import { MACOS_TOKEN_DIALOG_SCRIPT, promptAndPersistPlatformToken } from '../src/platform/visible-token-prompt.js';

function nativeResult(stdout, overrides = {}) {
  return { status: 0, stdout, stderr: '', ...overrides };
}

test('native macOS hidden-answer dialog script compiles without opening the dialog', {
  skip: process.platform !== 'darwin',
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-visible-token-compile-'));
  const output = path.join(temporary, 'prompt.scpt');
  try {
    const result = spawnSync('/usr/bin/osacompile', ['-o', output, '-e', MACOS_TOKEN_DIALOG_SCRIPT], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.statSync(output).isFile(), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('visible prompt stores a validated Token atomically in the managed private path', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-visible-token-'));
  const appPaths = createAppPaths(path.join(temporary, 'home'));
  const calls = [];
  const firstToken = 'first-local-test-token';
  const secondToken = 'replacement-local-test-token';
  try {
    const first = promptAndPersistPlatformToken({
      appPaths,
      platform: 'darwin',
      runProcess(command, args, options) {
        calls.push({ command, args, options });
        return nativeResult(`${firstToken}\n`);
      },
    });
    const expected = path.join(appPaths.home, 'secrets', 'platform-token');
    assert.deepEqual(first, { tokenFile: expected });
    assert.equal(fs.readFileSync(expected, 'utf8'), `${firstToken}\n`);
    assert.equal(fs.statSync(expected).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(expected)).mode & 0o777, 0o700);
    assert.equal(JSON.stringify(first).includes(firstToken), false);
    assert.equal(calls[0].command, '/usr/bin/osascript');
    assert.deepEqual(calls[0].args.slice(0, 1), ['-e']);
    assert.equal(JSON.stringify(calls[0]).includes(firstToken), false);
    assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);

    const replaced = promptAndPersistPlatformToken({
      appPaths,
      platform: 'darwin',
      runProcess: () => nativeResult(`${secondToken}\n`),
    });
    assert.deepEqual(replaced, { tokenFile: expected });
    assert.equal(fs.readFileSync(expected, 'utf8'), `${secondToken}\n`);
    assert.equal(fs.readdirSync(path.dirname(expected)).sort().join(','), 'platform-token');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('visible prompt cancellation and unavailable UI fail closed without creating a Token file', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-visible-token-failure-'));
  const appPaths = createAppPaths(path.join(temporary, 'home'));
  const tokenFile = path.join(appPaths.home, 'secrets', 'platform-token');
  try {
    assert.throws(() => promptAndPersistPlatformToken({
      appPaths,
      platform: 'darwin',
      runProcess: () => nativeResult('', { status: 1, stderr: 'execution error: User canceled. (-128)' }),
    }), { code: 'TOKEN_PROMPT_CANCELLED' });
    assert.equal(fs.existsSync(tokenFile), false);

    const privateChildMessage = 'private-child-error-must-not-escape';
    assert.throws(() => promptAndPersistPlatformToken({
      appPaths,
      platform: 'darwin',
      runProcess: () => nativeResult('', { status: 1, stderr: privateChildMessage }),
    }), (error) => {
      assert.equal(error.code, 'VISIBLE_TOKEN_PROMPT_UNAVAILABLE');
      assert.equal(JSON.stringify(error).includes(privateChildMessage), false);
      return true;
    });
    assert.equal(fs.existsSync(tokenFile), false);

    assert.throws(() => promptAndPersistPlatformToken({
      appPaths,
      platform: 'linux',
      runProcess: () => {
        throw new Error('must not run');
      },
    }), { code: 'VISIBLE_TOKEN_PROMPT_UNAVAILABLE' });
    assert.equal(fs.existsSync(tokenFile), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('visible prompt rejects empty, whitespace, NUL, and oversized input before persistence', () => {
  const invalidValues = ['', 'two values\n', 'nul\0value\n', `${'x'.repeat(MAX_TOKEN_FILE_BYTES)}\n`];
  for (const [index, value] of invalidValues.entries()) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `ivx-visible-token-invalid-${index}-`));
    const appPaths = createAppPaths(path.join(temporary, 'home'));
    const tokenFile = path.join(appPaths.home, 'secrets', 'platform-token');
    try {
      assert.throws(() => promptAndPersistPlatformToken({
        appPaths,
        platform: 'darwin',
        runProcess: () => nativeResult(value),
      }), { code: 'TOKEN_PROMPT_CONTENT_INVALID' });
      assert.equal(fs.existsSync(tokenFile), false);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test('visible prompt leaves no secret-bearing temporary file when atomic replacement fails', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-visible-token-write-failure-'));
  const appPaths = createAppPaths(path.join(temporary, 'home'));
  const secretDir = path.join(appPaths.home, 'secrets');
  const tokenTarget = path.join(secretDir, 'platform-token');
  try {
    fs.mkdirSync(tokenTarget, { recursive: true, mode: 0o700 });
    assert.throws(() => promptAndPersistPlatformToken({
      appPaths,
      platform: 'darwin',
      runProcess: () => nativeResult('must-not-remain-in-temp\n'),
    }));
    assert.deepEqual(fs.readdirSync(secretDir), ['platform-token']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
