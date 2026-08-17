import { WorkflowError, invariant } from '../errors.js';
import { decodePlatformWork, encodePlatformWork } from './work-codec.js';

const EDIT_ROLES = new Set([1, 2, 3]);

// Mirrors VxEditor41 src/stores/globalConfig.js defaultWorkConfig. The editor
// uses this exact fallback when getDefaultConfig returns null or an empty object.
const EDITOR_DEFAULT_WORK_CONFIG = Object.freeze({
  wechat: {},
  applet: {},
  merchant: {},
  wxopen: {},
  wechatApp: {},
  live: {},
  alipay: {},
  dingding: {},
  alipayApp: {},
  h5microApp: {},
  byteDance: {},
  ios: {},
  android: {},
  windows: {},
  mac: {},
  iot: {},
  emailConfig: {},
  qqmap: {},
  jpush: {},
  publicService: {},
  qq: {},
  custom: {},
  azure: {},
  paypal: {},
  hy: {},
  harmony: {},
});

function positiveInteger(value, label) {
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && number > 0, 'PLATFORM_INPUT_INVALID', `${label} must be a positive integer`);
  return number;
}

function parseJsonText(text, label) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkflowError('PLATFORM_RESPONSE_INVALID', `${label} did not return valid JSON`);
  }
}

function isPlatformAuthenticationFilter(status, value) {
  if (status !== 203 || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.id !== 'filter' || Number(value.code) !== 203) return false;
  const detail = String(value.detail ?? value.message ?? '');
  return /请先登[录陆]|\b(?:login|log in|authenticated|authentication)\b/i.test(detail);
}

