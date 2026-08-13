import crypto from 'node:crypto';
import { validateBehaviorTrace, validateRuntimeComparison, validateRuntimeScenario } from '../contracts/schema-v2.js';
import { normalizeRuntimeValue } from './trace-normalizer.js';
import { runtimeValueDigest } from './trace-redaction.js';

function byName(trace) {
  const values = new Map();
  for (const observation of trace.observations) {
    if (!values.has(observation.name)) values.set(observation.name, []);
    values.get(observation.name).push(observation);
  }
  return values;
}

function ids(values) {
  return (values || []).map((entry) => entry.observationId);
}

function allNormalizations(source, target) {
  return [...new Set([...(source || []).flatMap((entry) => entry.normalizations), ...(target || []).flatMap((entry) => entry.normalizations)])].sort();
}

function result(assertion, status, reasonCode, source, target) {
  return {
    assertionId: assertion.assertionId,
    status,
    reasonCode,
    sourceObservationIds: ids(source),
    targetObservationIds: ids(target),
    normalizations: allNormalizations(source, target),
  };
}

function compareAssertion(assertion, sourceTrace, targetTrace, sourceByName, targetByName, subjects) {
  if (assertion.comparator === 'NO_ERROR') {
    if (sourceTrace.errors.length) return result(assertion, 'INCONCLUSIVE', 'SOURCE_RUNTIME_ERROR', [], []);
    if (targetTrace.errors.length) return result(assertion, 'FAILED', 'TARGET_RUNTIME_ERROR', [], []);
    return result(assertion, 'PASSED', 'NO_RUNTIME_ERROR', [], []);
  }
  const source = sourceByName.get(assertion.observation.name) || [];
  const target = targetByName.get(assertion.observation.name) || [];
  if (source.length !== 1 || target.length !== 1 || source[0].comparisonDigest === null || target[0].comparisonDigest === null) {
    return result(assertion, 'INCONCLUSIVE', 'OBSERVATION_MISSING_OR_AMBIGUOUS', source, target);
  }
  if (assertion.comparator === 'V4_V5_EQUAL') {
    return result(assertion, source[0].comparisonDigest === target[0].comparisonDigest ? 'PASSED' : 'FAILED', source[0].comparisonDigest === target[0].comparisonDigest ? 'NORMALIZED_VALUES_EQUAL' : 'NORMALIZED_VALUES_DIFFER', source, target);
  }
  if (assertion.comparator === 'V4_V5_SHAPE_EQUAL') {
    return result(assertion, source[0].shapeDigest === target[0].shapeDigest ? 'PASSED' : 'FAILED', source[0].shapeDigest === target[0].shapeDigest ? 'VALUE_SHAPES_EQUAL' : 'VALUE_SHAPES_DIFFER', source, target);
  }
  const normalizedExpected = normalizeRuntimeValue(assertion.expected, subjects).value;
  const expectedDigest = runtimeValueDigest(normalizedExpected);
  if (source[0].comparisonDigest !== expectedDigest) return result(assertion, 'INCONCLUSIVE', 'SOURCE_EXPECTATION_NOT_MET', source, target);
  return result(assertion, target[0].comparisonDigest === expectedDigest ? 'PASSED' : 'FAILED', target[0].comparisonDigest === expectedDigest ? 'EXPECTED_VALUE_MATCHED' : 'TARGET_EXPECTATION_NOT_MET', source, target);
}

export function compareRuntimeScenario({ scenario, source, target, sourceNormalized, targetNormalized, environment, environmentAssurance = 'STRICT_EQUIVALENT', riskAcceptanceId = null, subjects, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  validateRuntimeScenario(scenario);
  validateBehaviorTrace(source);
  validateBehaviorTrace(target);
  const sourceByName = byName(sourceNormalized);
  const targetByName = byName(targetNormalized);
  const assertions = scenario.assertions.map((assertion) => compareAssertion(assertion, source, target, sourceByName, targetByName, subjects));
  const coverage = {
    total: assertions.length,
    passed: assertions.filter((entry) => entry.status === 'PASSED').length,
    failed: assertions.filter((entry) => entry.status === 'FAILED').length,
    inconclusive: assertions.filter((entry) => entry.status === 'INCONCLUSIVE').length,
  };
  const status = coverage.failed ? 'MISMATCH_DETECTED' : coverage.inconclusive ? 'INCONCLUSIVE' : 'PARITY_PASSED';
  const at = now().toISOString();
  const comparison = {
    schemaVersion: 2,
    kind: 'runtime-comparison',
    comparisonId: `comparison_${randomBytes(6).toString('hex')}`,
    reviewId: source.reviewId,
    cycleId: source.cycleId,
    scenarioId: scenario.scenarioId,
    sourceTraceId: source.traceId,
    targetTraceId: target.traceId,
    environment: {
      comparisonId: environment.comparisonId,
      status: environment.status,
      assurance: environmentAssurance,
      riskAcceptanceId,
    },
    status,
    assertions,
    coverage,
    runtime: {
      driver: source.runtime.driver,
      driverVersion: source.runtime.driverVersion,
      sourceBrowserVersion: source.runtime.browserVersion,
      targetBrowserVersion: target.runtime.browserVersion,
      modes: [...new Set([source.runtime.mode, target.runtime.mode])],
      humanTakeover: source.runtime.mode === 'USER_VISIBLE' || target.runtime.mode === 'USER_VISIBLE',
    },
    evaluatedAt: at,
    createdAt: at,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
  return validateRuntimeComparison(comparison);
}
