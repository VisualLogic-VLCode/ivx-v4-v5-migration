import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectPlatformToken,
  MAX_TOKEN_FILE_BYTES,
  readPlatformTokenFile,
  resolvePlatformToken,
} from '../src/platform/token-source.js';

function writeToken(file, value, mode = 0o600) {
  fs.writeFileSync(file, value, { mode });
  fs.chmodSync(file, mode);
  return file;
}

test('token files are selected before environment variables without exposing their contents', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-token-source-'));
  const configured = writeToken(path.join(temporary, 'configured.token'), 'configured-secret\n');
  const explicit = writeToken(path.join(temporary, 'explicit.token'), 'explicit-secret');
  try {
    const fromConfigured = resolvePlatformToken({
      platform: { tokenFile: configured, tokenEnv: 'TEST_TOKEN' },
      env: { TEST_TOKEN: 'environment-secret' },
    });
    assert.equal(fromConfigured.token, 'configured-secret');
    assert.equal(fromConfigured.source, 'file');
    assert.equal(fromConfigured.tokenFile, configured);

    const fromExplicit = resolvePlatformToken({
      explicitTokenFile: explicit,
      platform: { tokenFile: configured, tokenEnv: 'TEST_TOKEN' },
      env: { TEST_TOKEN: 'environment-secret' },
    });
    assert.equal(fromExplicit.token, 'explicit-secret');
    assert.equal(fromExplicit.tokenFile, explicit);

    const status = inspectPlatformToken({
      platform: { tokenFile: configured, tokenEnv: 'TEST_TOKEN' },
      env: { TEST_TOKEN: 'environment-secret' },
    });
    assert.deepEqual(status, {
      available: true,
      source: 'file',
      tokenFile: configured,
      tokenEnv: 'TEST_TOKEN',
      error: null,
    });
    assert.equal(JSON.stringify(status).includes('configured-secret'), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('environment remains the fallback when no token file is selected', () => {
  const resolved = resolvePlatformToken({
    platform: { tokenFile: null, tokenEnv: 'TEST_TOKEN' },
    env: { TEST_TOKEN: ' environment-secret ' },
  });
  assert.deepEqual(resolved, {
    token: 'environment-secret',
    source: 'environment',
    tokenFile: null,
    tokenEnv: 'TEST_TOKEN',
  });
  const missing = inspectPlatformToken({
    platform: { tokenFile: null, tokenEnv: 'TEST_TOKEN' },
    env: {},
  });
  assert.equal(missing.available, false);
  assert.equal(missing.source, 'environment');
  assert.equal(missing.error.code, 'PLATFORM_TOKEN_REQUIRED');
});

test('token files reject unsafe metadata and malformed contents without falling back', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-token-invalid-'));
  const insecure = writeToken(path.join(temporary, 'insecure.token'), 'secret', 0o644);
  const multiline = writeToken(path.join(temporary, 'multiline.token'), 'first\nsecond\n');
  const oversized = writeToken(path.join(temporary, 'oversized.token'), 'x'.repeat(MAX_TOKEN_FILE_BYTES + 1));
  const valid = writeToken(path.join(temporary, 'valid.token'), 'valid-secret');
  const symlink = path.join(temporary, 'linked.token');
  fs.symlinkSync(valid, symlink);
  try {
    assert.throws(() => readPlatformTokenFile(insecure), { code: 'TOKEN_FILE_PERMISSIONS_INVALID' });
    assert.throws(() => readPlatformTokenFile(multiline), { code: 'TOKEN_FILE_CONTENT_INVALID' });
    assert.throws(() => readPlatformTokenFile(oversized), { code: 'TOKEN_FILE_SIZE_INVALID' });
    assert.throws(() => readPlatformTokenFile(symlink), { code: 'TOKEN_FILE_SYMLINK_FORBIDDEN' });
    assert.throws(() => readPlatformTokenFile(path.join(temporary, 'missing.token')), { code: 'TOKEN_FILE_NOT_FOUND' });

    const status = inspectPlatformToken({
      platform: { tokenFile: insecure, tokenEnv: 'TEST_TOKEN' },
      env: { TEST_TOKEN: 'must-not-be-used' },
    });
    assert.equal(status.available, false);
    assert.equal(status.source, 'file');
    assert.equal(status.error.code, 'TOKEN_FILE_PERMISSIONS_INVALID');
    assert.equal(JSON.stringify(status).includes('must-not-be-used'), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