function safeErrorDetail(text, token) {
  return String(text || '')
    .replaceAll(token, '[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .slice(0, 2000);
}

export function normalizePlatformBaseUrl(value, allowInsecureLocalhost = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkflowError('PLATFORM_BASE_URL_INVALID', 'Platform base URL is invalid');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  invariant(url.protocol === 'https:' || (allowInsecureLocalhost && local && url.protocol === 'http:'), 'PLATFORM_BASE_URL_INSECURE', 'Platform base URL must use HTTPS');
  invariant(!url.username && !url.password, 'PLATFORM_BASE_URL_INVALID', 'Platform base URL must not contain credentials');
  invariant(!url.search && !url.hash, 'PLATFORM_BASE_URL_INVALID', 'Platform base URL must not contain a query or fragment');
  invariant(url.pathname === '/' || url.pathname === '', 'PLATFORM_BASE_URL_INVALID', 'Platform base URL must be an origin without a path');
  return url.origin;
}

export function mergeSaveAsConfig(defaultConfig, sourceConfig) {
  const hasUserDefaults = defaultConfig
    && typeof defaultConfig === 'object'
    && !Array.isArray(defaultConfig)
    && Object.keys(defaultConfig).length > 0;
  const defaults = structuredClone(hasUserDefaults ? defaultConfig : EDITOR_DEFAULT_WORK_CONFIG);
  if (!hasUserDefaults) defaults.wechat.authorize = 'Base';
  delete defaults.default;
  const customVars = sourceConfig && typeof sourceConfig === 'object' ? sourceConfig.customVars : undefined;
  if (customVars !== undefined) defaults.customVars = structuredClone(customVars);
  return defaults;
}

const WORK_ROUTING_KEYS = Object.freeze([
  'domain',
  'path',
  'previewDomain',
  'previewPath',
  'customDomain',
  'pubRoot',
  'preRoot',
]);

export function extractWorkRouting(workInfo = {}, settings = {}) {
  const output = {};
  for (const key of WORK_ROUTING_KEYS) {
    if (Object.hasOwn(settings || {}, key)) output[key] = structuredClone(settings[key]);
    else if (Object.hasOwn(workInfo || {}, key)) output[key] = structuredClone(workInfo[key]);
  }
  return output;
}

export function extractWorkDomainBinding(settings = {}) {
  invariant(settings && typeof settings === 'object' && !Array.isArray(settings), 'PLATFORM_INPUT_INVALID', 'settings must be an object');
  const binding = {
    domain: Object.hasOwn(settings, 'domain') ? settings.domain : '',
    previewDomain: Object.hasOwn(settings, 'previewDomain') ? settings.previewDomain : '',
    customDomain: Object.hasOwn(settings, 'customDomain') ? settings.customDomain : false,
  };
  for (const key of ['domain', 'previewDomain']) {
    invariant(typeof binding[key] === 'string', 'PLATFORM_RESPONSE_INVALID', `settings.${key} must be a string`);
  }
  invariant(typeof binding.customDomain === 'boolean', 'PLATFORM_RESPONSE_INVALID', 'settings.customDomain must be a boolean');
  return binding;
}

export function extractWorkPathOwnership(workInfo = {}, settings = {}) {
  const routing = extractWorkRouting(workInfo, settings);
  invariant(typeof routing.path === 'string', 'PLATFORM_RESPONSE_INVALID', 'Target settings have no publish path');
  invariant(typeof routing.previewPath === 'string', 'PLATFORM_RESPONSE_INVALID', 'Target settings have no preview path');
  const pubRoot = Object.hasOwn(routing, 'pubRoot') ? routing.pubRoot : routing.path === '' || routing.path === '/';
  const preRoot = Object.hasOwn(routing, 'preRoot') ? routing.preRoot : routing.previewPath === '' || routing.previewPath === '/';
  invariant(typeof pubRoot === 'boolean', 'PLATFORM_RESPONSE_INVALID', 'Target settings pubRoot must be a boolean');
  invariant(typeof preRoot === 'boolean', 'PLATFORM_RESPONSE_INVALID', 'Target settings preRoot must be a boolean');
  return {
    path: pubRoot ? '/' : routing.path,
    previewPath: preRoot ? '/' : routing.previewPath,
    pubRoot,
    preRoot,
  };
}

export function buildSaveAsDomainRouting(sourceSettings, targetWorkInfo, targetSettings) {
  const source = extractWorkDomainBinding(sourceSettings);
  const target = extractWorkPathOwnership(targetWorkInfo, targetSettings);
  return normalizeWorkRouting({
    domain: source.domain,
    path: target.path,
    previewDomain: source.previewDomain,
    previewPath: target.previewPath,
    customDomain: source.customDomain,
    pubRoot: target.pubRoot,
    preRoot: target.preRoot,
  });
}

function normalizeWorkRouting(routing) {
  invariant(routing && typeof routing === 'object' && !Array.isArray(routing), 'PLATFORM_INPUT_INVALID', 'routing must be an object');
  const keys = Object.keys(routing);
  invariant(keys.length > 0, 'PLATFORM_INPUT_INVALID', 'routing must contain at least one field');
  invariant(keys.every((key) => WORK_ROUTING_KEYS.includes(key)), 'PLATFORM_INPUT_INVALID', 'routing contains an unsupported field');
  for (const key of ['domain', 'path', 'previewDomain', 'previewPath']) {
    if (Object.hasOwn(routing, key)) invariant(typeof routing[key] === 'string', 'PLATFORM_INPUT_INVALID', `routing.${key} must be a string`);
  }
  if (Object.hasOwn(routing, 'customDomain')) invariant(typeof routing.customDomain === 'boolean', 'PLATFORM_INPUT_INVALID', 'routing.customDomain must be a boolean');
  for (const key of ['pubRoot', 'preRoot']) {
    if (Object.hasOwn(routing, key)) invariant(typeof routing[key] === 'boolean', 'PLATFORM_INPUT_INVALID', `routing.${key} must be a boolean`);
  }
  const hasPublished = Object.hasOwn(routing, 'domain') || Object.hasOwn(routing, 'path') || Object.hasOwn(routing, 'pubRoot');
  const hasPreview = Object.hasOwn(routing, 'previewDomain') || Object.hasOwn(routing, 'previewPath') || Object.hasOwn(routing, 'preRoot');
  invariant(!hasPublished || (Object.hasOwn(routing, 'domain') && Object.hasOwn(routing, 'path')), 'PLATFORM_INPUT_INVALID', 'routing domain and path must be supplied together');
  invariant(!hasPreview || (Object.hasOwn(routing, 'previewDomain') && Object.hasOwn(routing, 'previewPath')), 'PLATFORM_INPUT_INVALID', 'routing previewDomain and previewPath must be supplied together');
  invariant(!Object.hasOwn(routing, 'customDomain') || hasPublished, 'PLATFORM_INPUT_INVALID', 'routing.customDomain requires domain and path');
  invariant(!Object.hasOwn(routing, 'pubRoot') || hasPublished, 'PLATFORM_INPUT_INVALID', 'routing.pubRoot requires domain and path');
  invariant(!Object.hasOwn(routing, 'preRoot') || hasPreview, 'PLATFORM_INPUT_INVALID', 'routing.preRoot requires previewDomain and previewPath');
  return structuredClone(routing);
}

function observedWorkRoutingValue(key, info, settings) {
  const routing = extractWorkRouting(info, settings);
  if (key === 'domain' || key === 'previewDomain') {
    const value = Object.hasOwn(routing, key) ? routing[key] : '';
    invariant(typeof value === 'string', 'PLATFORM_RESPONSE_INVALID', `Target settings ${key} must be a string`);
    return value;
  }
  if (key === 'customDomain') {
    const value = Object.hasOwn(routing, key) ? routing[key] : false;
    invariant(typeof value === 'boolean', 'PLATFORM_RESPONSE_INVALID', 'Target settings customDomain must be a boolean');
    return value;
  }

  const pathKey = key === 'path' || key === 'pubRoot' ? 'path' : 'previewPath';
  const rootKey = pathKey === 'path' ? 'pubRoot' : 'preRoot';
  const path = routing[pathKey];
  invariant(typeof path === 'string', 'PLATFORM_RESPONSE_INVALID', `Target settings ${pathKey} must be a string`);
  const root = Object.hasOwn(routing, rootKey) ? routing[rootKey] : path === '' || path === '/';
  invariant(typeof root === 'boolean', 'PLATFORM_RESPONSE_INVALID', `Target settings ${rootKey} must be a boolean`);
  return key === rootKey ? root : (root ? '/' : path);
}

function workRoutingMismatchedFields(expected, info, settings) {
  const normalizedExpected = normalizeWorkRouting(expected);
  return Object.entries(normalizedExpected)
    .filter(([key, value]) => observedWorkRoutingValue(key, info, settings) !== value)
    .map(([key]) => key);
}

export function workRoutingMatches(expected, info, settings) {
  return workRoutingMismatchedFields(expected, info, settings).length === 0;
}

function stablePlatformValue(value) {
  if (Array.isArray(value)) return value.map(stablePlatformValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stablePlatformValue(value[key])]));
}

