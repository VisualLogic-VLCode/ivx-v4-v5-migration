import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSaveAsDomainRouting,
  extractWorkDomainBinding,
  extractWorkPathOwnership,
  extractWorkRouting,
  IvxPlatformAdapter,
  mergeSaveAsConfig,
  normalizePlatformBaseUrl,
  workRoutingMatches,
} from '../src/platform/http-adapter.js';
import { encodePlatformWork } from '../src/platform/work-codec.js';

const work = {
  case: { id: 'case', type: 'ih5-case' },
  stage: { id: 'stage', type: 'stage' },
  server: { id: 'server', type: 'server' },
};

function response(value, { status = 200, binary = false } = {}) {
  return new Response(binary ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
  });
}

test('platform origins are normalized and unsafe overrides are rejected', () => {
  assert.equal(normalizePlatformBaseUrl('https://dev.ivx.cn/'), 'https://dev.ivx.cn');
  assert.equal(normalizePlatformBaseUrl('http://127.0.0.1:3000/', true), 'http://127.0.0.1:3000');
  assert.throws(() => normalizePlatformBaseUrl('http://dev.ivx.cn'), { code: 'PLATFORM_BASE_URL_INSECURE' });
  assert.throws(() => normalizePlatformBaseUrl('https://user:secret@dev.ivx.cn'), { code: 'PLATFORM_BASE_URL_INVALID' });
  assert.throws(() => normalizePlatformBaseUrl('https://dev.ivx.cn/editor'), { code: 'PLATFORM_BASE_URL_INVALID' });
  assert.throws(() => normalizePlatformBaseUrl('https://dev.ivx.cn?target=other'), { code: 'PLATFORM_BASE_URL_INVALID' });
});

test('platform adapter uses an in-memory bearer token and decodes work', async () => {
  const calls = [];
  const token = 'secret-user-token';
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://127.0.0.1:3000',
    token,
    allowInsecureLocalhost: true,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/work/load/')) return response(encodePlatformWork(work), { binary: true });
      return response({ nid: 10, workId: 'work-1', memberType: 1, gid: 0 });
    },
  });
  const info = await adapter.getCaseInfo(10);
  const loaded = await adapter.loadWork(info);
  const revision = await adapter.recheckSourceRevision({ nid: 10, workId: 'work-1' });
  assert.equal(info.nid, 10);
  assert.deepEqual(loaded, work);
  assert.equal(revision.unchanged, true);
  assert.equal(calls.every((call) => call.options.headers.Authorization === `Bearer ${token}`), true);
  assert.equal(JSON.stringify(adapter).includes(token), false);
});

test('platform adapter preflight separates personal allow, role deny, and group uncertainty', async () => {
  const cases = new Map([
    [10, { nid: 10, workId: 'a-1', gid: 0, memberType: 3 }],
    [11, { nid: 11, workId: 'b-1', gid: 0, memberType: 4 }],
    [12, { nid: 12, workId: 'c-1', gid: 99, memberType: 3 }],
    [13, { nid: 13, workId: 'd-1', gid: 98, memberType: 3 }],
  ]);
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'token',
    allowInsecureLocalhost: true,
    fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : {};
      if (pathname.endsWith('/work/get')) return response(cases.get(body.nid));
      if (pathname.endsWith('/userinfo')) return response({ id: 500 });
      if (pathname.endsWith('/workGroup/get')) return response({ gid: body.gid, uid: body.gid === 98 ? 500 : 600 });
      throw new Error(`Unexpected ${pathname}`);
    },
  });
  assert.equal((await adapter.preflightSaveAs({ nid: 10 })).decision, 'ALLOWED');
  assert.equal((await adapter.preflightSaveAs({ nid: 11 })).decision, 'DENIED');
  assert.equal((await adapter.preflightSaveAs({ nid: 12, gid: 99 })).decision, 'UNKNOWN');
  assert.equal((await adapter.preflightSaveAs({ nid: 13, gid: 98 })).reason, 'GROUP_OWNER');
  assert.equal((await adapter.preflightTargetUpdate({ nid: 10 })).decision, 'ALLOWED');
  assert.equal((await adapter.preflightTargetUpdate({ nid: 11 })).reason, 'TARGET_ROLE_NOT_EDITABLE');
  assert.equal((await adapter.preflightTargetUpdate({ nid: 12 })).decision, 'UNKNOWN');
});

