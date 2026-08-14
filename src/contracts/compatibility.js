import crypto from 'node:crypto';
import { invariant } from '../errors.js';
import { validateIssueClassificationV2 } from './schema-v2.js';
import { MIGRATION_INTENTS, normalizeMigrationIntent, normalizeRelatedJobIds } from '../jobs/intents.js';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function contentSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function validUtcDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateJobV1(job) {
  invariant(job && typeof job === 'object' && !Array.isArray(job), 'INVALID_JOB_STATE', 'Job state must be an object');
  invariant(job.schemaVersion === 1, 'INVALID_JOB_STATE', 'Job state schemaVersion must be 1');
  invariant(/^mig_[A-Za-z0-9_]+$/.test(job.jobId), 'INVALID_JOB_STATE', 'Job state has an invalid jobId');
  invariant(typeof job.status === 'string' && job.status, 'INVALID_JOB_STATE', 'Job state status is required');
  invariant(job.input && Number.isSafeInteger(job.input.sourceNid) && job.input.sourceNid > 0, 'INVALID_JOB_STATE', 'Job state sourceNid is invalid');
  normalizeMigrationIntent(job.input.intent || MIGRATION_INTENTS.CREATE_V5);
  normalizeRelatedJobIds(job.input.relatedPriorJobIds || []);
  invariant(Array.isArray(job.history), 'INVALID_JOB_STATE', 'Job state history must be an array');
  return job;
}

export function validateJobStateV2(job) {
  invariant(object(job), 'INVALID_JOB_STATE', 'Job state must be an object');
  invariant(job.schemaVersion === 2, 'INVALID_JOB_STATE', 'Job state schemaVersion must be 2');
  invariant(job.kind === 'migration-job', 'INVALID_JOB_STATE', 'Job state kind must be migration-job');
  invariant(/^mig_[A-Za-z0-9_]+$/.test(job.jobId), 'INVALID_JOB_STATE', 'Job state has an invalid jobId');
  invariant(typeof job.status === 'string' && job.status, 'INVALID_JOB_STATE', 'Job state status is required');
  invariant(['platform', 'local-file'].includes(job.mode), 'INVALID_JOB_STATE', 'Job state mode is invalid');
  invariant(job.input && Number.isSafeInteger(job.input.sourceNid) && job.input.sourceNid > 0, 'INVALID_JOB_STATE', 'Job state sourceNid is invalid');
  invariant(job.input.gid === null || (Number.isSafeInteger(job.input.gid) && job.input.gid > 0), 'INVALID_JOB_STATE', 'Job state gid is invalid');
  normalizeMigrationIntent(job.input.intent || MIGRATION_INTENTS.CREATE_V5);
  normalizeRelatedJobIds(job.input.relatedPriorJobIds || []);
  invariant(object(job.runtime) && object(job.source) && object(job.target) && object(job.issues), 'INVALID_JOB_STATE', 'Job state runtime/source/target/issues must be objects');
  invariant(validUtcDateTime(job.createdAt) && validUtcDateTime(job.updatedAt), 'INVALID_JOB_STATE', 'Job state timestamps are invalid');
  invariant(Array.isArray(job.history), 'INVALID_JOB_STATE', 'Job state history must be an array');
  invariant(object(job.provenance), 'INVALID_JOB_STATE', 'Job state provenance is required');
  invariant(job.provenance.sourceSchemaVersion === 1, 'INVALID_JOB_STATE', 'Job state provenance sourceSchemaVersion must be 1');
  invariant(/^[0-9a-f]{64}$/.test(job.provenance.sourceStateSha256), 'INVALID_JOB_STATE', 'Job state provenance sourceStateSha256 is invalid');
  invariant(validUtcDateTime(job.provenance.migratedAt), 'INVALID_JOB_STATE', 'Job state provenance migratedAt is invalid');
  invariant(job.provenance.migrationMode === 'COPY', 'INVALID_JOB_STATE', 'Job state provenance migrationMode must be COPY');
  return job;
}

export function readJobStateCompatible(job) {
  if (job?.schemaVersion === 1) {
    validateJobV1(job);
    return {
      sourceSchemaVersion: 1,
      readOnly: true,
      migrationRequired: true,
      state: structuredClone(job),
    };
  }
  if (job?.schemaVersion === 2) {
    validateJobStateV2(job);
    return {
      sourceSchemaVersion: 2,
      readOnly: false,
      migrationRequired: false,
      state: structuredClone(job),
    };
  }
  invariant(false, 'JOB_SCHEMA_VERSION_UNSUPPORTED', 'Unsupported Job state schema version', { actual: job?.schemaVersion ?? null });
}

export function migrateJobStateV1ToV2(job, { migratedAt = new Date().toISOString() } = {}) {
  validateJobV1(job);
  const migrated = structuredClone(job);
  migrated.schemaVersion = 2;
  migrated.kind = 'migration-job';
  migrated.input.intent = migrated.input.intent || MIGRATION_INTENTS.CREATE_V5;
  migrated.input.relatedPriorJobIds = migrated.input.relatedPriorJobIds || [];
  migrated.provenance = {
    sourceSchemaVersion: 1,
    sourceStateSha256: contentSha256(job),
    migratedAt,
    migrationMode: 'COPY',
  };
  return validateJobStateV2(migrated);
}

const LEGACY_OWNER_MAP = Object.freeze({
  CONVERTER: ['CONVERTER', 'CONVERTER_MAINTAINER', 'NONE'],
  SOURCE: ['SOURCE_DATA', 'WORKFLOW_AI', 'V5_ARTIFACT'],
  PLATFORM: ['PLATFORM_RUNTIME', 'PLATFORM_MAINTAINER', 'NONE'],
  AUTHORIZATION: ['AUTHORIZATION', 'USER', 'AUTHORIZATION_PREREQUISITE'],
  UNKNOWN: ['UNKNOWN', 'UNKNOWN', 'NONE'],
});

