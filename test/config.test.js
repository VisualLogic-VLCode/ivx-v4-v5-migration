import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, saveConfig } from '../src/config.js';
import { createAppPaths } from '../src/paths.js';

test('config rejects persisted tokens and keeps secret values out of defaults', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-config-'));
  try {
    const paths = createAppPaths(temporary);
    const config = loadConfig(paths);
    assert.equal(config.platform.tokenFile, null);
    assert.equal(config.platform.tokenEnv, 'IVX_MIGRATION_TOKEN');
    assert.equal(config.releaseManifests.workflow, null);
    assert.equal(config.releaseManifests.converter, null);
    assert.equal(config.update.agentPolicy, 'prompt');
    assert.equal(Object.hasOwn(config.platform, 'token'), false);
    assert.throws(() => saveConfig({ ...config, platform: { ...config.platform, token: 'secret' } }, paths), /must not be stored/);
    assert.throws(() => saveConfig({ ...config, platform: { ...config.platform, tokenFile: './relative.token' } }, paths), /absolute path/);
    assert.doesNotThrow(() => saveConfig({ ...config, platform: { ...config.platform, tokenFile: path.join(temporary, 'platform.token') } }, paths));
    assert.throws(() => saveConfig({ ...config, update: { ...config.update, agentPolicy: 'sometimes' } }, paths), /agentPolicy/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
