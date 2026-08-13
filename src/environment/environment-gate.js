import {
  ENVIRONMENT_GATE_STATUSES,
  validateEnvironmentComparison,
  validateEnvironmentManifest,
} from '../contracts/schema-v2.js';
import { invariant } from '../errors.js';
import { environmentWorkInfoExtraKeys, environmentWorkInfoKeys, resolveEnvironmentFieldPolicy } from './field-policy.js';

function pointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function equalValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function meaningful(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(meaningful);
  if (typeof value === 'object') return Object.values(value).some(meaningful);
  return true;
}

function addField(fields, path, value) {
  fields.set(path, { presence: 'PRESENT', value });
}

function collectCustomVars(fields, customVars) {
  if (customVars === undefined) return;
  if (Array.isArray(customVars)) {
    const seen = new Set();
    for (const item of customVars) {
      const key = item && typeof item === 'object' && !Array.isArray(item) ? item.k : null;
      if (typeof key !== 'string' || !key || seen.has(key)) {
        addField(fields, '/config/customVars', { malformed: true });
        continue;
      }
      seen.add(key);
      const comparable = { ...item };
      delete comparable.k;
      addField(fields, `/config/customVars/${pointerSegment(key)}`, comparable);
    }
    return;
  }
  if (customVars && typeof customVars === 'object') {
    for (const [key, value] of Object.entries(customVars)) {
      addField(fields, `/config/customVars/${pointerSegment(key)}`, value);
    }
    return;
  }
  addField(fields, '/config/customVars', { malformed: true });
}

function collectEnvironmentFields(environment) {
  invariant(environment && typeof environment === 'object' && !Array.isArray(environment), 'ENVIRONMENT_INPUT_INVALID', 'Environment input must be an object');
  const fields = new Map();
  const config = environment.config && typeof environment.config === 'object' && !Array.isArray(environment.config)
    ? environment.config
    : {};
  for (const [key, value] of Object.entries(config)) {
    if (key === 'customVars') collectCustomVars(fields, value);
    else addField(fields, `/config/${pointerSegment(key)}`, value);
  }
  const settings = environment.settings && typeof environment.settings === 'object' && !Array.isArray(environment.settings)
    ? environment.settings
    : {};
  for (const [key, value] of Object.entries(settings)) addField(fields, `/settings/${pointerSegment(key)}`, value);
  const workInfo = environment.workInfo && typeof environment.workInfo === 'object' && !Array.isArray(environment.workInfo)
    ? environment.workInfo
    : {};
  for (const key of environmentWorkInfoKeys()) {
    if (Object.hasOwn(workInfo, key)) addField(fields, `/workInfo/${pointerSegment(key)}`, workInfo[key]);
  }
  let extra = workInfo.extra;
  if (typeof extra === 'string' && extra) {
    try { extra = JSON.parse(extra); } catch { addField(fields, '/workInfo/extra', { malformed: true }); }
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const key of environmentWorkInfoExtraKeys()) {
      if (Object.hasOwn(extra, key)) addField(fields, `/workInfo/extra/${pointerSegment(key)}`, extra[key]);
    }
  }
  return fields;
}

