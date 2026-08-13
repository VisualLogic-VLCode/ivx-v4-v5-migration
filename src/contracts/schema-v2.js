import { invariant } from '../errors.js';

export const ISSUE_CAUSES = Object.freeze([
  'CONVERTER',
  'SOURCE_DATA',
  'TARGET_CASE',
  'TEST_HARNESS',
  'ENVIRONMENT_CONFIGURATION',
  'PLATFORM_RUNTIME',
  'KNOWLEDGE_GAP',
  'AUTHORIZATION',
  'UNKNOWN',
]);

export const RESPONSIBLE_PARTIES = Object.freeze([
  'CONVERTER_MAINTAINER',
  'WORKFLOW_AI',
  'USER',
  'PLATFORM_MAINTAINER',
  'KNOWLEDGE_MAINTAINER',
  'UNKNOWN',
]);

export const REPAIR_TARGETS = Object.freeze([
  'NONE',
  'V5_ARTIFACT',
  'RUNTIME_SCENARIO',
  'ENVIRONMENT_BINDING',
  'KNOWLEDGE_RULE',
  'AUTHORIZATION_PREREQUISITE',
]);

export const ENVIRONMENT_FIELD_POLICIES = Object.freeze([
  'COPY_EXACT',
  'REMAP_FOR_TARGET',
  'USE_TARGET_BINDING',
  'REQUIRE_USER_BINDING',
  'REDACT_AND_COMPARE',
  'IGNORE_FOR_PARITY',
]);

export const ENVIRONMENT_GATE_STATUSES = Object.freeze([
  'ENVIRONMENT_EQUIVALENT',
  'NORMALIZED_EQUIVALENT',
  'REQUIRES_USER_BINDING',
  'BLOCKED_ENVIRONMENT',
]);

export const AUTOMATIC_REPAIR_DECISIONS = Object.freeze([
  'AUTO_REPAIR_ALLOWED',
  'AUTO_REPAIR_PAUSED',
  'AUTO_REPAIR_STOPPED',
]);

export const REPAIR_BUDGET_STATES = Object.freeze([
  'AVAILABLE',
  'PAUSED',
  'FROZEN',
  'EXHAUSTED',
]);

export const REPAIR_AUTHORIZATION_SCOPES = Object.freeze(['INITIAL', 'EXTENSION']);
export const REPAIR_BATCH_STATES = Object.freeze([
  'LOCAL_VALIDATED',
  'WRITE_REQUESTED',
  'WRITE_OUTCOME_UNKNOWN',
  'READBACK_VERIFIED',
  'RECONCILIATION_REQUIRED',
  'RUNTIME_TESTING',
  'RUNTIME_VERIFIED',
  'RUNTIME_FAILED',
]);

export const DIAGNOSTIC_SAVE_STATUSES = Object.freeze([
  'DIAGNOSTIC_SAVE_ELIGIBLE',
  'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH',
  'DIAGNOSTIC_SAVE_WAITING_FOR_PLATFORM',
  'DIAGNOSTIC_SAVE_RECONCILIATION_REQUIRED',
  'DIAGNOSTIC_SAVE_UNSAFE_ARTIFACT',
]);

export const REVIEW_STATUSES = Object.freeze([
  'REVIEW_OPEN',
  'ENVIRONMENT_PREFLIGHT',
  'AWAITING_USER_BINDING',
  'BLOCKED_ENVIRONMENT',
  'RUNTIME_TESTING',
  'MISMATCH_DETECTED',
  'DIAGNOSING',
  'CONVERTER_REPORT_READY',
  'REPAIR_PROPOSED',
  'TEST_OR_ENV_REPAIR',
  'AUTO_REPAIR_STOPPED',
  'AWAITING_HUMAN_EVIDENCE',
  'LOCAL_VALIDATING',
  'READY_TO_UPDATE_TARGET',
  'TARGET_UPDATED',
  'TARGET_EXTERNALLY_MODIFIED',
  'RUNTIME_RETESTING',
  'RUNTIME_PARITY_PASSED',
  'RUNTIME_REPAIR_EXHAUSTED',
  'BLOCKED_PLATFORM_RUNTIME',
  'RUNTIME_NOT_TESTED',
]);

export const REVIEW_CAPABILITIES = Object.freeze(['READ_ONLY', 'WRITE']);

const CREATED_BY = new Set(['CLI', 'AGENT', 'USER']);
const SENSITIVITY = new Set(['PRIVATE', 'REDACTED']);
const SIDE_EFFECTS = new Set(['READ_ONLY', 'REVERSIBLE', 'EXTERNAL_SIDE_EFFECT']);
const EXECUTION_MODES = new Set(['UNATTENDED', 'USER_VISIBLE']);
export const RUNTIME_ACTION_TYPES = Object.freeze([
  'OPEN_PAGE',
  'CLICK',
  'FILL',
  'SELECT_OPTION',
  'CHECK',
  'UNCHECK',
  'PRESS',
  'WAIT_FOR',
  'RELOAD',
  'GO_BACK',
]);
export const RUNTIME_LOCATOR_STRATEGIES = Object.freeze(['ROLE', 'LABEL', 'PLACEHOLDER', 'TEXT', 'TEST_ID']);
export const RUNTIME_OBSERVATION_CAPTURES = Object.freeze(['TEXT', 'VALUE', 'VISIBLE', 'COUNT', 'URL']);
const PREREQUISITE_STATES = new Set(['SATISFIED', 'MISSING', 'UNAVAILABLE', 'UNKNOWN']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const JOB_ID_PATTERN = /^mig_[A-Za-z0-9_]+$/;
const REVIEW_ID_PATTERN = /^rev_[A-Za-z0-9_]+$/;
const SECRET_KEY = /^(?:token|accesstoken|refreshtoken|bearertoken|cookie|authorization|password|secret|clientsecret|secretkey|privatekey|certificatepassword|apikey|accesskey)$/i;
const SECRET_TARGET = /(?:password|passwd|token|cookie|authorization|secret|api[-_ ]?key|密码|验证码)/iu;

function fail(message, details) {
  invariant(false, 'SCHEMA_V2_INVALID', message, details);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
  return value;
}

function exactKeys(value, required, allowed, path) {
  const object = record(value, path);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) fail(`${path}.${key} is required`);
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) fail(`${path}.${key} is not allowed`);
  }
  return object;
}

function string(value, path, { min = 1, max = 4096, pattern } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    fail(`${path} must be a non-empty string no longer than ${max} characters`);
  }
  if (pattern && !pattern.test(value)) fail(`${path} has an invalid format`);
  return value;
}

function nullableString(value, path, options) {
  if (value === null) return value;
  return string(value, path, options);
}

function enumValue(value, allowed, path) {
  const values = allowed instanceof Set ? allowed : new Set(allowed);
  if (!values.has(value)) fail(`${path} must be one of: ${[...values].join(', ')}`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
  return value;
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${path} must be an integer between ${min} and ${max}`);
  return value;
}

function number(value, path, { min = 0, max = 1 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${path} must be a number between ${min} and ${max}`);
  }
  return value;
}

function array(value, path, { max = 1000 } = {}) {
  if (!Array.isArray(value) || value.length > max) fail(`${path} must be an array with at most ${max} items`);
  return value;
}

function uniqueStrings(value, path, { max = 1000 } = {}) {
  const items = array(value, path, { max }).map((item, index) => string(item, `${path}[${index}]`, { max: 512 }));
  if (new Set(items).size !== items.length) fail(`${path} must not contain duplicates`);
  return items;
}

