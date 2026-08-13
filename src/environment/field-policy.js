import { ENVIRONMENT_FIELD_POLICIES } from '../contracts/schema-v2.js';

const CONFIG_TARGET_BINDINGS = Object.freeze([
  'alipay',
  'alipayApp',
  'android',
  'applet',
  'azure',
  'byteDance',
  'dingding',
  'douyin',
  'emailConfig',
  'h5microApp',
  'harmony',
  'hy',
  'ios',
  'iot',
  'jpush',
  'live',
  'mac',
  'merchant',
  'paypal',
  'publicService',
  'qq',
  'qqmap',
  'role',
  'textAnalytics',
  'uc',
  'wechat',
  'wechatApp',
  'wecom',
  'windows',
  'wxopen',
]);

const CONFIG_EXPLICIT_BINDINGS = Object.freeze(['custom', 'extJs', 'java']);

const EXACT_POLICIES = new Map();

function register(paths, policy) {
  for (const path of paths) EXACT_POLICIES.set(path, policy);
}

register(CONFIG_TARGET_BINDINGS.map((key) => `/config/${key}`), 'USE_TARGET_BINDING');
register(CONFIG_EXPLICIT_BINDINGS.map((key) => `/config/${key}`), 'REQUIRE_USER_BINDING');
register(['/config/default', '/config/name'], 'IGNORE_FOR_PARITY');

register([
  '/settings/favicon',
  '/settings/loading',
  '/settings/loadingInfoState',
  '/settings/removeLogo',
  '/settings/stage',
  '/settings/uaFilter',
], 'COPY_EXACT');
register([
  '/settings/customDomain',
  '/settings/domain',
  '/settings/hideJs',
  '/settings/path',
  '/settings/previewDomain',
  '/settings/previewPath',
], 'REMAP_FOR_TARGET');
register([
  '/settings/indexMetas',
  '/settings/sidebarCfg',
  '/settings/tags',
], 'IGNORE_FOR_PARITY');

register([
  '/workInfo/domain',
  '/workInfo/domainForPreview',
  '/workInfo/domainForPublish',
  '/workInfo/link',
  '/workInfo/nid',
  '/workInfo/path',
  '/workInfo/previewDomain',
  '/workInfo/previewPath',
  '/workInfo/previewUrl',
  '/workInfo/publishUrl',
  '/workInfo/workId',
], 'REMAP_FOR_TARGET');
register(['/workInfo/language'], 'COPY_EXACT');
register(['/workInfo/extra/preDisable'], 'COPY_EXACT');
register(['/workInfo/extra/bgNid'], 'REQUIRE_USER_BINDING');
register([
  '/workInfo/extra/pubDisable',
  '/workInfo/extra/pubVerDisable',
  '/workInfo/extra/seoCache',
  '/workInfo/extra/seoStatic',
  '/workInfo/extra/seoWait',
], 'IGNORE_FOR_PARITY');

const WORK_INFO_ENVIRONMENT_KEYS = Object.freeze(
  [...EXACT_POLICIES.keys()]
    .filter((path) => path.startsWith('/workInfo/'))
    .map((path) => path.slice('/workInfo/'.length))
    .filter((key) => !key.includes('/')),
);

const WORK_INFO_EXTRA_ENVIRONMENT_KEYS = Object.freeze(
  [...EXACT_POLICIES.keys()]
    .filter((path) => path.startsWith('/workInfo/extra/'))
    .map((path) => path.slice('/workInfo/extra/'.length)),
);

export const ENVIRONMENT_FIELD_POLICY_REGISTRY = Object.freeze({
  schemaVersion: 1,
  exact: Object.freeze(Object.fromEntries(EXACT_POLICIES)),
  dynamic: Object.freeze([
    Object.freeze({ prefix: '/config/customVars/', policy: 'REDACT_AND_COMPARE' }),
  ]),
});

export function resolveEnvironmentFieldPolicy(path) {
  const exact = EXACT_POLICIES.get(path);
  if (exact) return exact;
  if (path.startsWith('/config/customVars/') && path.length > '/config/customVars/'.length) {
    return 'REDACT_AND_COMPARE';
  }
  return null;
}

export function environmentWorkInfoKeys() {
  return [...WORK_INFO_ENVIRONMENT_KEYS];
}

export function environmentWorkInfoExtraKeys() {
  return [...WORK_INFO_EXTRA_ENVIRONMENT_KEYS];
}

export function isEnvironmentFieldPolicy(value) {
  return ENVIRONMENT_FIELD_POLICIES.includes(value);
}
