import { WorkflowError, invariant } from '../errors.js';
import { decodePlatformWork, encodePlatformWork } from './work-codec.js';

const EDIT_ROLES = new Set([1, 2, 3]);

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

function safeErrorDetail(text, token) {
  return String(text || '')
    .replaceAll(token, '[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .slice(0, 2000);
}

function assertPlatformBaseUrl(value, allowInsecureLocalhost) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkflowError('PLATFORM_BASE_URL_INVALID', 'Platform base URL is invalid');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  invariant(url.protocol === 'https:' || (allowInsecureLocalhost && local && url.protocol === 'http:'), 'PLATFORM_BASE_URL_INSECURE', 'Platform base URL must use HTTPS');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

export function mergeSaveAsConfig(defaultConfig, sourceConfig) {
  invariant(
    defaultConfig && typeof defaultConfig === 'object' && !Array.isArray(defaultConfig) && Object.keys(defaultConfig).length > 0,
    'PLATFORM_DEFAULT_CONFIG_UNAVAILABLE',
    'Platform returned no default work configuration; Save As cannot safely reproduce editor defaults',
  );
  const defaults = structuredClone(defaultConfig);
  delete defaults.default;
  const customVars = sourceConfig && typeof sourceConfig === 'object' ? sourceConfig.customVars : undefined;
  if (customVars !== undefined) defaults.customVars = structuredClone(customVars);
  return defaults;
}

export class IvxPlatformAdapter {
  #token;
  #fetch;

  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, writesEnabled = false, allowInsecureLocalhost = false } = {}) {
    invariant(typeof token === 'string' && token.trim(), 'PLATFORM_TOKEN_REQUIRED', 'A platform token is required in memory');
    invariant(typeof fetchImpl === 'function', 'PLATFORM_FETCH_REQUIRED', 'A fetch implementation is required');
    this.baseUrl = assertPlatformBaseUrl(baseUrl, allowInsecureLocalhost);
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
}