function isoDate(value, path) {
  string(value, path, { max: 64 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${path} must be an ISO-8601 UTC date-time`);
  }
  return value;
}

function nullableIsoDate(value, path) {
  if (value === null) return value;
  return isoDate(value, path);
}

function id(value, path) {
  return string(value, path, { max: 128, pattern: ID_PATTERN });
}

function jobId(value, path = 'jobId') {
  return string(value, path, { max: 128, pattern: JOB_ID_PATTERN });
}

function reviewId(value, path = 'reviewId') {
  return string(value, path, { max: 128, pattern: REVIEW_ID_PATTERN });
}

function sha256(value, path) {
  return string(value, path, { min: 64, max: 64, pattern: SHA256_PATTERN });
}

function nullableSha256(value, path) {
  if (value === null) return value;
  return sha256(value, path);
}

function assertNoSecretKeys(value, path = '$', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, '');
    if (SECRET_KEY.test(normalizedKey)) fail(`${path}.${key} is a forbidden secret-bearing field`);
    assertNoSecretKeys(child, `${path}.${key}`, seen);
  }
}

function schemaHeader(document, kind) {
  const object = record(document, '$');
  if (object.schemaVersion !== 2) fail('schemaVersion must be 2');
  if (object.kind !== kind) fail(`kind must be ${kind}`);
  assertNoSecretKeys(object);
  return object;
}

function validateArtifactMetadata(document, path = '$') {
  enumValue(document.createdBy, CREATED_BY, `${path}.createdBy`);
  enumValue(document.sensitivity, SENSITIVITY, `${path}.sensitivity`);
  isoDate(document.createdAt, `${path}.createdAt`);
}

function validateEvidenceRefs(document, path) {
  uniqueStrings(document.evidenceRefs, `${path}.evidenceRefs`, { max: 200 });
  uniqueStrings(document.knowledgeRuleIds, `${path}.knowledgeRuleIds`, { max: 200 });
}

const CAUSE_DEFAULTS = Object.freeze({
  CONVERTER: ['CONVERTER_MAINTAINER', 'NONE'],
  SOURCE_DATA: ['WORKFLOW_AI', 'V5_ARTIFACT'],
  TARGET_CASE: ['WORKFLOW_AI', 'V5_ARTIFACT'],
  TEST_HARNESS: ['WORKFLOW_AI', 'RUNTIME_SCENARIO'],
  ENVIRONMENT_CONFIGURATION: ['USER', 'ENVIRONMENT_BINDING'],
  PLATFORM_RUNTIME: ['PLATFORM_MAINTAINER', 'NONE'],
  KNOWLEDGE_GAP: ['KNOWLEDGE_MAINTAINER', 'KNOWLEDGE_RULE'],
  AUTHORIZATION: ['USER', 'AUTHORIZATION_PREREQUISITE'],
  UNKNOWN: ['UNKNOWN', 'NONE'],
});

function validateClassificationIssue(issue, index) {
  const path = `$.issues[${index}]`;
  exactKeys(issue,
    ['issueId', 'clusterId', 'cause', 'responsibleParty', 'repairTarget', 'confidence', 'reason', 'evidenceRefs', 'knowledgeRuleIds', 'autoRepairAllowed'],
    ['issueId', 'clusterId', 'cause', 'responsibleParty', 'repairTarget', 'confidence', 'reason', 'evidenceRefs', 'knowledgeRuleIds', 'autoRepairAllowed'],
    path);
  id(issue.issueId, `${path}.issueId`);
  id(issue.clusterId, `${path}.clusterId`);
  enumValue(issue.cause, ISSUE_CAUSES, `${path}.cause`);
  enumValue(issue.responsibleParty, RESPONSIBLE_PARTIES, `${path}.responsibleParty`);
  enumValue(issue.repairTarget, REPAIR_TARGETS, `${path}.repairTarget`);
  number(issue.confidence, `${path}.confidence`);
  string(issue.reason, `${path}.reason`, { max: 8192 });
  validateEvidenceRefs(issue, path);
  boolean(issue.autoRepairAllowed, `${path}.autoRepairAllowed`);
  const [expectedParty, expectedTarget] = CAUSE_DEFAULTS[issue.cause];
  if (issue.responsibleParty !== expectedParty) fail(`${path}.responsibleParty is inconsistent with cause ${issue.cause}`);
  if (issue.repairTarget !== expectedTarget) fail(`${path}.repairTarget is inconsistent with cause ${issue.cause}`);
  const canAutoRepair = ['SOURCE_DATA', 'TARGET_CASE'].includes(issue.cause)
    && issue.responsibleParty === 'WORKFLOW_AI'
    && issue.repairTarget === 'V5_ARTIFACT';
  if (issue.autoRepairAllowed && !canAutoRepair) fail(`${path}.autoRepairAllowed is forbidden for cause ${issue.cause}`);
}

export function validateIssueClassificationV2(document, validationReport) {
  schemaHeader(document, 'issue-classification');
  exactKeys(document,
    ['schemaVersion', 'kind', 'jobId', 'reviewId', 'classifiedAt', 'createdBy', 'sensitivity', 'issues'],
    ['schemaVersion', 'kind', 'jobId', 'reviewId', 'classifiedAt', 'createdBy', 'sensitivity', 'issues'],
    '$');
  jobId(document.jobId);
  if (document.reviewId !== null) reviewId(document.reviewId);
  isoDate(document.classifiedAt, '$.classifiedAt');
  enumValue(document.createdBy, CREATED_BY, '$.createdBy');
  enumValue(document.sensitivity, SENSITIVITY, '$.sensitivity');
  const issues = array(document.issues, '$.issues', { max: 2000 });
  const issueIds = new Set();
  issues.forEach((issue, index) => {
    validateClassificationIssue(issue, index);
    if (issueIds.has(issue.issueId)) fail(`$.issues contains duplicate issueId ${issue.issueId}`);
    issueIds.add(issue.issueId);
  });
  if (validationReport) {
    const expected = new Set((validationReport.issues || []).map((issue) => issue.issueId));
    for (const issueIdValue of issueIds) {
      if (!expected.delete(issueIdValue)) fail(`Unknown issue id: ${issueIdValue}`);
    }
    if (expected.size > 0) fail('Every validation issue must be classified', { missingIssueIds: [...expected] });
  }
  return document;
}

export function validateIssueCluster(document) {
  schemaHeader(document, 'issue-cluster');
  exactKeys(document,
    ['schemaVersion', 'kind', 'clusterId', 'diagnosisId', 'jobId', 'reviewId', 'issueIds', 'cause', 'responsibleParty', 'repairTarget', 'confidence', 'evidenceRefs', 'knowledgeRuleIds', 'classificationSha256', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'clusterId', 'diagnosisId', 'jobId', 'reviewId', 'issueIds', 'cause', 'responsibleParty', 'repairTarget', 'confidence', 'evidenceRefs', 'knowledgeRuleIds', 'classificationSha256', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.clusterId, '$.clusterId');
  id(document.diagnosisId, '$.diagnosisId');
  jobId(document.jobId);
  reviewId(document.reviewId);
  uniqueStrings(document.issueIds, '$.issueIds', { max: 2000 });
  if (document.issueIds.length === 0) fail('$.issueIds must contain at least one issue');
  enumValue(document.cause, ISSUE_CAUSES, '$.cause');
  enumValue(document.responsibleParty, RESPONSIBLE_PARTIES, '$.responsibleParty');
  enumValue(document.repairTarget, REPAIR_TARGETS, '$.repairTarget');
  exactKeys(document.confidence, ['minimum', 'average'], ['minimum', 'average'], '$.confidence');
  number(document.confidence.minimum, '$.confidence.minimum');
  number(document.confidence.average, '$.confidence.average');
  if (document.confidence.average < document.confidence.minimum) fail('$.confidence.average cannot be less than minimum');
  validateEvidenceRefs(document, '$');
  sha256(document.classificationSha256, '$.classificationSha256');
  validateArtifactMetadata(document);
  const [expectedParty, expectedTarget] = CAUSE_DEFAULTS[document.cause];
  if (document.responsibleParty !== expectedParty || document.repairTarget !== expectedTarget) {
    fail('Issue Cluster responsibility and repair target must match its cause');
  }
  return document;
}

function validateScenarioLocator(target, path) {
  exactKeys(target, ['strategy', 'value'], ['strategy', 'value', 'role', 'exact'], path);
  enumValue(target.strategy, RUNTIME_LOCATOR_STRATEGIES, `${path}.strategy`);
  string(target.value, `${path}.value`, { max: 512 });
  if (target.role !== undefined) string(target.role, `${path}.role`, { max: 128, pattern: ID_PATTERN });
  if (target.exact !== undefined) boolean(target.exact, `${path}.exact`);
  if (target.strategy === 'ROLE' && target.role === undefined) fail(`${path}.role is required for ROLE locators`);
  if (target.strategy !== 'ROLE' && target.role !== undefined) fail(`${path}.role is allowed only for ROLE locators`);
}

function validateScenarioStep(step, index, collection) {
  const path = `$.${collection}[${index}]`;
  exactKeys(step, ['stepId', 'type'], ['stepId', 'type', 'target', 'input', 'timeoutMs'], path);
  id(step.stepId, `${path}.stepId`);
  enumValue(step.type, RUNTIME_ACTION_TYPES, `${path}.type`);
  if (step.target !== undefined) validateScenarioLocator(step.target, `${path}.target`);
  if (step.input !== undefined && !['string', 'number', 'boolean'].includes(typeof step.input) && step.input !== null) {
    fail(`${path}.input must be a scalar or null`);
  }
  if (typeof step.input === 'string' && step.input.length > 4096) fail(`${path}.input is too long`);
  if (step.timeoutMs !== undefined) integer(step.timeoutMs, `${path}.timeoutMs`, { min: 1, max: 300000 });
  const needsTarget = ['CLICK', 'FILL', 'SELECT_OPTION', 'CHECK', 'UNCHECK', 'PRESS', 'WAIT_FOR'].includes(step.type);
  const needsInput = ['OPEN_PAGE', 'FILL', 'SELECT_OPTION', 'PRESS'].includes(step.type);
  if (needsTarget && step.target === undefined) fail(`${path}.target is required for ${step.type}`);
  if (!needsTarget && step.target !== undefined) fail(`${path}.target is not allowed for ${step.type}`);
  if (needsInput && step.input === undefined) fail(`${path}.input is required for ${step.type}`);
  if (!needsInput && step.input !== undefined) fail(`${path}.input is not allowed for ${step.type}`);
  if (step.type === 'OPEN_PAGE' && (
    typeof step.input !== 'string'
    || (step.input !== '$SUBJECT_URL' && !step.input.startsWith('/'))
  )) fail(`${path}.input must be $SUBJECT_URL or a same-origin absolute path for OPEN_PAGE`);
  if (step.type === 'PRESS' && !['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(step.input)) {
    fail(`${path}.input is not an allowed key for PRESS`);
  }
  if (step.type === 'FILL' && SECRET_TARGET.test(`${step.target.value} ${step.target.role || ''}`)) {
    fail(`${path} cannot persist authentication or secret entry; use the private browser authentication profile`);
  }
}

function validateScenarioAssertion(assertion, index) {
  const path = `$.assertions[${index}]`;
  exactKeys(assertion, ['assertionId', 'observation', 'comparator'], ['assertionId', 'observation', 'comparator', 'expected', 'allowedDifference'], path);
  id(assertion.assertionId, `${path}.assertionId`);
  exactKeys(assertion.observation, ['name', 'category', 'capture'], ['name', 'category', 'capture', 'target'], `${path}.observation`);
  id(assertion.observation.name, `${path}.observation.name`);
  enumValue(assertion.observation.category, ['UI', 'ROUTE', 'CONSOLE', 'NETWORK'], `${path}.observation.category`);
  enumValue(assertion.observation.capture, RUNTIME_OBSERVATION_CAPTURES, `${path}.observation.capture`);
  if (assertion.observation.target !== undefined) validateScenarioLocator(assertion.observation.target, `${path}.observation.target`);
  if (assertion.observation.capture === 'URL') {
    if (assertion.observation.category !== 'ROUTE' || assertion.observation.target !== undefined) fail(`${path}.observation URL capture must be a target-free ROUTE observation`);
  } else if (assertion.observation.target === undefined && !['CONSOLE', 'NETWORK'].includes(assertion.observation.category)) {
    fail(`${path}.observation.target is required for ${assertion.observation.capture}`);
  }
  enumValue(assertion.comparator, ['V4_V5_EQUAL', 'V4_V5_SHAPE_EQUAL', 'EXPECTED_VALUE', 'NO_ERROR'], `${path}.comparator`);
  if (assertion.comparator === 'NO_ERROR' && !['CONSOLE', 'NETWORK'].includes(assertion.observation.category)) fail(`${path}.NO_ERROR must observe CONSOLE or NETWORK`);
  if (assertion.comparator !== 'NO_ERROR' && ['CONSOLE', 'NETWORK'].includes(assertion.observation.category)) fail(`${path} console/network assertions currently support only NO_ERROR`);
  if (assertion.expected !== undefined && !['string', 'number', 'boolean'].includes(typeof assertion.expected) && assertion.expected !== null) {
    fail(`${path}.expected must be a scalar or null`);
  }
  if (assertion.allowedDifference !== undefined) string(assertion.allowedDifference, `${path}.allowedDifference`, { max: 1024 });
}

export function validateRuntimeScenario(document) {
  schemaHeader(document, 'runtime-scenario');
  exactKeys(document,
    ['schemaVersion', 'kind', 'scenarioId', 'version', 'name', 'source', 'sideEffect', 'executionPolicy', 'networkPolicy', 'artifactPolicy', 'preconditions', 'actions', 'assertions', 'cleanup', 'knowledgeRuleIds', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'scenarioId', 'version', 'name', 'source', 'sideEffect', 'executionPolicy', 'networkPolicy', 'artifactPolicy', 'preconditions', 'actions', 'assertions', 'cleanup', 'knowledgeRuleIds', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.scenarioId, '$.scenarioId');
  integer(document.version, '$.version', { min: 1 });
  string(document.name, '$.name', { max: 256 });
  exactKeys(document.source, ['type', 'reference'], ['type', 'reference'], '$.source');
  enumValue(document.source.type, ['USER', 'MAINTAINER', 'DETERMINISTIC', 'AI'], '$.source.type');
  nullableString(document.source.reference, '$.source.reference', { max: 512 });
  enumValue(document.sideEffect, SIDE_EFFECTS, '$.sideEffect');
  exactKeys(document.executionPolicy, ['mode', 'authorizationRequired', 'cleanupRequired'], ['mode', 'authorizationRequired', 'cleanupRequired'], '$.executionPolicy');
  enumValue(document.executionPolicy.mode, EXECUTION_MODES, '$.executionPolicy.mode');
  boolean(document.executionPolicy.authorizationRequired, '$.executionPolicy.authorizationRequired');
  boolean(document.executionPolicy.cleanupRequired, '$.executionPolicy.cleanupRequired');
  exactKeys(document.networkPolicy, ['unsafeRequests'], ['unsafeRequests'], '$.networkPolicy');
  enumValue(document.networkPolicy.unsafeRequests, ['BLOCK', 'ALLOW_WITH_AUTHORIZATION'], '$.networkPolicy.unsafeRequests');
  exactKeys(document.artifactPolicy, ['screenshots', 'nativePlaywrightTrace'], ['screenshots', 'nativePlaywrightTrace'], '$.artifactPolicy');
  enumValue(document.artifactPolicy.screenshots, ['OFF', 'FAILURES_ONLY'], '$.artifactPolicy.screenshots');
  if (document.artifactPolicy.nativePlaywrightTrace !== false) fail('Native Playwright traces are forbidden because they may persist authentication and response data');
  uniqueStrings(document.preconditions, '$.preconditions', { max: 100 });
  const actions = array(document.actions, '$.actions', { max: 200 });
  if (actions.length === 0) fail('Runtime Scenario requires at least one action');
  actions.forEach((step, index) => validateScenarioStep(step, index, 'actions'));
  const assertions = array(document.assertions, '$.assertions', { max: 200 });
  if (assertions.length === 0) fail('Runtime Scenario requires at least one assertion');
  assertions.forEach(validateScenarioAssertion);
  array(document.cleanup, '$.cleanup', { max: 100 }).forEach((step, index) => validateScenarioStep(step, index, 'cleanup'));
  uniqueStrings(document.knowledgeRuleIds, '$.knowledgeRuleIds', { max: 200 });
  validateArtifactMetadata(document);
  if (document.sideEffect === 'REVERSIBLE') {
    if (!document.executionPolicy.authorizationRequired || !document.executionPolicy.cleanupRequired || document.cleanup.length === 0) {
      fail('REVERSIBLE scenarios require authorization and a non-empty cleanup plan');
    }
    if (document.networkPolicy.unsafeRequests !== 'ALLOW_WITH_AUTHORIZATION') fail('REVERSIBLE scenarios must explicitly allow unsafe requests under authorization');
  }
  if (document.sideEffect === 'EXTERNAL_SIDE_EFFECT') {
    if (document.executionPolicy.mode !== 'USER_VISIBLE' || !document.executionPolicy.authorizationRequired) {
      fail('EXTERNAL_SIDE_EFFECT scenarios require USER_VISIBLE mode and authorization');
    }
    if (document.networkPolicy.unsafeRequests !== 'ALLOW_WITH_AUTHORIZATION') fail('EXTERNAL_SIDE_EFFECT scenarios must explicitly allow unsafe requests under authorization');
  }
  if (document.sideEffect === 'READ_ONLY') {
    if (document.executionPolicy.authorizationRequired || document.executionPolicy.cleanupRequired || document.cleanup.length > 0) {
      fail('READ_ONLY scenarios cannot require authorization or cleanup');
    }
    if (document.networkPolicy.unsafeRequests !== 'BLOCK') fail('READ_ONLY scenarios must block unsafe network requests');
  }
  return document;
}

function validateTraceSubject(subject) {
  exactKeys(subject, ['generation', 'nid', 'workId'], ['generation', 'nid', 'workId'], '$.subject');
  enumValue(subject.generation, ['V4', 'V5'], '$.subject.generation');
  integer(subject.nid, '$.subject.nid', { min: 1 });
  string(subject.workId, '$.subject.workId', { max: 256 });
}

function validateTraceObservation(observation, index) {
  const path = `$.observations[${index}]`;
  exactKeys(observation,
    ['observationId', 'category', 'name', 'sequence', 'valueType', 'valueDigest', 'summary'],
    ['observationId', 'category', 'name', 'sequence', 'valueType', 'valueDigest', 'summary'],
    path);
  id(observation.observationId, `${path}.observationId`);
  enumValue(observation.category, ['UI', 'STATE', 'ROUTE', 'EVENT', 'SERVICE', 'NETWORK', 'CONSOLE'], `${path}.category`);
  string(observation.name, `${path}.name`, { max: 512 });
  integer(observation.sequence, `${path}.sequence`, { min: 0 });
  string(observation.valueType, `${path}.valueType`, { max: 128 });
  nullableSha256(observation.valueDigest, `${path}.valueDigest`);
  string(observation.summary, `${path}.summary`, { max: 4096 });
}

function validateTraceError(error, index) {
  const path = `$.errors[${index}]`;
  exactKeys(error, ['code', 'message', 'at', 'source'], ['code', 'message', 'at', 'source'], path);
  string(error.code, `${path}.code`, { max: 128, pattern: ID_PATTERN });
  string(error.message, `${path}.message`, { max: 4096 });
  isoDate(error.at, `${path}.at`);
  enumValue(error.source, ['PAGE', 'CONSOLE', 'NETWORK', 'DRIVER', 'PLATFORM'], `${path}.source`);
}

function validateArtifactRef(artifact, index) {
  const path = `$.artifacts[${index}]`;
  exactKeys(artifact, ['artifactId', 'type', 'path', 'sha256'], ['artifactId', 'type', 'path', 'sha256'], path);
  id(artifact.artifactId, `${path}.artifactId`);
  enumValue(artifact.type, ['SCREENSHOT', 'TRACE', 'LOG_SUMMARY'], `${path}.type`);
  string(artifact.path, `${path}.path`, { max: 1024 });
  if (artifact.path.startsWith('/') || artifact.path.includes('..')) fail(`${path}.path must be a safe relative path`);
  sha256(artifact.sha256, `${path}.sha256`);
}

export function validateBehaviorTrace(document) {
  schemaHeader(document, 'behavior-trace');
  exactKeys(document,
    ['schemaVersion', 'kind', 'traceId', 'reviewId', 'scenarioId', 'cycleId', 'subject', 'runtime', 'startedAt', 'endedAt', 'status', 'observations', 'errors', 'artifacts', 'redaction', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'traceId', 'reviewId', 'scenarioId', 'cycleId', 'subject', 'runtime', 'startedAt', 'endedAt', 'status', 'observations', 'errors', 'artifacts', 'redaction', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.traceId, '$.traceId');
  reviewId(document.reviewId);
  id(document.scenarioId, '$.scenarioId');
  id(document.cycleId, '$.cycleId');
  validateTraceSubject(document.subject);
  exactKeys(document.runtime, ['driver', 'driverVersion', 'browserVersion', 'mode'], ['driver', 'driverVersion', 'browserVersion', 'mode'], '$.runtime');
  string(document.runtime.driver, '$.runtime.driver', { max: 128 });
  string(document.runtime.driverVersion, '$.runtime.driverVersion', { max: 128 });
  string(document.runtime.browserVersion, '$.runtime.browserVersion', { max: 128 });
  enumValue(document.runtime.mode, EXECUTION_MODES, '$.runtime.mode');
  isoDate(document.startedAt, '$.startedAt');
  isoDate(document.endedAt, '$.endedAt');
  if (Date.parse(document.endedAt) < Date.parse(document.startedAt)) fail('endedAt must not precede startedAt');
  enumValue(document.status, ['COMPLETED', 'FAILED', 'INTERRUPTED'], '$.status');
  array(document.observations, '$.observations', { max: 10000 }).forEach(validateTraceObservation);
  array(document.errors, '$.errors', { max: 1000 }).forEach(validateTraceError);
  array(document.artifacts, '$.artifacts', { max: 1000 }).forEach(validateArtifactRef);
  exactKeys(document.redaction, ['applied', 'policyVersion', 'omittedCategories'], ['applied', 'policyVersion', 'omittedCategories'], '$.redaction');
  if (document.redaction.applied !== true) fail('Behavior Trace redaction.applied must be true');
  string(document.redaction.policyVersion, '$.redaction.policyVersion', { max: 128 });
  uniqueStrings(document.redaction.omittedCategories, '$.redaction.omittedCategories', { max: 100 });
  validateArtifactMetadata(document);
  return document;
}

function validateRuntimeAssertionResult(result, index) {
  const path = `$.assertions[${index}]`;
  exactKeys(result,
    ['assertionId', 'status', 'reasonCode', 'sourceObservationIds', 'targetObservationIds', 'normalizations'],
    ['assertionId', 'status', 'reasonCode', 'sourceObservationIds', 'targetObservationIds', 'normalizations'],
    path);
  id(result.assertionId, `${path}.assertionId`);
  enumValue(result.status, ['PASSED', 'FAILED', 'INCONCLUSIVE'], `${path}.status`);
  id(result.reasonCode, `${path}.reasonCode`);
  uniqueStrings(result.sourceObservationIds, `${path}.sourceObservationIds`, { max: 100 });
  uniqueStrings(result.targetObservationIds, `${path}.targetObservationIds`, { max: 100 });
  uniqueStrings(result.normalizations, `${path}.normalizations`, { max: 100 });
}

export function validateRuntimeComparison(document) {
  schemaHeader(document, 'runtime-comparison');
  exactKeys(document,
    ['schemaVersion', 'kind', 'comparisonId', 'reviewId', 'cycleId', 'scenarioId', 'sourceTraceId', 'targetTraceId', 'environment', 'status', 'assertions', 'coverage', 'runtime', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'comparisonId', 'reviewId', 'cycleId', 'scenarioId', 'sourceTraceId', 'targetTraceId', 'environment', 'status', 'assertions', 'coverage', 'runtime', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.comparisonId, '$.comparisonId');
  reviewId(document.reviewId);
  id(document.cycleId, '$.cycleId');
  id(document.scenarioId, '$.scenarioId');
  id(document.sourceTraceId, '$.sourceTraceId');
  id(document.targetTraceId, '$.targetTraceId');
  exactKeys(document.environment, ['comparisonId', 'status'], ['comparisonId', 'status'], '$.environment');
  id(document.environment.comparisonId, '$.environment.comparisonId');
  enumValue(document.environment.status, ENVIRONMENT_GATE_STATUSES, '$.environment.status');
  enumValue(document.status, ['PARITY_PASSED', 'MISMATCH_DETECTED', 'INCONCLUSIVE'], '$.status');
  const assertions = array(document.assertions, '$.assertions', { max: 200 });
  const assertionIds = new Set();
  assertions.forEach((result, index) => {
    validateRuntimeAssertionResult(result, index);
    if (assertionIds.has(result.assertionId)) fail(`$.assertions contains duplicate assertionId ${result.assertionId}`);
    assertionIds.add(result.assertionId);
  });
  exactKeys(document.coverage, ['total', 'passed', 'failed', 'inconclusive'], ['total', 'passed', 'failed', 'inconclusive'], '$.coverage');
  for (const key of ['total', 'passed', 'failed', 'inconclusive']) integer(document.coverage[key], `$.coverage.${key}`, { min: 0, max: 200 });
  if (document.coverage.total !== assertions.length || document.coverage.total !== document.coverage.passed + document.coverage.failed + document.coverage.inconclusive) {
    fail('$.coverage must exactly summarize assertion results');
  }
  if (document.status === 'PARITY_PASSED' && (document.coverage.failed || document.coverage.inconclusive)) fail('PARITY_PASSED requires every assertion to pass');
  if (document.status === 'MISMATCH_DETECTED' && document.coverage.failed === 0) fail('MISMATCH_DETECTED requires a failed assertion');
  if (document.status === 'INCONCLUSIVE' && document.coverage.inconclusive === 0) fail('INCONCLUSIVE requires an inconclusive assertion');
  exactKeys(document.runtime, ['driver', 'driverVersion', 'sourceBrowserVersion', 'targetBrowserVersion', 'modes', 'humanTakeover'], ['driver', 'driverVersion', 'sourceBrowserVersion', 'targetBrowserVersion', 'modes', 'humanTakeover'], '$.runtime');
  string(document.runtime.driver, '$.runtime.driver', { max: 128 });
  string(document.runtime.driverVersion, '$.runtime.driverVersion', { max: 128 });
  string(document.runtime.sourceBrowserVersion, '$.runtime.sourceBrowserVersion', { max: 128 });
  string(document.runtime.targetBrowserVersion, '$.runtime.targetBrowserVersion', { max: 128 });
  uniqueStrings(document.runtime.modes, '$.runtime.modes', { max: 2 }).forEach((mode, index) => enumValue(mode, EXECUTION_MODES, `$.runtime.modes[${index}]`));
  boolean(document.runtime.humanTakeover, '$.runtime.humanTakeover');
  isoDate(document.evaluatedAt, '$.evaluatedAt');
  validateArtifactMetadata(document);
  return document;
}

function validateEnvironmentField(field, index) {
  const path = `$.fields[${index}]`;
  exactKeys(field,
    ['path', 'policy', 'presence', 'valueType', 'comparisonDigest', 'equivalent'],
    ['path', 'policy', 'presence', 'valueType', 'comparisonDigest', 'equivalent'],
    path);
  string(field.path, `${path}.path`, { max: 1024 });
  if (field.policy !== null) enumValue(field.policy, ENVIRONMENT_FIELD_POLICIES, `${path}.policy`);
  enumValue(field.presence, ['PRESENT', 'ABSENT', 'UNKNOWN'], `${path}.presence`);
  nullableString(field.valueType, `${path}.valueType`, { max: 128 });
  nullableSha256(field.comparisonDigest, `${path}.comparisonDigest`);
  if (field.equivalent !== null) boolean(field.equivalent, `${path}.equivalent`);
  if (field.presence !== 'PRESENT' && (field.valueType !== null || field.comparisonDigest !== null)) {
    fail(`${path} cannot describe value metadata when presence is ${field.presence}`);
  }
}

export function validateEnvironmentManifest(document) {
  schemaHeader(document, 'environment-manifest');
  exactKeys(document,
    ['schemaVersion', 'kind', 'manifestId', 'reviewId', 'subject', 'revision', 'fields', 'redaction', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'manifestId', 'reviewId', 'subject', 'revision', 'fields', 'redaction', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.manifestId, '$.manifestId');
  reviewId(document.reviewId);
  enumValue(document.subject, ['SOURCE_V4', 'TARGET_V5'], '$.subject');
  exactKeys(document.revision, ['nid', 'workId'], ['nid', 'workId'], '$.revision');
  integer(document.revision.nid, '$.revision.nid', { min: 1 });
  string(document.revision.workId, '$.revision.workId', { max: 256 });
  const fields = array(document.fields, '$.fields', { max: 5000 });
  const fieldPaths = new Set();
  fields.forEach((field, index) => {
    validateEnvironmentField(field, index);
    if (fieldPaths.has(field.path)) fail(`$.fields contains duplicate path ${field.path}`);
    fieldPaths.add(field.path);
  });
  exactKeys(document.redaction, ['applied', 'policyVersion'], ['applied', 'policyVersion'], '$.redaction');
  if (document.redaction.applied !== true) fail('Environment Manifest redaction.applied must be true');
  string(document.redaction.policyVersion, '$.redaction.policyVersion', { max: 128 });
  validateArtifactMetadata(document);
  return document;
}

function validateEnvironmentComparisonField(field, index) {
  const path = `$.fields[${index}]`;
  exactKeys(field,
    ['path', 'policy', 'sourcePresence', 'targetPresence', 'equivalent', 'disposition', 'bindingAssertionId'],
    ['path', 'policy', 'sourcePresence', 'targetPresence', 'equivalent', 'disposition', 'bindingAssertionId'],
    path);
  string(field.path, `${path}.path`, { max: 1024 });
  if (field.policy !== null) enumValue(field.policy, ENVIRONMENT_FIELD_POLICIES, `${path}.policy`);
  enumValue(field.sourcePresence, ['PRESENT', 'ABSENT', 'UNKNOWN'], `${path}.sourcePresence`);
  enumValue(field.targetPresence, ['PRESENT', 'ABSENT', 'UNKNOWN'], `${path}.targetPresence`);
  if (field.equivalent !== null) boolean(field.equivalent, `${path}.equivalent`);
  enumValue(field.disposition, ['EQUIVALENT', 'NORMALIZED', 'REQUIRES_USER_BINDING', 'BLOCKED', 'IGNORED'], `${path}.disposition`);
  if (field.bindingAssertionId !== null) id(field.bindingAssertionId, `${path}.bindingAssertionId`);
  if (field.policy === null && field.disposition !== 'BLOCKED') fail(`${path} with no registered policy must be BLOCKED`);
  if (field.bindingAssertionId !== null && (!['USE_TARGET_BINDING', 'REQUIRE_USER_BINDING'].includes(field.policy) || field.disposition !== 'NORMALIZED')) {
    fail(`${path}.bindingAssertionId is allowed only for a normalized binding policy`);
  }
  if (field.policy === 'REQUIRE_USER_BINDING' && field.disposition === 'NORMALIZED' && field.bindingAssertionId === null) {
    fail(`${path} requires a bindingAssertionId when normalized`);
  }
}

export function validateEnvironmentComparison(document) {
  schemaHeader(document, 'environment-comparison');
  exactKeys(document,
    ['schemaVersion', 'kind', 'comparisonId', 'reviewId', 'sourceManifestId', 'targetManifestId', 'sourceRevision', 'targetRevision', 'status', 'fields', 'normalizedPaths', 'requiredBindingPaths', 'blockedPaths', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'comparisonId', 'reviewId', 'sourceManifestId', 'targetManifestId', 'sourceRevision', 'targetRevision', 'status', 'fields', 'normalizedPaths', 'requiredBindingPaths', 'blockedPaths', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.comparisonId, '$.comparisonId');
  reviewId(document.reviewId);
  id(document.sourceManifestId, '$.sourceManifestId');
  id(document.targetManifestId, '$.targetManifestId');
  for (const [name, revision] of [['sourceRevision', document.sourceRevision], ['targetRevision', document.targetRevision]]) {
    exactKeys(revision, ['nid', 'workId'], ['nid', 'workId'], `$.${name}`);
    integer(revision.nid, `$.${name}.nid`, { min: 1 });
    string(revision.workId, `$.${name}.workId`, { max: 256 });
  }
  enumValue(document.status, ENVIRONMENT_GATE_STATUSES, '$.status');
  const fields = array(document.fields, '$.fields', { max: 10000 });
  const paths = new Set();
  fields.forEach((field, index) => {
    validateEnvironmentComparisonField(field, index);
    if (paths.has(field.path)) fail(`$.fields contains duplicate path ${field.path}`);
    paths.add(field.path);
  });
  const normalizedPaths = uniqueStrings(document.normalizedPaths, '$.normalizedPaths', { max: 10000 });
  const requiredBindingPaths = uniqueStrings(document.requiredBindingPaths, '$.requiredBindingPaths', { max: 10000 });
  const blockedPaths = uniqueStrings(document.blockedPaths, '$.blockedPaths', { max: 10000 });
  for (const listedPath of [...normalizedPaths, ...requiredBindingPaths, ...blockedPaths]) {
    if (!paths.has(listedPath)) fail(`Environment comparison references an unknown field path: ${listedPath}`);
  }
  isoDate(document.evaluatedAt, '$.evaluatedAt');
  validateArtifactMetadata(document);
  const expectedNormalized = fields.filter((field) => field.disposition === 'NORMALIZED').map((field) => field.path).sort();
  const expectedBindings = fields.filter((field) => field.disposition === 'REQUIRES_USER_BINDING').map((field) => field.path).sort();
  const expectedBlocked = fields.filter((field) => field.disposition === 'BLOCKED').map((field) => field.path).sort();
  if (JSON.stringify([...normalizedPaths].sort()) !== JSON.stringify(expectedNormalized)) fail('normalizedPaths must exactly match NORMALIZED field dispositions');
  if (JSON.stringify([...requiredBindingPaths].sort()) !== JSON.stringify(expectedBindings)) fail('requiredBindingPaths must exactly match REQUIRES_USER_BINDING field dispositions');
  if (JSON.stringify([...blockedPaths].sort()) !== JSON.stringify(expectedBlocked)) fail('blockedPaths must exactly match BLOCKED field dispositions');
  if (document.status === 'ENVIRONMENT_EQUIVALENT' && (normalizedPaths.length || requiredBindingPaths.length || blockedPaths.length)) {
    fail('ENVIRONMENT_EQUIVALENT cannot contain normalized, binding-required, or blocked paths');
  }
  if (document.status === 'NORMALIZED_EQUIVALENT' && (!normalizedPaths.length || requiredBindingPaths.length || blockedPaths.length)) {
    fail('NORMALIZED_EQUIVALENT requires normalized paths and no binding-required or blocked paths');
  }
  if (document.status === 'REQUIRES_USER_BINDING' && (!requiredBindingPaths.length || blockedPaths.length)) {
    fail('REQUIRES_USER_BINDING requires binding paths and no blocked paths');
  }
  if (document.status === 'BLOCKED_ENVIRONMENT' && !blockedPaths.length) {
    fail('BLOCKED_ENVIRONMENT requires at least one blocked path');
  }
  return document;
}

export function validateHumanFinding(document) {
  schemaHeader(document, 'human-finding');
  exactKeys(document,
    ['schemaVersion', 'kind', 'findingId', 'reviewId', 'issueId', 'clusterId', 'symptom', 'reproductionSteps', 'v4Observation', 'v5Observation', 'locations', 'suggestedCause', 'confidenceNote', 'targetManuallyEdited', 'targetRevision', 'requests', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'findingId', 'reviewId', 'issueId', 'clusterId', 'symptom', 'reproductionSteps', 'v4Observation', 'v5Observation', 'locations', 'suggestedCause', 'confidenceNote', 'targetManuallyEdited', 'targetRevision', 'requests', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.findingId, '$.findingId');
  reviewId(document.reviewId);
  if (document.issueId !== null) id(document.issueId, '$.issueId');
  if (document.clusterId !== null) id(document.clusterId, '$.clusterId');
  string(document.symptom, '$.symptom', { max: 8192 });
  uniqueStrings(document.reproductionSteps, '$.reproductionSteps', { max: 100 });
  nullableString(document.v4Observation, '$.v4Observation', { max: 8192 });
  nullableString(document.v5Observation, '$.v5Observation', { max: 8192 });
  uniqueStrings(document.locations, '$.locations', { max: 200 });
  if (document.suggestedCause !== null) enumValue(document.suggestedCause, ISSUE_CAUSES, '$.suggestedCause');
  nullableString(document.confidenceNote, '$.confidenceNote', { max: 4096 });
  boolean(document.targetManuallyEdited, '$.targetManuallyEdited');
  if (document.targetRevision !== null) string(document.targetRevision, '$.targetRevision', { max: 256 });
  uniqueStrings(document.requests, '$.requests', { max: 20 });
  document.requests.forEach((request, index) => enumValue(request, ['RERUN', 'RECLASSIFY', 'CONVERTER_REPORT', 'TRY_REPAIR', 'ACCEPT_TARGET_REVISION'], `$.requests[${index}]`));
  if (document.targetManuallyEdited && document.targetRevision === null) fail('targetRevision is required when targetManuallyEdited is true');
  if (!document.targetManuallyEdited && document.requests.includes('ACCEPT_TARGET_REVISION')) fail('ACCEPT_TARGET_REVISION requires targetManuallyEdited');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'USER') fail('Human Finding createdBy must be USER');
  if (document.sensitivity !== 'PRIVATE') fail('Human Finding sensitivity must be PRIVATE');
  return document;
}

export function validateRepairBudget(document) {
  schemaHeader(document, 'repair-budget');
  exactKeys(document,
    ['schemaVersion', 'kind', 'budgetId', 'reviewId', 'scope', 'clusterId', 'attempts', 'targetRevisions', 'status', 'updatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'budgetId', 'reviewId', 'scope', 'clusterId', 'attempts', 'targetRevisions', 'status', 'updatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.budgetId, '$.budgetId');
  reviewId(document.reviewId);
  enumValue(document.scope, ['ISSUE_CLUSTER', 'REVIEW_SESSION'], '$.scope');
  if (document.clusterId !== null) id(document.clusterId, '$.clusterId');
  if (document.attempts !== null) {
    exactKeys(document.attempts, ['automaticLimit', 'automaticUsed', 'extensionLimit', 'extensionUsed'], ['automaticLimit', 'automaticUsed', 'extensionLimit', 'extensionUsed'], '$.attempts');
    integer(document.attempts.automaticLimit, '$.attempts.automaticLimit', { min: 0, max: 100 });
    integer(document.attempts.automaticUsed, '$.attempts.automaticUsed', { min: 0, max: 100 });
    integer(document.attempts.extensionLimit, '$.attempts.extensionLimit', { min: 0, max: 100 });
    integer(document.attempts.extensionUsed, '$.attempts.extensionUsed', { min: 0, max: 100 });
    if (document.attempts.automaticUsed > document.attempts.automaticLimit || document.attempts.extensionUsed > document.attempts.extensionLimit) {
      fail('Repair attempt usage cannot exceed its limit');
    }
  }
  if (document.targetRevisions !== null) {
    exactKeys(document.targetRevisions, ['baseLimit', 'used', 'extensionLimit', 'extensionUsed'], ['baseLimit', 'used', 'extensionLimit', 'extensionUsed'], '$.targetRevisions');
    integer(document.targetRevisions.baseLimit, '$.targetRevisions.baseLimit', { min: 0, max: 1000 });
    integer(document.targetRevisions.used, '$.targetRevisions.used', { min: 0, max: 1000 });
    integer(document.targetRevisions.extensionLimit, '$.targetRevisions.extensionLimit', { min: 0, max: 1000 });
    integer(document.targetRevisions.extensionUsed, '$.targetRevisions.extensionUsed', { min: 0, max: 1000 });
    if (document.targetRevisions.used > document.targetRevisions.baseLimit || document.targetRevisions.extensionUsed > document.targetRevisions.extensionLimit) {
      fail('Target revision usage cannot exceed its limit');
    }
  }
  enumValue(document.status, ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'FROZEN'], '$.status');
  isoDate(document.updatedAt, '$.updatedAt');
  validateArtifactMetadata(document);
  if (document.scope === 'ISSUE_CLUSTER' && (document.clusterId === null || document.attempts === null || document.targetRevisions !== null)) {
    fail('ISSUE_CLUSTER budget requires clusterId and attempts only');
  }
  if (document.scope === 'REVIEW_SESSION' && (document.clusterId !== null || document.attempts !== null || document.targetRevisions === null)) {
    fail('REVIEW_SESSION budget requires targetRevisions only');
  }
  return document;
}

function validateJsonPatchOperation(operation, index) {
  const path = `$.patch[${index}]`;
  exactKeys(operation, ['op', 'path'], ['op', 'path', 'value'], path);
  enumValue(operation.op, ['add', 'remove', 'replace'], `${path}.op`);
  string(operation.path, `${path}.path`, { max: 2048 });
  if (!operation.path.startsWith('/')) fail(`${path}.path must be a JSON pointer`);
  if (operation.op === 'remove' && Object.hasOwn(operation, 'value')) fail(`${path}.value is forbidden for remove`);
  if (operation.op !== 'remove' && !Object.hasOwn(operation, 'value')) fail(`${path}.value is required for ${operation.op}`);
}

export function validateTargetRepairAuthorization(document) {
  schemaHeader(document, 'target-repair-authorization');
  exactKeys(document,
    ['schemaVersion', 'kind', 'authorizationId', 'reviewId', 'scope', 'clusterIds', 'maxAttemptsPerCluster', 'maxTargetRevisions', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'authorizationId', 'reviewId', 'scope', 'clusterIds', 'maxAttemptsPerCluster', 'maxTargetRevisions', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.authorizationId, '$.authorizationId');
  reviewId(document.reviewId);
  enumValue(document.scope, REPAIR_AUTHORIZATION_SCOPES, '$.scope');
  uniqueStrings(document.clusterIds, '$.clusterIds', { max: 200 });
  if (document.clusterIds.length === 0) fail('$.clusterIds must contain at least one Issue Cluster');
  integer(document.maxAttemptsPerCluster, '$.maxAttemptsPerCluster', { min: 1, max: 3 });
  integer(document.maxTargetRevisions, '$.maxTargetRevisions', { min: 1, max: 10 });
  const expectedAttempts = document.scope === 'INITIAL' ? 3 : 2;
  const expectedRevisions = document.scope === 'INITIAL' ? 10 : 5;
  if (document.maxAttemptsPerCluster > expectedAttempts || document.maxTargetRevisions > expectedRevisions) {
    fail(`${document.scope} authorization exceeds its bounded allowance`);
  }
  const expectedConfirmation = document.scope === 'INITIAL' ? 'AUTHORIZE_TARGET_REPAIR' : 'AUTHORIZE_REPAIR_EXTENSION';
  if (document.confirmation !== expectedConfirmation) fail(`$.confirmation must be ${expectedConfirmation}`);
  isoDate(document.expiresAt, '$.expiresAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'USER' || document.sensitivity !== 'PRIVATE') fail('Target repair authorization must be private USER evidence');
  if (Date.parse(document.expiresAt) <= Date.parse(document.createdAt)) fail('Target repair authorization must expire after creation');
  if (Date.parse(document.expiresAt) - Date.parse(document.createdAt) > 8 * 60 * 60 * 1000) fail('Target repair authorization cannot last longer than 8 hours');
  return document;
}

export function validateRepairProposal(document) {
  schemaHeader(document, 'repair-proposal');
  exactKeys(document,
    ['schemaVersion', 'kind', 'proposalId', 'reviewId', 'authorizationId', 'clusterIds', 'baseTarget', 'patch', 'affectedScenarioIds', 'evidenceRefs', 'knowledgeRuleIds', 'confidence', 'rationale', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'proposalId', 'reviewId', 'authorizationId', 'clusterIds', 'baseTarget', 'patch', 'affectedScenarioIds', 'evidenceRefs', 'knowledgeRuleIds', 'confidence', 'rationale', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.proposalId, '$.proposalId');
  reviewId(document.reviewId);
  id(document.authorizationId, '$.authorizationId');
  uniqueStrings(document.clusterIds, '$.clusterIds', { max: 50 });
  if (document.clusterIds.length === 0) fail('$.clusterIds must contain at least one Issue Cluster');
  exactKeys(document.baseTarget, ['nid', 'workId', 'sha256'], ['nid', 'workId', 'sha256'], '$.baseTarget');
  integer(document.baseTarget.nid, '$.baseTarget.nid', { min: 1 });
  string(document.baseTarget.workId, '$.baseTarget.workId', { max: 256 });
  sha256(document.baseTarget.sha256, '$.baseTarget.sha256');
  const patch = array(document.patch, '$.patch', { max: 20 });
  if (patch.length === 0) fail('$.patch must contain at least one operation');
  patch.forEach(validateJsonPatchOperation);
  uniqueStrings(document.affectedScenarioIds, '$.affectedScenarioIds', { max: 100 });
  if (document.affectedScenarioIds.length === 0) fail('$.affectedScenarioIds must contain at least one scenario');
  validateEvidenceRefs(document, '$');
  number(document.confidence, '$.confidence');
  string(document.rationale, '$.rationale', { max: 8192 });
  validateArtifactMetadata(document);
  if (document.createdBy !== 'AGENT' || document.sensitivity !== 'REDACTED') fail('Repair Proposal must be a redacted AGENT artifact');
  return document;
}

export function validateSaveableCheckpoint(document) {
  schemaHeader(document, 'saveable-checkpoint');
  exactKeys(document,
    ['schemaVersion', 'kind', 'checkpointId', 'reviewId', 'checkpointType', 'artifact', 'sha256', 'targetNid', 'targetWorkId', 'sourceAttemptId', 'sourceBatchId', 'staticValidation', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'checkpointId', 'reviewId', 'checkpointType', 'artifact', 'sha256', 'targetNid', 'targetWorkId', 'sourceAttemptId', 'sourceBatchId', 'staticValidation', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.checkpointId, '$.checkpointId');
  reviewId(document.reviewId);
  enumValue(document.checkpointType, ['CONVERTER_OUTPUT', 'STATICALLY_SAFE_CANDIDATE', 'CONFIRMED_TARGET_REVISION'], '$.checkpointType');
  string(document.artifact, '$.artifact', { max: 1024 });
  if (document.artifact.startsWith('/') || document.artifact.includes('..')) fail('$.artifact must be a safe relative path');
  sha256(document.sha256, '$.sha256');
  if (document.targetNid !== null) integer(document.targetNid, '$.targetNid', { min: 1 });
  if (document.targetWorkId !== null) string(document.targetWorkId, '$.targetWorkId', { max: 256 });
  if (document.sourceAttemptId !== null) id(document.sourceAttemptId, '$.sourceAttemptId');
  if (document.sourceBatchId !== null) id(document.sourceBatchId, '$.sourceBatchId');
  exactKeys(document.staticValidation, ['passed', 'issueCount', 'blockerCount'], ['passed', 'issueCount', 'blockerCount'], '$.staticValidation');
  boolean(document.staticValidation.passed, '$.staticValidation.passed');
  integer(document.staticValidation.issueCount, '$.staticValidation.issueCount', { min: 0, max: 100000 });
  integer(document.staticValidation.blockerCount, '$.staticValidation.blockerCount', { min: 0, max: 100000 });
  validateArtifactMetadata(document);
  if (document.checkpointType === 'CONFIRMED_TARGET_REVISION' && (document.targetNid === null || document.targetWorkId === null)) fail('Confirmed target checkpoints require target identity');
  if (document.checkpointType === 'STATICALLY_SAFE_CANDIDATE' && !document.staticValidation.passed) fail('Statically safe checkpoints require passing static validation');
  return document;
}

export function validateRepairAttempt(document) {
  schemaHeader(document, 'repair-attempt');
  exactKeys(document,
    ['schemaVersion', 'kind', 'attemptId', 'reviewId', 'proposalId', 'authorizationId', 'clusterIds', 'patchSha256', 'baseCheckpointId', 'candidateCheckpointId', 'outcome', 'stopReason', 'validation', 'scope', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'attemptId', 'reviewId', 'proposalId', 'authorizationId', 'clusterIds', 'patchSha256', 'baseCheckpointId', 'candidateCheckpointId', 'outcome', 'stopReason', 'validation', 'scope', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.attemptId, '$.attemptId');
  reviewId(document.reviewId);
  id(document.proposalId, '$.proposalId');
  id(document.authorizationId, '$.authorizationId');
  uniqueStrings(document.clusterIds, '$.clusterIds', { max: 50 });
  sha256(document.patchSha256, '$.patchSha256');
  id(document.baseCheckpointId, '$.baseCheckpointId');
  if (document.candidateCheckpointId !== null) id(document.candidateCheckpointId, '$.candidateCheckpointId');
  enumValue(document.outcome, ['LOCAL_VALIDATION_PASSED', 'LOCAL_VALIDATION_FAILED', 'AUTO_REPAIR_STOPPED'], '$.outcome');
  nullableString(document.stopReason, '$.stopReason', { max: 512 });
  exactKeys(document.validation, ['passed', 'issueCount', 'blockerCount', 'newHighSeverityIssueIds'], ['passed', 'issueCount', 'blockerCount', 'newHighSeverityIssueIds'], '$.validation');
  boolean(document.validation.passed, '$.validation.passed');
  integer(document.validation.issueCount, '$.validation.issueCount', { min: 0, max: 100000 });
  integer(document.validation.blockerCount, '$.validation.blockerCount', { min: 0, max: 100000 });
  uniqueStrings(document.validation.newHighSeverityIssueIds, '$.validation.newHighSeverityIssueIds', { max: 1000 });
  exactKeys(document.scope, ['operationCount', 'distinctPathCount', 'patchBytes'], ['operationCount', 'distinctPathCount', 'patchBytes'], '$.scope');
  integer(document.scope.operationCount, '$.scope.operationCount', { min: 1, max: 20 });
  integer(document.scope.distinctPathCount, '$.scope.distinctPathCount', { min: 1, max: 20 });
  integer(document.scope.patchBytes, '$.scope.patchBytes', { min: 1, max: 262144 });
  validateArtifactMetadata(document);
  return document;
}

export function validateRepairBatch(document) {
  schemaHeader(document, 'repair-batch');
  exactKeys(document,
    ['schemaVersion', 'kind', 'batchId', 'reviewId', 'attemptIds', 'clusterIds', 'state', 'authorizationId', 'expectedTarget', 'candidate', 'affectedScenarioIds', 'write', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'batchId', 'reviewId', 'attemptIds', 'clusterIds', 'state', 'authorizationId', 'expectedTarget', 'candidate', 'affectedScenarioIds', 'write', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.batchId, '$.batchId');
  reviewId(document.reviewId);
  uniqueStrings(document.attemptIds, '$.attemptIds', { max: 50 });
  uniqueStrings(document.clusterIds, '$.clusterIds', { max: 50 });
  enumValue(document.state, REPAIR_BATCH_STATES, '$.state');
  id(document.authorizationId, '$.authorizationId');
  exactKeys(document.expectedTarget, ['nid', 'workId', 'sha256'], ['nid', 'workId', 'sha256'], '$.expectedTarget');
  integer(document.expectedTarget.nid, '$.expectedTarget.nid', { min: 1 });
  string(document.expectedTarget.workId, '$.expectedTarget.workId', { max: 256 });
  sha256(document.expectedTarget.sha256, '$.expectedTarget.sha256');
  exactKeys(document.candidate, ['checkpointId', 'artifact', 'sha256'], ['checkpointId', 'artifact', 'sha256'], '$.candidate');
  id(document.candidate.checkpointId, '$.candidate.checkpointId');
  string(document.candidate.artifact, '$.candidate.artifact', { max: 1024 });
  sha256(document.candidate.sha256, '$.candidate.sha256');
  uniqueStrings(document.affectedScenarioIds, '$.affectedScenarioIds', { max: 100 });
  exactKeys(document.write, ['requestedAt', 'outcome', 'observedWorkId', 'observedSha256', 'errorCode'], ['requestedAt', 'outcome', 'observedWorkId', 'observedSha256', 'errorCode'], '$.write');
  nullableIsoDate(document.write.requestedAt, '$.write.requestedAt');
  enumValue(document.write.outcome, ['NOT_ATTEMPTED', 'REQUESTED', 'UNKNOWN', 'VERIFIED', 'RECONCILIATION_REQUIRED'], '$.write.outcome');
  nullableString(document.write.observedWorkId, '$.write.observedWorkId', { max: 256 });
  nullableSha256(document.write.observedSha256, '$.write.observedSha256');
  nullableString(document.write.errorCode, '$.write.errorCode', { max: 128 });
  isoDate(document.updatedAt, '$.updatedAt');
  validateArtifactMetadata(document);
  return document;
}

export function validateAutomaticRepairDecision(document) {
  schemaHeader(document, 'automatic-repair-decision');
  exactKeys(document,
    ['schemaVersion', 'kind', 'decisionId', 'reviewId', 'clusterId', 'cause', 'repairTarget', 'decision', 'reasonCode', 'reason', 'budgetId', 'budgetState', 'remainingAttempts', 'evidenceRefs', 'knowledgeRuleIds', 'decidedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'decisionId', 'reviewId', 'clusterId', 'cause', 'repairTarget', 'decision', 'reasonCode', 'reason', 'budgetId', 'budgetState', 'remainingAttempts', 'evidenceRefs', 'knowledgeRuleIds', 'decidedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.decisionId, '$.decisionId');
  reviewId(document.reviewId);
  id(document.clusterId, '$.clusterId');
  enumValue(document.cause, ISSUE_CAUSES, '$.cause');
  enumValue(document.repairTarget, REPAIR_TARGETS, '$.repairTarget');
  enumValue(document.decision, AUTOMATIC_REPAIR_DECISIONS, '$.decision');
  string(document.reasonCode, '$.reasonCode', { max: 128, pattern: ID_PATTERN });
  string(document.reason, '$.reason', { max: 8192 });
  id(document.budgetId, '$.budgetId');
  enumValue(document.budgetState, REPAIR_BUDGET_STATES, '$.budgetState');
  integer(document.remainingAttempts, '$.remainingAttempts', { min: 0, max: 100 });
  validateEvidenceRefs(document, '$');
  isoDate(document.decidedAt, '$.decidedAt');
  validateArtifactMetadata(document);
  if (document.decision === 'AUTO_REPAIR_ALLOWED') {
    if (!['SOURCE_DATA', 'TARGET_CASE'].includes(document.cause)
      || document.repairTarget !== 'V5_ARTIFACT'
      || document.budgetState !== 'AVAILABLE'
      || document.remainingAttempts < 1) {
      fail('AUTO_REPAIR_ALLOWED requires a repairable target cause, V5_ARTIFACT, and available remaining budget');
    }
  }
  if (document.decision === 'AUTO_REPAIR_STOPPED' && !['FROZEN', 'EXHAUSTED'].includes(document.budgetState)) {
    fail('AUTO_REPAIR_STOPPED requires a frozen or exhausted budget state');
  }
  if (document.budgetState === 'EXHAUSTED' && document.remainingAttempts !== 0) {
    fail('EXHAUSTED budgetState requires remainingAttempts at 0');
  }
  return document;
}

function validateCheckpoint(checkpoint) {
  exactKeys(checkpoint, ['kind', 'artifact', 'sha256', 'targetNid', 'targetWorkId'], ['kind', 'artifact', 'sha256', 'targetNid', 'targetWorkId'], '$.checkpoint');
  enumValue(checkpoint.kind, ['CONVERTER_OUTPUT', 'STATICALLY_SAFE_CANDIDATE', 'CONFIRMED_TARGET_REVISION'], '$.checkpoint.kind');
  string(checkpoint.artifact, '$.checkpoint.artifact', { max: 1024 });
  if (checkpoint.artifact.startsWith('/') || checkpoint.artifact.includes('..')) fail('$.checkpoint.artifact must be a safe relative path');
  sha256(checkpoint.sha256, '$.checkpoint.sha256');
  if (checkpoint.targetNid !== null) integer(checkpoint.targetNid, '$.checkpoint.targetNid', { min: 1 });
  if (checkpoint.targetWorkId !== null) string(checkpoint.targetWorkId, '$.checkpoint.targetWorkId', { max: 256 });
  if (checkpoint.kind === 'CONFIRMED_TARGET_REVISION' && (checkpoint.targetNid === null || checkpoint.targetWorkId === null)) {
    fail('CONFIRMED_TARGET_REVISION requires targetNid and targetWorkId');
  }
}

export function validateDiagnosticSaveEligibility(document) {
  schemaHeader(document, 'diagnostic-save-eligibility');
  exactKeys(document,
    ['schemaVersion', 'kind', 'eligibilityId', 'jobId', 'reviewId', 'clusterId', 'status', 'checkpoint', 'prerequisites', 'blockers', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'eligibilityId', 'jobId', 'reviewId', 'clusterId', 'status', 'checkpoint', 'prerequisites', 'blockers', 'evaluatedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.eligibilityId, '$.eligibilityId');
  jobId(document.jobId);
  if (document.reviewId !== null) reviewId(document.reviewId);
  if (document.clusterId !== null) id(document.clusterId, '$.clusterId');
  enumValue(document.status, DIAGNOSTIC_SAVE_STATUSES, '$.status');
  if (document.checkpoint !== null) validateCheckpoint(document.checkpoint);
  const prerequisiteKeys = ['authentication', 'serverPermission', 'userAuthorization', 'platformWritePath', 'revisionSafety', 'writeOutcomeKnown'];
  exactKeys(document.prerequisites, prerequisiteKeys, prerequisiteKeys, '$.prerequisites');
  for (const key of prerequisiteKeys) enumValue(document.prerequisites[key], PREREQUISITE_STATES, `$.prerequisites.${key}`);
  uniqueStrings(document.blockers, '$.blockers', { max: 100 });
  isoDate(document.evaluatedAt, '$.evaluatedAt');
  validateArtifactMetadata(document);
  const authMissing = ['authentication', 'serverPermission', 'userAuthorization'].some((key) => document.prerequisites[key] !== 'SATISFIED');
  const platformMissing = document.prerequisites.platformWritePath !== 'SATISFIED';
  const reconciliation = document.prerequisites.revisionSafety !== 'SATISFIED'
    || document.prerequisites.writeOutcomeKnown !== 'SATISFIED';
  if (document.status === 'DIAGNOSTIC_SAVE_ELIGIBLE') {
    if (!document.checkpoint || authMissing || platformMissing || reconciliation || document.blockers.length > 0) {
      fail('DIAGNOSTIC_SAVE_ELIGIBLE requires a checkpoint, all prerequisites satisfied, and no blockers');
    }
  }
  if (document.status === 'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH' && !authMissing) fail('WAITING_FOR_AUTH requires a missing authentication, permission, or authorization prerequisite');
  if (document.status === 'DIAGNOSTIC_SAVE_WAITING_FOR_PLATFORM' && !platformMissing) fail('WAITING_FOR_PLATFORM requires an unavailable platform write path');
  if (document.status === 'DIAGNOSTIC_SAVE_RECONCILIATION_REQUIRED' && !reconciliation) fail('RECONCILIATION_REQUIRED requires unsafe revision state or an unknown write outcome');
  if (document.status === 'DIAGNOSTIC_SAVE_UNSAFE_ARTIFACT' && document.checkpoint !== null) fail('UNSAFE_ARTIFACT requires checkpoint to be null');
  return document;
}

function validateRuntimePin(pin, path) {
  exactKeys(pin, ['version', 'sha256'], ['version', 'sha256'], path);
  string(pin.version, `${path}.version`, { max: 128 });
  sha256(pin.sha256, `${path}.sha256`);
}

function validateKnowledgeRuntimePin(pin, path) {
  exactKeys(pin, ['version', 'sha256', 'contentSha256', 'schemaVersion', 'ruleIds'], ['version', 'sha256', 'contentSha256', 'schemaVersion', 'ruleIds'], path);
  string(pin.version, `${path}.version`, { max: 128 });
  sha256(pin.sha256, `${path}.sha256`);
  sha256(pin.contentSha256, `${path}.contentSha256`);
  integer(pin.schemaVersion, `${path}.schemaVersion`, { min: 1, max: 1000 });
  uniqueStrings(pin.ruleIds, `${path}.ruleIds`, { max: 2000 });
}

const REPORT_TYPE_BY_CAUSE = Object.freeze({
  CONVERTER: 'CONVERTER_DEFECT',
  SOURCE_DATA: 'SOURCE_DATA',
  TARGET_CASE: 'TARGET_CASE',
  TEST_HARNESS: 'TEST_HARNESS',
  ENVIRONMENT_CONFIGURATION: 'ENVIRONMENT',
  PLATFORM_RUNTIME: 'PLATFORM_RUNTIME',
  KNOWLEDGE_GAP: 'KNOWLEDGE_GAP',
  AUTHORIZATION: 'AUTHORIZATION',
  UNKNOWN: 'UNKNOWN',
});

export function validateDiagnosisReport(document) {
  schemaHeader(document, 'diagnosis-report');
  exactKeys(document,
    ['schemaVersion', 'kind', 'reportId', 'reportType', 'diagnosisId', 'jobId', 'reviewId', 'clusterId', 'cause', 'responsibleParty', 'repairTarget', 'runtime', 'subjects', 'confidence', 'reproducibility', 'issueIds', 'evidence', 'evidenceRefs', 'knowledgeRuleIds', 'summary', 'recommendedActions', 'automaticRepairDecisionId', 'diagnosticSaveEligibilityId', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'reportId', 'reportType', 'diagnosisId', 'jobId', 'reviewId', 'clusterId', 'cause', 'responsibleParty', 'repairTarget', 'runtime', 'subjects', 'confidence', 'reproducibility', 'issueIds', 'evidence', 'evidenceRefs', 'knowledgeRuleIds', 'summary', 'recommendedActions', 'automaticRepairDecisionId', 'diagnosticSaveEligibilityId', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.reportId, '$.reportId');
  id(document.diagnosisId, '$.diagnosisId');
  jobId(document.jobId);
  reviewId(document.reviewId);
  id(document.clusterId, '$.clusterId');
  enumValue(document.cause, ISSUE_CAUSES, '$.cause');
  if (document.reportType !== REPORT_TYPE_BY_CAUSE[document.cause]) fail('reportType is inconsistent with cause');
  enumValue(document.responsibleParty, RESPONSIBLE_PARTIES, '$.responsibleParty');
  enumValue(document.repairTarget, REPAIR_TARGETS, '$.repairTarget');
  exactKeys(document.runtime, ['workflow', 'converter', 'knowledge'], ['workflow', 'converter', 'knowledge'], '$.runtime');
  validateRuntimePin(document.runtime.workflow, '$.runtime.workflow');
  validateRuntimePin(document.runtime.converter, '$.runtime.converter');
  validateKnowledgeRuntimePin(document.runtime.knowledge, '$.runtime.knowledge');
  exactKeys(document.subjects, ['sourceNid', 'sourceGid', 'sourceWorkId', 'targetNid', 'targetWorkId'], ['sourceNid', 'sourceGid', 'sourceWorkId', 'targetNid', 'targetWorkId'], '$.subjects');
  integer(document.subjects.sourceNid, '$.subjects.sourceNid', { min: 1 });
  if (document.subjects.sourceGid !== null) integer(document.subjects.sourceGid, '$.subjects.sourceGid', { min: 1 });
  string(document.subjects.sourceWorkId, '$.subjects.sourceWorkId', { max: 256 });
  integer(document.subjects.targetNid, '$.subjects.targetNid', { min: 1 });
  string(document.subjects.targetWorkId, '$.subjects.targetWorkId', { max: 256 });
  number(document.confidence, '$.confidence');
  enumValue(document.reproducibility, ['REPRODUCIBLE', 'PARTIAL', 'INSUFFICIENT_EVIDENCE'], '$.reproducibility');
  uniqueStrings(document.issueIds, '$.issueIds', { max: 2000 });
  if (document.issueIds.length === 0) fail('$.issueIds must contain at least one issue');
  array(document.evidence, '$.evidence', { max: 2000 }).forEach((entry, index) => {
    const path = `$.evidence[${index}]`;
    exactKeys(entry, ['issueId', 'comparisonId', 'assertionId', 'status', 'reasonCode', 'evidenceRef'], ['issueId', 'comparisonId', 'assertionId', 'status', 'reasonCode', 'evidenceRef'], path);
    id(entry.issueId, `${path}.issueId`);
    id(entry.comparisonId, `${path}.comparisonId`);
    id(entry.assertionId, `${path}.assertionId`);
    enumValue(entry.status, ['FAILED', 'INCONCLUSIVE'], `${path}.status`);
    id(entry.reasonCode, `${path}.reasonCode`);
    string(entry.evidenceRef, `${path}.evidenceRef`, { max: 512 });
  });
  if (document.evidence.length === 0 || document.evidence.some((entry) => !document.issueIds.includes(entry.issueId))) fail('$.evidence must describe this report issue set');
  validateEvidenceRefs(document, '$');
  string(document.summary, '$.summary', { max: 8192 });
  uniqueStrings(document.recommendedActions, '$.recommendedActions', { max: 100 });
  id(document.automaticRepairDecisionId, '$.automaticRepairDecisionId');
  id(document.diagnosticSaveEligibilityId, '$.diagnosticSaveEligibilityId');
  validateArtifactMetadata(document);
  return document;
}

export function validateRuntimeReviewSession(document) {
  schemaHeader(document, 'runtime-review-session');
  exactKeys(document,
    ['schemaVersion', 'kind', 'reviewId', 'jobId', 'target', 'capability', 'status', 'runtime', 'baseline', 'activeCycleId', 'issueClusterIds', 'scenarioIds', 'humanFindingIds', 'repairBudgetIds', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'reviewId', 'jobId', 'target', 'capability', 'status', 'runtime', 'baseline', 'activeCycleId', 'issueClusterIds', 'scenarioIds', 'humanFindingIds', 'repairBudgetIds', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    '$');
  reviewId(document.reviewId);
  jobId(document.jobId);
  exactKeys(document.target, ['nid', 'workId'], ['nid', 'workId'], '$.target');
  integer(document.target.nid, '$.target.nid', { min: 1 });
  string(document.target.workId, '$.target.workId', { max: 256 });
  enumValue(document.capability, REVIEW_CAPABILITIES, '$.capability');
  enumValue(document.status, REVIEW_STATUSES, '$.status');
  exactKeys(document.runtime, ['workflow', 'converter', 'knowledge'], ['workflow', 'converter', 'knowledge'], '$.runtime');
  validateRuntimePin(document.runtime.workflow, '$.runtime.workflow');
  validateRuntimePin(document.runtime.converter, '$.runtime.converter');
  validateKnowledgeRuntimePin(document.runtime.knowledge, '$.runtime.knowledge');
  exactKeys(document.baseline, ['sourceWorkId', 'targetWorkId'], ['sourceWorkId', 'targetWorkId'], '$.baseline');
  string(document.baseline.sourceWorkId, '$.baseline.sourceWorkId', { max: 256 });
  string(document.baseline.targetWorkId, '$.baseline.targetWorkId', { max: 256 });
  if (document.baseline.targetWorkId !== document.target.workId) fail('baseline.targetWorkId must match target.workId');
  if (document.activeCycleId !== null) id(document.activeCycleId, '$.activeCycleId');
  uniqueStrings(document.issueClusterIds, '$.issueClusterIds', { max: 2000 });
  uniqueStrings(document.scenarioIds, '$.scenarioIds', { max: 1000 });
  uniqueStrings(document.humanFindingIds, '$.humanFindingIds', { max: 2000 });
  uniqueStrings(document.repairBudgetIds, '$.repairBudgetIds', { max: 2000 });
  array(document.history, '$.history', { max: 10000 }).forEach((entry, index) => {
    const path = `$.history[${index}]`;
    exactKeys(entry, ['status', 'at', 'reason'], ['status', 'at', 'reason'], path);
    enumValue(entry.status, REVIEW_STATUSES, `${path}.status`);
    isoDate(entry.at, `${path}.at`);
    nullableString(entry.reason, `${path}.reason`, { max: 4096 });
  });
  isoDate(document.updatedAt, '$.updatedAt');
  validateArtifactMetadata(document);
  if (Date.parse(document.updatedAt) < Date.parse(document.createdAt)) fail('updatedAt must not precede createdAt');
  if (document.history.length === 0 || document.history.at(-1).status !== document.status) fail('history must end with the current review status');
  return document;
}

export const SCHEMA_V2_VALIDATORS = Object.freeze({
  'issue-classification': validateIssueClassificationV2,
  'issue-cluster': validateIssueCluster,
  'diagnosis-report': validateDiagnosisReport,
  'runtime-scenario': validateRuntimeScenario,
  'behavior-trace': validateBehaviorTrace,
  'runtime-comparison': validateRuntimeComparison,
  'environment-manifest': validateEnvironmentManifest,
  'environment-comparison': validateEnvironmentComparison,
  'human-finding': validateHumanFinding,
  'repair-budget': validateRepairBudget,
  'target-repair-authorization': validateTargetRepairAuthorization,
  'repair-proposal': validateRepairProposal,
  'repair-attempt': validateRepairAttempt,
  'repair-batch': validateRepairBatch,
  'saveable-checkpoint': validateSaveableCheckpoint,
  'automatic-repair-decision': validateAutomaticRepairDecision,
  'diagnostic-save-eligibility': validateDiagnosticSaveEligibility,
  'runtime-review-session': validateRuntimeReviewSession,
});

export function validateSchemaV2Artifact(document, options = {}) {
  if (document?.schemaVersion !== 2) {
    invariant(false, 'SCHEMA_VERSION_UNSUPPORTED', 'Expected schemaVersion 2', { actual: document?.schemaVersion ?? null });
  }
  const validator = SCHEMA_V2_VALIDATORS[document.kind];
  invariant(validator, 'SCHEMA_KIND_UNSUPPORTED', 'Unsupported schema v2 artifact kind', { kind: document.kind ?? null });
  return validator(document, options.validationReport);
}
