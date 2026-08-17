import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { AutonomousExplorationRunner } from '../src/runtime/autonomous-exploration-runner.js';
import { classifyExplorationControl } from '../src/runtime/playwright-exploration-driver.js';

const NOW = '2026-08-17T02:00:00.000Z';
const HASH = 'a'.repeat(64);

function png(file) {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(255);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(image));
}

function loaded(root, { environmentMode = 'EQUIVALENT_ONLY' } = {}) {
  return {
    root,
    state: { status: 'READY', startedAt: null },
    checkpoint: null,
    authorization: {
      authorizationId: 'explore-auth-1',
      jobId: 'mig_20260817015900_abcde',
      source: { nid: 100, workId: 'source-work-1' },
      target: { nid: 200, workId: 'target-work-1' },
      origins: { source: 'https://source.example.test', target: 'https://target.example.test' },
      environmentMode,
    },
    plan: {
      explorationId: 'exploration-1',
      startPath: '$SUBJECT_URL',
      limits: { maxStates: 5, maxActions: 5, maxDepth: 2, maxDurationMs: 60_000, maxScreenshots: 10 },
      coverageGoal: { minStates: 2, minExecutedControls: 1, requireVisual: true },
      seedPaths: [],
    },
    manifest: { sha256: HASH },
    environment: { comparisonId: 'env-1', status: environmentMode === 'EQUIVALENT_ONLY' ? 'ENVIRONMENT_EQUIVALENT' : 'BLOCKED_ENVIRONMENT' },
  };
}

function fakeStore(root, options) {
  const current = loaded(root, options);
  return {
    paths: {},
    current,
    checkpoints: [],
    interrupted: null,
    completed: null,
    withLease(_reviewId, _explorationId, callback) { return callback(); },
    load() { return current; },
    markRunning() { current.state.status = 'RUNNING'; current.state.startedAt ||= NOW; },
    checkpoint(_reviewId, _explorationId, checkpoint) { current.checkpoint = structuredClone(checkpoint); this.checkpoints.push(current.checkpoint); },
    complete(_reviewId, _explorationId, report) { this.completed = report; current.state.status = 'COMPLETED'; return { state: current.state, report }; },
    interrupt(_reviewId, _explorationId, error) { this.interrupted = error; current.state.status = 'INTERRUPTED'; },
  };
}

function fakeDriver({ blocked = false } = {}) {
  return {
    calls: [],
    async runPairPath(input) {
      this.calls.push(input);
      const depth = input.sourceActions.length;
      const controls = depth === 0 ? [{
        controlId: 'tab-1',
        kind: 'TAB',
        role: 'tab',
        label: 'Overview',
        eligibility: 'ELIGIBLE',
        reason: 'TAB_SWITCH',
        action: { actionId: 'tab-action', type: 'CLICK', target: { strategy: 'ROLE', role: 'tab', value: 'Overview', exact: true } },
      }] : [];
      const subject = (generation, nid, workId) => {
        const screenshot = path.join(input.artifactRoot, 'screenshots', `${input.pathId}-${generation.toLowerCase()}.png`);
        png(screenshot);
        return {
          generation,
          status: blocked ? 'BLOCKED' : 'COMPLETED',
          subject: { generation, nid, workId },
          runtime: { driver: 'fake', driverVersion: '1', browserVersion: '1' },
          state: { fingerprint: depth ? 'b'.repeat(64) : HASH },
          controls,
          events: [],
          blocked: blocked ? [{ code: 'ISOLATED_STORAGE_MUTATION_OBSERVED' }] : [],
          errors: [],
          safety: { unsafeRequestAttempted: false, isolatedStorageChanged: false, credentials: 'DRIVER_USE_ONLY' },
          screenshot: { path: path.relative(input.artifactRoot, screenshot).split(path.sep).join('/'), sha256: HASH },
          startedAt: NOW,
          completedAt: NOW,
          sensitivity: 'REDACTED',
        };
      };
      return { source: subject('V4', 100, 'source-work-1'), target: subject('V5', 200, 'target-work-1') };
    },
  };
}

const subjects = {
  source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: 'https://source.example.test/' },
  target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: 'https://target.example.test/' },
};

test('SAFE_BFS executes a matched control, checkpoints every state, and reports bounded visual parity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runner-'));
  try {
    const store = fakeStore(root);
    const driver = fakeDriver();
    const runner = new AutonomousExplorationRunner({ store, driver, now: () => new Date(NOW) });
    const result = await runner.run({ reviewId: 'rev_20260817020000_abcde', explorationId: 'exploration-1', ...subjects });
    assert.equal(driver.calls.length, 2);
    assert.equal(store.checkpoints.length, 2);
    assert.equal(result.report.status, 'EXPLORATION_PARITY_PASSED');
    assert.equal(result.report.coverage.states, 2);
    assert.equal(result.report.coverage.executedControls, 1);
    assert.equal(result.report.claims.parityClaimed, true);
    assert.equal(result.report.claims.strictParityClaimed, false);
    assert.equal(result.report.claims.platformWriteAttempted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic environment can explore but cannot claim parity or Converter attribution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runner-diagnostic-'));
  try {
    const store = fakeStore(root, { environmentMode: 'ALLOW_DIAGNOSTIC' });
    const runner = new AutonomousExplorationRunner({ store, driver: fakeDriver(), now: () => new Date(NOW) });
    const result = await runner.run({ reviewId: 'rev_20260817020000_abcde', explorationId: 'exploration-1', ...subjects });
    assert.equal(result.report.status, 'PARTIAL_PARITY_PASSED');
    assert.equal(result.report.claims.parityClaimed, false);
    assert.equal(result.report.claims.converterAttributionAllowed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a fully quarantined crawl is inconclusive rather than partial or passed parity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runner-blocked-'));
  try {
    const store = fakeStore(root);
    const runner = new AutonomousExplorationRunner({ store, driver: fakeDriver({ blocked: true }), now: () => new Date(NOW) });
    const result = await runner.run({ reviewId: 'rev_20260817020000_abcde', explorationId: 'exploration-1', ...subjects });
    assert.equal(result.report.status, 'INCONCLUSIVE');
    assert.equal(result.report.coverage.blockedActions > 0, true);
    assert.equal(result.report.claims.parityClaimed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('control policy admits tabs, same-origin routes and filters while rejecting secrets and generic buttons', () => {
  const target = { strategy: 'CSS', value: '#control' };
  assert.equal(classifyExplorationControl({ kind: 'DISCLOSURE', target }).eligibility, 'ELIGIBLE');
  assert.equal(classifyExplorationControl({ kind: 'LINK', sameOrigin: true, route: '/reports', hasQuery: false, inNavigation: true }).eligibility, 'ELIGIBLE');
  assert.equal(classifyExplorationControl({ kind: 'LINK', sameOrigin: true, route: '/records/delete/1', hasQuery: false, inNavigation: true }).reason, 'RISKY_ROUTE');
  assert.equal(classifyExplorationControl({ kind: 'FILTER_INPUT', label: 'Search', target }).eligibility, 'ELIGIBLE');
  assert.equal(classifyExplorationControl({ kind: 'FILTER_INPUT', label: 'Password', target }).reason, 'SECRET_OR_AUTHENTICATION_FIELD');
  assert.equal(classifyExplorationControl({ kind: 'OTHER', label: 'Delete', target }).reason, 'UNPROVEN_READ_ONLY_CONTROL');
});
