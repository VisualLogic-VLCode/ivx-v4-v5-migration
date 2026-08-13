import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fetchBytes, systemCurlBytes } from '../src/releases/http-fetch.js';

test('system downloader keeps URLs and request headers out of process arguments', async () => {
  let invocation;
  let config = '';
  const spawnImpl = (command, args) => {
    invocation = { command, args };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = {
      end(value) {
        config = value;
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('downloaded-bytes'));
          child.emit('close', 0);
        });
      },
    };
    return child;
  };
  const bytes = await systemCurlBytes('https://example.test/runtime.tgz?signature=private-query', {
    headers: { Authorization: 'Bearer private-header' },
    timeoutMs: 1000,
    spawnImpl,
  });
  assert.equal(bytes.toString('utf8'), 'downloaded-bytes');
  assert.equal(invocation.command, 'curl');
  assert.equal(invocation.args.join(' ').includes('private-query'), false);
  assert.equal(invocation.args.join(' ').includes('private-header'), false);
  assert.equal(config.includes('private-query'), true);
  assert.equal(config.includes('private-header'), true);
});

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

test('remote bytes use an injected bounded fallback after a Fetch network failure', async () => {
  let fetchCalls = 0;
  let fallbackCalls = 0;
  const bytes = await fetchBytes('https://example.test/runtime.tgz', {
    attempts: 3,
    timeoutMs: 100,
    fetchImpl: async () => {
      fetchCalls += 1;
      const error = new Error('fetch failed');
      error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      throw error;
    },
    fallbackImpl: async (_location, options) => {
      fallbackCalls += 1;
      assert.equal(options.timeoutMs, 100);
      return Buffer.from('native-https-bytes');
    },
  });
  assert.equal(bytes.toString('utf8'), 'native-https-bytes');
  assert.equal(fetchCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test('remote bytes keep retries bounded when Fetch and its injected fallback both fail', async () => {
  let fetchCalls = 0;
  let fallbackCalls = 0;
  await assert.rejects(fetchBytes('https://example.test/runtime.tgz', {
    attempts: 2,
    retryDelaysMs: [0],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw Object.assign(new Error('fetch failed'), { code: 'FETCH_FAILED' });
    },
    fallbackImpl: async () => {
      fallbackCalls += 1;
      throw Object.assign(new Error('fallback failed'), { code: 'CURL_EXIT_28' });
    },
  }), (error) => error.code === 'REMOTE_DOWNLOAD_FAILED' && error.details.causeCode === 'CURL_EXIT_28');
  assert.equal(fetchCalls, 2);
  assert.equal(fallbackCalls, 2);
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
