import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEnvironmentGate } from '../src/environment/environment-gate.js';
import { resolveEnvironmentFieldPolicy } from '../src/environment/field-policy.js';

const NOW = '2026-08-13T06:00:00.000Z';

function environmentPair() {
  return {
    source: {
      revision: { nid: 100, workId: 'source-work-1' },
      workInfo: {
        nid: 100,
        workId: 'source-work-1',
        link: 'source-link',
        domain: 'source.example.test',
        path: '/play/source',
        previewDomain: 'source-preview.example.test',
        previewPath: '/play/source-preview',
        language: 'zh-CN',
        extra: { ver: 1, preDisable: false, seoCache: 2 },
      },
      config: {
        wechat: { appId: 'source-app', appSecret: 'source-wechat-secret' },
        customVars: [{ k: 'SESSION_KEY', v: 'source-session-secret', v2: '', d: 'session', b: false }],
      },
      settings: {
        domain: 'source.example.test',
        path: '/play/source',
        previewDomain: 'source-preview.example.test',
        previewPath: '/play/source-preview',
        customDomain: true,
        loading: { bgColor: '#ffffff' },
      },
    },
    target: {
      revision: { nid: 200, workId: 'target-work-1' },
      workInfo: {
        nid: 200,
        workId: 'target-work-1',
        link: 'target-link',
        domain: 'target.example.test',
        path: '/play/target',
        previewDomain: 'target-preview.example.test',
        previewPath: '/play/target-preview',
        language: 'zh-CN',
        extra: { ver: 2, preDisable: false, seoCache: 7 },
      },
      config: {
        wechat: { appId: 'target-app', appSecret: 'target-wechat-secret' },
        customVars: [{ k: 'SESSION_KEY', v: 'source-session-secret', v2: '', d: 'session', b: false }],
      },
      settings: {
        domain: 'target.example.test',
        path: '/play/target',
        previewDomain: 'target-preview.example.test',
        previewPath: '/play/target-preview',
        customDomain: false,
        loading: { bgColor: '#ffffff' },
      },
    },
  };
}

function evaluate(pair, extra = {}) {
  return evaluateEnvironmentGate({
    reviewId: 'rev_20260813060000_abcde',
    sourceManifestId: 'env-source-1',
    targetManifestId: 'env-target-1',
    comparisonId: 'env-comparison-1',
    source: pair.source,
    target: pair.target,
    evaluatedAt: NOW,
    ...extra,
  });
}

function userBindingAssertion() {
  return {
    assertionId: 'binding-wechat-1',
    assertedBy: 'USER',
    assertedAt: NOW,
    equivalent: true,
  };
}