test('target routing snapshot prefers settings over work metadata without retaining unrelated fields', () => {
  assert.deepEqual(
    extractWorkRouting(
      { domain: 'published.example', path: '/v4', previewDomain: 'old-preview.example', ignored: 'no' },
      { previewDomain: 'preview.example', previewPath: '/v5', customDomain: true, another: 'no' },
    ),
    { domain: 'published.example', path: '/v4', previewDomain: 'preview.example', previewPath: '/v5', customDomain: true },
  );
});

test('Save As domain routing copies source domains while preserving target-generated paths', () => {
  const source = {
    domain: 'source.example.test',
    customDomain: true,
    previewDomain: 'source-preview.example.test',
    path: '/play/source-must-not-copy',
    previewPath: '/play/source-preview-must-not-copy',
  };
  const targetInfo = { path: '/play/target-info', previewPath: '/play/target-preview-info' };
  const targetSettings = {
    path: '/play/target-generated',
    previewPath: '/play/target-preview-generated',
    pubRoot: false,
    preRoot: false,
  };
  assert.deepEqual(extractWorkDomainBinding(source), {
    domain: 'source.example.test',
    previewDomain: 'source-preview.example.test',
    customDomain: true,
  });
  assert.deepEqual(extractWorkPathOwnership(targetInfo, targetSettings), {
    path: '/play/target-generated',
    previewPath: '/play/target-preview-generated',
    pubRoot: false,
    preRoot: false,
  });
  assert.deepEqual(buildSaveAsDomainRouting(source, targetInfo, targetSettings), {
    domain: 'source.example.test',
    path: '/play/target-generated',
    previewDomain: 'source-preview.example.test',
    previewPath: '/play/target-preview-generated',
    customDomain: true,
    pubRoot: false,
    preRoot: false,
  });
});

test('Save As domain routing keeps default domains and canonicalizes target root paths', () => {
  assert.deepEqual(buildSaveAsDomainRouting({}, {}, {
    path: '',
    previewPath: '/',
    pubRoot: true,
    preRoot: true,
  }), {
    domain: '',
    path: '/',
    previewDomain: '',
    previewPath: '/',
    customDomain: false,
    pubRoot: true,
    preRoot: true,
  });
  assert.throws(() => buildSaveAsDomainRouting({}, {}, { path: '/play/target' }), { code: 'PLATFORM_RESPONSE_INVALID' });
});

test('routing read-back compares platform default omissions and root path spellings semantically', () => {
  assert.equal(workRoutingMatches({
    domain: 'source.example.test',
    path: '/play/target',
    previewDomain: 'source-preview.example.test',
    previewPath: '/play/target-preview',
    customDomain: true,
    pubRoot: false,
    preRoot: false,
  }, {}, {
    domain: 'source.example.test',
    path: '/play/target',
    previewDomain: 'source-preview.example.test',
    previewPath: '/play/target-preview',
    customDomain: true,
  }), true);

  assert.equal(workRoutingMatches({
    domain: '',
    path: '/',
    previewDomain: '',
    previewPath: '/',
    customDomain: false,
    pubRoot: true,
    preRoot: true,
  }, {}, {
    path: '',
    previewPath: '',
  }), true);

  assert.equal(workRoutingMatches({
    domain: 'source.example.test',
    path: '/play/target',
    previewDomain: 'source-preview.example.test',
    previewPath: '/play/target-preview',
    customDomain: true,
    pubRoot: false,
    preRoot: false,
  }, {}, {
    domain: 'different.example.test',
    path: '/play/target',
    previewDomain: 'source-preview.example.test',
    previewPath: '/play/target-preview',
    customDomain: true,
  }), false);
});

test('routing modify preserves an unknown write outcome when immediate read-back is unavailable', async () => {
  let modifyAttempted = false;
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'token',
    writesEnabled: true,
    allowInsecureLocalhost: true,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/work/get') && !modifyAttempted) {
        return response({ nid: 10, workId: 'target-work-1' });
      }
      if (pathname.endsWith('/work/modify')) {
        modifyAttempted = true;
        throw new Error('connection reset after request dispatch');
      }
      throw new Error('routing read-back unavailable');
    },
  });

  await assert.rejects(adapter.modifyWorkRouting({
    nid: 10,
    expectedWorkId: 'target-work-1',
    routing: {
      domain: 'source.example.test',
      path: '/play/target',
      previewDomain: 'source-preview.example.test',
      previewPath: '/play/target-preview',
      customDomain: true,
      pubRoot: false,
      preRoot: false,
    },
  }), (error) => {
    assert.equal(error.details.outcome, 'UNKNOWN_AFTER_WRITE_ATTEMPT');
    return true;
  });
});

