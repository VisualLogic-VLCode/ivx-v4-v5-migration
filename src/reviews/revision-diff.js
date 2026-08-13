import { sha256Buffer } from '../fs/secure-json.js';

const SAFE_PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$-]{0,127}$/;
const SECRET_KEY = /^(?:token|accessToken|refreshToken|bearerToken|cookie|authorization|password|secret|clientSecret|secretKey|privateKey|certificatePassword|apiKey|accessKey)$/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function revisionValueDigest(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(stableValue(value)), 'utf8'));
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function displaySegment(value) {
  if (SAFE_PATH_SEGMENT.test(value) && !SECRET_KEY.test(value)) {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
  }
  const digest = sha256Buffer(Buffer.from(value, 'utf8')).slice(0, 12);
  return `~redacted-${digest}`;
}

function childPath(parent, segment) {
  const value = displaySegment(String(segment));
  return parent === '' ? `/${value}` : `${parent}/${value}`;
}

function change(path, kind, before, after) {
  return {
    path: path || '/',
    kind,
    beforeType: before === undefined ? 'missing' : valueType(before),
    afterType: after === undefined ? 'missing' : valueType(after),
    beforeDigest: before === undefined ? null : revisionValueDigest(before),
    afterDigest: after === undefined ? null : revisionValueDigest(after),
  };
}

export function createRedactedRevisionDiff(before, after, { maxChanges = 200 } = {}) {
  const changes = [];
  let truncated = false;

  function record(item) {
    if (changes.length >= maxChanges) {
      truncated = true;
      return false;
    }
    changes.push(item);
    return true;
  }

  function visit(left, right, pointer = '') {
    if (truncated || Object.is(left, right)) return;
    const leftType = valueType(left);
    const rightType = valueType(right);
    if (leftType !== rightType || left === null || right === null || !['object', 'array'].includes(leftType)) {
      record(change(pointer, 'VALUE_CHANGED', left, right));
      return;
    }
    if (Array.isArray(left)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length && !truncated; index += 1) {
        if (index >= left.length) record(change(childPath(pointer, index), 'ADDED', undefined, right[index]));
        else if (index >= right.length) record(change(childPath(pointer, index), 'REMOVED', left[index], undefined));
        else visit(left[index], right[index], childPath(pointer, index));
      }
      return;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (truncated) break;
      if (!Object.hasOwn(left, key)) record(change(childPath(pointer, key), 'ADDED', undefined, right[key]));
      else if (!Object.hasOwn(right, key)) record(change(childPath(pointer, key), 'REMOVED', left[key], undefined));
      else visit(left[key], right[key], childPath(pointer, key));
    }
  }

  visit(before, after);
  return {
    changed: changes.length > 0 || truncated,
    changes,
    truncated,
    maxChanges,
  };
}