test('environment gate redacts values and records declared route and binding normalization', () => {
  const result = evaluate(environmentPair(), { bindingAssertions: { '/config/wechat': userBindingAssertion() } });
  assert.equal(result.comparison.status, 'NORMALIZED_EQUIVALENT');
  assert.equal(result.comparison.normalizedPaths.includes('/config/wechat'), true);
  assert.equal(result.comparison.fields.find((field) => field.path === '/config/wechat').bindingAssertionId, 'binding-wechat-1');
  assert.equal(result.comparison.normalizedPaths.includes('/workInfo/nid'), true);
  assert.equal(result.comparison.fields.find((field) => field.path === '/workInfo/extra/seoCache').disposition, 'IGNORED');
  assert.equal(result.comparison.fields.some((field) => field.path === '/workInfo/extra/ver'), false);
  const customVar = result.sourceManifest.fields.find((field) => field.path === '/config/customVars/SESSION_KEY');
  assert.equal(customVar.policy, 'REDACT_AND_COMPARE');
  assert.equal(customVar.equivalent, true);
  assert.equal(customVar.comparisonDigest, null);
  const serialized = JSON.stringify(result);
  for (const secret of ['source-session-secret', 'source-wechat-secret', 'target-wechat-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('target bindings require evidence and unknown settings block environment attribution', () => {
  const bindingRequired = evaluate(environmentPair());
  assert.equal(bindingRequired.comparison.status, 'REQUIRES_USER_BINDING');
  assert.deepEqual(bindingRequired.comparison.requiredBindingPaths, ['/config/wechat']);

  const pair = environmentPair();
  pair.source.settings.futureRuntimeToggle = true;
  const blocked = evaluate(pair, { bindingAssertions: { '/config/wechat': userBindingAssertion() } });
  assert.equal(blocked.comparison.status, 'BLOCKED_ENVIRONMENT');
  assert.equal(blocked.comparison.blockedPaths.includes('/settings/futureRuntimeToggle'), true);
  const unknownField = blocked.sourceManifest.fields.find((field) => field.path === '/settings/futureRuntimeToggle');
  assert.equal(unknownField.policy, null);
});

test('redacted custom variables and copy-exact display settings must still match in memory', () => {
  const customVarMismatch = environmentPair();
  customVarMismatch.target.config.customVars[0].v = 'different-target-value';
  assert.equal(
    evaluate(customVarMismatch, { bindingAssertions: { '/config/wechat': userBindingAssertion() } }).comparison.blockedPaths.includes('/config/customVars/SESSION_KEY'),
    true,
  );

  const loadingMismatch = environmentPair();
  loadingMismatch.target.settings.loading.bgColor = '#000000';
  assert.equal(
    evaluate(loadingMismatch, { bindingAssertions: { '/config/wechat': userBindingAssertion() } }).comparison.blockedPaths.includes('/settings/loading'),
    true,
  );
});

test('platform-default false booleans and settings-backed work-info projections normalize safely', () => {
  const pair = environmentPair();
  delete pair.target.workInfo.domain;
  delete pair.target.workInfo.previewDomain;
  delete pair.target.workInfo.extra.preDisable;
  const result = evaluate(pair, { bindingAssertions: { '/config/wechat': userBindingAssertion() } });
  assert.equal(result.comparison.status, 'NORMALIZED_EQUIVALENT');
  for (const path of ['/workInfo/domain', '/workInfo/previewDomain', '/workInfo/extra/preDisable']) {
    const field = result.comparison.fields.find((entry) => entry.path === path);
    assert.equal(field.disposition, 'NORMALIZED', path);
    assert.equal(field.equivalent, true, path);
    assert.equal(result.comparison.normalizedPaths.includes(path), true, path);
  }
  assert.equal(result.targetManifest.fields.find((entry) => entry.path === '/workInfo/domain').presence, 'ABSENT');
  assert.equal(result.targetManifest.fields.find((entry) => entry.path === '/workInfo/extra/preDisable').presence, 'ABSENT');
});

test('projection normalization still blocks missing authoritative settings and true default changes', () => {
  const missingSettings = environmentPair();
  delete missingSettings.target.workInfo.domain;
  delete missingSettings.target.settings.domain;
  assert.equal(
    evaluate(missingSettings, { bindingAssertions: { '/config/wechat': userBindingAssertion() } }).comparison.blockedPaths.includes('/workInfo/domain'),
    true,
  );

  const changedBoolean = environmentPair();
  changedBoolean.source.workInfo.extra.preDisable = true;
  delete changedBoolean.target.workInfo.extra.preDisable;
  assert.equal(
    evaluate(changedBoolean, { bindingAssertions: { '/config/wechat': userBindingAssertion() } }).comparison.blockedPaths.includes('/workInfo/extra/preDisable'),
    true,
  );
});

test('field policy registry is closed and classifies dynamic custom variables without enumerating their values', () => {
  assert.equal(resolveEnvironmentFieldPolicy('/settings/loading'), 'COPY_EXACT');
  assert.equal(resolveEnvironmentFieldPolicy('/config/customVars/arbitrary-key'), 'REDACT_AND_COMPARE');
  assert.equal(resolveEnvironmentFieldPolicy('/config/future-provider'), null);
});

test('binding normalization rejects unaudited boolean or agent-originated overrides', () => {
  assert.throws(() => evaluate(environmentPair(), { bindingAssertions: { '/config/wechat': true } }), { code: 'ENVIRONMENT_BINDING_ASSERTION_INVALID' });
  const assertion = userBindingAssertion();
  assertion.assertedBy = 'AGENT';
  assert.throws(() => evaluate(environmentPair(), { bindingAssertions: { '/config/wechat': assertion } }), /must originate from USER/);
});
