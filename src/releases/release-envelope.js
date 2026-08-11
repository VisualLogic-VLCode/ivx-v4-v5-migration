import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, invariant } from '../errors.js';
import { fetchBytes } from './http-fetch.js';

async function readLocation(location) {
  if (/^https:\/\//i.test(location)) {
    const bytes = await fetchBytes(location, {
      headers: { Accept: 'application/json' },
      errorCode: 'RELEASE_MANIFEST_FETCH_FAILED',
      label: 'Release manifest',
    });
    return { bytes, local: false };
  }
  if (/^file:\/\//i.test(location)) return { bytes: fs.readFileSync(fileURLToPath(location)), local: true };
  return { bytes: fs.readFileSync(path.resolve(location)), local: true };
}

function validateReleasePayload(payload) {
  invariant(payload?.schemaVersion === 1, 'INVALID_RELEASE_MANIFEST', 'Release payload schemaVersion must be 1');
  invariant(['workflow', 'converter'].includes(payload.kind), 'INVALID_RELEASE_MANIFEST', 'Release payload kind must be workflow or converter');
  invariant(typeof payload.channel === 'string' && payload.channel, 'INVALID_RELEASE_MANIFEST', 'Release channel is required');
  invariant(typeof payload.latest === 'string' && payload.latest, 'INVALID_RELEASE_MANIFEST', 'Release latest version is required');
  invariant(payload.versions && typeof payload.versions === 'object', 'INVALID_RELEASE_MANIFEST', 'Release versions map is required');
  invariant(payload.versions[payload.latest], 'INVALID_RELEASE_MANIFEST', 'Latest release descriptor is missing');
  return payload;
}

export async function loadReleaseEnvelope(location, {
  publicKeyPem,
  allowUnsignedLocal = false,
} = {}) {
  invariant(location, 'RELEASE_MANIFEST_NOT_CONFIGURED', 'Release manifest location is not configured');
  const { bytes, local } = await readLocation(location);
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new WorkflowError('INVALID_RELEASE_MANIFEST', 'Release manifest is not valid JSON', { error: error.message });
  }

  if (typeof envelope.payload === 'string' && envelope.signature?.value) {
    invariant(envelope.signature.algorithm === 'ed25519', 'RELEASE_SIGNATURE_INVALID', 'Release manifest signature algorithm must be ed25519');
    invariant(publicKeyPem, 'RELEASE_PUBLIC_KEY_REQUIRED', 'A public key is required to verify the release manifest');
    const payloadBytes = Buffer.from(envelope.payload, 'base64');
    const signature = Buffer.from(envelope.signature.value, 'base64');
    const verified = crypto.verify(null, payloadBytes, publicKeyPem, signature);
    invariant(verified, 'RELEASE_SIGNATURE_INVALID', 'Release manifest signature is invalid');
    return {
      signed: true,
      payload: validateReleasePayload(JSON.parse(payloadBytes.toString('utf8'))),
    };
  }

  invariant(local && allowUnsignedLocal, 'UNSIGNED_RELEASE_MANIFEST_FORBIDDEN', 'Unsigned release manifests are only allowed for explicit local development');
  return { signed: false, payload: validateReleasePayload(envelope) };
}

export function createSignedReleaseEnvelope(payload, privateKeyPem) {
  const payloadBytes = Buffer.from(JSON.stringify(validateReleasePayload(payload)), 'utf8');
  const signature = crypto.sign(null, payloadBytes, privateKeyPem);
  return {
    schemaVersion: 1,
    payload: payloadBytes.toString('base64'),
    signature: {
      algorithm: 'ed25519',
      value: signature.toString('base64'),
    },
  };
}
