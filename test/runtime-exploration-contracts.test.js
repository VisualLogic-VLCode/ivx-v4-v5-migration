import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateRuntimeExplorationAuthorization,
  validateRuntimeExplorationPlan,
  validateRuntimeExplorationReport,
  validateSchemaV2Artifact,
} from '../src/contracts/schema-v2.js';

const NOW = '2026-08-17T02:00:00.000Z';
const HASH = 'a'.repeat(64);

function limits(overrides = {}) {
  return { maxStates: 5, maxActions: 10, maxDepth: 3, maxDurationMs: 60_000, maxScreenshots: 10, ...overrides };
}

function authorization(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'runtime-exploration-authorization',
    authorizationId: 'exploration-auth-1',
    reviewId: 'rev_20260817020000_abcde',
    jobId: 'mig_20260817015900_abcde',
    jobManifestSha256: HASH,
    source: { nid: 100, workId: 'source-work-1' },
    target: { nid: 200, workId: 'target-work-1' },
    origins: { source: 'https://source.example.test', target: 'https://target.example.test' },
    scope: { jobArtifacts: 'COMPLETE_READ_ONLY', authenticatedSession: 'DRIVER_USE_ONLY', execution: 'AUTONOMOUS_READ_ONLY' },
    environment: { comparisonId: 'env-1', status: 'ENVIRONMENT_EQUIVALENT' },
    environmentMode: 'EQUIVALENT_ONLY',
    profile: 'QUICK',
    limits: limits(),
    confirmation: 'RUN_AUTONOMOUS_READ_ONLY_EXPLORATION',
    expiresAt: '2026-08-17T04:00:00.000Z',
    createdAt: NOW,
    createdBy: 'USER',
    sensitivity: 'PRIVATE',
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'runtime-exploration-plan',
    explorationId: 'exploration-1',
    reviewId: 'rev_20260817020000_abcde',
    jobId: 'mig_20260817015900_abcde',
    profile: 'QUICK',
    startPath: '$SUBJECT_URL',
    strategy: 'SAFE_BFS',
    limits: limits(),
    coverageGoal: { minStates: 2, minExecutedControls: 1, requireVisual: true },
    seedPaths: [{
      pathId: 'seed-tabs',
      name: 'Open the first business tab',
      actions: [{ actionId: 'click-tab', type: 'CLICK', target: { strategy: 'ROLE', role: 'tab', value: 'Overview', exact: true } }],
    }, {
      pathId: 'seed-filter',
      name: 'Fill a non-secret search filter',
      actions: [{ actionId: 'fill-filter', type: 'FILL', target: { strategy: 'CSS', value: '[data-filter]' }, input: 'migration-probe' }],
    }],
    knowledgeRuleIds: [],
    createdAt: NOW,
    createdBy: 'AGENT',
    sensitivity: 'REDACTED',
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'runtime-exploration-report',
    explorationId: 'exploration-1',
    reviewId: 'rev_20260817020000_abcde',
    jobId: 'mig_20260817015900_abcde',
    authorizationId: 'exploration-auth-1',
    planSha256: HASH,
    jobManifestSha256: HASH,
    status: 'EXPLORATION_PARITY_PASSED',
    environment: { comparisonId: 'env-1', status: 'ENVIRONMENT_EQUIVALENT', mode: 'EQUIVALENT_ONLY' },
    coverage: {
      states: 2, paths: 2, discoveredControls: 3, eligibleControls: 2, executedControls: 2,
      skippedControls: 1, blockedActions: 0, visualCheckpoints: 4, mismatches: 0,
      goalSatisfied: true, queueExhausted: true, budgetExhausted: false,
    },
    pathResults: [{
      pathId: 'path-root', depth: 0, status: 'MATCHED', sourceFingerprint: HASH,
      targetFingerprint: HASH, visualStatus: 'MATCHED', evidenceRef: 'explorations/exploration-1/paths/path-root/result.json',
    }],
    stopReason: null,
    claims: {
      parityClaimed: true, strictParityClaimed: true, converterAttributionAllowed: true,
      automaticRepairAllowed: false, targetRepairAttempted: false, platformWriteAttempted: false,
    },
    startedAt: NOW,
    completedAt: '2026-08-17T02:01:00.000Z',
    createdAt: '2026-08-17T02:01:00.000Z',
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
    ...overrides,
  };
}

