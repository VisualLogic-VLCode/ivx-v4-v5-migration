import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  migrateIssueClassificationV1ToV2,
  readIssueClassificationCompatible,
  readJobStateCompatible,
  validateJobStateV2,
} from '../src/contracts/compatibility.js';
import {
  validateAutomaticRepairDecision,
  validateBehaviorTrace,
  validateDiagnosticSaveEligibility,
  validateEnvironmentComparison,
  validateEnvironmentManifest,
  validateHumanFinding,
  validateIssueClassificationV2,
  validateRepairBudget,
  validateRuntimeReviewSession,
  validateRuntimeComparison,
  validateRuntimeScenario,
  validateSchemaV2Artifact,
} from '../src/contracts/schema-v2.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';

const NOW = '2026-08-13T04:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const projectRoot = path.resolve(import.meta.dirname, '..');

function artifact(kind, extra, { createdBy = 'CLI', sensitivity = 'REDACTED' } = {}) {
  return {
    schemaVersion: 2,
    kind,
    ...extra,
    createdAt: NOW,
    createdBy,
    sensitivity,
  };
}

function issueClassification() {
  return {
    schemaVersion: 2,
    kind: 'issue-classification',
    jobId: 'mig_20260813040000_abcde',
    reviewId: 'rev_20260813040000_abcde',
    classifiedAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
    issues: [{
      issueId: 'VAL-1',
      clusterId: 'cluster-1',
      cause: 'TARGET_CASE',
      responsibleParty: 'WORKFLOW_AI',
      repairTarget: 'V5_ARTIFACT',
      confidence: 0.91,
      reason: 'The target contains one locally repairable value.',
      evidenceRefs: ['validation:VAL-1'],
      knowledgeRuleIds: ['CVT-001'],
      autoRepairAllowed: true,
    }],
  };
}

function runtimeScenario() {
  return artifact('runtime-scenario', {
    scenarioId: 'scenario-order-submit',
    version: 1,
    name: 'Order submit result',
    source: { type: 'USER', reference: 'finding-1' },
    sideEffect: 'READ_ONLY',
    executionPolicy: { mode: 'UNATTENDED', authorizationRequired: false, cleanupRequired: false },
    networkPolicy: { unsafeRequests: 'BLOCK' },
    artifactPolicy: { screenshots: 'FAILURES_ONLY', nativePlaywrightTrace: false },
    preconditions: ['Open the order page with fixture data.'],
    actions: [{ stepId: 'step-open', type: 'OPEN_PAGE', input: '/order', timeoutMs: 30000 }],
    assertions: [{
      assertionId: 'assert-result',
      observation: { name: 'resultText', category: 'UI', capture: 'TEXT', target: { strategy: 'TEST_ID', value: 'result-text' } },
      comparator: 'V4_V5_EQUAL',
    }],
    cleanup: [],
    knowledgeRuleIds: ['CVT-001'],
  });
}

function behaviorTrace() {
  return artifact('behavior-trace', {
    traceId: 'trace-1',
    reviewId: 'rev_20260813040000_abcde',
    scenarioId: 'scenario-order-submit',
    cycleId: 'cycle-1',
    subject: { generation: 'V5', nid: 123456, workId: 'target-work-1' },
    runtime: { driver: 'playwright', driverVersion: '1.0.0', browserVersion: '100.0', mode: 'UNATTENDED' },
    startedAt: NOW,
    endedAt: '2026-08-13T04:00:10.000Z',
    status: 'COMPLETED',
    observations: [{
      observationId: 'obs-1',
      category: 'UI',
      name: 'resultText',
      sequence: 0,
      valueType: 'string',
      valueDigest: HASH_A,
      summary: 'Non-sensitive visible text digest captured.',
    }],
    errors: [],
    artifacts: [{ artifactId: 'shot-1', type: 'SCREENSHOT', path: 'screenshots/result.png', sha256: HASH_B }],
    redaction: { applied: true, policyVersion: '1', omittedCategories: ['headers'] },
  });
}

