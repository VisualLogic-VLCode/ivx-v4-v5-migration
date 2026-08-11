import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createSignedReleaseEnvelope, loadReleaseEnvelope } from '../src/releases/release-envelope.js';
import { evaluateRelease } from '../src/releases/release-policy.js';

function payload() {
  return {
    schemaVersion: 1,
    kind: 'converter',
    channel: 'stable',
    latest: '2.8.2',
    minimumSupported: '2.7.0',
    revoked: ['2.8.0'],
    versions: {
      '2.8.2': {
        packageName: '@ivx/converter',
        compatibleWorkflow: '>=1.0.0 <2.0.0',
        artifact: { url: 'https://example.invalid/converter.tgz', sha256: 'a'.repeat(64) },
      },
    },
  };
}

test('signed release envelope verifies exact payload bytes', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const envelope = createSignedReleaseEnvelope(payload(), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-release-'));
  const file = path.join(temporary, 'stable.json');
  try {
    fs.writeFileSync(file, JSON.stringify(envelope));
    const result = await loadReleaseEnvelope(file, { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) });
    assert.equal(result.signed, true);
    assert.equal(result.payload.latest, '2.8.2');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('release policy distinguishes updates and revoked runtimes', () => {
  assert.equal(evaluateRelease({ payload: payload(), currentVersion: '2.8.1', workflowVersion: '1.2.0' }).status, 'UPDATE_AVAILABLE');
  assert.equal(evaluateRelease({ payload: payload(), currentVersion: '2.8.0', workflowVersion: '1.2.0' }).status, 'CURRENT_REVOKED');
});

test('maintainer CLI signs a release payload without exposing the private key', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-release-sign-'));
  const payloadFile = path.join(temporary, 'payload.json');
  const privateKeyFile = path.join(temporary, 'private.pem');
  const outputFile = path.join(temporary, 'stable.json');
  const appHome = path.join(temporary, 'home');
  try {
    fs.writeFileSync(payloadFile, JSON.stringify(payload()));
    fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const cli = path.resolve(import.meta.dirname, '..', 'bin', 'ivx-migrate.js');
    const result = spawnSync(process.execPath, [
      cli,
      'release', 'sign',
      '--payload', payloadFile,
      '--private-key', privateKeyFile,
      '--output', outputFile,
    ], {
      env: { ...process.env, IVX_MIGRATION_HOME: appHome },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.result.latest, '2.8.2');
    assert.equal(fs.statSync(outputFile).mode & 0o777, 0o600);
    const outputText = fs.readFileSync(outputFile, 'utf8');
    assert.equal(outputText.includes('PRIVATE KEY'), false);
    const verified = await loadReleaseEnvelope(outputFile, {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    });
    assert.equal(verified.payload.latest, '2.8.2');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
