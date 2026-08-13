import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';
import { PlaywrightRuntimeDriver } from '../src/runtime/playwright-driver.js';
import { RuntimeReviewRunner } from '../src/runtime/review-runner.js';
import { redactRuntimeText, redactedUrl } from '../src/runtime/trace-redaction.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function runtimePins() {
  return {
    workflow: { version: '0.4.0', sha256: HASH_A },
    converter: { version: '1.2.1', sha256: HASH_B },
    knowledge: { version: '0.1.0', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
  };
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
}

function scenario(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'runtime-scenario',
    scenarioId: 'scenario-parity',
    version: 1,
    name: 'Normalized identity parity',
    source: { type: 'DETERMINISTIC', reference: 'fixture:identity' },
    sideEffect: 'READ_ONLY',
    executionPolicy: { mode: 'UNATTENDED', authorizationRequired: false, cleanupRequired: false },
    networkPolicy: { unsafeRequests: 'BLOCK' },
    artifactPolicy: { screenshots: 'FAILURES_ONLY', nativePlaywrightTrace: false },
    preconditions: [],
    actions: [{ stepId: 'open', type: 'OPEN_PAGE', input: '/preview', timeoutMs: 30000 }],
    assertions: [{
      assertionId: 'visible-result',
      observation: { name: 'result', category: 'UI', capture: 'TEXT', target: { strategy: 'TEST_ID', value: 'result' } },
      comparator: 'V4_V5_EQUAL',
    }, {
      assertionId: 'no-error',
      observation: { name: 'runtime-errors', category: 'CONSOLE', capture: 'COUNT' },
      comparator: 'NO_ERROR',
    }],
    cleanup: [],
    knowledgeRuleIds: [],
    createdAt: '2026-08-13T06:00:00.000Z',
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
    ...overrides,
  };
}

function environmentComparison(reviewId, status = 'ENVIRONMENT_EQUIVALENT') {
  return {
    schemaVersion: 2,
    kind: 'environment-comparison',
    comparisonId: `env-${status.toLowerCase()}`,
    reviewId,
    sourceManifestId: 'env-source',
    targetManifestId: 'env-target',
    sourceRevision: { nid: 100, workId: 'source-work-1' },
    targetRevision: { nid: 200, workId: 'target-work-1' },
    status,
    fields: status === 'BLOCKED_ENVIRONMENT' ? [{
      path: '/unknown', policy: null, sourcePresence: 'PRESENT', targetPresence: 'PRESENT', equivalent: null, disposition: 'BLOCKED', bindingAssertionId: null,
    }] : [],
    normalizedPaths: [],
    requiredBindingPaths: [],
    blockedPaths: status === 'BLOCKED_ENVIRONMENT' ? ['/unknown'] : [],
    evaluatedAt: '2026-08-13T06:00:00.000Z',
    createdAt: '2026-08-13T06:00:00.000Z',
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

function fakePlaywright({ mismatch = false, unsafeOnGoto = false } = {}) {
  const state = { contextCount: 0, contexts: [] };
  const chromium = {
    executablePath: () => '/fake/chromium',
    async launch() {
      return {
        version: () => '140.0.0-test',
        async newContext() {
          const index = state.contextCount++;
          const listeners = new Map();
          const context = {
            index,
            closed: false,
            routeHandler: null,
            async route(_pattern, handler) { this.routeHandler = handler; },
            async newPage() {
              let currentUrl = 'about:blank';
              const value = index % 2 === 0
                ? 'Case 100 source-work-1 at 2026-08-13T06:00:00.000Z'
                : mismatch
                  ? 'Different business result'
                  : 'Case 200 target-work-1 at 2026-08-13T06:05:00.000Z';
              const locator = {
                click: async () => {}, fill: async () => {}, selectOption: async () => {}, check: async () => {}, uncheck: async () => {}, press: async () => {}, waitFor: async () => {},
                textContent: async () => value,
                inputValue: async () => value,
                isVisible: async () => true,
                count: async () => 1,
              };
              return {
                on(name, callback) { listeners.set(name, callback); },
                async goto(url) {
                  currentUrl = url;
                  if (unsafeOnGoto && context.routeHandler) {
                    await context.routeHandler({
                      request: () => ({ method: () => 'POST', url: () => `${url}/write?token=private-value` }),
                      abort: async () => {},
                      continue: async () => {},
                    });
                  }
                },
                async reload() {}, async goBack() {},
                getByRole: () => locator, getByLabel: () => locator, getByPlaceholder: () => locator, getByText: () => locator, getByTestId: () => locator,
                locator: () => locator,
                url: () => currentUrl,
                screenshot: async ({ path: output }) => fs.writeFileSync(output, 'fake-png'),
              };
            },
            async close() { this.closed = true; },
          };
          state.contexts.push(context);
          return context;
        },
        async close() { state.browserClosed = true; },
      };
    },
  };
  return { module: { chromium }, state };
}

function withReview(prefix, callback) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const jobs = new JobStore(paths);
  const job = createCompletedJob(jobs);
  const reviews = new RuntimeReviewStore(paths, { jobs });
  const review = reviews.create({ jobId: job.jobId, capability: 'READ_ONLY', runtime: runtimePins(), targetSnapshot: { value: 'baseline' } });
  return Promise.resolve(callback({ temporary, paths, jobs, job, reviews, review })).finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
}

test('report-only runner uses isolated contexts and normalizes only allowed identities and timestamps', async () => {
  await withReview('ivx-runtime-parity-', async ({ paths, reviews, review }) => {
    const fixture = fakePlaywright();
    const driver = new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true });
    const runner = new RuntimeReviewRunner({ reviews, driver });
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const result = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://127.0.0.1:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://127.0.0.1:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    });
    assert.equal(result.review.status, 'RUNTIME_PARITY_PASSED');
    assert.equal(result.report.status, 'PARITY_PASSED');
    assert.equal(result.report.targetRepairAttempted, false);
    assert.equal(result.report.platformWriteAttempted, false);
    assert.equal(fixture.state.contextCount, 2);
    assert.equal(fixture.state.contexts.every((context) => context.closed), true);
    assert.equal(fixture.state.browserClosed, true);
    assert.deepEqual(result.comparisons[0].assertions[0].normalizations, ['CASE_IDENTITY', 'TIMESTAMP', 'WORK_IDENTITY']);
    const serialized = fs.readFileSync(path.join(reviews.runtimeCycleDir(review.reviewId, result.cycle.cycleId), 'traces', 'scenario-parity.v4.json'), 'utf8');
    assert.equal(serialized.includes('source-work-1 at'), false);
  });
});

