import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { encodePlatformWork } from '../src/platform/work-codec.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function runCli(home, token, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      env: { ...process.env, IVX_MIGRATION_HOME: home, TEST_REVIEW_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function completedJob(home) {
  const jobs = new JobStore(createAppPaths(home));
  const source = {
    case: { id: 'case-root', type: 'ih5-case', events: { list: [{ tree: { type: 'root' } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
  const target = {
    case: { id: 'case-root', type: 'ih5-case', events: { list: [{ ast: { op: 'val', val: true } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
  let job = jobs.create({
    sourceNid: 100,
    mode: 'platform',
    workflowRuntime: { version: '0.4.0', sha256: 'a'.repeat(64) },
    converterRuntime: { version: '1.2.1', entrySha256: 'b'.repeat(64) },
    knowledgeRuntime: { version: '0.1.1', sha256: 'c'.repeat(64), contentSha256: 'd'.repeat(64), schemaVersion: 1, ruleIds: [] },
  });
  jobs.writeArtifact(job.jobId, 'v4/app.json', source, { pretty: false });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', target, { pretty: false });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  job = jobs.transition(job.jobId, 'CONVERTED', { patch: { target: { artifact: 'v5/app.v5.json' } } });
  for (const status of ['VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { ...job.target, nid: 200, workId: 'target-work-1' } } });
  return { job, target };
}

test('platform-backed review creation and Environment Gate never expose case secrets to the Agent', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-review-platform-cli-'));
  const home = path.join(temporary, 'home');
  const token = 'review-token-never-persist';
  const secret = 'environment-secret-never-output';
  let targetSecret = secret;
  const { job, target } = completedJob(home);
  const source = JSON.parse(fs.readFileSync(path.join(home, 'jobs', job.jobId, 'v4', 'app.json'), 'utf8'));
  let sourceWorkId = 'source-work-after-save-2';
  let sourceSnapshot = source;
  let targetWorkId = 'target-work-1';
  let targetSnapshot = target;
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/ih5/editor/work/get') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        const isSource = body.nid === 100;
        return sendJson(response, {
          nid: body.nid,
          workId: isSource ? sourceWorkId : targetWorkId,
          extra: isSource ? { ver: 4 } : { ver: 2 },
          previewUrl: `http://127.0.0.1:${server.address().port}/preview/${body.nid}`,
        });
      }
      if (url.pathname.startsWith('/work/load/')) {
        const workId = decodeURIComponent(url.pathname.slice('/work/load/'.length));
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return response.end(encodePlatformWork(workId.startsWith('source-work-') ? sourceSnapshot : targetSnapshot));
      }
      if (url.pathname === '/ih5/editor/work/getConfig') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        return sendJson(response, body.type === 'settings' ? {} : { customVars: { SESSION_KEY: body.nid === 100 ? secret : targetSecret } });
      }
      return sendJson(response, { error: `unexpected ${url.pathname}` }, 404);
    } catch (error) {
      return sendJson(response, { error: error.message }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_REVIEW_TOKEN',
      writeMode: 'disabled',
      allowInsecureLocalhost: true,
    },
  }), { mode: 0o600 });

  try {
    const created = await runCli(home, token, ['review', 'create-platform', '--job', job.jobId, '--capability', 'WRITE']);
    assert.equal(created.code, 0, created.stderr || created.stdout);
    const review = JSON.parse(created.stdout).result;
    assert.equal(review.target.nid, 200);
    assert.equal(review.baseline.targetWorkId, 'target-work-1');
    assert.equal(review.baseline.sourceWorkId, 'source-work-after-save-2');
    assert.equal(created.stdout.includes(token), false);
    sourceWorkId = 'source-work-before-environment-3';

    const checked = await runCli(home, token, ['review', 'environment-check', '--review', review.reviewId]);
    assert.equal(checked.code, 0, checked.stderr || checked.stdout);
    const evaluation = JSON.parse(checked.stdout).result;
    assert.equal(['ENVIRONMENT_EQUIVALENT', 'NORMALIZED_EQUIVALENT'].includes(evaluation.comparison.status), true);
    assert.equal(evaluation.comparison.sourceRevision.workId, 'source-work-before-environment-3');
    assert.equal(evaluation.comparison.targetRevision.workId, 'target-work-1');
    assert.equal(evaluation.sourceReconciliation.fromWorkId, 'source-work-after-save-2');
    assert.equal(evaluation.sourceReconciliation.toWorkId, 'source-work-before-environment-3');
    assert.equal(evaluation.sourceReconciliation.outcome, 'CONTENT_EQUIVALENT');
    assert.match(evaluation.sourceReconciliation.expectedContentSha256, /^[a-f0-9]{64}$/);
    assert.match(evaluation.sourceReconciliation.currentContentSha256, /^[a-f0-9]{64}$/);
    assert.equal(evaluation.sourceReconciliation.expectedContentSha256, evaluation.sourceReconciliation.currentContentSha256);
    assert.equal(checked.stdout.includes(secret), false);
    assert.equal(checked.stdout.includes(token), false);

    const reconciliations = fs.readdirSync(path.join(home, 'reviews', review.reviewId, 'source-reconciliations')).filter((file) => file.endsWith('.json'));
    assert.equal(reconciliations.length, 2);
    assert.equal(reconciliations.every((file) => (fs.statSync(path.join(home, 'reviews', review.reviewId, 'source-reconciliations', file)).mode & 0o777) === 0o600), true);
    assert.equal(reconciliations.every((file) => {
      const artifact = JSON.parse(fs.readFileSync(path.join(home, 'reviews', review.reviewId, 'source-reconciliations', file), 'utf8'));
      return /^[a-f0-9]{64}$/.test(artifact.expectedContentSha256)
        && artifact.expectedContentSha256 === artifact.currentContentSha256;
    }), true);
    const reconciledStatus = await runCli(home, token, ['review', 'status', '--review', review.reviewId]);
    assert.equal(reconciledStatus.code, 0, reconciledStatus.stderr || reconciledStatus.stdout);
    assert.equal(JSON.parse(reconciledStatus.stdout).result.baseline.sourceWorkId, 'source-work-before-environment-3');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).platform.writeMode, 'disabled');

    const environmentFiles = fs.readdirSync(path.join(home, 'reviews', review.reviewId, 'environment')).filter((file) => file.endsWith('.json'));
    assert.equal(environmentFiles.length, 3);
    assert.equal(environmentFiles.every((file) => (fs.statSync(path.join(home, 'reviews', review.reviewId, 'environment', file)).mode & 0o777) === 0o600), true);

    const scenarioFile = path.join(temporary, 'scenario.json');
    fs.writeFileSync(scenarioFile, JSON.stringify({
      schemaVersion: 2,
      kind: 'runtime-scenario',
      scenarioId: 'scenario-platform-closed',
      version: 1,
      name: 'Blocked platform environment never launches a browser',
      source: { type: 'DETERMINISTIC', reference: 'mock-platform' },
      sideEffect: 'READ_ONLY',
      executionPolicy: { mode: 'UNATTENDED', authorizationRequired: false, cleanupRequired: false },
      networkPolicy: { unsafeRequests: 'BLOCK' },
      artifactPolicy: { screenshots: 'OFF', nativePlaywrightTrace: false },
      preconditions: [],
      actions: [{ stepId: 'open', type: 'OPEN_PAGE', input: '/' }],
      assertions: [{ assertionId: 'no-errors', observation: { name: 'errors', category: 'CONSOLE', capture: 'COUNT' }, comparator: 'NO_ERROR' }],
      cleanup: [],
      knowledgeRuleIds: [],
      createdAt: new Date().toISOString(),
      createdBy: 'CLI',
      sensitivity: 'REDACTED',
    }));
    const added = await runCli(home, token, ['review', 'scenario-add', '--review', review.reviewId, '--file', scenarioFile]);
    assert.equal(added.code, 0, added.stderr || added.stdout);
    targetSecret = 'different-target-secret-never-output';
    const blockedCheck = await runCli(home, token, ['review', 'environment-check', '--review', review.reviewId]);
    assert.equal(blockedCheck.code, 0, blockedCheck.stderr || blockedCheck.stdout);
    const blockedEnvironment = JSON.parse(blockedCheck.stdout).result.comparison;
    assert.equal(blockedEnvironment.status, 'BLOCKED_ENVIRONMENT');
    const blockedRun = await runCli(home, token, [
      'review', 'runtime-run-platform', '--review', review.reviewId,
      '--scenario', 'scenario-platform-closed', '--environment-id', blockedEnvironment.comparisonId,
    ]);
    assert.equal(blockedRun.code, 0, blockedRun.stderr || blockedRun.stdout);
    assert.equal(JSON.parse(blockedRun.stdout).result.blocked, true);
    assert.equal(blockedRun.stdout.includes('different-target-secret-never-output'), false);
    assert.equal(blockedRun.stdout.includes(token), false);

    const riskAcceptanceFile = path.join(temporary, 'environment-risk-acceptance.json');
    fs.writeFileSync(riskAcceptanceFile, JSON.stringify({
      schemaVersion: 2,
      kind: 'environment-risk-acceptance',
      acceptanceId: 'environment-risk-cli-scope-test',
      reviewId: review.reviewId,
      sourceRevision: blockedEnvironment.sourceRevision,
      targetRevision: blockedEnvironment.targetRevision,
      acceptedPaths: ['/not-the-blocked-path'],
      scenarioIds: ['scenario-platform-closed'],
      purpose: 'DIAGNOSTIC_RUNTIME_ONLY',
      confirmation: 'ACCEPT_ENVIRONMENT_RISK',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    }), { mode: 0o600 });
    const rejectedRiskRun = await runCli(home, token, [
      'review', 'runtime-run-platform', '--review', review.reviewId,
      '--scenario', 'scenario-platform-closed', '--environment-id', blockedEnvironment.comparisonId,
      '--environment-risk-acceptance-file', riskAcceptanceFile,
    ]);
    assert.equal(rejectedRiskRun.code, 1);
    assert.equal(JSON.parse(rejectedRiskRun.stderr).code, 'ENVIRONMENT_RISK_ACCEPTANCE_PATHS_INCOMPLETE');
    assert.equal(rejectedRiskRun.stderr.includes('different-target-secret-never-output'), false);
    assert.equal(rejectedRiskRun.stderr.includes(token), false);

    targetWorkId = 'target-work-manual-2';
    targetSnapshot = structuredClone(target);
    targetSnapshot.case.manualEdit = true;
    const observed = await runCli(home, token, ['review', 'observe-platform-revision', '--review', review.reviewId]);
    assert.equal(observed.code, 0, observed.stderr || observed.stdout);
    assert.equal(JSON.parse(observed.stdout).result.review.status, 'TARGET_EXTERNALLY_MODIFIED');
    assert.equal(observed.stdout.includes(secret), false);
    assert.equal(observed.stdout.includes(token), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('platform-backed review creation rejects substantive source changes before persisting a Review', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-review-platform-source-change-'));
  const home = path.join(temporary, 'home');
  const token = 'review-token-source-change';
  const { job, target } = completedJob(home);
  const changedSource = JSON.parse(fs.readFileSync(path.join(home, 'jobs', job.jobId, 'v4', 'app.json'), 'utf8'));
  changedSource.case.changedAfterConversion = true;
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/ih5/editor/work/get') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        return sendJson(response, {
          nid: body.nid,
          workId: body.nid === 100 ? 'source-work-changed-2' : 'target-work-1',
          extra: { ver: body.nid === 100 ? 4 : 2 },
        });
      }
      if (url.pathname.startsWith('/work/load/')) {
        const workId = decodeURIComponent(url.pathname.slice('/work/load/'.length));
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return response.end(encodePlatformWork(workId.startsWith('source-work-') ? changedSource : target));
      }
      return sendJson(response, { error: `unexpected ${url.pathname}` }, 404);
    } catch (error) {
      return sendJson(response, { error: error.message }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_REVIEW_TOKEN',
      writeMode: 'disabled',
      allowInsecureLocalhost: true,
    },
  }), { mode: 0o600 });
  try {
    const created = await runCli(home, token, ['review', 'create-platform', '--job', job.jobId, '--capability', 'READ_ONLY']);
    assert.equal(created.code, 1);
    assert.equal(JSON.parse(created.stderr).code, 'REVIEW_SOURCE_CONTENT_CHANGED');
    assert.equal(created.stderr.includes(token), false);
    const reviews = await runCli(home, token, ['review', 'list', '--job', job.jobId]);
    assert.equal(reviews.code, 0, reviews.stderr || reviews.stdout);
    assert.deepEqual(JSON.parse(reviews.stdout).result.reviews, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