test('autonomous exploration contracts validate exact private authorization and redacted Agent plan/report', () => {
  assert.equal(validateRuntimeExplorationAuthorization(authorization()).kind, 'runtime-exploration-authorization');
  assert.equal(validateRuntimeExplorationPlan(plan()).kind, 'runtime-exploration-plan');
  assert.equal(validateRuntimeExplorationReport(report()).kind, 'runtime-exploration-report');
  assert.equal(validateSchemaV2Artifact(plan()).kind, 'runtime-exploration-plan');
});

test('authorization cannot expose raw credentials or grant broader execution', () => {
  const raw = authorization();
  raw.scope.authenticatedSession = 'AGENT_READ';
  assert.throws(() => validateRuntimeExplorationAuthorization(raw), /DRIVER_USE_ONLY/);

  const secret = authorization();
  secret.platformToken = 'forbidden';
  assert.throws(() => validateRuntimeExplorationAuthorization(secret), /not allowed|forbidden secret-bearing field/);

  const long = authorization({ expiresAt: '2026-08-17T11:00:00.000Z' });
  assert.throws(() => validateRuntimeExplorationAuthorization(long), /within 8 hours/);

  const originPath = authorization({ origins: { source: 'https://source.example.test/preview', target: 'https://target.example.test' } });
  assert.throws(() => validateRuntimeExplorationAuthorization(originPath), /must be an HTTPS origin/);
});

test('Agent plans allow bounded CSS/XPath hints but reject secret fields and unsafe navigation', () => {
  const xpath = plan();
  xpath.seedPaths[0].actions[0] = { actionId: 'focus-disclosure', type: 'FOCUS', target: { strategy: 'XPATH', value: '//button[@aria-expanded="false"]' } };
  assert.equal(validateRuntimeExplorationPlan(xpath), xpath);

  const secret = plan();
  secret.seedPaths[1].actions[0].target = { strategy: 'LABEL', value: 'Password' };
  assert.throws(() => validateRuntimeExplorationPlan(secret), /authentication or secret field/);

  const external = plan({ startPath: 'https://evil.example/' });
  assert.throws(() => validateRuntimeExplorationPlan(external), /same-origin absolute path/);

  const riskyRoute = plan();
  riskyRoute.seedPaths[0].actions[0] = { actionId: 'delete-route', type: 'OPEN_PAGE', input: '/records/delete/1' };
  assert.throws(() => validateRuntimeExplorationPlan(riskyRoute), /not a proven read-only route/);

  const arbitraryClick = plan();
  arbitraryClick.seedPaths[0].actions[0].target = { strategy: 'CSS', value: 'button.delete' };
  assert.throws(() => validateRuntimeExplorationPlan(arbitraryClick), /limited to semantic tabs/);
});

test('diagnostic environment reports cannot claim parity, attribution, repair, or platform writes', () => {
  const diagnostic = report({
    status: 'PARTIAL_PARITY_PASSED',
    environment: { comparisonId: 'env-risk', status: 'BLOCKED_ENVIRONMENT', mode: 'ALLOW_DIAGNOSTIC' },
    claims: {
      parityClaimed: false, strictParityClaimed: false, converterAttributionAllowed: false,
      automaticRepairAllowed: false, targetRepairAttempted: false, platformWriteAttempted: false,
    },
  });
  assert.equal(validateRuntimeExplorationReport(diagnostic), diagnostic);
  diagnostic.claims.converterAttributionAllowed = true;
  assert.throws(() => validateRuntimeExplorationReport(diagnostic), /Diagnostic environment exploration/);

  const write = report();
  write.claims.platformWriteAttempted = true;
  assert.throws(() => validateRuntimeExplorationReport(write), /cannot record repair or platform writes/);
});
