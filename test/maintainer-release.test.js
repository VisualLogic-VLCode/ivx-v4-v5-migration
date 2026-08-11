import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRelease } from '../scripts/prepare-release.mjs';
import { publishRelease } from '../scripts/publish-release.mjs';
import { loadReleaseEnvelope } from '../src/releases/release-envelope.js';

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