function validateIssueClassificationV1(classification, validationReport) {
  invariant(classification?.schemaVersion === 1, 'INVALID_CLASSIFICATION', 'Classification schemaVersion must be 1');
  invariant(Array.isArray(classification.issues), 'INVALID_CLASSIFICATION', 'Classification issues must be an array');
  const expected = new Set((validationReport?.issues || []).map((issue) => issue.issueId));
  const issueIds = new Set();
  for (const item of classification.issues) {
    invariant(item && typeof item === 'object', 'INVALID_CLASSIFICATION', 'Classification issue must be an object');
    invariant(expected.has(item.issueId) || !validationReport, 'INVALID_CLASSIFICATION', `Unknown issue id: ${item.issueId}`);
    invariant(LEGACY_OWNER_MAP[item.owner], 'INVALID_CLASSIFICATION', `Invalid issue owner: ${item.owner}`);
    invariant(typeof item.reason === 'string' && item.reason.trim(), 'INVALID_CLASSIFICATION', `Classification reason is required: ${item.issueId}`);
    invariant(typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1, 'INVALID_CLASSIFICATION', `Classification confidence must be 0-1: ${item.issueId}`);
    invariant(!issueIds.has(item.issueId), 'INVALID_CLASSIFICATION', `Duplicate issue id: ${item.issueId}`);
    if (item.owner === 'CONVERTER') invariant(item.repairAllowed !== true, 'CONVERTER_REPAIR_FORBIDDEN', 'Converter issues cannot be repaired by this workflow');
    issueIds.add(item.issueId);
    expected.delete(item.issueId);
  }
  invariant(expected.size === 0, 'INVALID_CLASSIFICATION', 'Every validation issue must be classified', { missingIssueIds: [...expected] });
  return classification;
}

export function readIssueClassificationCompatible(classification, validationReport) {
  if (classification?.schemaVersion === 1) {
    validateIssueClassificationV1(classification, validationReport);
    return {
      sourceSchemaVersion: 1,
      readOnly: true,
      migrationRequired: true,
      classification: structuredClone(classification),
    };
  }
  if (classification?.schemaVersion === 2) {
    validateIssueClassificationV2(classification, validationReport);
    return {
      sourceSchemaVersion: 2,
      readOnly: false,
      migrationRequired: false,
      classification: structuredClone(classification),
    };
  }
  invariant(false, 'CLASSIFICATION_SCHEMA_VERSION_UNSUPPORTED', 'Unsupported issue classification schema version', {
    actual: classification?.schemaVersion ?? null,
  });
}

export function migrateIssueClassificationV1ToV2(classification, {
  jobId,
  reviewId = null,
  classifiedAt = new Date().toISOString(),
  validationReport,
} = {}) {
  validateIssueClassificationV1(classification, validationReport);
  invariant(/^mig_[A-Za-z0-9_]+$/.test(jobId), 'INVALID_CLASSIFICATION', 'jobId is required to migrate a v1 classification');
  const migrated = {
    schemaVersion: 2,
    kind: 'issue-classification',
    jobId,
    reviewId,
    classifiedAt,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
    issues: classification.issues.map((issue) => {
      const legacyMapping = issue.owner === 'SOURCE' && issue.repairAllowed !== true
        ? LEGACY_OWNER_MAP.UNKNOWN
        : LEGACY_OWNER_MAP[issue.owner];
      const [cause, responsibleParty, repairTarget] = legacyMapping;
      return {
        issueId: issue.issueId,
        clusterId: `legacy:${issue.issueId}`,
        cause,
        responsibleParty,
        repairTarget,
        confidence: issue.confidence,
        reason: issue.reason,
        evidenceRefs: [`validation:${issue.issueId}`],
        knowledgeRuleIds: [],
        autoRepairAllowed: issue.owner === 'SOURCE' && issue.repairAllowed === true,
      };
    }),
  };
  return validateIssueClassificationV2(migrated, validationReport);
}

export function validateIssueClassificationCompatible(classification, validationReport) {
  return readIssueClassificationCompatible(classification, validationReport).classification;
}

export function issueCause(classification, issue) {
  if (classification?.schemaVersion === 2) return issue.cause;
  if (issue.owner === 'SOURCE') return issue.repairAllowed === true ? 'SOURCE_DATA' : 'UNKNOWN';
  if (issue.owner === 'PLATFORM') return 'PLATFORM_RUNTIME';
  return issue.owner;
}

export function issueAutoRepairAllowed(classification, issue) {
  if (classification?.schemaVersion === 2) return issue.autoRepairAllowed === true;
  return issue.owner === 'SOURCE' && issue.repairAllowed === true;
}

export function diagnosticOwnerBucket(classification, issue) {
  const cause = issueCause(classification, issue);
  if (cause === 'CONVERTER') return 'CONVERTER';
  if (cause === 'SOURCE_DATA' || cause === 'TARGET_CASE') return 'SOURCE';
  if (cause === 'TEST_HARNESS') return 'TEST_HARNESS';
  if (cause === 'ENVIRONMENT_CONFIGURATION') return 'ENVIRONMENT';
  if (cause === 'PLATFORM_RUNTIME') return 'PLATFORM';
  if (cause === 'KNOWLEDGE_GAP') return 'KNOWLEDGE';
  if (cause === 'AUTHORIZATION') return 'AUTHORIZATION';
  if (cause === 'UNKNOWN') return 'UNKNOWN';
  return null;
}