test('business mismatches are reported without target writes and blocked environments never launch a driver', async () => {
  await withReview('ivx-runtime-mismatch-', async ({ paths, reviews, review }) => {
    const fixture = fakePlaywright({ mismatch: true });
    const runner = new RuntimeReviewRunner({ reviews, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const result = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    });
    assert.equal(result.review.status, 'MISMATCH_DETECTED');
    assert.equal(result.report.status, 'MISMATCH_DETECTED');
    assert.equal(result.comparisons[0].assertions[0].reasonCode, 'NORMALIZED_VALUES_DIFFER');
  });

  await withReview('ivx-runtime-env-block-', async ({ paths, reviews, review }) => {
    const fixture = fakePlaywright();
    const runner = new RuntimeReviewRunner({ reviews, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const result = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId, 'BLOCKED_ENVIRONMENT'),
    });
    assert.equal(result.blocked, true);
    assert.equal(result.review.status, 'BLOCKED_ENVIRONMENT');
    assert.equal(fixture.state.contextCount, 0);
    const resumed = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    });
    assert.equal(resumed.review.status, 'RUNTIME_PARITY_PASSED');
    assert.equal(fixture.state.contextCount, 2);
  });

  await withReview('ivx-runtime-env-stale-', async ({ paths, reviews, review }) => {
    const fixture = fakePlaywright();
    const runner = new RuntimeReviewRunner({ reviews, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const stale = environmentComparison(review.reviewId);
    stale.targetRevision.workId = 'older-target-work';
    await assert.rejects(runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: stale,
    }), { code: 'RUNTIME_ENVIRONMENT_REVISION_MISMATCH' });
    assert.equal(fixture.state.contextCount, 0);
    assert.equal(reviews.load(review.reviewId).status, 'REVIEW_OPEN');
  });
});

