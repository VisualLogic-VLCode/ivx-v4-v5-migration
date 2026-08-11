import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBytes } from '../src/releases/http-fetch.js';

test('remote bytes retry transient network failures and eventually succeed', async () => {
  let calls = 0;
  const bytes = await fetchBytes('https://example.test/runtime.tgz?temporary=secret', {
    attempts: 3,
    timeoutMs: 100,
    retryDelaysMs: [0, 0],
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('fetch failed');
        error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
        throw error;
      }
      return new Response('runtime-bytes', { status: 200 });
    },
  });
  assert.equal(bytes.toString('utf8'), 'runtime-bytes');
  assert.equal(calls, 3);
});

test('remote failure is structured and redacts URL query values', async () => {
  await assert.rejects(
    fetchBytes('https://example.test/stable.json?signature=secret', {
      attempts: 2,
      timeoutMs: 100,
      retryDelaysMs: [0],
      errorCode: 'RELEASE_MANIFEST_FETCH_FAILED',
      label: 'Release manifest',
      fetchImpl: async () => {
        const error = new Error('fetch failed with secret');
        error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, 'RELEASE_MANIFEST_FETCH_FAILED');
      assert.equal(error.details.attempts, 2);
      assert.equal(error.details.causeCode, 'UND_ERR_CONNECT_TIMEOUT');
      assert.equal(error.details.location, 'https://example.test/stable.json');
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return true;
    },
  );
});

test('non-retryable HTTP failures stop after the first request', async () => {
  let calls = 0;
  await assert.rejects(
    fetchBytes('https://example.test/missing.json', {
      retryDelaysMs: [0, 0],
      errorCode: 'RELEASE_MANIFEST_FETCH_FAILED',
      label: 'Release manifest',
      fetchImpl: async () => {
        calls += 1;
        return new Response('missing', { status: 404 });
      },
    }),
    (error) => error.code === 'RELEASE_MANIFEST_FETCH_FAILED' && error.details.status === 404,
  );
  assert.equal(calls, 1);
});
