import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { evaluateEnvironmentGate } from '../src/environment/environment-gate.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';

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
      env: { ...process.env, IVX_MIGRATION_HOME: home, TEST_AGENT_DIRECT_TOKEN: token },
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

function fixture(home, { includeEnvironment = true } = {}) {
  const paths = createAppPaths(home);
  const jobs = new JobStore(paths);
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
  jobs.writeArtifact(job.jobId, 'v4/app.json', { case: { nid: 100 }, stage: {}, server: {} });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', { case: { nid: 200 }, stage: {}, server: {} });
  const reviews = new RuntimeReviewStore(paths, { jobs });
  const review = reviews.create({
    jobId: job.jobId,
    runtime: {
      workflow: { version: '0.8.0', sha256: 'a'.repeat(64) },
      converter: { version: '1.2.5', sha256: 'b'.repeat(64) },
      knowledge: { version: '0.1.6', sha256: 'c'.repeat(64), contentSha256: 'd'.repeat(64), schemaVersion: 1, ruleIds: [] },
    },
    targetSnapshot: { case: { nid: 200 }, stage: {}, server: {} },
  });
  const now = new Date().toISOString();
  const evaluation = includeEnvironment ? evaluateEnvironmentGate({
    reviewId: review.reviewId,
    sourceManifestId: 'source-environment-agent-direct-cli',
    targetManifestId: 'target-environment-agent-direct-cli',
    comparisonId: 'environment-comparison-agent-direct-cli',
    source: { revision: { nid: 100, workId: 'source-work-1' }, workInfo: {}, config: {}, settings: {} },
    target: { revision: { nid: 200, workId: 'target-work-1' }, workInfo: {}, config: {}, settings: {} },
    evaluatedAt: now,
  }) : null;
  if (evaluation) reviews.recordEnvironmentEvaluation(review.reviewId, evaluation);
  return { job, review, evaluation };
}