test('READ_ONLY network policy blocks unsafe requests and trace redaction removes credential values', async () => {
  await withReview('ivx-runtime-network-', async ({ paths, reviews, review }) => {
    const fixture = fakePlaywright({ unsafeOnGoto: true });
    const runner = new RuntimeReviewRunner({ reviews, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const result = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    });
    assert.equal(result.report.status, 'INCONCLUSIVE');
    const trace = JSON.parse(fs.readFileSync(path.join(reviews.runtimeCycleDir(review.reviewId, result.cycle.cycleId), 'traces', 'scenario-parity.v4.json')));
    assert.equal(trace.status, 'FAILED');
    assert.equal(trace.errors.some((error) => error.code === 'UNSAFE_NETWORK_REQUEST_BLOCKED'), true);
    assert.equal(JSON.stringify(trace).includes('private-value'), false);
  });
  assert.equal(redactRuntimeText('Authorization=Bearer abcdefghijklmnopqrstuvwxyz.1234567890.signature').includes('signature'), false);
  assert.equal(redactedUrl('https://user:pass@example.test/path?token=private#secret').includes('private'), false);
});

test('driver interruption is recoverable and persists only a redacted failure summary', async () => {
  await withReview('ivx-runtime-interrupt-', async ({ reviews, review }) => {
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const privateValue = 'Authorization=Bearer private-runtime-token-value';
    const runner = new RuntimeReviewRunner({
      reviews,
      driver: { runPair: async () => { const error = new Error(privateValue); error.code = 'BROWSER_LAUNCH_FAILED'; throw error; } },
    });
    await assert.rejects(runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    }), { code: 'BROWSER_LAUNCH_FAILED' });
    const recovered = reviews.recover(review.reviewId);
    assert.equal(recovered.review.status, 'RUNTIME_NOT_TESTED');
    assert.equal(recovered.review.activeCycleId, null);
    assert.equal(recovered.activeCycle, null);
    const cycles = fs.readdirSync(path.join(reviews.reviewDir(review.reviewId), 'cycles'));
    const interruption = fs.readFileSync(path.join(reviews.reviewDir(review.reviewId), 'cycles', cycles[0], 'interruption.json'), 'utf8');
    assert.equal(interruption.includes('private-runtime-token-value'), false);
    assert.match(interruption, /redacted/);
  });
});