function samePlatformValue(left, right) {
  return JSON.stringify(stablePlatformValue(left)) === JSON.stringify(stablePlatformValue(right));
}

export class IvxPlatformAdapter {
  #token;
  #fetch;

  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, writesEnabled = false, allowInsecureLocalhost = false } = {}) {
    invariant(typeof token === 'string' && token.trim(), 'PLATFORM_TOKEN_REQUIRED', 'A platform token is required in memory');
    invariant(typeof fetchImpl === 'function', 'PLATFORM_FETCH_REQUIRED', 'A fetch implementation is required');
    this.baseUrl = normalizePlatformBaseUrl(baseUrl, allowInsecureLocalhost);
    this.#token = token.trim();
    this.#fetch = fetchImpl;
    this.writesEnabled = writesEnabled === true;
  }

  async #request(method, pathname, { query, json, body, write = false, response = 'json' } = {}) {
    if (write && !this.writesEnabled) {
      throw new WorkflowError('PLATFORM_WRITES_DISABLED', 'Platform writes are disabled for this adapter instance');
    }
    const url = new URL(pathname, this.baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = {
      Accept: response === 'binary' ? 'application/octet-stream' : 'application/json',
      Authorization: `Bearer ${this.#token}`,
    };
    let requestBody = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(json);
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
    }
    let result;
    try {
      result = await this.#fetch(url, { method, headers, body: requestBody });
    } catch (error) {
      throw new WorkflowError('PLATFORM_NETWORK_FAILED', 'Platform request failed before a response was received', {
        operation: `${method} ${pathname}`,
        cause: safeErrorDetail(error?.message, this.#token),
        outcome: write ? 'UNKNOWN_AFTER_WRITE_ATTEMPT' : 'NO_RESPONSE',
      });
    }
    if (!result.ok) {
      const text = await result.text();
      const code = result.status === 401
        ? 'PLATFORM_AUTH_FAILED'
        : result.status === 403
          ? 'PLATFORM_PERMISSION_DENIED'
          : 'PLATFORM_HTTP_FAILED';
      throw new WorkflowError(code, `Platform returned HTTP ${result.status}`, {
        operation: `${method} ${pathname}`,
        status: result.status,
        detail: safeErrorDetail(text, this.#token),
        outcome: write ? 'UNKNOWN_AFTER_WRITE_ATTEMPT' : 'REJECTED',
      });
    }
    if (result.status === 203) {
      const buffered = Buffer.from(await result.arrayBuffer());
      const text = buffered.toString('utf8');
      let value = null;
      try { value = JSON.parse(text); } catch { /* Preserve the requested response mode below. */ }
      if (isPlatformAuthenticationFilter(result.status, value)) {
        throw new WorkflowError('PLATFORM_AUTH_FAILED', 'Platform authentication failed', {
          operation: `${method} ${pathname}`,
          status: result.status,
          detail: safeErrorDetail(text, this.#token),
          outcome: write ? 'UNKNOWN_AFTER_WRITE_ATTEMPT' : 'REJECTED',
        });
      }
      if (response === 'binary') return buffered;
      if (response === 'text') return text;
      return parseJsonText(text, pathname);
    }
    if (response === 'binary') return Buffer.from(await result.arrayBuffer());
    const text = await result.text();
    if (response === 'text') return text;
    return parseJsonText(text, pathname);
  }

  getCaseInfo(nid) {
    return this.#request('POST', '/ih5/editor/work/get', {
      json: { nid: positiveInteger(nid, 'nid') },
    });
  }

  getCurrentUser() {
    return this.#request('POST', '/ih5/app/user/userinfo', {
      json: { allowAnonymous: false },
    });
  }

  getWorkGroup(gid) {
    return this.#request('POST', '/ih5/editor/workGroup/get', {
      json: { gid: positiveInteger(gid, 'gid') },
    });
  }

  async loadWork({ nid, workId }) {
    positiveInteger(nid, 'nid');
    invariant(typeof workId === 'string' && workId, 'PLATFORM_INPUT_INVALID', 'workId is required');
    const encoded = await this.#request('GET', `/work/load/${encodeURIComponent(workId)}`, {
      query: { nid },
      response: 'binary',
    });
    return decodePlatformWork(encoded);
  }

  getWorkConfig(nid) {
    return this.#request('POST', '/ih5/editor/work/getConfig', {
      json: { nid: positiveInteger(nid, 'nid'), type: 'config' },
    });
  }

  getWorkSettings(nid) {
    return this.#request('POST', '/ih5/editor/work/getConfig', {
      json: { nid: positiveInteger(nid, 'nid'), type: 'settings' },
    });
  }

  async getWorkEnvironment({ nid, workId } = {}) {
    const normalizedNid = positiveInteger(nid, 'nid');
    if (workId !== undefined && workId !== null) {
      invariant(typeof workId === 'string' && workId, 'PLATFORM_INPUT_INVALID', 'workId must be a non-empty string');
    }
    const before = await this.getCaseInfo(normalizedNid);
    if (workId !== undefined && workId !== null) {
      invariant(before?.workId === workId, 'PLATFORM_REVISION_CHANGED', 'Work revision changed before reading its environment', {
        expectedWorkId: workId,
        currentWorkId: before?.workId || null,
      });
    }
    const [firstConfig, firstSettings] = await Promise.all([
      this.getWorkConfig(normalizedNid),
      this.getWorkSettings(normalizedNid),
    ]);
    const middle = await this.getCaseInfo(normalizedNid);
    invariant(before?.workId === middle?.workId, 'PLATFORM_REVISION_CHANGED', 'Work revision changed while reading its environment', {
      expectedWorkId: before?.workId || null,
      currentWorkId: middle?.workId || null,
    });
    const [secondConfig, secondSettings] = await Promise.all([
      this.getWorkConfig(normalizedNid),
      this.getWorkSettings(normalizedNid),
    ]);
    const after = await this.getCaseInfo(normalizedNid);
    invariant(middle?.workId === after?.workId, 'PLATFORM_REVISION_CHANGED', 'Work revision changed while reading its environment', {
      expectedWorkId: middle?.workId || null,
      currentWorkId: after?.workId || null,
    });
    invariant(
      samePlatformValue(firstConfig || {}, secondConfig || {})
        && samePlatformValue(firstSettings || {}, secondSettings || {}),
      'PLATFORM_ENVIRONMENT_CHANGED',
      'Work configuration changed while reading its environment',
      { configChanged: !samePlatformValue(firstConfig || {}, secondConfig || {}), settingsChanged: !samePlatformValue(firstSettings || {}, secondSettings || {}) },
    );
    return { workInfo: after, config: secondConfig || {}, settings: secondSettings || {} };
  }

  getDefaultUserConfig() {
    return this.#request('POST', '/ih5/app/user/getDefaultConfig', { json: {} });
  }

  async recheckSourceRevision({ nid, workId }) {
    invariant(typeof workId === 'string' && workId, 'PLATFORM_INPUT_INVALID', 'Expected source workId is required');
    const current = await this.getCaseInfo(nid);
    return {
      unchanged: current?.workId === workId,
      expectedWorkId: workId,
      currentWorkId: current?.workId || null,
      current,
    };
  }

  setWorkConfig(nid, config) {
    return this.#request('POST', '/ih5/editor/work/setConfig', {
      json: { nid: positiveInteger(nid, 'nid'), type: 'config', config },
      write: true,
    });
  }

  async modifyWorkRouting({ nid, expectedWorkId, routing } = {}) {
    const normalizedNid = positiveInteger(nid, 'nid');
    invariant(typeof expectedWorkId === 'string' && expectedWorkId, 'PLATFORM_INPUT_INVALID', 'expectedWorkId is required');
    const normalizedRouting = normalizeWorkRouting(routing);
    const before = await this.getCaseInfo(normalizedNid);
    invariant(before?.workId === expectedWorkId, 'PLATFORM_REVISION_CHANGED', 'Work revision changed before routing update', {
      expectedWorkId,
      currentWorkId: before?.workId || null,
    });
    const readBack = async () => {
      const [workInfo, settings] = await Promise.all([
        this.getCaseInfo(normalizedNid),
        this.getWorkSettings(normalizedNid),
      ]);
      invariant(workInfo?.workId === expectedWorkId, 'PLATFORM_REVISION_CHANGED', 'Work revision changed while verifying its routing update', {
        expectedWorkId,
        currentWorkId: workInfo?.workId || null,
      });
      return { workInfo, settings: settings || {} };
    };
    try {
      await this.#request('POST', '/ih5/editor/work/modify', {
        json: { nid: normalizedNid, ...normalizedRouting },
        write: true,
      });
    } catch (error) {
      if (error?.details?.outcome !== 'UNKNOWN_AFTER_WRITE_ATTEMPT') throw error;
      let observed;
      try {
        observed = await readBack();
      } catch {
        throw error;
      }
      if (workRoutingMatches(normalizedRouting, observed.workInfo, observed.settings)) {
        return { ...observed, confirmation: 'CONFIRMED_BY_READBACK' };
      }
      throw error;
    }
    const observed = await readBack();
    const mismatchedFields = workRoutingMismatchedFields(normalizedRouting, observed.workInfo, observed.settings);
    invariant(mismatchedFields.length === 0, 'TARGET_ENVIRONMENT_VERIFICATION_FAILED', 'Target routing read-back does not match the requested binding', { mismatchedFields });
    return { ...observed, confirmation: 'SUCCEEDED' };
  }

  saveAsV5({ sourceNid, work }) {
    return this.#request('POST', '/work/saveAs', {
      query: { nid: positiveInteger(sourceNid, 'sourceNid'), newVer: 2 },
      body: encodePlatformWork(work),
      write: true,
    });
  }

  saveWork({ targetNid, workId, work }) {
    invariant(typeof workId === 'string' && workId, 'PLATFORM_INPUT_INVALID', 'workId is required');
    return this.#request('POST', `/work/save/${encodeURIComponent(workId)}`, {
      query: { nid: positiveInteger(targetNid, 'targetNid') },
      body: encodePlatformWork(work),
      write: true,
    });
  }

  async preflightSaveAs({ nid, gid, currentUser } = {}) {
    const user = currentUser || await this.getCurrentUser();
    const source = await this.getCaseInfo(nid);
    const sourceGid = Number(source?.gid || 0);
    if (gid !== undefined && gid !== null && Number(gid) !== sourceGid) {
      return { allowed: false, decision: 'DENIED', reason: 'SOURCE_GID_MISMATCH', source };
    }
    const memberType = Number(source?.memberType || 0);
    if (!EDIT_ROLES.has(memberType)) {
      return { allowed: false, decision: 'DENIED', reason: 'SOURCE_ROLE_NOT_EDITABLE', source };
    }
    if (!sourceGid) return { allowed: true, decision: 'ALLOWED', reason: 'PERSONAL_CASE_MEMBER', source };
    const group = await this.getWorkGroup(sourceGid);
    const currentUid = Number(user?.id || user?.uid || 0);
    const groupOwnerUid = Number(group?.uid || 0);
    if (currentUid > 0 && currentUid === groupOwnerUid) {
      return { allowed: true, decision: 'ALLOWED', reason: 'GROUP_OWNER', source };
    }
    return {
      allowed: false,
      decision: 'UNKNOWN',
      reason: 'UNKNOWN_SERVER_POLICY',
      source,
      evidence: { memberType, currentUserKnown: currentUid > 0, groupOwnerKnown: groupOwnerUid > 0 },
    };
  }

  async preflightTargetUpdate({ nid, currentUser } = {}) {
    const user = currentUser || await this.getCurrentUser();
    const target = await this.getCaseInfo(nid);
    const memberType = Number(target?.memberType || 0);
    if (!EDIT_ROLES.has(memberType)) {
      return { allowed: false, decision: 'DENIED', reason: 'TARGET_ROLE_NOT_EDITABLE', target };
    }
    const targetGid = Number(target?.gid || 0);
    if (!targetGid) return { allowed: true, decision: 'ALLOWED', reason: 'PERSONAL_CASE_MEMBER', target };
    const group = await this.getWorkGroup(targetGid);
    const currentUid = Number(user?.id || user?.uid || 0);
    const groupOwnerUid = Number(group?.uid || 0);
    if (currentUid > 0 && currentUid === groupOwnerUid) {
      return { allowed: true, decision: 'ALLOWED', reason: 'GROUP_OWNER', target };
    }
    return {
      allowed: false,
      decision: 'UNKNOWN',
      reason: 'UNKNOWN_SERVER_POLICY',
      target,
      evidence: { memberType, currentUserKnown: currentUid > 0, groupOwnerKnown: groupOwnerUid > 0 },
    };
  }
}