test('protocol-9 Agent Direct CLI hands execution to the local Agent and archives its attestation without a Workflow driver', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-direct-cli-'));
  const home = path.join(temporary, 'home');
  const token = 'agent-direct-token-never-output';
  const { job, review, evaluation } = fixture(home);
  let requests = 0;
  const server = http.createServer(async (request, response) => {
    requests += 1;
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url, 'http://127.0.0.1');
      assert.equal(url.pathname, '/ih5/editor/work/get');
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      return sendJson(response, {
        nid: body.nid,
        workId: body.nid === 100 ? 'source-work-1' : 'target-work-1',
        previewUrl: `http://127.0.0.1:${server.address().port}/preview/${body.nid}`,
      });
    } catch (error) {
      return sendJson(response, { error: error.message }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_AGENT_DIRECT_TOKEN',
      writeMode: 'disabled',
      allowInsecureLocalhost: true,
    },
  }), { mode: 0o600 });

  try {
    const beforeRejected = requests;
    const rejected = await runCli(home, token, [
      'review', 'agent-test-authorize-platform', '--review', review.reviewId,
      '--environment-id', evaluation.comparison.comparisonId,
      '--capability', 'AGENT_DIRECT_SIDE_EFFECT',
      '--confirm', 'RUN_AGENT_DIRECT_SIDE_EFFECT_TEST',
    ]);
    assert.equal(rejected.code, 1);
    assert.equal(JSON.parse(rejected.stderr).code, 'AGENT_DIRECT_SIDE_EFFECT_NOT_ENABLED');
    assert.equal(requests, beforeRejected);

    const authorized = await runCli(home, token, [
      'review', 'agent-test-authorize-platform', '--review', review.reviewId,
      '--environment-id', evaluation.comparison.comparisonId,
      '--capability', 'AGENT_DIRECT_READ_ONLY',
      '--confirm', 'RUN_AGENT_DIRECT_READ_ONLY_TEST',
    ]);
    assert.equal(authorized.code, 0, authorized.stderr || authorized.stdout);
    const authorization = JSON.parse(authorized.stdout).result;
    assert.equal(authorization.scope.browserControl, 'AGENT_DIRECT');
    assert.equal(authorization.scope.workflowDriver, 'NOT_PROVIDED');
    assert.equal(authorized.stdout.includes(token), false);

    const delivered = await runCli(home, token, [
      'review', 'agent-test-context-platform', '--review', review.reviewId,
      '--authorization', authorization.authorizationId,
    ]);
    assert.equal(delivered.code, 0, delivered.stderr || delivered.stdout);
    const context = JSON.parse(delivered.stdout).result;
    assert.equal(context.workflowExecution.browserDriver, 'NOT_PROVIDED');
    assert.equal(context.workflowExecution.actionPlanner, 'NOT_PROVIDED');
    assert.equal(context.credentialPolicy.access, 'AGENT_LOCAL_USE');
    assert.equal(context.credentialPolicy.valuesIncluded, false);
    assert.equal(context.credentialPolicy.userDirectInput, 'EPHEMERAL_BROWSER_USE_ALLOWED');
    assert.equal(context.credentialPolicy.browserUse, 'AUTHORIZED_SUBJECTS_ONLY');
    assert.equal(context.credentialPolicy.agentToolTransport, 'MINIMUM_BROWSER_OPERATION_ONLY');
    assert.equal(context.credentialPolicy.workflowAccess, 'FORBIDDEN');
    assert.equal(context.credentialPolicy.persistence, 'FORBIDDEN');
    assert.equal(context.credentialPolicy.reporting, 'FORBIDDEN');
    assert.equal(context.credentialPolicy.reuse, 'CURRENT_AGENT_TASK_ONLY');
    assert.equal(context.job.root, path.join(home, 'jobs', job.jobId));
    assert.equal(context.job.manifest.entries.some((entry) => entry.path === 'v4/app.json'), true);
    assert.equal(delivered.stdout.includes(token), false);

    fs.mkdirSync(path.join(context.session.workspaceRoot, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(context.session.workspaceRoot, 'screenshots', 'agent-pair.png'), 'redacted paired evidence', { mode: 0o600 });
    const completedAt = new Date().toISOString();
    const attestationFile = path.join(temporary, 'attestation.json');
    fs.writeFileSync(attestationFile, JSON.stringify({
      schemaVersion: 2,
      kind: 'agent-test-attestation',
      attestationId: 'agent-attestation-cli-1',
      sessionId: context.session.sessionId,
      authorizationId: authorization.authorizationId,
      reviewId: review.reviewId,
      jobId: job.jobId,
      sourceRevision: authorization.source,
      targetRevision: authorization.target,
      environment: authorization.environment,
      capability: authorization.capability,
      executor: { kind: 'LOCAL_AI_AGENT', product: 'Codex', tools: ['browser-control', 'javascript', 'css-xpath'] },
      outcome: 'AGENT_ATTESTED_PARITY_OBSERVED',
      coverage: { businessFlows: 1, states: 4, actions: 3, assertions: 2, screenshots: 1, networkObservations: 1 },
      effects: { attempted: false, operationCount: 0, systems: [], objectTypes: [], actionClasses: [] },
      findings: [],
      evidenceRefs: ['screenshots/agent-pair.png'],
      claims: { parityObserved: true, strictParityClaimed: false, workflowDriverUsed: false, targetModifiedByTest: false },
      completedAt,
      createdAt: completedAt,
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
    }), { mode: 0o600 });
    const submitted = await runCli(home, token, [
      'review', 'agent-test-submit-platform', '--review', review.reviewId,
      '--session', context.session.sessionId, '--file', attestationFile,
    ]);
    assert.equal(submitted.code, 0, submitted.stderr || submitted.stdout);
    const result = JSON.parse(submitted.stdout).result;
    assert.equal(result.state.status, 'COMPLETED');
    assert.equal(result.evidenceManifest.fileCount, 1);
    assert.equal(submitted.stdout.includes(token), false);

    const status = await runCli(home, token, ['review', 'agent-test-status', '--review', review.reviewId, '--session', context.session.sessionId]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(JSON.parse(status.stdout).result.state.status, 'COMPLETED');
    const listed = await runCli(home, token, ['review', 'agent-test-list', '--review', review.reviewId]);
    assert.equal(listed.code, 0, listed.stderr || listed.stdout);
    assert.equal(JSON.parse(listed.stdout).result.sessions.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).platform.writeMode, 'disabled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Agent Native CLI hands current facts to the Agent without confirmation, Environment Gate, write-mode, or Workflow browser driver', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-native-cli-'));
  const home = path.join(temporary, 'home');
  const token = 'agent-native-token-never-output';
  const { job, review } = fixture(home, { includeEnvironment: false });
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      return sendJson(response, {
        nid: body.nid,
        workId: body.nid === 100 ? 'source-current-drift' : 'target-current-drift',
        previewUrl: `http://127.0.0.1:${server.address().port}/preview/${body.nid}`,
      });
    } catch (error) {
      return sendJson(response, { error: error.message }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_AGENT_DIRECT_TOKEN',
      writeMode: 'explicit',
      allowInsecureLocalhost: true,
    },
  }), { mode: 0o600 });
  try {
    const handed = await runCli(home, token, ['review', 'agent-native-handoff-platform', '--review', review.reviewId]);
    assert.equal(handed.code, 0, handed.stderr || handed.stdout);
    const handoff = JSON.parse(handed.stdout).result;
    assert.equal(handoff.mode, 'AGENT_NATIVE');
    assert.equal(handoff.workflow.restrictionsApplied, false);
    assert.equal(handoff.workflow.authorizationRequired, false);
    assert.equal(handoff.workflow.sessionCreated, false);
    assert.equal(handoff.environment.comparisonId, null);
    assert.equal(handoff.subjects.source.workId, 'source-current-drift');
    assert.equal(handoff.subjects.target.workId, 'target-current-drift');
    assert.equal(handed.stdout.includes(token), false);
    assert.equal(fs.existsSync(path.join(home, 'reviews', review.reviewId, 'agent-direct-tests')), false);

    const completedAt = new Date().toISOString();
    const observationFile = path.join(temporary, 'native-observation.json');
    fs.writeFileSync(observationFile, JSON.stringify({
      schemaVersion: 2,
      kind: 'agent-native-observation-bundle',
      runId: 'native-cli-run-1',
      previousRunId: null,
      repairBatchId: null,
      reviewId: review.reviewId,
      jobId: job.jobId,
      purpose: 'INITIAL_TEST',
      subjects: {
        source: { nid: 100, workId: 'source-current-drift', url: handoff.subjects.source.url, origin: handoff.subjects.source.origin },
        target: { nid: 200, workId: 'target-current-drift', url: handoff.subjects.target.url, origin: handoff.subjects.target.origin },
      },
      environment: { comparisonId: null, status: null, differences: [] },
      execution: { tools: ['agent-selected-tool'], startedAt: completedAt, completedAt },
      outcome: 'INCONCLUSIVE',
      coverage: { businessFlows: 0, states: 1, actions: 0, assertions: 0, screenshots: 0, networkObservations: 0 },
      effects: { occurred: false, systems: [], summaries: [] },
      findings: [{ findingId: 'native-cli-finding-1', severity: 'WARNING', status: 'INCONCLUSIVE', summary: 'The Agent could not complete the business observation.', candidateCause: 'TEST_HARNESS', evidenceRefs: [] }],
      evidenceRefs: [],
      claims: { strictParityClaimed: false, workflowRestrictionsApplied: false },
      completedAt,
      createdAt: completedAt,
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
    }), { mode: 0o600 });
    const submitted = await runCli(home, token, ['review', 'agent-native-submit', '--review', review.reviewId, '--file', observationFile]);
    assert.equal(submitted.code, 0, submitted.stderr || submitted.stdout);
    assert.equal(JSON.parse(submitted.stdout).result.review.status, 'AGENT_NATIVE_INCONCLUSIVE');
    const listed = await runCli(home, token, ['review', 'agent-native-list', '--review', review.reviewId]);
    assert.equal(JSON.parse(listed.stdout).result.runs.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
