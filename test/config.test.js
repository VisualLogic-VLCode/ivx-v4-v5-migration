import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adoptPublicKnowledgeProfile, loadConfig, saveConfig } from '../src/config.js';
import { PUBLIC_RELEASE_PROFILE } from '../src/distribution-profile.js';
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
    assert.equal(config.releaseManifests.knowledge, null);
    assert.equal(config.releasePublicKeys.knowledge, null);
    assert.equal(config.update.knowledgePolicy, 'prompt');
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

test('existing managed public configurations adopt the independent Knowledge channel exactly once', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-config-knowledge-profile-'));
  try {
    const paths = createAppPaths(temporary);
    const base = loadConfig(paths);
    const managed = saveConfig({
      ...base,
      releaseManifests: {
        workflow: PUBLIC_RELEASE_PROFILE.manifests.workflow,
        converter: PUBLIC_RELEASE_PROFILE.manifests.converter,
        knowledge: null,
      },
      releasePublicKeyPem: PUBLIC_RELEASE_PROFILE.publicKeyPem,
    }, paths);
    const adopted = adoptPublicKnowledgeProfile(managed, PUBLIC_RELEASE_PROFILE, paths);
    assert.equal(adopted.releaseManifests.knowledge, PUBLIC_RELEASE_PROFILE.manifests.knowledge);
    assert.equal(adopted.releasePublicKeys.knowledge, PUBLIC_RELEASE_PROFILE.publicKeys.knowledge);
    assert.deepEqual(adoptPublicKnowledgeProfile(adopted, PUBLIC_RELEASE_PROFILE, paths), adopted);
    const custom = { ...base, releaseManifests: { ...base.releaseManifests, workflow: '/local/workflow.json', converter: '/local/converter.json' } };
    assert.equal(adoptPublicKnowledgeProfile(custom, PUBLIC_RELEASE_PROFILE, paths).releaseManifests.knowledge, null);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
