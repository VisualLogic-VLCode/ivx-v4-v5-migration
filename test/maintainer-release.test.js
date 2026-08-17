import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRelease } from '../scripts/prepare-release.mjs';
import { publishRelease, validateRepositoryReleaseHardening } from '../scripts/publish-release.mjs';
import { loadReleaseEnvelope } from '../src/releases/release-envelope.js';

const protectedRulesets = [
  {
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/release-channel'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    bypass_actors: [],
  },
  {
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    bypass_actors: [],
  },
];

test('release hardening requires immutable releases and protected channel/tag history', () => {
  assert.doesNotThrow(() => validateRepositoryReleaseHardening({
    immutableReleases: { enabled: true },
    rulesets: protectedRulesets,
  }));
  assert.throws(() => validateRepositoryReleaseHardening({
    immutableReleases: { enabled: false },
    rulesets: protectedRulesets,
  }), /immutable Releases/);
  assert.throws(() => validateRepositoryReleaseHardening({
    immutableReleases: { enabled: true },
    rulesets: protectedRulesets.map((ruleset) => ({ ...ruleset, bypass_actors: [{ id: 1 }] })),
  }), /without bypass actors/);
});

test('maintainer preparation builds, hashes, signs, and plans a GitHub Release without publishing it', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-maintainer-release-'));
  const packageDir = path.join(temporary, 'converter');
  const output = path.join(temporary, 'output');
  const privateKeyFile = path.join(temporary, 'private.pem');
  fs.mkdirSync(packageDir);
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@test/converter',
    version: '1.2.3',
    type: 'module',
    files: ['index.js'],
  }));
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'export const version = "1.2.3";\n');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  try {
    const prepared = prepareRelease({
      kind: 'converter',
      'package-dir': packageDir,
      output,
      repo: 'test-owner/test-converter',
      'private-key': privateKeyFile,
      'compatible-workflow': '>=0.3.1 <1.0.0',
    });
    assert.equal(prepared.version, '1.2.3');
    assert.equal(prepared.artifact.name, 'tov5parser-1.2.3.tgz');
    assert.equal(fs.existsSync(prepared.artifact.file), true);
    assert.match(prepared.artifact.url, /releases\/download\/v1\.2\.3/);
    const verified = await loadReleaseEnvelope(prepared.manifest.file, {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    });
    assert.equal(verified.payload.latest, '1.2.3');
    assert.equal(verified.payload.versions['1.2.3'].artifact.sha256, prepared.artifact.sha256);
    assert.equal(fs.readFileSync(prepared.manifest.file, 'utf8').includes('PRIVATE KEY'), false);
    await assert.rejects(
      publishRelease({ plan: prepared.planFile }),
      /requires --confirm PUBLISH_STABLE_RELEASE/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Workflow release descriptor advertises Agent Direct read-only testing under Agent protocol 9', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-workflow-release-'));
  const packageDir = path.join(temporary, 'workflow');
  const output = path.join(temporary, 'output');
  const privateKeyFile = path.join(temporary, 'private.pem');
  fs.mkdirSync(packageDir);
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@test/workflow',
    version: '0.8.3',
    type: 'module',
    files: ['index.js'],
  }));
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'export const version = "0.8.3";\n');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  try {
    const prepared = prepareRelease({
      kind: 'workflow',
      'package-dir': packageDir,
      output,
      repo: 'test-owner/test-workflow',
      'private-key': privateKeyFile,
      'compatible-converter': '>=1.2.0 <2.0.0',
    });
    const verified = await loadReleaseEnvelope(prepared.manifest.file, {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    });
    const descriptor = verified.payload.versions['0.8.3'];
    assert.equal(descriptor.agentProtocolVersion, 9);
    assert.equal(descriptor.compatibleConverter, '>=1.2.0 <2.0.0');
    assert.equal(descriptor.capabilities.autonomousReadOnlyExploration, true);
    assert.equal(descriptor.capabilities.agentDirectReadOnlyTest, true);
    assert.equal(descriptor.capabilities.agentDirectUserSuppliedEphemeralCredential, true);
    assert.equal(descriptor.capabilities.agentDirectSideEffectTest, false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
