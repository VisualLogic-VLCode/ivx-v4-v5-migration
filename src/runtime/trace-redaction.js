import { sha256Buffer } from '../fs/secure-json.js';

const SECRET_ASSIGNMENT = /\b(token|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwd|secret|api[_-]?key|private[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const LONG_CREDENTIAL = /\b[A-Za-z0-9+/=_-]{48,}\b/g;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function redactRuntimeText(value, { max = 2048 } = {}) {
  let text = String(value ?? '');
  text = text
    .replace(BEARER, 'Bearer <redacted>')
    .replace(SECRET_ASSIGNMENT, (_match, key) => `${key}=<redacted>`)
    .replace(JWT, '<redacted-jwt>')
    .replace(LONG_CREDENTIAL, '<redacted-value>');
  return text.length > max ? `${text.slice(0, max)}…<truncated>` : text;
}

export function redactedUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.hash = '';
    url.pathname = url.pathname.split('/').map((segment) => (
      segment.length >= 24 || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)
        ? '<redacted-segment>'
        : segment
    )).join('/');
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '<redacted>');
    return redactRuntimeText(url.toString(), { max: 2048 });
  } catch {
    return redactRuntimeText(value, { max: 2048 });
  }
}

export function runtimeValueDigest(value) {
  return sha256Buffer(Buffer.from(canonical(value), 'utf8'));
}

export function runtimeValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function runtimeValueShape(value, depth = 0) {
  if (depth >= 6) return '<depth-limit>';
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: [...new Set(value.slice(0, 100).map((entry) => JSON.stringify(runtimeValueShape(entry, depth + 1))))].sort() };
  if (typeof value === 'object') return { type: 'object', fields: Object.keys(value).sort().slice(0, 200).map((key) => [key, runtimeValueShape(value[key], depth + 1)]) };
  return typeof value;
}

export function runtimeValueSummary(value) {
  if (value === null) return 'Captured null value.';
  if (typeof value === 'string') return `Captured string (${value.length} characters).`;
  if (Array.isArray(value)) return `Captured array (${value.length} items).`;
  if (typeof value === 'object') return `Captured object (${Object.keys(value).length} fields).`;
  return `Captured ${typeof value} value.`;
}