test('platform writes are disabled by default and errors redact the token', async () => {
  const token = 'do-not-leak-this';
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'https://example.invalid',
    token,
    fetchImpl: async () => { throw new Error(`network failed for Bearer ${token}`); },
  });
  await assert.rejects(adapter.saveAsV5({ sourceNid: 10, work }), { code: 'PLATFORM_WRITES_DISABLED' });
  await assert.rejects(adapter.getCaseInfo(10), (error) => {
    assert.equal(JSON.stringify(error.details).includes(token), false);
    return true;
  });
});

test('platform adapter normalizes the real HTTP 203 login filter before endpoint consumers', async () => {
  const realLoginFilter = {
    id: 'filter',
    code: 203,
    detail: '请先登陆',
    status: 'Non-Authoritative Information',
  };
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'expired-token-must-not-leak',
    allowInsecureLocalhost: true,
    fetchImpl: async () => response(realLoginFilter, { status: 203 }),
  });
  for (const operation of [
    () => adapter.getCaseInfo(10),
    () => adapter.loadWork({ nid: 10, workId: 'work-1' }),
  ]) {
    await assert.rejects(operation(), (error) => {
      assert.equal(error.code, 'PLATFORM_AUTH_FAILED');
      assert.equal(error.details.status, 203);
      assert.equal(error.details.outcome, 'REJECTED');
      assert.match(error.details.detail, /请先登陆/);
      assert.equal(JSON.stringify(error).includes('expired-token-must-not-leak'), false);
      return true;
    });
  }

  const writeAdapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'expired-write-token',
    writesEnabled: true,
    allowInsecureLocalhost: true,
    fetchImpl: async () => response(realLoginFilter, { status: 203 }),
  });
  await assert.rejects(writeAdapter.saveAsV5({ sourceNid: 10, work }), (error) => {
    assert.equal(error.code, 'PLATFORM_AUTH_FAILED');
    assert.equal(error.details.outcome, 'UNKNOWN_AFTER_WRITE_ATTEMPT');
    assert.equal(JSON.stringify(error).includes('expired-write-token'), false);
    return true;
  });
});

test('platform adapter does not treat an unrelated HTTP 203 JSON response as authentication failure', async () => {
  const adapter = new IvxPlatformAdapter({
    baseUrl: 'http://localhost:3000',
    token: 'token',
    allowInsecureLocalhost: true,
    fetchImpl: async () => response({ id: 'other', code: 203, detail: 'partial result' }, { status: 203 }),
  });
  assert.deepEqual(await adapter.getCaseInfo(10), { id: 'other', code: 203, detail: 'partial result' });
});

test('Save As config merge keeps source customVars over user defaults', () => {
  assert.deepEqual(
    mergeSaveAsConfig({ default: true, wechat: { noJs: false }, customVars: { old: 1 } }, { customVars: { source: 2 } }),
    { wechat: { noJs: false }, customVars: { source: 2 } },
  );
});

test('Save As config merge mirrors the editor fallback when user defaults are empty', () => {
  const expectedKeys = [
    'alipay', 'alipayApp', 'android', 'applet', 'azure', 'byteDance',
    'custom', 'dingding', 'emailConfig', 'h5microApp', 'harmony', 'hy',
    'ios', 'iot', 'jpush', 'live', 'mac', 'merchant', 'paypal',
    'publicService', 'qq', 'qqmap', 'wechat', 'wechatApp', 'windows', 'wxopen',
  ];
  const fallback = mergeSaveAsConfig({}, { customVars: { source: 2 } });
  assert.deepEqual(Object.keys(fallback).sort(), [...expectedKeys, 'customVars'].sort());
  assert.deepEqual(fallback.wechat, { authorize: 'Base' });
  assert.deepEqual(fallback.customVars, { source: 2 });
  assert.deepEqual(mergeSaveAsConfig(null, {}).wechat, { authorize: 'Base' });
});
