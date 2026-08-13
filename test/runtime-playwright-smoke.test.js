import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareRuntimeScenario } from '../src/runtime/comparator.js';
import { PlaywrightRuntimeDriver } from '../src/runtime/playwright-driver.js';
import { normalizeCapturedTrace } from '../src/runtime/trace-normalizer.js';

function scenario() {
  return {
    schemaVersion: 2,
    kind: 'runtime-scenario',
    scenarioId: 'real-browser-smoke',
    version: 1,
    name: 'Real Chromium isolation smoke',
    source: { type: 'DETERMINISTIC', reference: 'local-http-fixture' },
    sideEffect: 'READ_ONLY',
    executionPolicy: { mode: 'UNATTENDED', authorizationRequired: false, cleanupRequired: false },
    networkPolicy: { unsafeRequests: 'BLOCK' },
    artifactPolicy: { screenshots: 'FAILURES_ONLY', nativePlaywrightTrace: false },
    preconditions: [],
    actions: [{ stepId: 'open', type: 'OPEN_PAGE', input: '/preview' }],
    assertions: [{
      assertionId: 'result-parity',
      observation: { name: 'result', category: 'UI', capture: 'TEXT', target: { strategy: 'TEST_ID', value: 'result' } },
      comparator: 'V4_V5_EQUAL',
    }, {
      assertionId: 'no-errors',
      observation: { name: 'errors', category: 'CONSOLE', capture: 'COUNT' },
      comparator: 'NO_ERROR',
    }],
    cleanup: [],
    knowledgeRuleIds: [],
    createdAt: '2026-08-13T06:00:00.000Z',
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  };
}

async function fixtureServer(text) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/preview') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><body><div data-testid="result"></div><script>
      const visits = Number(localStorage.getItem('visits') || '0') + 1;
      localStorage.setItem('visits', String(visits));
      document.querySelector('[data-testid=result]').textContent = ${JSON.stringify(text)} + ' visits=' + visits;
    </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('real locked Chromium executes isolated deterministic V4/V5 contexts', { skip: process.env.IVX_PLAYWRIGHT_SMOKE !== '1' }, async () => {
  const sourceServer = await fixtureServer('Case 100 source-work-1 at 2026-08-13T06:00:00.000Z');
  const targetServer = await fixtureServer('Case 200 target-work-1 at 2026-08-13T06:05:00.000Z');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-real-browser-smoke-'));
  try {
    const source = { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: sourceServer.url };
    const target = { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: targetServer.url };
    const driver = new PlaywrightRuntimeDriver({ allowInsecureLocalhost: true });
    const pair = await driver.runPair({
      reviewId: 'rev_20260813060000_smoke',
      cycleId: 'cycle-smoke',
      scenario: scenario(),
      source,
      target,
      artifactRoot: temporary,
    });
    const subjects = { source, target };
    const sourceNormalized = normalizeCapturedTrace(pair.source.trace, pair.source.captures, subjects);
    const targetNormalized = normalizeCapturedTrace(pair.target.trace, pair.target.captures, subjects);
    const comparison = compareRuntimeScenario({
      scenario: scenario(),
      source: pair.source.trace,
      target: pair.target.trace,
      sourceNormalized,
      targetNormalized,
      environment: { comparisonId: 'env-smoke', status: 'ENVIRONMENT_EQUIVALENT' },
      subjects,
    });
    assert.equal(comparison.status, 'PARITY_PASSED');
    assert.equal(comparison.runtime.driver, 'playwright');
    assert.equal(comparison.runtime.driverVersion, '1.62.1');
    assert.equal(pair.source.trace.status, 'COMPLETED');
    assert.equal(pair.target.trace.status, 'COMPLETED');
    assert.equal(JSON.stringify(pair.source.trace).includes('source-work-1 at'), false);
  } finally {
    await new Promise((resolve) => sourceServer.server.close(resolve));
    await new Promise((resolve) => targetServer.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
