import assert from 'node:assert/strict';
import test from 'node:test';
import { IvxPlatformAdapter } from '../src/platform/http-adapter.js';

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function adapterFixture({ loseModifyResponse = false, changeConfigDuringRead = false } = {}) {
  const calls = [];
  const state = {
    info: { nid: 200, workId: 'target-work-1', domain: 'old.example.test', path: '/play/old', previewDomain: 'old-preview.example.test', previewPath: '/play/old-preview' },
    config: { customVars: { env: 'test-secret-value' } },
    settings: { domain: 'old.example.test', path: '/play/old', previewDomain: 'old-preview.example.test', previewPath: '/play/old-preview', customDomain: true },
  };
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'platform-test-token',
    writesEnabled: true,
    allowInsecureLocalhost: true,
    fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : {};
      calls.push({ pathname, body, method: options.method });
      if (pathname === '/ih5/editor/work/get') return response(state.info);
      if (pathname === '/ih5/editor/work/getConfig' && body.type === 'config') {
        const configReads = calls.filter((call) => call.pathname === pathname && call.body.type === 'config').length;
        if (changeConfigDuringRead && configReads > 1) return response({ customVars: { env: 'changed-value' } });
        return response(state.config);
      }
      if (pathname === '/ih5/editor/work/getConfig' && body.type === 'settings') return response(state.settings);
      if (pathname === '/ih5/editor/work/modify') {
        for (const key of ['domain', 'path', 'previewDomain', 'previewPath', 'customDomain']) {
          if (Object.hasOwn(body, key)) {
            state.settings[key] = body[key];
            if (key !== 'customDomain') state.info[key] = body[key];
          }
        }
        if (loseModifyResponse) throw new Error('response lost after routing write');
        return response({});
      }
      throw new Error(`Unexpected ${pathname}`);
    },
  });
  return { adapter, calls, state };
}

test('adapter reads work info, config, and settings as one revision-pinned environment', async () => {
  const { adapter, calls } = adapterFixture();
  const environment = await adapter.getWorkEnvironment({ nid: 200, workId: 'target-work-1' });
  assert.equal(environment.workInfo.workId, 'target-work-1');
  assert.deepEqual(environment.settings.customDomain, true);
  assert.equal(environment.config.customVars.env, 'test-secret-value');
  assert.deepEqual(calls.filter((call) => call.pathname.endsWith('/getConfig')).map((call) => call.body.type).sort(), ['config', 'config', 'settings', 'settings']);
  await assert.rejects(adapter.getWorkEnvironment({ nid: 200, workId: 'stale-work' }), { code: 'PLATFORM_REVISION_CHANGED' });
});

test('adapter refuses a non-atomic environment read when config changes between samples', async () => {
  const { adapter } = adapterFixture({ changeConfigDuringRead: true });
  await assert.rejects(adapter.getWorkEnvironment({ nid: 200, workId: 'target-work-1' }), (error) => {
    assert.equal(error.code, 'PLATFORM_ENVIRONMENT_CHANGED');
    assert.deepEqual(error.details, { configChanged: true, settingsChanged: false });
    assert.equal(JSON.stringify(error).includes('test-secret-value'), false);
    assert.equal(JSON.stringify(error).includes('changed-value'), false);
    return true;
  });
});

test('adapter routing writes are narrow, revision-checked, and verified by read-back', async () => {
  const { adapter, calls } = adapterFixture();
  const result = await adapter.modifyWorkRouting({
    nid: 200,
    expectedWorkId: 'target-work-1',
    routing: {
      domain: 'new.example.test',
      path: '/play/new',
      previewDomain: 'new-preview.example.test',
      previewPath: '/play/new-preview',
      customDomain: true,
    },
  });
  assert.equal(result.confirmation, 'SUCCEEDED');
  assert.equal(result.settings.previewPath, '/play/new-preview');
  assert.equal(calls.filter((call) => call.pathname.endsWith('/modify')).length, 1);

  await assert.rejects(adapter.modifyWorkRouting({
    nid: 200,
    expectedWorkId: 'target-work-1',
    routing: { settings: '{}' },
  }), { code: 'PLATFORM_INPUT_INVALID' });
});

test('unknown routing-write responses reconcile by read-back and are not replayed', async () => {
  const { adapter, calls } = adapterFixture({ loseModifyResponse: true });
  const result = await adapter.modifyWorkRouting({
    nid: 200,
    expectedWorkId: 'target-work-1',
    routing: { previewDomain: 'new-preview.example.test', previewPath: '/play/new-preview' },
  });
  assert.equal(result.confirmation, 'CONFIRMED_BY_READBACK');
  assert.equal(calls.filter((call) => call.pathname.endsWith('/modify')).length, 1);
});
