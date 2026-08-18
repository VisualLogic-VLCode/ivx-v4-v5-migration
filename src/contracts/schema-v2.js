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
  'FLAKY_RUNTIME',
  'UNKNOWN',
]);

export const AGENT_NATIVE_OBSERVATION_OUTCOMES = Object.freeze([
  'OBSERVED_EQUIVALENT',
  'OBSERVED_MISMATCH',
  'INCONCLUSIVE',
]);

export const AGENT_NATIVE_RUN_PURPOSES = Object.freeze([
  'INITIAL_TEST',
  'USER_RETEST',
  'REPAIR_REGRESSION',
]);

const AGENT_NATIVE_EXPLORATION_SCOPES = Object.freeze(['WHOLE_CASE', 'AFFECTED_FLOWS']);
const AGENT_NATIVE_DISCOVERY_SOURCES = Object.freeze(['STATIC_ARTIFACT', 'RUNTIME_UI', 'RUNTIME_NETWORK', 'USER_INPUT']);
const AGENT_NATIVE_EFFECT_CLASSES = Object.freeze(['READ_ONLY', 'WRITE', 'UNKNOWN']);
const AGENT_NATIVE_EXECUTION_SCOPES = Object.freeze(['FULLY_EXECUTED', 'PRE_SUBMIT_BOUNDARY', 'BLOCKED', 'NOT_EXECUTED']);
const AGENT_NATIVE_FLOW_RESULTS = Object.freeze(['MATCHED', 'MISMATCH', 'INCONCLUSIVE', 'NOT_OBSERVED']);

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

export const ENVIRONMENT_EXECUTION_ASSURANCES = Object.freeze([
  'STRICT_EQUIVALENT',
  'USER_DECLARED_EQUIVALENT',
  'USER_ACCEPTED_RISK',
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
  'RUNTIME_INCONCLUSIVE',
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
  'RUNTIME_DIAGNOSTIC_TESTING',
  'MISMATCH_DETECTED',
  'MISMATCH_UNDER_ENVIRONMENT_RISK',
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
  'RUNTIME_PARITY_PASSED_WITH_USER_DECLARED_ENVIRONMENT',
  'DIAGNOSTIC_RUNTIME_PASSED_WITH_ENVIRONMENT_RISK',
  'DIAGNOSTIC_RUNTIME_INCONCLUSIVE_WITH_ENVIRONMENT_RISK',
  'RUNTIME_REPAIR_EXHAUSTED',
  'BLOCKED_PLATFORM_RUNTIME',
  'RUNTIME_NOT_TESTED',
  'AGENT_NATIVE_EQUIVALENCE_OBSERVED',
  'AGENT_NATIVE_MISMATCH_OBSERVED',
  'AGENT_NATIVE_INCONCLUSIVE',
  'REVIEW_SUPERSEDED_BY_REFRESH',
]);

export const REVIEW_CAPABILITIES = Object.freeze(['READ_ONLY', 'WRITE']);

export const REFRESH_STATUSES = Object.freeze([
  'REFRESH_PREPARING',
  'AWAITING_REFRESH_AUTHORIZATION',
  'REFRESH_READY_TO_APPLY',
  'REFRESH_WRITE_REQUESTED',
  'REFRESH_RECONCILIATION_REQUIRED',
  'TARGET_REFRESHED',
  'REFRESH_BLOCKED',
  'REFRESH_PLAN_STALE',
  'REFRESH_TARGET_DRIFTED',
  'REFRESH_OUTCOME_UNKNOWN',
]);

