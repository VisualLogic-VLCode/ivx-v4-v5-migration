import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { performUpdatePreflight } from '../src/releases/update-preflight.js';
import { RuntimeRegistry } from '../src/releases/runtime-registry.js';
import { createAppPaths } from '../src/paths.js';

function manifest(file, revoked = []) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    kind: 'converter',
    channel: 'stable',
    latest: '1.1.0',
    minimumSupported: '1.0.0',
    revoked,
    versions: {
      '1.1.0': {
        packageName: '@test/converter',
        artifact: { url: 'file:///not-downloaded.tgz', sha256: 'a'.repeat(64) },
      },
    },
  }));
}

function context(temporary, manifestPath) {
  const paths = createAppPaths(path.join(temporary, 'home'));
  return {
    config: {
      releaseManifests: { workflow: null, converter: manifestPath },
      releasePublicKeyPem: null,
      allowUnsignedLocalManifests: true,
      update: { channel: 'stable', workflowPolicy: 'prompt', converterPolicy: 'prompt' },
    },
    registry: new RuntimeRegistry(paths),
    installer: { install: async () => assert.fail('prompt policy must not install') },
  };
}

test('new Job preflight prompts for a newer unrevoked converter', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-update-preflight-'));
  try {
    const file = path.join(temporary, 'converter.json');
    manifest(file);
    const value = context(temporary, file);
    await assert.rejects(
      performUpdatePreflight({ ...value, workflowVersion: '0.1.0', converterVersion: '1.0.0' }),
      (error) => error.code === 'RUNTIME_UPDATE_AVAILABLE',
    );
    const continued = await performUpdatePreflight({
      ...value,
      workflowVersion: '0.1.0',
      converterVersion: '1.0.0',
      allowCurrent: true,
    });
    assert.equal(continued.checks.converter.status, 'UPDATE_AVAILABLE');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('revoked converter cannot bypass update with use-current', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-update-revoked-'));
  try {
    const file = path.join(temporary, 'converter.json');
    manifest(file, ['1.0.0']);
    const value = context(temporary, file);
    await assert.rejects(
      performUpdatePreflight({
        ...value,
        workflowVersion: '0.1.0',
        converterVersion: '1.0.0',
        allowCurrent: true,
      }),
      (error) => error.code === 'RUNTIME_UPDATE_REQUIRED',
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
