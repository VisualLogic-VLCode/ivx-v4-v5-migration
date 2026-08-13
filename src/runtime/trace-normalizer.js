import { runtimeValueDigest, runtimeValueShape } from './trace-redaction.js';

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const REQUEST_ID = /\b(?:trace|request|correlation)[-_]?(?:id)?[=:][A-Za-z0-9._:-]{8,}\b/gi;

function identityEntries(subjects) {
  const entries = [];
  for (const [placeholder, values] of [
    ['<CASE_NID>', [subjects.source?.nid, subjects.target?.nid]],
    ['<WORK_ID>', [subjects.source?.workId, subjects.target?.workId]],
  ]) {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value)) entries.push([String(value), placeholder]);
    }
  }
  return entries.sort((left, right) => right[0].length - left[0].length);
}

function normalizeString(input, subjects) {
  let value = input;
  const applied = new Set();
  for (const [identity, placeholder] of identityEntries(subjects)) {
    if (value.includes(identity)) {
      value = value.split(identity).join(placeholder);
      applied.add(placeholder === '<CASE_NID>' ? 'CASE_IDENTITY' : 'WORK_IDENTITY');
    }
  }
  if (ISO_TIMESTAMP.test(value)) {
    ISO_TIMESTAMP.lastIndex = 0;
    value = value.replace(ISO_TIMESTAMP, '<TIMESTAMP>');
    applied.add('TIMESTAMP');
  }
  ISO_TIMESTAMP.lastIndex = 0;
  if (UUID.test(value)) {
    UUID.lastIndex = 0;
    value = value.replace(UUID, '<UUID>');
    applied.add('RANDOM_ID');
  }
  UUID.lastIndex = 0;
  if (REQUEST_ID.test(value)) {
    REQUEST_ID.lastIndex = 0;
    value = value.replace(REQUEST_ID, '<REQUEST_ID>');
    applied.add('REQUEST_ID');
  }
  REQUEST_ID.lastIndex = 0;
  return { value, applied };
}

export function normalizeRuntimeValue(input, subjects, depth = 0) {
  if (depth >= 8) return { value: '<depth-limit>', applied: new Set(['DEPTH_LIMIT']) };
  if (typeof input === 'string') return normalizeString(input, subjects);
  if (Array.isArray(input)) {
    const values = [];
    const applied = new Set();
    for (const item of input) {
      const normalized = normalizeRuntimeValue(item, subjects, depth + 1);
      values.push(normalized.value);
      normalized.applied.forEach((entry) => applied.add(entry));
    }
    return { value: values, applied };
  }
  if (input && typeof input === 'object') {
    const value = {};
    const applied = new Set();
    for (const key of Object.keys(input).sort()) {
      const normalized = normalizeRuntimeValue(input[key], subjects, depth + 1);
      value[key] = normalized.value;
      normalized.applied.forEach((entry) => applied.add(entry));
    }
    return { value, applied };
  }
  return { value: input, applied: new Set() };
}

export function normalizeCapturedTrace(trace, captures, subjects) {
  const observations = trace.observations.map((observation) => {
    const captured = captures.get(observation.observationId);
    if (!captured) return { ...observation, comparisonDigest: null, shapeDigest: null, normalizations: [] };
    const normalized = normalizeRuntimeValue(captured, subjects);
    return {
      observationId: observation.observationId,
      category: observation.category,
      name: observation.name,
      sequence: observation.sequence,
      valueType: observation.valueType,
      comparisonDigest: runtimeValueDigest(normalized.value),
      shapeDigest: runtimeValueDigest(runtimeValueShape(normalized.value)),
      normalizations: [...normalized.applied].sort(),
    };
  });
  return {
    schemaVersion: 1,
    kind: 'normalized-behavior-trace',
    traceId: trace.traceId,
    subject: trace.subject,
    observations,
    errors: trace.errors.map((error) => ({ code: error.code, source: error.source })),
    normalizationPolicyVersion: '1',
  };
}