function runtimeComparison() {
  return artifact('runtime-comparison', {
    comparisonId: 'comparison-1',
    reviewId: 'rev_20260813040000_abcde',
    cycleId: 'cycle-1',
    scenarioId: 'scenario-order-submit',
    sourceTraceId: 'trace-v4-1',
    targetTraceId: 'trace-v5-1',
    environment: { comparisonId: 'environment-comparison-1', status: 'ENVIRONMENT_EQUIVALENT' },
    status: 'PARITY_PASSED',
    assertions: [{
      assertionId: 'assert-result',
      status: 'PASSED',
      reasonCode: 'NORMALIZED_VALUES_EQUAL',
      sourceObservationIds: ['obs-v4-1'],
      targetObservationIds: ['obs-v5-1'],
      normalizations: ['CASE_IDENTITY'],
    }],
    coverage: { total: 1, passed: 1, failed: 0, inconclusive: 0 },
    runtime: {
      driver: 'playwright',
      driverVersion: '1.62.1',
      sourceBrowserVersion: '140.0',
      targetBrowserVersion: '140.0',
      modes: ['UNATTENDED'],
      humanTakeover: false,
    },
    evaluatedAt: NOW,
  });
}

function environmentManifest() {
  return artifact('environment-manifest', {
    manifestId: 'env-1',
    reviewId: 'rev_20260813040000_abcde',
    subject: 'TARGET_V5',
    revision: { nid: 123456, workId: 'target-work-1' },
    fields: [{
      path: '/customVars/apiBase',
      policy: 'REDACT_AND_COMPARE',
      presence: 'PRESENT',
      valueType: 'string',
      comparisonDigest: HASH_A,
      equivalent: true,
    }],
    redaction: { applied: true, policyVersion: '1' },
  });
}

function environmentComparison() {
  return artifact('environment-comparison', {
    comparisonId: 'environment-comparison-1',
    reviewId: 'rev_20260813040000_abcde',
    sourceManifestId: 'env-source-1',
    targetManifestId: 'env-target-1',
    sourceRevision: { nid: 100, workId: 'source-work-1' },
    targetRevision: { nid: 123456, workId: 'target-work-1' },
    status: 'NORMALIZED_EQUIVALENT',
    fields: [{
      path: '/workInfo/nid',
      policy: 'REMAP_FOR_TARGET',
      sourcePresence: 'PRESENT',
      targetPresence: 'PRESENT',
      equivalent: true,
      disposition: 'NORMALIZED',
      bindingAssertionId: null,
    }],
    normalizedPaths: ['/workInfo/nid'],
    requiredBindingPaths: [],
    blockedPaths: [],
    evaluatedAt: NOW,
  });
}

function humanFinding() {
  return artifact('human-finding', {
    findingId: 'finding-1',
    reviewId: 'rev_20260813040000_abcde',
    issueId: 'VAL-1',
    clusterId: 'cluster-1',
    symptom: 'The result text differs after submit.',
    reproductionSteps: ['Open order page', 'Submit fixture order'],
    v4Observation: 'Shows success.',
    v5Observation: 'Shows an empty value.',
    locations: ['/stage/children/0', 'bid:cjk76jaa3j50000sdws0'],
    suggestedCause: 'TARGET_CASE',
    confidenceNote: 'The user reproduced the issue twice.',
    targetManuallyEdited: false,
    targetRevision: null,
    requests: ['RERUN', 'RECLASSIFY'],
  }, { createdBy: 'USER', sensitivity: 'PRIVATE' });
}

function clusterBudget() {
  return artifact('repair-budget', {
    budgetId: 'budget-cluster-1',
    reviewId: 'rev_20260813040000_abcde',
    scope: 'ISSUE_CLUSTER',
    clusterId: 'cluster-1',
    attempts: { automaticLimit: 3, automaticUsed: 1, extensionLimit: 2, extensionUsed: 0 },
    targetRevisions: null,
    status: 'ACTIVE',
    updatedAt: NOW,
  });
}

function automaticRepairDecision() {
  return artifact('automatic-repair-decision', {
    decisionId: 'decision-1',
    reviewId: 'rev_20260813040000_abcde',
    clusterId: 'cluster-1',
    cause: 'TARGET_CASE',
    repairTarget: 'V5_ARTIFACT',
    decision: 'AUTO_REPAIR_ALLOWED',
    reasonCode: 'POLICY_AND_BUDGET_ALLOW',
    reason: 'The target-only repair has a unique bounded patch.',
    budgetId: 'budget-cluster-1',
    budgetState: 'AVAILABLE',
    remainingAttempts: 2,
    evidenceRefs: ['validation:VAL-1'],
    knowledgeRuleIds: ['CVT-001'],
    decidedAt: NOW,
  });
}