export const REFRESH_JOURNAL_PHASES = Object.freeze([
  'NOT_STARTED',
  'WRITE_REQUESTED',
  'WRITE_OUTCOME_UNKNOWN',
  'READBACK_VERIFIED',
  'RECONCILIATION_REQUIRED',
  'TARGET_DRIFTED',
  'BASELINE_STILL_PRESENT',
]);

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
export const EXPLORATION_PROFILES = Object.freeze(['QUICK', 'STANDARD', 'DEEP']);
export const EXPLORATION_ENVIRONMENT_MODES = Object.freeze(['EQUIVALENT_ONLY', 'ALLOW_DIAGNOSTIC']);
export const EXPLORATION_ACTION_TYPES = Object.freeze(['OPEN_PAGE', 'CLICK', 'FILL', 'HOVER', 'FOCUS', 'SCROLL']);
export const EXPLORATION_LOCATOR_STRATEGIES = Object.freeze([...RUNTIME_LOCATOR_STRATEGIES, 'CSS', 'XPATH']);
export const EXPLORATION_REPORT_STATUSES = Object.freeze([
  'EXPLORATION_PARITY_PASSED',
  'PARTIAL_PARITY_PASSED',
  'MISMATCH_DETECTED',
  'INCONCLUSIVE',
  'INTERRUPTED',
]);
const PREREQUISITE_STATES = new Set(['SATISFIED', 'MISSING', 'UNAVAILABLE', 'UNKNOWN']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const JOB_ID_PATTERN = /^mig_[A-Za-z0-9_]+$/;
const REVIEW_ID_PATTERN = /^rev_[A-Za-z0-9_]+$/;
const REFRESH_ID_PATTERN = /^rfr_[A-Za-z0-9_]+$/;
const SECRET_KEY = /^(?:token|accesstoken|refreshtoken|bearertoken|cookie|authorization|password|secret|clientsecret|secretkey|privatekey|certificatepassword|apikey|accesskey)$/i;
const SECRET_TARGET = /(?:password|passwd|token|cookie|authorization|secret|api[-_ ]?key|密码|验证码)/iu;
const EXPLORATION_RISKY_ROUTE = /(?:^|[\/_-])(?:delete|remove|destroy|logout|signout|submit|confirm|pay|purchase|send|publish|deploy|删除|移除|退出|提交|确认|支付|发送|发布)(?:[\/_-]|$)/iu;
const EXPLORATION_FILTER_TARGET = /(?:search|filter|query|find|搜索|筛选|查询|查找)/iu;

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

function refreshId(value, path = 'refreshId') {
  return string(value, path, { max: 128, pattern: REFRESH_ID_PATTERN });
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

function safeArtifactPath(value, path) {
  string(value, path, { max: 1024 });
  if (value.startsWith('/') || value.includes('..')) fail(`${path} must be a safe relative path`);
  return value;
}

function validatePinnedRuntimeSet(runtime, path) {
  exactKeys(runtime, ['workflow', 'converter', 'knowledge'], ['workflow', 'converter', 'knowledge'], path);
  validateRuntimePin(runtime.workflow, `${path}.workflow`);
  validateRuntimePin(runtime.converter, `${path}.converter`);
  validateKnowledgeRuntimePin(runtime.knowledge, `${path}.knowledge`);
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
  FLAKY_RUNTIME: ['UNKNOWN', 'NONE'],
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

function validateExplorationLimits(limits, path) {
  exactKeys(limits,
    ['maxStates', 'maxActions', 'maxDepth', 'maxDurationMs', 'maxScreenshots'],
    ['maxStates', 'maxActions', 'maxDepth', 'maxDurationMs', 'maxScreenshots'],
    path);
  integer(limits.maxStates, `${path}.maxStates`, { min: 1, max: 500 });
  integer(limits.maxActions, `${path}.maxActions`, { min: 1, max: 3000 });
  integer(limits.maxDepth, `${path}.maxDepth`, { min: 0, max: 16 });
  integer(limits.maxDurationMs, `${path}.maxDurationMs`, { min: 1000, max: 7_200_000 });
  integer(limits.maxScreenshots, `${path}.maxScreenshots`, { min: 2, max: 1000 });
  if (limits.maxActions < limits.maxStates - 1) fail(`${path}.maxActions must allow at least one action for every non-root state`);
  if (limits.maxScreenshots < Math.min(limits.maxStates * 2, 1000)) fail(`${path}.maxScreenshots must allow a V4 and V5 screenshot for every state`);
  return limits;
}

function validateExplorationSubject(subject, path) {
  exactKeys(subject, ['nid', 'workId'], ['nid', 'workId'], path);
  integer(subject.nid, `${path}.nid`, { min: 1 });
  string(subject.workId, `${path}.workId`, { max: 256 });
}

export function validateRuntimeExplorationAuthorization(document) {
  schemaHeader(document, 'runtime-exploration-authorization');
  exactKeys(document,
    ['schemaVersion', 'kind', 'authorizationId', 'reviewId', 'jobId', 'jobManifestSha256', 'source', 'target', 'origins', 'scope', 'environment', 'environmentMode', 'profile', 'limits', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'authorizationId', 'reviewId', 'jobId', 'jobManifestSha256', 'source', 'target', 'origins', 'scope', 'environment', 'environmentMode', 'profile', 'limits', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.authorizationId, '$.authorizationId');
  reviewId(document.reviewId);
  jobId(document.jobId);
  sha256(document.jobManifestSha256, '$.jobManifestSha256');
  validateExplorationSubject(document.source, '$.source');
  validateExplorationSubject(document.target, '$.target');
  exactKeys(document.origins, ['source', 'target'], ['source', 'target'], '$.origins');
  for (const key of ['source', 'target']) {
    string(document.origins[key], `$.origins.${key}`, { max: 2048 });
    let origin;
    try { origin = new URL(document.origins[key]); } catch { fail(`$.origins.${key} must be an absolute URL origin`); }
    const loopback = origin && ['localhost', '127.0.0.1', '::1'].includes(origin.hostname);
    if (!origin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) || origin.origin !== document.origins[key] || origin.username || origin.password) {
      fail(`$.origins.${key} must be an HTTPS origin without credentials, except HTTP loopback tests`);
    }
  }
  exactKeys(document.scope,
    ['jobArtifacts', 'authenticatedSession', 'execution'],
    ['jobArtifacts', 'authenticatedSession', 'execution'],
    '$.scope');
  enumValue(document.scope.jobArtifacts, ['COMPLETE_READ_ONLY'], '$.scope.jobArtifacts');
  enumValue(document.scope.authenticatedSession, ['DRIVER_USE_ONLY'], '$.scope.authenticatedSession');
  enumValue(document.scope.execution, ['AUTONOMOUS_READ_ONLY'], '$.scope.execution');
  exactKeys(document.environment, ['comparisonId', 'status'], ['comparisonId', 'status'], '$.environment');
  id(document.environment.comparisonId, '$.environment.comparisonId');
  enumValue(document.environment.status, ENVIRONMENT_GATE_STATUSES, '$.environment.status');
  enumValue(document.environmentMode, EXPLORATION_ENVIRONMENT_MODES, '$.environmentMode');
  enumValue(document.profile, EXPLORATION_PROFILES, '$.profile');
  validateExplorationLimits(document.limits, '$.limits');
  enumValue(document.confirmation, ['RUN_AUTONOMOUS_READ_ONLY_EXPLORATION'], '$.confirmation');
  isoDate(document.expiresAt, '$.expiresAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'USER' || document.sensitivity !== 'PRIVATE') fail('Runtime Exploration Authorization must be private USER evidence');
  const lifetime = Date.parse(document.expiresAt) - Date.parse(document.createdAt);
  if (lifetime <= 0 || lifetime > 8 * 60 * 60 * 1000) fail('Runtime Exploration Authorization must expire within 8 hours after creation');
  return document;
}

function validateExplorationLocator(target, path) {
  exactKeys(target, ['strategy', 'value'], ['strategy', 'value', 'role', 'exact'], path);
  enumValue(target.strategy, EXPLORATION_LOCATOR_STRATEGIES, `${path}.strategy`);
  string(target.value, `${path}.value`, { max: 1024 });
  if (target.role !== undefined) string(target.role, `${path}.role`, { max: 128, pattern: ID_PATTERN });
  if (target.exact !== undefined) boolean(target.exact, `${path}.exact`);
  if (target.strategy === 'ROLE' && target.role === undefined) fail(`${path}.role is required for ROLE locators`);
  if (target.strategy !== 'ROLE' && target.role !== undefined) fail(`${path}.role is allowed only for ROLE locators`);
  if (['CSS', 'XPATH'].includes(target.strategy) && target.exact !== undefined) fail(`${path}.exact is not allowed for CSS/XPATH locators`);
}

function validateExplorationAction(action, path) {
  exactKeys(action, ['actionId', 'type'], ['actionId', 'type', 'target', 'input', 'timeoutMs'], path);
  id(action.actionId, `${path}.actionId`);
  enumValue(action.type, EXPLORATION_ACTION_TYPES, `${path}.type`);
  if (action.target !== undefined) validateExplorationLocator(action.target, `${path}.target`);
  if (action.timeoutMs !== undefined) integer(action.timeoutMs, `${path}.timeoutMs`, { min: 1, max: 120000 });
  const needsTarget = ['CLICK', 'FILL', 'HOVER', 'FOCUS'].includes(action.type);
  const needsInput = ['OPEN_PAGE', 'FILL', 'SCROLL'].includes(action.type);
  if (needsTarget && action.target === undefined) fail(`${path}.target is required for ${action.type}`);
  if (!needsTarget && action.target !== undefined) fail(`${path}.target is not allowed for ${action.type}`);
  if (needsInput && action.input === undefined) fail(`${path}.input is required for ${action.type}`);
  if (!needsInput && action.input !== undefined) fail(`${path}.input is not allowed for ${action.type}`);
  if (action.type === 'OPEN_PAGE' && (
    typeof action.input !== 'string'
    || (action.input !== '$SUBJECT_URL' && !action.input.startsWith('/'))
  )) fail(`${path}.input must be $SUBJECT_URL or a same-origin absolute path for OPEN_PAGE`);
  if (action.type === 'OPEN_PAGE' && action.input !== '$SUBJECT_URL' && EXPLORATION_RISKY_ROUTE.test(action.input)) fail(`${path}.input is not a proven read-only route`);
  if (action.type === 'CLICK' && !(action.target.strategy === 'ROLE' && action.target.role === 'tab')) fail(`${path} Agent-authored CLICK is limited to semantic tabs; other clicks must be discovered by the trusted controller`);
  if (action.type === 'FILL') {
    if (typeof action.input !== 'string' || action.input.length > 512) fail(`${path}.input must be a string no longer than 512 characters for FILL`);
    if (SECRET_TARGET.test(`${action.target.value} ${action.target.role || ''}`)) fail(`${path} cannot target an authentication or secret field`);
    if (!EXPLORATION_FILTER_TARGET.test(`${action.target.value} ${action.target.role || ''}`)) fail(`${path} FILL must identify a search, filter, query, or find control`);
  }
  if (action.type === 'SCROLL') integer(action.input, `${path}.input`, { min: 1, max: 10000 });
}

export function validateRuntimeExplorationPlan(document) {
  schemaHeader(document, 'runtime-exploration-plan');
  exactKeys(document,
    ['schemaVersion', 'kind', 'explorationId', 'reviewId', 'jobId', 'profile', 'startPath', 'strategy', 'limits', 'coverageGoal', 'seedPaths', 'knowledgeRuleIds', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'explorationId', 'reviewId', 'jobId', 'profile', 'startPath', 'strategy', 'limits', 'coverageGoal', 'seedPaths', 'knowledgeRuleIds', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.explorationId, '$.explorationId');
  reviewId(document.reviewId);
  jobId(document.jobId);
  enumValue(document.profile, EXPLORATION_PROFILES, '$.profile');
  if (typeof document.startPath !== 'string' || (document.startPath !== '$SUBJECT_URL' && !document.startPath.startsWith('/')) || document.startPath.length > 2048) {
    fail('$.startPath must be $SUBJECT_URL or a same-origin absolute path');
  }
  enumValue(document.strategy, ['SAFE_BFS'], '$.strategy');
  validateExplorationLimits(document.limits, '$.limits');
  exactKeys(document.coverageGoal,
    ['minStates', 'minExecutedControls', 'requireVisual'],
    ['minStates', 'minExecutedControls', 'requireVisual'],
    '$.coverageGoal');
  integer(document.coverageGoal.minStates, '$.coverageGoal.minStates', { min: 1, max: document.limits.maxStates });
  integer(document.coverageGoal.minExecutedControls, '$.coverageGoal.minExecutedControls', { min: 0, max: document.limits.maxActions });
  boolean(document.coverageGoal.requireVisual, '$.coverageGoal.requireVisual');
  const seedPaths = array(document.seedPaths, '$.seedPaths', { max: 20 });
  const pathIds = new Set();
  seedPaths.forEach((seed, seedIndex) => {
    const path = `$.seedPaths[${seedIndex}]`;
    exactKeys(seed, ['pathId', 'name', 'actions'], ['pathId', 'name', 'actions'], path);
    id(seed.pathId, `${path}.pathId`);
    if (pathIds.has(seed.pathId)) fail('$.seedPaths must not contain duplicate pathId values');
    pathIds.add(seed.pathId);
    string(seed.name, `${path}.name`, { max: 256 });
    const actions = array(seed.actions, `${path}.actions`, { max: 50 });
    const actionIds = new Set();
    actions.forEach((action, actionIndex) => {
      validateExplorationAction(action, `${path}.actions[${actionIndex}]`);
      if (actionIds.has(action.actionId)) fail(`${path}.actions must not contain duplicate actionId values`);
      actionIds.add(action.actionId);
    });
    if (actions.length > document.limits.maxDepth) fail(`${path}.actions exceeds the exploration maxDepth`);
  });
  uniqueStrings(document.knowledgeRuleIds, '$.knowledgeRuleIds', { max: 200 });
  validateArtifactMetadata(document);
  if (document.createdBy !== 'AGENT' || document.sensitivity !== 'REDACTED') fail('Runtime Exploration Plan must be a redacted AGENT artifact');
  return document;
}

export function validateRuntimeExplorationReport(document) {
  schemaHeader(document, 'runtime-exploration-report');
  exactKeys(document,
    ['schemaVersion', 'kind', 'explorationId', 'reviewId', 'jobId', 'authorizationId', 'planSha256', 'jobManifestSha256', 'status', 'environment', 'coverage', 'pathResults', 'stopReason', 'claims', 'startedAt', 'completedAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'explorationId', 'reviewId', 'jobId', 'authorizationId', 'planSha256', 'jobManifestSha256', 'status', 'environment', 'coverage', 'pathResults', 'stopReason', 'claims', 'startedAt', 'completedAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.explorationId, '$.explorationId');
  reviewId(document.reviewId);
  jobId(document.jobId);
  id(document.authorizationId, '$.authorizationId');
  sha256(document.planSha256, '$.planSha256');
  sha256(document.jobManifestSha256, '$.jobManifestSha256');
  enumValue(document.status, EXPLORATION_REPORT_STATUSES, '$.status');
  exactKeys(document.environment, ['comparisonId', 'status', 'mode'], ['comparisonId', 'status', 'mode'], '$.environment');
  id(document.environment.comparisonId, '$.environment.comparisonId');
  enumValue(document.environment.status, ENVIRONMENT_GATE_STATUSES, '$.environment.status');
  enumValue(document.environment.mode, EXPLORATION_ENVIRONMENT_MODES, '$.environment.mode');
  exactKeys(document.coverage,
    ['states', 'paths', 'discoveredControls', 'eligibleControls', 'executedControls', 'skippedControls', 'blockedActions', 'visualCheckpoints', 'mismatches', 'goalSatisfied', 'queueExhausted', 'budgetExhausted'],
    ['states', 'paths', 'discoveredControls', 'eligibleControls', 'executedControls', 'skippedControls', 'blockedActions', 'visualCheckpoints', 'mismatches', 'goalSatisfied', 'queueExhausted', 'budgetExhausted'],
    '$.coverage');
  for (const key of ['states', 'paths', 'discoveredControls', 'eligibleControls', 'executedControls', 'skippedControls', 'blockedActions', 'visualCheckpoints', 'mismatches']) {
    integer(document.coverage[key], `$.coverage.${key}`, { min: 0, max: 100000 });
  }
  for (const key of ['goalSatisfied', 'queueExhausted', 'budgetExhausted']) boolean(document.coverage[key], `$.coverage.${key}`);
  const pathResults = array(document.pathResults, '$.pathResults', { max: 500 });
  pathResults.forEach((entry, index) => {
    const path = `$.pathResults[${index}]`;
    exactKeys(entry,
      ['pathId', 'depth', 'status', 'sourceFingerprint', 'targetFingerprint', 'visualStatus', 'evidenceRef'],
      ['pathId', 'depth', 'status', 'sourceFingerprint', 'targetFingerprint', 'visualStatus', 'evidenceRef'],
      path);
    id(entry.pathId, `${path}.pathId`);
    integer(entry.depth, `${path}.depth`, { min: 0, max: 16 });
    enumValue(entry.status, ['MATCHED', 'DIVERGED', 'BLOCKED', 'INCONCLUSIVE'], `${path}.status`);
    nullableSha256(entry.sourceFingerprint, `${path}.sourceFingerprint`);
    nullableSha256(entry.targetFingerprint, `${path}.targetFingerprint`);
    enumValue(entry.visualStatus, ['MATCHED', 'DIFFERENT', 'INCONCLUSIVE'], `${path}.visualStatus`);
    safeArtifactPath(entry.evidenceRef, `${path}.evidenceRef`);
  });
  nullableString(document.stopReason, '$.stopReason', { max: 1024 });
  exactKeys(document.claims,
    ['parityClaimed', 'strictParityClaimed', 'converterAttributionAllowed', 'automaticRepairAllowed', 'targetRepairAttempted', 'platformWriteAttempted'],
    ['parityClaimed', 'strictParityClaimed', 'converterAttributionAllowed', 'automaticRepairAllowed', 'targetRepairAttempted', 'platformWriteAttempted'],
    '$.claims');
  for (const key of Object.keys(document.claims)) boolean(document.claims[key], `$.claims.${key}`);
  if (document.claims.targetRepairAttempted || document.claims.platformWriteAttempted) fail('Runtime Exploration Report cannot record repair or platform writes');
  if (document.status !== 'EXPLORATION_PARITY_PASSED' && (document.claims.parityClaimed || document.claims.strictParityClaimed)) fail('Only EXPLORATION_PARITY_PASSED may claim parity');
  if (document.environment.mode === 'ALLOW_DIAGNOSTIC' && (document.claims.parityClaimed || document.claims.converterAttributionAllowed || document.claims.automaticRepairAllowed)) {
    fail('Diagnostic environment exploration cannot claim parity, Converter attribution, or automatic repair');
  }
  isoDate(document.startedAt, '$.startedAt');
  isoDate(document.completedAt, '$.completedAt');
  validateArtifactMetadata(document);
  if (Date.parse(document.completedAt) < Date.parse(document.startedAt)) fail('completedAt must not precede startedAt');
  if (document.createdAt !== document.completedAt) fail('Runtime Exploration Report createdAt must equal completedAt');
  if (document.createdBy !== 'CLI' || document.sensitivity !== 'REDACTED') fail('Runtime Exploration Report must be a redacted CLI artifact');
  return document;
}

function validateAgentNativeSubject(subject, path) {
  exactKeys(subject, ['nid', 'workId', 'url', 'origin'], ['nid', 'workId', 'url', 'origin'], path);
  integer(subject.nid, `${path}.nid`, { min: 1 });
  nullableString(subject.workId, `${path}.workId`, { max: 256 });
  for (const key of ['url', 'origin']) {
    nullableString(subject[key], `${path}.${key}`, { max: 4096 });
    if (subject[key] !== null) {
      let parsed;
      try { parsed = new URL(subject[key]); } catch { fail(`${path}.${key} must be an absolute HTTP(S) URL without credentials`); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        fail(`${path}.${key} must be an absolute HTTP(S) URL without credentials`);
      }
      if (key === 'origin' && parsed.origin !== subject[key]) fail(`${path}.origin must contain only the URL origin`);
    }
  }
}

function validateAgentNativeExploration(exploration, { outcome, purpose, coverage }) {
  exactKeys(exploration, ['scope', 'inventory', 'candidateFlows', 'queue'], ['scope', 'inventory', 'candidateFlows', 'queue'], '$.exploration');
  enumValue(exploration.scope, AGENT_NATIVE_EXPLORATION_SCOPES, '$.exploration.scope');
  if (purpose === 'REPAIR_REGRESSION' && exploration.scope !== 'AFFECTED_FLOWS') fail('REPAIR_REGRESSION requires AFFECTED_FLOWS exploration scope');
  if (purpose !== 'REPAIR_REGRESSION' && exploration.scope !== 'WHOLE_CASE') fail('Initial and user retest observations require WHOLE_CASE exploration scope');

  const inventoryKeys = ['smokeTestCompleted', 'staticArtifactsInspected', 'runtimeSurfaceInspected', 'navigationInspected', 'serviceCallsInspected'];
  exactKeys(exploration.inventory, inventoryKeys, inventoryKeys, '$.exploration.inventory');
  for (const key of inventoryKeys) boolean(exploration.inventory[key], `$.exploration.inventory.${key}`);

  const flows = array(exploration.candidateFlows, '$.exploration.candidateFlows', { max: 1000 });
  const flowIds = new Set();
  flows.forEach((flow, index) => {
    const path = `$.exploration.candidateFlows[${index}]`;
    const keys = ['flowId', 'summary', 'discoverySources', 'effectClass', 'executionScope', 'result', 'stepCount', 'stopReason', 'evidenceRefs'];
    exactKeys(flow, keys, keys, path);
    id(flow.flowId, `${path}.flowId`);
    if (flowIds.has(flow.flowId)) fail('$.exploration.candidateFlows flowId values must be unique');
    flowIds.add(flow.flowId);
    string(flow.summary, `${path}.summary`, { max: 4096 });
    const sources = array(flow.discoverySources, `${path}.discoverySources`, { max: 4 });
    if (sources.length === 0) fail(`${path}.discoverySources must contain at least one source`);
    sources.forEach((source, sourceIndex) => enumValue(source, AGENT_NATIVE_DISCOVERY_SOURCES, `${path}.discoverySources[${sourceIndex}]`));
    if (new Set(sources).size !== sources.length) fail(`${path}.discoverySources must not contain duplicates`);
    enumValue(flow.effectClass, AGENT_NATIVE_EFFECT_CLASSES, `${path}.effectClass`);
    enumValue(flow.executionScope, AGENT_NATIVE_EXECUTION_SCOPES, `${path}.executionScope`);
    enumValue(flow.result, AGENT_NATIVE_FLOW_RESULTS, `${path}.result`);
    integer(flow.stepCount, `${path}.stepCount`, { min: 0, max: 1000000 });
    nullableString(flow.stopReason, `${path}.stopReason`, { max: 4096 });
    const refs = uniqueStrings(flow.evidenceRefs, `${path}.evidenceRefs`, { max: 200 });
    refs.forEach((ref, refIndex) => safeArtifactPath(ref, `${path}.evidenceRefs[${refIndex}]`));

    if (flow.executionScope === 'FULLY_EXECUTED') {
      if (flow.result === 'NOT_OBSERVED' || flow.stopReason !== null) fail(`${path} fully executed flow requires an observed result and no stopReason`);
    } else if (flow.executionScope === 'PRE_SUBMIT_BOUNDARY') {
      if (flow.effectClass !== 'WRITE' || flow.result === 'NOT_OBSERVED' || flow.stopReason === null) {
        fail(`${path} pre-submit flow requires WRITE classification, an observed result, and a stopReason`);
      }
    } else if (flow.executionScope === 'BLOCKED') {
      if (flow.result !== 'INCONCLUSIVE' || flow.stopReason === null) fail(`${path} blocked flow must be INCONCLUSIVE with a stopReason`);
    } else if (flow.result !== 'NOT_OBSERVED' || flow.stopReason === null) {
      fail(`${path} unexecuted flow must be NOT_OBSERVED with a stopReason`);
    }
  });

  const queueKeys = ['candidateCount', 'fullyExecutedCount', 'preSubmitCount', 'blockedCount', 'notExecutedCount', 'unknownEffectCount', 'exhausted'];
  exactKeys(exploration.queue, queueKeys, queueKeys, '$.exploration.queue');
  for (const key of queueKeys.filter((key) => key !== 'exhausted')) integer(exploration.queue[key], `$.exploration.queue.${key}`, { min: 0, max: 1000000 });
  boolean(exploration.queue.exhausted, '$.exploration.queue.exhausted');
  const derived = {
    candidateCount: flows.length,
    fullyExecutedCount: flows.filter((flow) => flow.executionScope === 'FULLY_EXECUTED').length,
    preSubmitCount: flows.filter((flow) => flow.executionScope === 'PRE_SUBMIT_BOUNDARY').length,
    blockedCount: flows.filter((flow) => flow.executionScope === 'BLOCKED').length,
    notExecutedCount: flows.filter((flow) => flow.executionScope === 'NOT_EXECUTED').length,
    unknownEffectCount: flows.filter((flow) => flow.effectClass === 'UNKNOWN').length,
  };
  for (const [key, value] of Object.entries(derived)) {
    if (exploration.queue[key] !== value) fail(`$.exploration.queue.${key} must equal the candidate-flow inventory`);
  }
  const exhausted = derived.blockedCount === 0 && derived.notExecutedCount === 0;
  if (exploration.queue.exhausted !== exhausted) fail('$.exploration.queue.exhausted must reflect blocked and unexecuted candidate flows');
  if (coverage.businessFlows !== flows.length) fail('$.coverage.businessFlows must equal $.exploration.candidateFlows length');

  const inventoryComplete = inventoryKeys.every((key) => exploration.inventory[key]);
  if (outcome === 'OBSERVED_EQUIVALENT') {
    if (!inventoryComplete) fail('OBSERVED_EQUIVALENT requires complete smoke, static, runtime, navigation, and service inventory');
    if (flows.length === 0) fail('OBSERVED_EQUIVALENT requires at least one candidate business flow');
    if (!exploration.queue.exhausted) fail('OBSERVED_EQUIVALENT requires an exhausted candidate-flow queue');
    if (derived.unknownEffectCount > 0) fail('OBSERVED_EQUIVALENT cannot retain UNKNOWN-effect candidate flows');
    if (flows.some((flow) => !['FULLY_EXECUTED', 'PRE_SUBMIT_BOUNDARY'].includes(flow.executionScope) || flow.result !== 'MATCHED')) {
      fail('OBSERVED_EQUIVALENT requires every candidate flow to match after full execution or a recorded pre-submit boundary');
    }
  }
  if (outcome === 'OBSERVED_MISMATCH' && !flows.some((flow) => flow.result === 'MISMATCH')) {
    fail('OBSERVED_MISMATCH requires a MISMATCH candidate flow');
  }
  if (outcome === 'INCONCLUSIVE') {
    const unresolved = !inventoryComplete || !exploration.queue.exhausted || derived.unknownEffectCount > 0
      || flows.some((flow) => ['INCONCLUSIVE', 'NOT_OBSERVED'].includes(flow.result));
    if (!unresolved) fail('INCONCLUSIVE requires incomplete inventory, unresolved queue/effect, or an inconclusive candidate flow');
  }
}

export function validateAgentNativeObservationBundle(document, { allowLegacyExploration = false } = {}) {
  schemaHeader(document, 'agent-native-observation-bundle');
  const keys = ['schemaVersion', 'kind', 'runId', 'previousRunId', 'repairBatchId', 'reviewId', 'jobId', 'purpose', 'subjects', 'environment', 'execution', 'outcome', 'coverage', 'exploration', 'effects', 'findings', 'evidenceRefs', 'claims', 'completedAt', 'createdAt', 'createdBy', 'sensitivity'];
  const required = allowLegacyExploration ? keys.filter((key) => key !== 'exploration') : keys;
  exactKeys(document,
    required,
    keys,
    '$');
  id(document.runId, '$.runId');
  if (document.previousRunId !== null) id(document.previousRunId, '$.previousRunId');
  if (document.repairBatchId !== null) id(document.repairBatchId, '$.repairBatchId');
  reviewId(document.reviewId);
  jobId(document.jobId);
  enumValue(document.purpose, AGENT_NATIVE_RUN_PURPOSES, '$.purpose');
  if (document.purpose === 'REPAIR_REGRESSION' && document.repairBatchId === null) fail('REPAIR_REGRESSION requires repairBatchId');
  if (document.purpose !== 'REPAIR_REGRESSION' && document.repairBatchId !== null) fail('Only REPAIR_REGRESSION may reference repairBatchId');
  exactKeys(document.subjects, ['source', 'target'], ['source', 'target'], '$.subjects');
  validateAgentNativeSubject(document.subjects.source, '$.subjects.source');
  validateAgentNativeSubject(document.subjects.target, '$.subjects.target');
  exactKeys(document.environment, ['comparisonId', 'status', 'differences'], ['comparisonId', 'status', 'differences'], '$.environment');
  if (document.environment.comparisonId !== null) id(document.environment.comparisonId, '$.environment.comparisonId');
  if (document.environment.status !== null) enumValue(document.environment.status, ENVIRONMENT_GATE_STATUSES, '$.environment.status');
  array(document.environment.differences, '$.environment.differences', { max: 1000 }).forEach((difference, index) => {
    const path = `$.environment.differences[${index}]`;
    exactKeys(difference, ['path', 'summary'], ['path', 'summary'], path);
    string(difference.path, `${path}.path`, { max: 1024 });
    string(difference.summary, `${path}.summary`, { max: 2048 });
  });
  exactKeys(document.execution, ['tools', 'startedAt', 'completedAt'], ['tools', 'startedAt', 'completedAt'], '$.execution');
  uniqueStrings(document.execution.tools, '$.execution.tools', { max: 100 });
  isoDate(document.execution.startedAt, '$.execution.startedAt');
  isoDate(document.execution.completedAt, '$.execution.completedAt');
  if (Date.parse(document.execution.completedAt) < Date.parse(document.execution.startedAt)) fail('execution.completedAt must not precede execution.startedAt');
  enumValue(document.outcome, AGENT_NATIVE_OBSERVATION_OUTCOMES, '$.outcome');
  exactKeys(document.coverage, ['businessFlows', 'states', 'actions', 'assertions', 'screenshots', 'networkObservations'], ['businessFlows', 'states', 'actions', 'assertions', 'screenshots', 'networkObservations'], '$.coverage');
  for (const key of Object.keys(document.coverage)) integer(document.coverage[key], `$.coverage.${key}`, { min: 0, max: 1000000 });
  if (document.exploration) validateAgentNativeExploration(document.exploration, { outcome: document.outcome, purpose: document.purpose, coverage: document.coverage });
  exactKeys(document.effects, ['occurred', 'systems', 'summaries'], ['occurred', 'systems', 'summaries'], '$.effects');
  boolean(document.effects.occurred, '$.effects.occurred');
  uniqueStrings(document.effects.systems, '$.effects.systems', { max: 100 });
  uniqueStrings(document.effects.summaries, '$.effects.summaries', { max: 200 });
  if (!document.effects.occurred && (document.effects.systems.length || document.effects.summaries.length)) fail('effects systems/summaries require occurred=true');
  const findings = array(document.findings, '$.findings', { max: 1000 });
  findings.forEach((finding, index) => {
    const path = `$.findings[${index}]`;
    exactKeys(finding, ['findingId', 'severity', 'status', 'summary', 'candidateCause', 'evidenceRefs'], ['findingId', 'severity', 'status', 'summary', 'candidateCause', 'evidenceRefs'], path);
    id(finding.findingId, `${path}.findingId`);
    enumValue(finding.severity, ['INFO', 'WARNING', 'ERROR'], `${path}.severity`);
    enumValue(finding.status, ['MATCHED', 'MISMATCH', 'INCONCLUSIVE'], `${path}.status`);
    string(finding.summary, `${path}.summary`, { max: 4096 });
    if (finding.candidateCause !== null) enumValue(finding.candidateCause, ISSUE_CAUSES, `${path}.candidateCause`);
    const refs = uniqueStrings(finding.evidenceRefs, `${path}.evidenceRefs`, { max: 200 });
    refs.forEach((ref, refIndex) => safeArtifactPath(ref, `${path}.evidenceRefs[${refIndex}]`));
  });
  if (document.outcome === 'OBSERVED_MISMATCH' && !findings.some((finding) => finding.status === 'MISMATCH')) fail('OBSERVED_MISMATCH requires a MISMATCH finding');
  if (document.outcome === 'OBSERVED_EQUIVALENT' && findings.some((finding) => finding.status !== 'MATCHED')) fail('OBSERVED_EQUIVALENT may contain only MATCHED findings');
  const evidenceRefs = uniqueStrings(document.evidenceRefs, '$.evidenceRefs', { max: 2000 });
  evidenceRefs.forEach((ref, index) => safeArtifactPath(ref, `$.evidenceRefs[${index}]`));
  exactKeys(document.claims, ['strictParityClaimed', 'workflowRestrictionsApplied'], ['strictParityClaimed', 'workflowRestrictionsApplied'], '$.claims');
  boolean(document.claims.strictParityClaimed, '$.claims.strictParityClaimed');
  boolean(document.claims.workflowRestrictionsApplied, '$.claims.workflowRestrictionsApplied');
  if (document.claims.strictParityClaimed || document.claims.workflowRestrictionsApplied) fail('Agent Native Observation cannot claim strict parity or Workflow test restrictions');
  isoDate(document.completedAt, '$.completedAt');
  validateArtifactMetadata(document);
  if (document.createdAt !== document.completedAt || document.completedAt !== document.execution.completedAt) fail('Agent Native Observation timestamps must close at the same instant');
  if (document.createdBy !== 'AGENT' || document.sensitivity !== 'REDACTED') fail('Agent Native Observation must be a redacted AGENT artifact');
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
  exactKeys(document.environment, ['comparisonId', 'status'], ['comparisonId', 'status', 'assurance', 'riskAcceptanceId'], '$.environment');
  id(document.environment.comparisonId, '$.environment.comparisonId');
  enumValue(document.environment.status, ENVIRONMENT_GATE_STATUSES, '$.environment.status');
  if (document.environment.assurance !== undefined) {
    enumValue(document.environment.assurance, ENVIRONMENT_EXECUTION_ASSURANCES, '$.environment.assurance');
    if (document.environment.riskAcceptanceId !== null) id(document.environment.riskAcceptanceId, '$.environment.riskAcceptanceId');
    if (document.environment.assurance === 'USER_ACCEPTED_RISK') {
      if (!['REQUIRES_USER_BINDING', 'BLOCKED_ENVIRONMENT'].includes(document.environment.status) || document.environment.riskAcceptanceId === null) {
        fail('USER_ACCEPTED_RISK requires an unresolved Environment Gate and a riskAcceptanceId');
      }
    } else if (!['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT'].includes(document.environment.status) || document.environment.riskAcceptanceId !== null) {
      fail('Equivalent environment assurance requires an equivalent Environment Gate and no riskAcceptanceId');
    }
  } else if (document.environment.riskAcceptanceId !== undefined) {
    fail('$.environment.riskAcceptanceId requires $.environment.assurance');
  }
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

function validateEnvironmentRiskRevision(revision, path) {
  exactKeys(revision, ['nid', 'workId'], ['nid', 'workId'], path);
  integer(revision.nid, `${path}.nid`, { min: 1 });
  string(revision.workId, `${path}.workId`, { max: 256 });
}

export function validateEnvironmentRiskAcceptance(document) {
  schemaHeader(document, 'environment-risk-acceptance');
  exactKeys(document,
    ['schemaVersion', 'kind', 'acceptanceId', 'reviewId', 'sourceRevision', 'targetRevision', 'acceptedPaths', 'scenarioIds', 'purpose', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'acceptanceId', 'reviewId', 'sourceRevision', 'targetRevision', 'acceptedPaths', 'scenarioIds', 'purpose', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.acceptanceId, '$.acceptanceId');
  reviewId(document.reviewId);
  validateEnvironmentRiskRevision(document.sourceRevision, '$.sourceRevision');
  validateEnvironmentRiskRevision(document.targetRevision, '$.targetRevision');
  const acceptedPaths = uniqueStrings(document.acceptedPaths, '$.acceptedPaths', { max: 10000 });
  if (acceptedPaths.length === 0 || acceptedPaths.some((value) => !value.startsWith('/'))) fail('$.acceptedPaths must contain JSON-pointer environment paths');
  const scenarioIds = uniqueStrings(document.scenarioIds, '$.scenarioIds', { max: 100 });
  if (scenarioIds.length === 0) fail('$.scenarioIds must contain at least one Runtime Scenario');
  enumValue(document.purpose, ['DIAGNOSTIC_RUNTIME_ONLY'], '$.purpose');
  if (document.confirmation !== 'ACCEPT_ENVIRONMENT_RISK') fail('$.confirmation must be ACCEPT_ENVIRONMENT_RISK');
  isoDate(document.expiresAt, '$.expiresAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'USER' || document.sensitivity !== 'PRIVATE') fail('Environment risk acceptance must be private USER evidence');
  if (Date.parse(document.expiresAt) <= Date.parse(document.createdAt)) fail('Environment risk acceptance must expire after creation');
  if (Date.parse(document.expiresAt) - Date.parse(document.createdAt) > 8 * 60 * 60 * 1000) fail('Environment risk acceptance cannot last longer than 8 hours');
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
    ['schemaVersion', 'kind', 'proposalId', 'reviewId', 'authorizationId', 'clusterIds', 'baseTarget', 'patch', 'affectedScenarioIds', 'affectedNativeRunIds', 'evidenceRefs', 'knowledgeRuleIds', 'confidence', 'rationale', 'createdAt', 'createdBy', 'sensitivity'],
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
  if (document.affectedNativeRunIds !== undefined) uniqueStrings(document.affectedNativeRunIds, '$.affectedNativeRunIds', { max: 1000 });
  if (document.affectedScenarioIds.length === 0 && (document.affectedNativeRunIds || []).length === 0) fail('Repair Proposal must reference at least one affected Runtime Scenario or Agent Native run');
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
    ['schemaVersion', 'kind', 'batchId', 'reviewId', 'attemptIds', 'clusterIds', 'state', 'authorizationId', 'expectedTarget', 'candidate', 'affectedScenarioIds', 'affectedNativeRunIds', 'write', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
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
  if (document.affectedNativeRunIds !== undefined) uniqueStrings(document.affectedNativeRunIds, '$.affectedNativeRunIds', { max: 1000 });
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
  FLAKY_RUNTIME: 'FLAKY_RUNTIME',
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
    const nativeShape = entry.sourceKind !== undefined;
    exactKeys(entry,
      nativeShape ? ['sourceKind', 'issueId', 'comparisonId', 'assertionId', 'nativeRunId', 'findingId', 'status', 'reasonCode', 'evidenceRef'] : ['issueId', 'comparisonId', 'assertionId', 'status', 'reasonCode', 'evidenceRef'],
      nativeShape ? ['sourceKind', 'issueId', 'comparisonId', 'assertionId', 'nativeRunId', 'findingId', 'status', 'reasonCode', 'evidenceRef'] : ['issueId', 'comparisonId', 'assertionId', 'status', 'reasonCode', 'evidenceRef'],
      path);
    if (nativeShape) enumValue(entry.sourceKind, ['RUNTIME_COMPARISON', 'AGENT_NATIVE_OBSERVATION'], `${path}.sourceKind`);
    id(entry.issueId, `${path}.issueId`);
    if (entry.comparisonId !== null) id(entry.comparisonId, `${path}.comparisonId`);
    if (entry.assertionId !== null) id(entry.assertionId, `${path}.assertionId`);
    if (nativeShape && entry.nativeRunId !== null) id(entry.nativeRunId, `${path}.nativeRunId`);
    if (nativeShape && entry.findingId !== null) id(entry.findingId, `${path}.findingId`);
    if (nativeShape && entry.sourceKind === 'RUNTIME_COMPARISON' && (entry.comparisonId === null || entry.assertionId === null || entry.nativeRunId !== null || entry.findingId !== null)) fail(`${path} runtime evidence identifiers are inconsistent`);
    if (nativeShape && entry.sourceKind === 'AGENT_NATIVE_OBSERVATION' && (entry.nativeRunId === null || entry.findingId === null || entry.comparisonId !== null || entry.assertionId !== null)) fail(`${path} Agent Native evidence identifiers are inconsistent`);
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

export function validateRefreshJob(document) {
  schemaHeader(document, 'existing-target-refresh');
  exactKeys(document,
    ['schemaVersion', 'kind', 'refreshId', 'status', 'source', 'target', 'runtime', 'plan', 'result', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'refreshId', 'status', 'source', 'target', 'runtime', 'plan', 'result', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    '$');
  refreshId(document.refreshId);
  enumValue(document.status, REFRESH_STATUSES, '$.status');
  exactKeys(document.source, ['nid', 'gid'], ['nid', 'gid'], '$.source');
  integer(document.source.nid, '$.source.nid', { min: 1 });
  if (document.source.gid !== null) integer(document.source.gid, '$.source.gid', { min: 1 });
  exactKeys(document.target, ['nid', 'lineageJobId'], ['nid', 'lineageJobId'], '$.target');
  integer(document.target.nid, '$.target.nid', { min: 1 });
  jobId(document.target.lineageJobId, '$.target.lineageJobId');
  validatePinnedRuntimeSet(document.runtime, '$.runtime');
  exactKeys(document.plan, ['planId', 'planSha256', 'artifact', 'authorizationId'], ['planId', 'planSha256', 'artifact', 'authorizationId'], '$.plan');
  if (document.plan.planId !== null) id(document.plan.planId, '$.plan.planId');
  nullableSha256(document.plan.planSha256, '$.plan.planSha256');
  if (document.plan.artifact !== null) safeArtifactPath(document.plan.artifact, '$.plan.artifact');
  if (document.plan.authorizationId !== null) id(document.plan.authorizationId, '$.plan.authorizationId');
  exactKeys(document.result, ['targetWorkId', 'targetSha256', 'newReviewId', 'supersededReviewIds'], ['targetWorkId', 'targetSha256', 'newReviewId', 'supersededReviewIds'], '$.result');
  if (document.result.targetWorkId !== null) string(document.result.targetWorkId, '$.result.targetWorkId', { max: 256 });
  nullableSha256(document.result.targetSha256, '$.result.targetSha256');
  if (document.result.newReviewId !== null) reviewId(document.result.newReviewId, '$.result.newReviewId');
  uniqueStrings(document.result.supersededReviewIds, '$.result.supersededReviewIds', { max: 1000 });
  array(document.history, '$.history', { max: 10000 }).forEach((entry, index) => {
    const path = `$.history[${index}]`;
    exactKeys(entry, ['status', 'at', 'reason'], ['status', 'at', 'reason'], path);
    enumValue(entry.status, REFRESH_STATUSES, `${path}.status`);
    isoDate(entry.at, `${path}.at`);
    nullableString(entry.reason, `${path}.reason`, { max: 4096 });
  });
  isoDate(document.updatedAt, '$.updatedAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'CLI' || document.sensitivity !== 'PRIVATE') fail('Refresh Job must be private CLI state');
  if (document.history.length === 0 || document.history.at(-1).status !== document.status) fail('Refresh Job history must end with its current status');
  if (Date.parse(document.updatedAt) < Date.parse(document.createdAt)) fail('Refresh Job updatedAt must not precede createdAt');
  return document;
}

export function validateRefreshPlan(document) {
  schemaHeader(document, 'refresh-plan');
  exactKeys(document,
    ['schemaVersion', 'kind', 'planId', 'refreshId', 'source', 'target', 'runtime', 'candidate', 'identityRewrite', 'configurationPolicy', 'diagnostics', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'planId', 'refreshId', 'source', 'target', 'runtime', 'candidate', 'identityRewrite', 'configurationPolicy', 'diagnostics', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.planId, '$.planId');
  refreshId(document.refreshId);
  exactKeys(document.source, ['nid', 'gid', 'workId', 'sha256', 'classificationArtifact'], ['nid', 'gid', 'workId', 'sha256', 'classificationArtifact'], '$.source');
  integer(document.source.nid, '$.source.nid', { min: 1 });
  if (document.source.gid !== null) integer(document.source.gid, '$.source.gid', { min: 1 });
  string(document.source.workId, '$.source.workId', { max: 256 });
  sha256(document.source.sha256, '$.source.sha256');
  safeArtifactPath(document.source.classificationArtifact, '$.source.classificationArtifact');
  exactKeys(document.target, ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256', 'lineageJobId', 'classificationArtifact'], ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256', 'lineageJobId', 'classificationArtifact'], '$.target');
  integer(document.target.nid, '$.target.nid', { min: 1 });
  string(document.target.workId, '$.target.workId', { max: 256 });
  for (const key of ['sha256', 'configSha256', 'settingsSha256', 'routingSha256']) sha256(document.target[key], `$.target.${key}`);
  jobId(document.target.lineageJobId, '$.target.lineageJobId');
  safeArtifactPath(document.target.classificationArtifact, '$.target.classificationArtifact');
  validatePinnedRuntimeSet(document.runtime, '$.runtime');
  exactKeys(document.candidate, ['artifact', 'sha256', 'validationArtifact', 'structuralValidationPassed', 'issueCount', 'blockerCount'], ['artifact', 'sha256', 'validationArtifact', 'structuralValidationPassed', 'issueCount', 'blockerCount'], '$.candidate');
  safeArtifactPath(document.candidate.artifact, '$.candidate.artifact');
  sha256(document.candidate.sha256, '$.candidate.sha256');
  safeArtifactPath(document.candidate.validationArtifact, '$.candidate.validationArtifact');
  boolean(document.candidate.structuralValidationPassed, '$.candidate.structuralValidationPassed');
  integer(document.candidate.issueCount, '$.candidate.issueCount', { min: 0, max: 100000 });
  integer(document.candidate.blockerCount, '$.candidate.blockerCount', { min: 0, max: 100000 });
  exactKeys(document.identityRewrite, ['sourceNid', 'targetNid'], ['sourceNid', 'targetNid'], '$.identityRewrite');
  integer(document.identityRewrite.sourceNid, '$.identityRewrite.sourceNid', { min: 1 });
  integer(document.identityRewrite.targetNid, '$.identityRewrite.targetNid', { min: 1 });
  if (document.identityRewrite.sourceNid !== document.source.nid || document.identityRewrite.targetNid !== document.target.nid) fail('identityRewrite must match the pinned source and target');
  enumValue(document.configurationPolicy, ['PRESERVE_TARGET_CONFIGURATION'], '$.configurationPolicy');
  exactKeys(document.diagnostics, ['manifestArtifact', 'converterDiagnosticsArtifact', 'sha256', 'total'], ['manifestArtifact', 'converterDiagnosticsArtifact', 'sha256', 'total'], '$.diagnostics');
  safeArtifactPath(document.diagnostics.manifestArtifact, '$.diagnostics.manifestArtifact');
  if (document.diagnostics.converterDiagnosticsArtifact !== null) safeArtifactPath(document.diagnostics.converterDiagnosticsArtifact, '$.diagnostics.converterDiagnosticsArtifact');
  sha256(document.diagnostics.sha256, '$.diagnostics.sha256');
  integer(document.diagnostics.total, '$.diagnostics.total', { min: 0, max: 100000 });
  isoDate(document.expiresAt, '$.expiresAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'CLI' || document.sensitivity !== 'PRIVATE') fail('Refresh Plan must be private CLI state');
  if (Date.parse(document.expiresAt) <= Date.parse(document.createdAt)) fail('Refresh Plan must expire after creation');
  if (Date.parse(document.expiresAt) - Date.parse(document.createdAt) > 8 * 60 * 60 * 1000) fail('Refresh Plan cannot last longer than 8 hours');
  return document;
}

export function validateRefreshAuthorization(document) {
  schemaHeader(document, 'refresh-authorization');
  exactKeys(document,
    ['schemaVersion', 'kind', 'authorizationId', 'refreshId', 'planId', 'planSha256', 'source', 'target', 'candidateSha256', 'diagnosticsSha256', 'maxTargetRevisions', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'authorizationId', 'refreshId', 'planId', 'planSha256', 'source', 'target', 'candidateSha256', 'diagnosticsSha256', 'maxTargetRevisions', 'confirmation', 'expiresAt', 'createdAt', 'createdBy', 'sensitivity'],
    '$');
  id(document.authorizationId, '$.authorizationId');
  refreshId(document.refreshId);
  id(document.planId, '$.planId');
  sha256(document.planSha256, '$.planSha256');
  exactKeys(document.source, ['workId', 'sha256'], ['workId', 'sha256'], '$.source');
  string(document.source.workId, '$.source.workId', { max: 256 });
  sha256(document.source.sha256, '$.source.sha256');
  exactKeys(document.target, ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256'], ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256'], '$.target');
  integer(document.target.nid, '$.target.nid', { min: 1 });
  string(document.target.workId, '$.target.workId', { max: 256 });
  for (const key of ['sha256', 'configSha256', 'settingsSha256', 'routingSha256']) sha256(document.target[key], `$.target.${key}`);
  sha256(document.candidateSha256, '$.candidateSha256');
  sha256(document.diagnosticsSha256, '$.diagnosticsSha256');
  if (document.maxTargetRevisions !== 1) fail('Refresh Authorization permits exactly one confirmed target revision');
  if (document.confirmation !== 'REFRESH_EXISTING_V5') fail('$.confirmation must be REFRESH_EXISTING_V5');
  isoDate(document.expiresAt, '$.expiresAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'USER' || document.sensitivity !== 'PRIVATE') fail('Refresh Authorization must be private USER evidence');
  if (Date.parse(document.expiresAt) <= Date.parse(document.createdAt)) fail('Refresh Authorization must expire after creation');
  if (Date.parse(document.expiresAt) - Date.parse(document.createdAt) > 8 * 60 * 60 * 1000) fail('Refresh Authorization cannot last longer than 8 hours');
  return document;
}

export function validateRefreshJournal(document) {
  schemaHeader(document, 'refresh-journal');
  exactKeys(document,
    ['schemaVersion', 'kind', 'refreshId', 'planId', 'planSha256', 'authorizationId', 'phase', 'expectedTarget', 'candidateSha256', 'write', 'attempts', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'refreshId', 'planId', 'planSha256', 'authorizationId', 'phase', 'expectedTarget', 'candidateSha256', 'write', 'attempts', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    '$');
  refreshId(document.refreshId);
  id(document.planId, '$.planId');
  sha256(document.planSha256, '$.planSha256');
  id(document.authorizationId, '$.authorizationId');
  enumValue(document.phase, REFRESH_JOURNAL_PHASES, '$.phase');
  exactKeys(document.expectedTarget, ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256'], ['nid', 'workId', 'sha256', 'configSha256', 'settingsSha256', 'routingSha256'], '$.expectedTarget');
  integer(document.expectedTarget.nid, '$.expectedTarget.nid', { min: 1 });
  string(document.expectedTarget.workId, '$.expectedTarget.workId', { max: 256 });
  for (const key of ['sha256', 'configSha256', 'settingsSha256', 'routingSha256']) sha256(document.expectedTarget[key], `$.expectedTarget.${key}`);
  sha256(document.candidateSha256, '$.candidateSha256');
  exactKeys(document.write, ['requestedAt', 'responseWorkId', 'observedWorkId', 'observedSha256', 'errorCode'], ['requestedAt', 'responseWorkId', 'observedWorkId', 'observedSha256', 'errorCode'], '$.write');
  nullableIsoDate(document.write.requestedAt, '$.write.requestedAt');
  nullableString(document.write.responseWorkId, '$.write.responseWorkId', { max: 256 });
  nullableString(document.write.observedWorkId, '$.write.observedWorkId', { max: 256 });
  nullableSha256(document.write.observedSha256, '$.write.observedSha256');
  nullableString(document.write.errorCode, '$.write.errorCode', { max: 256 });
  array(document.attempts, '$.attempts', { max: 100 }).forEach((entry, index) => {
    const path = `$.attempts[${index}]`;
    exactKeys(entry, ['operation', 'status', 'at', 'errorCode'], ['operation', 'status', 'at', 'errorCode'], path);
    id(entry.operation, `${path}.operation`);
    id(entry.status, `${path}.status`);
    isoDate(entry.at, `${path}.at`);
    nullableString(entry.errorCode, `${path}.errorCode`, { max: 256 });
  });
  isoDate(document.updatedAt, '$.updatedAt');
  validateArtifactMetadata(document);
  if (document.createdBy !== 'CLI' || document.sensitivity !== 'PRIVATE') fail('Refresh Journal must be private CLI state');
  if (Date.parse(document.updatedAt) < Date.parse(document.createdAt)) fail('Refresh Journal updatedAt must not precede createdAt');
  return document;
}

export function validateRuntimeReviewSession(document) {
  schemaHeader(document, 'runtime-review-session');
  exactKeys(document,
    ['schemaVersion', 'kind', 'reviewId', 'jobId', 'target', 'capability', 'status', 'runtime', 'baseline', 'activeCycleId', 'issueClusterIds', 'scenarioIds', 'humanFindingIds', 'repairBudgetIds', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    ['schemaVersion', 'kind', 'reviewId', 'jobId', 'refreshId', 'supersession', 'target', 'capability', 'status', 'runtime', 'baseline', 'activeCycleId', 'issueClusterIds', 'scenarioIds', 'humanFindingIds', 'repairBudgetIds', 'history', 'createdAt', 'updatedAt', 'createdBy', 'sensitivity'],
    '$');
  reviewId(document.reviewId);
  jobId(document.jobId);
  if (document.refreshId !== undefined && document.refreshId !== null) refreshId(document.refreshId);
  if (document.supersession !== undefined && document.supersession !== null) {
    exactKeys(document.supersession, ['refreshId', 'newReviewId', 'newTargetWorkId', 'at'], ['refreshId', 'newReviewId', 'newTargetWorkId', 'at'], '$.supersession');
    refreshId(document.supersession.refreshId);
    reviewId(document.supersession.newReviewId);
    string(document.supersession.newTargetWorkId, '$.supersession.newTargetWorkId', { max: 256 });
    isoDate(document.supersession.at, '$.supersession.at');
  }
  exactKeys(document.target, ['nid', 'workId'], ['nid', 'workId'], '$.target');
  integer(document.target.nid, '$.target.nid', { min: 1 });
  string(document.target.workId, '$.target.workId', { max: 256 });
  enumValue(document.capability, REVIEW_CAPABILITIES, '$.capability');
  enumValue(document.status, REVIEW_STATUSES, '$.status');
  exactKeys(document.runtime, ['workflow', 'converter', 'knowledge'], ['workflow', 'converter', 'knowledge'], '$.runtime');
  validateRuntimePin(document.runtime.workflow, '$.runtime.workflow');
  validateRuntimePin(document.runtime.converter, '$.runtime.converter');
  validateKnowledgeRuntimePin(document.runtime.knowledge, '$.runtime.knowledge');
  exactKeys(document.baseline, ['sourceWorkId', 'targetWorkId'], ['sourceWorkId', 'targetWorkId', 'sourceArtifact'], '$.baseline');
  string(document.baseline.sourceWorkId, '$.baseline.sourceWorkId', { max: 256 });
  string(document.baseline.targetWorkId, '$.baseline.targetWorkId', { max: 256 });
  if (document.baseline.sourceArtifact !== undefined && document.baseline.sourceArtifact !== null) safeArtifactPath(document.baseline.sourceArtifact, '$.baseline.sourceArtifact');
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
  if (document.refreshId !== undefined && document.refreshId !== null && !document.baseline.sourceArtifact) fail('Refresh-created Review must pin its sourceArtifact');
  if (document.status === 'REVIEW_SUPERSEDED_BY_REFRESH') {
    if (document.capability !== 'READ_ONLY' || document.activeCycleId !== null || !document.supersession) fail('Superseded Review must be READ_ONLY, cycle-free, and contain supersession metadata');
  } else if (document.supersession !== undefined && document.supersession !== null) {
    fail('Only REVIEW_SUPERSEDED_BY_REFRESH may contain supersession metadata');
  }
  return document;
}

export const SCHEMA_V2_VALIDATORS = Object.freeze({
  'issue-classification': validateIssueClassificationV2,
  'issue-cluster': validateIssueCluster,
  'diagnosis-report': validateDiagnosisReport,
  'runtime-scenario': validateRuntimeScenario,
  'behavior-trace': validateBehaviorTrace,
  'runtime-comparison': validateRuntimeComparison,
  'runtime-exploration-authorization': validateRuntimeExplorationAuthorization,
  'runtime-exploration-plan': validateRuntimeExplorationPlan,
  'runtime-exploration-report': validateRuntimeExplorationReport,
  'agent-native-observation-bundle': validateAgentNativeObservationBundle,
  'environment-manifest': validateEnvironmentManifest,
  'environment-comparison': validateEnvironmentComparison,
  'environment-risk-acceptance': validateEnvironmentRiskAcceptance,
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
  'existing-target-refresh': validateRefreshJob,
  'refresh-plan': validateRefreshPlan,
  'refresh-authorization': validateRefreshAuthorization,
  'refresh-journal': validateRefreshJournal,
});

export function validateSchemaV2Artifact(document, options = {}) {
  if (document?.schemaVersion !== 2) {
    invariant(false, 'SCHEMA_VERSION_UNSUPPORTED', 'Expected schemaVersion 2', { actual: document?.schemaVersion ?? null });
  }
  const validator = SCHEMA_V2_VALIDATORS[document.kind];
  invariant(validator, 'SCHEMA_KIND_UNSUPPORTED', 'Unsupported schema v2 artifact kind', { kind: document.kind ?? null });
  return validator(document, options.validationReport);
}