test('a fresh runner resumes a crashed READ_ONLY cycle but never replays a side-effect cycle', async () => {
  await withReview('ivx-runtime-resume-', async ({ paths, reviews, review }) => {
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const prepared = reviews.prepareRuntimeCycle(review.reviewId, {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1' },
      environmentComparison: environmentComparison(review.reviewId),
    });
    assert.equal(prepared.review.activeCycleId, prepared.cycle.cycleId);
    const recovered = new RuntimeReviewStore(paths, { jobs: reviews.jobs });
    const fixture = fakePlaywright();
    const runner = new RuntimeReviewRunner({ reviews: recovered, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    const result = await runner.resumeCycle(review.reviewId, { sourceBaseUrl: 'http://localhost:3100', targetBaseUrl: 'http://localhost:3200' });
    assert.equal(result.review.status, 'RUNTIME_PARITY_PASSED');
    assert.equal(result.cycle.cycleId, prepared.cycle.cycleId);
  });

  await withReview('ivx-runtime-resume-side-effect-', async ({ reviews, review }) => {
    const reversible = scenario({
      scenarioId: 'scenario-reversible-crash',
      sideEffect: 'REVERSIBLE',
      executionPolicy: { mode: 'UNATTENDED', authorizationRequired: true, cleanupRequired: true },
      networkPolicy: { unsafeRequests: 'ALLOW_WITH_AUTHORIZATION' },
      cleanup: [{ stepId: 'cleanup', type: 'GO_BACK' }],
    });
    reviews.addRuntimeScenario(review.reviewId, reversible);
    const authorization = {
      schemaVersion: 1,
      kind: 'runtime-execution-authorization',
      authorizationId: 'auth-crashed-side-effect',
      reviewId: review.reviewId,
      scenarioIds: ['scenario-reversible-crash'],
      confirmation: 'RUN_REVERSIBLE_SCENARIO',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    };
    reviews.prepareRuntimeCycle(review.reviewId, {
      scenarioIds: ['scenario-reversible-crash'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1' },
      environmentComparison: environmentComparison(review.reviewId),
      authorization,
    });
    assert.throws(() => reviews.resumeRuntimeCycle(review.reviewId, { sourceBaseUrl: 'http://localhost:3100', targetBaseUrl: 'http://localhost:3200' }), { code: 'RUNTIME_SIDE_EFFECT_RECONCILIATION_REQUIRED' });
  });
});

test('runtime operation lease prevents concurrent execution of the same review cycle', async () => {
  await withReview('ivx-runtime-lease-', async ({ paths, reviews, review }) => {
    reviews.addRuntimeScenario(review.reviewId, scenario());
    const fixture = fakePlaywright();
    const realDriver = new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true });
    let release;
    let enteredResolve;
    const entered = new Promise((resolve) => { enteredResolve = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const driver = {
      async runPair(input) {
        enteredResolve();
        await gate;
        return realDriver.runPair(input);
      },
    };
    const runner = new RuntimeReviewRunner({ reviews, driver });
    const input = {
      scenarioIds: ['scenario-parity'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    };
    const first = runner.runCycle(review.reviewId, input);
    await entered;
    await assert.rejects(runner.runCycle(review.reviewId, input), { code: 'RUNTIME_CYCLE_LOCKED' });
    release();
    assert.equal((await first).review.status, 'RUNTIME_PARITY_PASSED');
  });
});

test('side-effect scenarios require single-use USER authorization and external effects require visible takeover', async () => {
  await withReview('ivx-runtime-auth-', async ({ paths, reviews, review }) => {
    const reversible = scenario({
      scenarioId: 'scenario-reversible',
      sideEffect: 'REVERSIBLE',
      executionPolicy: { mode: 'UNATTENDED', authorizationRequired: true, cleanupRequired: true },
      networkPolicy: { unsafeRequests: 'ALLOW_WITH_AUTHORIZATION' },
      cleanup: [{ stepId: 'cleanup-back', type: 'GO_BACK' }],
    });
    reviews.addRuntimeScenario(review.reviewId, reversible);
    const input = {
      scenarioIds: ['scenario-reversible'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
    };
    const fixture = fakePlaywright();
    const runner = new RuntimeReviewRunner({ reviews, driver: new PlaywrightRuntimeDriver({ playwright: fixture.module, appPaths: paths, allowInsecureLocalhost: true }) });
    await assert.rejects(runner.runCycle(review.reviewId, input), { code: 'RUNTIME_AUTHORIZATION_REQUIRED' });
    const authorization = {
      schemaVersion: 1,
      kind: 'runtime-execution-authorization',
      authorizationId: 'auth-one',
      reviewId: review.reviewId,
      scenarioIds: ['scenario-reversible'],
      confirmation: 'RUN_REVERSIBLE_SCENARIO',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    };
    const result = await runner.runCycle(review.reviewId, { ...input, authorization });
    assert.equal(result.report.status, 'PARITY_PASSED');
    assert.equal(fs.existsSync(path.join(reviews.reviewDir(review.reviewId), 'runtime-authorizations', 'auth-one.json')), true);
  });

  await withReview('ivx-runtime-external-', async ({ paths, reviews, review }) => {
    const external = scenario({
      scenarioId: 'scenario-external',
      sideEffect: 'EXTERNAL_SIDE_EFFECT',
      executionPolicy: { mode: 'USER_VISIBLE', authorizationRequired: true, cleanupRequired: false },
      networkPolicy: { unsafeRequests: 'ALLOW_WITH_AUTHORIZATION' },
    });
    reviews.addRuntimeScenario(review.reviewId, external);
    const fixture = fakePlaywright();
    let takeovers = 0;
    const runner = new RuntimeReviewRunner({
      reviews,
      driver: new PlaywrightRuntimeDriver({
        playwright: fixture.module,
        appPaths: paths,
        allowInsecureLocalhost: true,
        onTakeover: async () => { takeovers += 1; },
      }),
    });
    const authorization = {
      schemaVersion: 1,
      kind: 'runtime-execution-authorization',
      authorizationId: 'auth-external',
      reviewId: review.reviewId,
      scenarioIds: ['scenario-external'],
      confirmation: 'RUN_EXTERNAL_SIDE_EFFECT_SCENARIO',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    };
    const result = await runner.runCycle(review.reviewId, {
      scenarioIds: ['scenario-external'],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'http://localhost:3100' },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'http://localhost:3200' },
      environmentComparison: environmentComparison(review.reviewId),
      authorization,
    });
    assert.equal(result.report.status, 'PARITY_PASSED');
    assert.equal(takeovers, 2);
    assert.equal(result.comparisons[0].runtime.humanTakeover, true);
  });
});