function diagnosticSaveEligibility() {
  return artifact('diagnostic-save-eligibility', {
    eligibilityId: 'eligibility-1',
    jobId: 'mig_20260813040000_abcde',
    reviewId: 'rev_20260813040000_abcde',
    clusterId: 'cluster-1',
    status: 'DIAGNOSTIC_SAVE_ELIGIBLE',
    checkpoint: {
      kind: 'STATICALLY_SAFE_CANDIDATE',
      artifact: 'v5/app.v5.json',
      sha256: HASH_C,
      targetNid: null,
      targetWorkId: null,
    },
    prerequisites: {
      authentication: 'SATISFIED',
      serverPermission: 'SATISFIED',
      userAuthorization: 'SATISFIED',
      platformWritePath: 'SATISFIED',
      revisionSafety: 'SATISFIED',
      writeOutcomeKnown: 'SATISFIED',
    },
    blockers: [],
    evaluatedAt: NOW,
  });
}

function reviewSession() {
  return artifact('runtime-review-session', {
    reviewId: 'rev_20260813040000_abcde',
    jobId: 'mig_20260813040000_abcde',
    target: { nid: 123456, workId: 'target-work-1' },
    capability: 'WRITE',
    status: 'REVIEW_OPEN',
    runtime: {
      workflow: { version: '0.4.0', sha256: HASH_A },
      converter: { version: '1.2.1', sha256: HASH_B },
      knowledge: { version: '0.1.0', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
    },
    baseline: { sourceWorkId: 'source-work-1', targetWorkId: 'target-work-1' },
    activeCycleId: null,
    issueClusterIds: [],
    scenarioIds: ['scenario-order-submit'],
    humanFindingIds: [],
    repairBudgetIds: ['budget-session-1'],
    history: [{ status: 'REVIEW_OPEN', at: NOW, reason: 'review-created' }],
    updatedAt: NOW,
  });
}

test('all schema-v2 artifact contracts accept a complete valid document', () => {
  const classification = issueClassification();
  assert.equal(validateIssueClassificationV2(classification, { issues: [{ issueId: 'VAL-1' }] }), classification);
  assert.equal(validateRuntimeScenario(runtimeScenario()).kind, 'runtime-scenario');
  assert.equal(validateBehaviorTrace(behaviorTrace()).kind, 'behavior-trace');
  assert.equal(validateRuntimeComparison(runtimeComparison()).kind, 'runtime-comparison');
  assert.equal(validateEnvironmentManifest(environmentManifest()).kind, 'environment-manifest');
  assert.equal(validateEnvironmentComparison(environmentComparison()).kind, 'environment-comparison');
  assert.equal(validateHumanFinding(humanFinding()).kind, 'human-finding');
  assert.equal(validateRepairBudget(clusterBudget()).kind, 'repair-budget');
  assert.equal(validateAutomaticRepairDecision(automaticRepairDecision()).kind, 'automatic-repair-decision');
  assert.equal(validateDiagnosticSaveEligibility(diagnosticSaveEligibility()).kind, 'diagnostic-save-eligibility');
  assert.equal(validateRuntimeReviewSession(reviewSession()).kind, 'runtime-review-session');
  assert.equal(validateSchemaV2Artifact(runtimeScenario()).kind, 'runtime-scenario');
});

test('review capability and Human Finding provenance are closed contracts', () => {
  const review = reviewSession();
  review.capability = 'UNBOUNDED_WRITE';
  assert.throws(() => validateRuntimeReviewSession(review), /capability/);

  const finding = humanFinding();
  finding.createdBy = 'AGENT';
  assert.throws(() => validateHumanFinding(finding), /createdBy must be USER/);
  finding.createdBy = 'USER';
  finding.sensitivity = 'REDACTED';
  assert.throws(() => validateHumanFinding(finding), /sensitivity must be PRIVATE/);
});

test('schema-v2 classification separates cause, responsibility, target, and repair permission', () => {
  const invalid = issueClassification();
  invalid.issues[0].cause = 'CONVERTER';
  assert.throws(() => validateIssueClassificationV2(invalid), { code: 'SCHEMA_V2_INVALID' });

  const converter = issueClassification();
  Object.assign(converter.issues[0], {
    cause: 'CONVERTER',
    responsibleParty: 'CONVERTER_MAINTAINER',
    repairTarget: 'NONE',
    autoRepairAllowed: true,
  });
  assert.throws(() => validateIssueClassificationV2(converter), /autoRepairAllowed is forbidden/);
});

test('runtime scenario side-effect policy is cross-field validated', () => {
  const platformPreview = runtimeScenario();
  platformPreview.actions[0].input = '$SUBJECT_URL';
  assert.equal(validateRuntimeScenario(platformPreview), platformPreview);

  const unsafeRelativeRoute = runtimeScenario();
  unsafeRelativeRoute.actions[0].input = 'play/case';
  assert.throws(() => validateRuntimeScenario(unsafeRelativeRoute), /\$SUBJECT_URL or a same-origin absolute path/);

  const reversible = runtimeScenario();
  reversible.sideEffect = 'REVERSIBLE';
  assert.throws(() => validateRuntimeScenario(reversible), /cleanup plan/);

  const external = runtimeScenario();
  external.sideEffect = 'EXTERNAL_SIDE_EFFECT';
  assert.throws(() => validateRuntimeScenario(external), /USER_VISIBLE/);

  const executable = runtimeScenario();
  executable.actions[0] = { stepId: 'script', type: 'EVALUATE_JAVASCRIPT', input: 'document.cookie' };
  assert.throws(() => validateRuntimeScenario(executable), /type must be one of/);

  const secretFill = runtimeScenario();
  secretFill.actions.push({ stepId: 'fill-secret', type: 'FILL', target: { strategy: 'LABEL', value: 'Password' }, input: 'private-value' });
  assert.throws(() => validateRuntimeScenario(secretFill), /private browser authentication profile/);

  const nativeTrace = runtimeScenario();
  nativeTrace.artifactPolicy.nativePlaywrightTrace = true;
  assert.throws(() => validateRuntimeScenario(nativeTrace), /Native Playwright traces are forbidden/);
});

test('trace and environment contracts reject secret-bearing or unredacted structures', () => {
  const trace = behaviorTrace();
  trace.redaction.applied = false;
  assert.throws(() => validateBehaviorTrace(trace), /redaction.applied must be true/);

  const environment = environmentManifest();
  environment.fields[0].access_token = 'forbidden';
  assert.throws(() => validateEnvironmentManifest(environment), /forbidden secret-bearing field/);

  const comparison = environmentComparison();
  comparison.normalizedPaths = [];
  assert.throws(() => validateEnvironmentComparison(comparison), /exactly match NORMALIZED/);
});

test('repair and diagnostic-save decisions remain independent and enforce their own prerequisites', () => {
  const stopped = automaticRepairDecision();
  stopped.decision = 'AUTO_REPAIR_STOPPED';
  assert.throws(() => validateAutomaticRepairDecision(stopped), /frozen or exhausted/);
  stopped.budgetState = 'FROZEN';
  assert.equal(validateAutomaticRepairDecision(stopped), stopped);

  const exhausted = automaticRepairDecision();
  exhausted.decision = 'AUTO_REPAIR_STOPPED';
  exhausted.budgetState = 'EXHAUSTED';
  assert.throws(() => validateAutomaticRepairDecision(exhausted), /remainingAttempts at 0/);

  const eligibility = diagnosticSaveEligibility();
  eligibility.prerequisites.userAuthorization = 'MISSING';
  assert.throws(() => validateDiagnosticSaveEligibility(eligibility), /all prerequisites satisfied/);
  eligibility.status = 'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH';
  assert.equal(validateDiagnosticSaveEligibility(eligibility), eligibility);
});

test('repair budget distinguishes per-cluster attempts from review target revisions', () => {
  const cluster = clusterBudget();
  assert.equal(validateRepairBudget(cluster), cluster);
  cluster.attempts.automaticUsed = 4;
  assert.throws(() => validateRepairBudget(cluster), /usage cannot exceed/);

  const session = artifact('repair-budget', {
    budgetId: 'budget-session-1',
    reviewId: 'rev_20260813040000_abcde',
    scope: 'REVIEW_SESSION',
    clusterId: null,
    attempts: null,
    targetRevisions: { baseLimit: 10, used: 2, extensionLimit: 5, extensionUsed: 0 },
    status: 'ACTIVE',
    updatedAt: NOW,
  });
  assert.equal(validateRepairBudget(session), session);
});

test('schema-v1 classification is readable and explicit migration is conservative', () => {
  const validation = { issues: [{ issueId: 'VAL-1' }, { issueId: 'VAL-2' }] };
  const legacy = {
    schemaVersion: 1,
    issues: [
      { issueId: 'VAL-1', owner: 'SOURCE', confidence: 0.8, reason: 'safe source repair', repairAllowed: true },
      { issueId: 'VAL-2', owner: 'SOURCE', confidence: 0.5, reason: 'source-like but ambiguous', repairAllowed: false },
    ],
  };
  const read = readIssueClassificationCompatible(legacy, validation);
  assert.equal(read.readOnly, true);
  assert.equal(read.sourceSchemaVersion, 1);
  assert.deepEqual(read.classification, legacy);
  const migrated = migrateIssueClassificationV1ToV2(legacy, {
    jobId: 'mig_20260813040000_abcde',
    classifiedAt: NOW,
    validationReport: validation,
  });
  assert.equal(migrated.issues[0].cause, 'SOURCE_DATA');
  assert.equal(migrated.issues[0].autoRepairAllowed, true);
  assert.equal(migrated.issues[1].cause, 'UNKNOWN');
  assert.equal(migrated.issues[1].autoRepairAllowed, false);
});

test('JobStore reads schema-v1 state without mutation and writes an explicit v2 copy', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-schema-v2-job-'));
  try {
    const store = new JobStore(createAppPaths(temporary));
    const job = store.create({ sourceNid: 123, gid: 9 });
    const before = fs.readFileSync(store.statePath(job.jobId));
    const read = store.loadForRead(job.jobId);
    assert.equal(read.sourceSchemaVersion, 1);
    assert.equal(read.readOnly, true);
    assert.equal(read.migrationRequired, true);
    assert.deepEqual(readJobStateCompatible(job).state, job);

    const migration = store.createV2MigrationCopy(job.jobId, { migratedAt: NOW });
    const after = fs.readFileSync(store.statePath(job.jobId));
    assert.deepEqual(after, before);
    assert.equal(migration.state.schemaVersion, 2);
    assert.equal(migration.state.provenance.sourceSchemaVersion, 1);
    const invalidMigration = structuredClone(migration.state);
    invalidMigration.provenance.migrationMode = 'IN_PLACE';
    assert.throws(() => validateJobStateV2(invalidMigration), /migrationMode must be COPY/);
    const migrationPath = path.join(store.jobDir(job.jobId), migration.migratedArtifact);
    assert.equal(fs.statSync(migrationPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(migrationPath, 'utf8')).kind, 'migration-job');
    assert.throws(() => store.createV2MigrationCopy(job.jobId, { migratedAt: NOW }), { code: 'JOB_MIGRATION_COPY_EXISTS' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('unknown future schema versions fail closed', () => {
  assert.throws(() => readJobStateCompatible({ schemaVersion: 99 }), { code: 'JOB_SCHEMA_VERSION_UNSUPPORTED' });
  assert.throws(() => readIssueClassificationCompatible({ schemaVersion: 99 }), { code: 'CLASSIFICATION_SCHEMA_VERSION_UNSUPPORTED' });
  assert.throws(() => validateSchemaV2Artifact({ schemaVersion: 3, kind: 'runtime-scenario' }), { code: 'SCHEMA_VERSION_UNSUPPORTED' });
  assert.throws(() => validateSchemaV2Artifact({ schemaVersion: 2, kind: 'future-kind' }), { code: 'SCHEMA_KIND_UNSUPPORTED' });
});

test('all distributable schema-v2 documents are valid JSON with stable identifiers and resolvable local refs', () => {
  const schemaDir = path.join(projectRoot, 'schemas', 'v2');
  const expected = [
    'automatic-repair-decision.schema.json',
    'behavior-trace.schema.json',
    'common.schema.json',
    'diagnosis-report.schema.json',
    'diagnostic-save-eligibility.schema.json',
    'environment-comparison.schema.json',
    'environment-manifest.schema.json',
    'human-finding.schema.json',
    'issue-classification.schema.json',
    'issue-cluster.schema.json',
    'job-state.schema.json',
    'repair-attempt.schema.json',
    'repair-batch.schema.json',
    'repair-budget.schema.json',
    'repair-proposal.schema.json',
    'runtime-comparison.schema.json',
    'runtime-review-session.schema.json',
    'runtime-scenario.schema.json',
    'saveable-checkpoint.schema.json',
    'target-repair-authorization.schema.json',
  ];
  assert.deepEqual(fs.readdirSync(schemaDir).filter((file) => file.endsWith('.json')).sort(), expected);
  for (const file of expected) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, `https://schemas.ivx.local/migration/v2/${file}`);
    const serialized = JSON.stringify(schema);
    for (const match of serialized.matchAll(/"\$ref":"([^"#]+\.schema\.json)(?:#[^"]*)?"/g)) {
      assert.equal(fs.existsSync(path.join(schemaDir, match[1])), true, `${file} has unresolved local ref ${match[1]}`);
    }
  }
});