function validateBindingAssertions(bindingAssertions, knownPaths) {
  invariant(bindingAssertions && typeof bindingAssertions === 'object' && !Array.isArray(bindingAssertions), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'bindingAssertions must be an object');
  for (const [path, assertion] of Object.entries(bindingAssertions)) {
    invariant(knownPaths.has(path), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion references an unknown environment path', { path });
    invariant(['USE_TARGET_BINDING', 'REQUIRE_USER_BINDING'].includes(resolveEnvironmentFieldPolicy(path)), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion is not allowed for this field policy', { path });
    invariant(assertion && typeof assertion === 'object' && !Array.isArray(assertion), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion must be an object', { path });
    const keys = Object.keys(assertion).sort();
    invariant(JSON.stringify(keys) === JSON.stringify(['assertedAt', 'assertedBy', 'assertionId', 'equivalent']), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion has an invalid shape', { path });
    invariant(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(assertion.assertionId), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion has an invalid assertionId', { path });
    invariant(assertion.assertedBy === 'USER', 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion must originate from USER', { path });
    invariant(assertion.equivalent === true, 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion must explicitly confirm equivalence', { path });
    invariant(typeof assertion.assertedAt === 'string' && !Number.isNaN(Date.parse(assertion.assertedAt)) && assertion.assertedAt.endsWith('Z'), 'ENVIRONMENT_BINDING_ASSERTION_INVALID', 'Binding assertion has an invalid assertedAt', { path });
  }
  return bindingAssertions;
}

function bindingAssertion(bindingAssertions, path) {
  return Object.hasOwn(bindingAssertions, path) ? bindingAssertions[path] : null;
}

function evaluateField(path, source, target, bindingAssertions) {
  const policy = resolveEnvironmentFieldPolicy(path);
  const sourcePresence = source?.presence || 'ABSENT';
  const targetPresence = target?.presence || 'ABSENT';
  const bothEqual = sourcePresence === targetPresence
    && (sourcePresence === 'ABSENT' || equalValue(source.value, target.value));
  const result = { path, policy, sourcePresence, targetPresence, equivalent: null, disposition: 'BLOCKED', bindingAssertionId: null };
  if (!policy) return result;
  if (policy === 'IGNORE_FOR_PARITY') return { ...result, disposition: 'IGNORED' };
  if (policy === 'COPY_EXACT' || policy === 'REDACT_AND_COMPARE') {
    return { ...result, equivalent: bothEqual, disposition: bothEqual ? 'EQUIVALENT' : 'BLOCKED' };
  }
  if (policy === 'REMAP_FOR_TARGET') {
    if (sourcePresence === 'PRESENT' && targetPresence !== 'PRESENT') {
      return { ...result, equivalent: false, disposition: 'BLOCKED' };
    }
    return { ...result, equivalent: true, disposition: 'NORMALIZED' };
  }
  if (policy === 'USE_TARGET_BINDING') {
    if (!meaningful(source?.value)) {
      return { ...result, equivalent: true, disposition: meaningful(target?.value) ? 'NORMALIZED' : 'EQUIVALENT' };
    }
    if (bothEqual) return { ...result, equivalent: true, disposition: 'EQUIVALENT' };
    const assertion = bindingAssertion(bindingAssertions, path);
    if (assertion) return { ...result, equivalent: true, disposition: 'NORMALIZED', bindingAssertionId: assertion.assertionId };
    return { ...result, equivalent: false, disposition: 'REQUIRES_USER_BINDING' };
  }
  if (policy === 'REQUIRE_USER_BINDING') {
    if (!meaningful(source?.value)) return { ...result, equivalent: true, disposition: 'EQUIVALENT' };
    const assertion = bindingAssertion(bindingAssertions, path);
    if (assertion) return { ...result, equivalent: true, disposition: 'NORMALIZED', bindingAssertionId: assertion.assertionId };
    return { ...result, equivalent: false, disposition: 'REQUIRES_USER_BINDING' };
  }
  return result;
}

function manifestFields(fieldResults, values) {
  return fieldResults.map((result) => {
    const entry = values.get(result.path);
    return {
      path: result.path,
      policy: result.policy,
      presence: entry?.presence || 'ABSENT',
      valueType: entry ? valueType(entry.value) : null,
      comparisonDigest: null,
      equivalent: result.equivalent,
    };
  });
}

function makeManifest({ manifestId, reviewId, subject, revision, fields, createdAt, createdBy }) {
  return validateEnvironmentManifest({
    schemaVersion: 2,
    kind: 'environment-manifest',
    manifestId,
    reviewId,
    subject,
    revision: structuredClone(revision),
    fields,
    redaction: { applied: true, policyVersion: 'environment-field-policy-v1' },
    createdAt,
    createdBy,
    sensitivity: 'REDACTED',
  });
}

export function evaluateEnvironmentGate({
  reviewId,
  sourceManifestId,
  targetManifestId,
  comparisonId,
  source,
  target,
  bindingAssertions = {},
  evaluatedAt = new Date().toISOString(),
  createdBy = 'CLI',
} = {}) {
  const sourceValues = collectEnvironmentFields(source);
  const targetValues = collectEnvironmentFields(target);
  const paths = [...new Set([...sourceValues.keys(), ...targetValues.keys()])].sort();
  const validatedAssertions = validateBindingAssertions(bindingAssertions, new Set(paths));
  const fields = paths.map((path) => evaluateField(path, sourceValues.get(path), targetValues.get(path), validatedAssertions));
  const normalizedPaths = fields.filter((field) => field.disposition === 'NORMALIZED').map((field) => field.path);
  const requiredBindingPaths = fields.filter((field) => field.disposition === 'REQUIRES_USER_BINDING').map((field) => field.path);
  const blockedPaths = fields.filter((field) => field.disposition === 'BLOCKED').map((field) => field.path);
  let status = ENVIRONMENT_GATE_STATUSES[0];
  if (blockedPaths.length) status = 'BLOCKED_ENVIRONMENT';
  else if (requiredBindingPaths.length) status = 'REQUIRES_USER_BINDING';
  else if (normalizedPaths.length) status = 'NORMALIZED_EQUIVALENT';
  const sourceManifest = makeManifest({
    manifestId: sourceManifestId,
    reviewId,
    subject: 'SOURCE_V4',
    revision: source.revision,
    fields: manifestFields(fields, sourceValues),
    createdAt: evaluatedAt,
    createdBy,
  });
  const targetManifest = makeManifest({
    manifestId: targetManifestId,
    reviewId,
    subject: 'TARGET_V5',
    revision: target.revision,
    fields: manifestFields(fields, targetValues),
    createdAt: evaluatedAt,
    createdBy,
  });
  const comparison = validateEnvironmentComparison({
    schemaVersion: 2,
    kind: 'environment-comparison',
    comparisonId,
    reviewId,
    sourceManifestId,
    targetManifestId,
    status,
    fields,
    normalizedPaths,
    requiredBindingPaths,
    blockedPaths,
    evaluatedAt,
    createdAt: evaluatedAt,
    createdBy,
    sensitivity: 'REDACTED',
  });
  return { sourceManifest, targetManifest, comparison };
}
