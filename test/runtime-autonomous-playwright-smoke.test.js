import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlaywrightExplorationDriver } from '../src/runtime/playwright-exploration-driver.js';

async function fixtureServer({ tabScript = "this.setAttribute('aria-selected','true');document.querySelector('#result').textContent='Overview open'" } = {}) {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><title>Migration fixture</title></head><body>
      <nav><a href="/reports">Reports</a><a href="/search?q=private">Query route</a></nav>
      <button role="tab" aria-selected="false" onclick="${tabScript}">Overview</button>
      <button onclick="fetch('/write',{method:'POST'})">Delete</button>
      <details><summary>More</summary><p>Details</p></details>
      <label>Search <input name="search" type="search"></label>
      <label>Password <input name="password" type="password"></label>
      <div id="result">Ready</div>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('real Chromium discovers and replays safe controls with masked visual checkpoints', { skip: process.env.IVX_PLAYWRIGHT_SMOKE !== '1' }, async () => {
  const sourceServer = await fixtureServer();
  const targetServer = await fixtureServer();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-autonomous-browser-'));
  try {
    const driver = new PlaywrightExplorationDriver({ allowInsecureLocalhost: true });
    const pair = await driver.runPairPath({
      reviewId: 'rev_20260817020000_smoke',
      explorationId: 'exploration-smoke',
      pathId: 'path-tab',
      startPath: '$SUBJECT_URL',
      actions: [{ actionId: 'open-overview', type: 'CLICK', target: { strategy: 'ROLE', role: 'tab', value: 'Overview', exact: true } }],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: sourceServer.url },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: targetServer.url },
      artifactRoot: temporary,
    });
    assert.equal(pair.source.status, 'COMPLETED', JSON.stringify(pair.source.errors));
    assert.equal(pair.target.status, 'COMPLETED', JSON.stringify(pair.target.errors));
    assert.equal(pair.source.state.fingerprint, pair.target.state.fingerprint);
    assert.equal(pair.source.controls.some((control) => control.reason === 'TAB_SWITCH'), true);
    assert.equal(pair.source.controls.some((control) => control.reason === 'SAME_ORIGIN_NAVIGATION'), true);
    assert.equal(pair.source.controls.some((control) => control.reason === 'NON_SECRET_FILTER_INPUT'), true);
    assert.equal(pair.source.controls.some((control) => control.reason === 'SECRET_OR_AUTHENTICATION_FIELD'), true);
    assert.equal(pair.source.controls.some((control) => control.label === 'Delete' && control.eligibility === 'ELIGIBLE'), false);
    assert.equal(fs.existsSync(path.join(temporary, pair.source.screenshot.path)), true);
  } finally {
    await new Promise((resolve) => sourceServer.server.close(resolve));
    await new Promise((resolve) => targetServer.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('real Chromium quarantines a semantic tab branch that attempts POST or mutates isolated storage', { skip: process.env.IVX_PLAYWRIGHT_SMOKE !== '1' }, async () => {
  const tabScript = "localStorage.setItem('changed','yes');fetch('/write',{method:'POST'})";
  const sourceServer = await fixtureServer({ tabScript });
  const targetServer = await fixtureServer({ tabScript });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-autonomous-gates-'));
  try {
    const driver = new PlaywrightExplorationDriver({ allowInsecureLocalhost: true });
    const pair = await driver.runPairPath({
      reviewId: 'rev_20260817020000_smoke',
      explorationId: 'exploration-gates',
      pathId: 'path-unsafe-tab',
      startPath: '$SUBJECT_URL',
      actions: [{ actionId: 'open-overview', type: 'CLICK', target: { strategy: 'ROLE', role: 'tab', value: 'Overview', exact: true } }],
      source: { generation: 'V4', nid: 100, workId: 'source-work-1', baseUrl: sourceServer.url },
      target: { generation: 'V5', nid: 200, workId: 'target-work-1', baseUrl: targetServer.url },
      artifactRoot: temporary,
    });
    for (const result of [pair.source, pair.target]) {
      assert.equal(result.status, 'BLOCKED');
      assert.equal(result.blocked.some((entry) => entry.code === 'UNSAFE_NETWORK_REQUEST_BLOCKED'), true);
      assert.equal(result.blocked.some((entry) => entry.code === 'ISOLATED_STORAGE_MUTATION_OBSERVED'), true);
      assert.equal(result.safety.actionStorageChanged, true);
    }
  } finally {
    await new Promise((resolve) => sourceServer.server.close(resolve));
    await new Promise((resolve) => targetServer.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
