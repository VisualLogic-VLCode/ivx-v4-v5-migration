import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { decodePlatformWork, encodePlatformWork } from '../src/platform/work-codec.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

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
    const child = spawn(process.execPath, [path.join(projectRoot, 'bin', 'ivx-migrate.js'), ...args], {
      cwd: projectRoot,
      env: { ...process.env, IVX_MIGRATION_HOME: home, TEST_IVX_TOKEN: token },
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

function createIssueJob(home, converted, issues) {
  const jobs = new JobStore(createAppPaths(home));
  let job = jobs.create({
    sourceNid: 100,
    mode: 'platform',
    workflowRuntime: { packageName: '@test/workflow', version: '1.0.0' },
    converterRuntime: { packageName: '@test/converter', version: '2.0.0' },
  });
  job = jobs.transition(job.jobId, 'UPDATE_CHECKED');
  job = jobs.transition(job.jobId, 'AUTHORIZED');
  job = jobs.transition(job.jobId, 'VERSION_CLASSIFIED');
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', {
    patch: { source: { workId: 'source-work-1', inputSha256: 'a'.repeat(64) } },
  });
  jobs.writeArtifact(job.jobId, 'v4/app.json', converted, { pretty: false });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', converted, { pretty: false });
  job = jobs.transition(job.jobId, 'CONVERTED', {
    patch: { target: { artifact: 'v5/app.v5.json', outputSha256: 'b'.repeat(64) } },
  });
  const validationIssues = issues.map((issue, index) => ({
    issueId: `ISSUE-${String(index + 1).padStart(4, '0')}`,
    rule: `${issue.owner}_TEST_ISSUE`,
    severity: 'BLOCKER',
    message: `${issue.owner} diagnostic-save test issue`,
  }));
  const validation = {
    schemaVersion: 1,
    passed: false,
    summary: { issueCount: issues.length, blockerCount: issues.length },
    issues: validationIssues,
  };
  jobs.writeArtifact(job.jobId, 'reports/validation.json', validation);
  jobs.writeArtifact(job.jobId, 'reports/issue-classification.json', {
    schemaVersion: 1,
    issues: issues.map((issue, index) => ({
      issueId: validationIssues[index].issueId,
      owner: issue.owner,
      confidence: 1,
      reason: `${issue.owner} ownership confirmed for diagnostic-save test`,
      repairAllowed: issue.repairAllowed === true,
    })),
  });
  job = jobs.transition(job.jobId, 'VALIDATED');
  job = jobs.transition(job.jobId, 'ISSUES_CLASSIFIED', { patch: { issues: { summary: validation.summary } } });
  const hasConverter = issues.some((issue) => issue.owner === 'CONVERTER');
  const hasUnknown = issues.some((issue) => issue.owner === 'UNKNOWN' || (issue.owner === 'SOURCE' && issue.repairAllowed !== true));
  const hasRepairableSource = issues.some((issue) => issue.owner === 'SOURCE' && issue.repairAllowed === true);
  const status = hasConverter
    ? 'BLOCKED_CONVERTER_DEFECT'
    : hasUnknown || !hasRepairableSource
      ? 'NEEDS_REVIEW'
      : 'AI_REPAIR_REQUIRED';
  return { jobs, job: jobs.transition(job.jobId, status) };
}

test('CLI permits every classified cause after independent diagnostic-save hard gates pass', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-diagnostic-save-cli-'));
  const home = path.join(temporary, 'home');
  const token = 'diagnostic-save-token-never-persist';
  const sourceNid = 100;
  const targetNid = 200;
  const converted = {
    case: { id: 'case', type: 'ih5-case', props: { nid: sourceNid } },
    stage: { id: 'stage', type: 'stage' },
    server: { id: 'server', type: 'server' },
  };
  let targetWork = null;
  let targetWorkId = 'target-work-0';
  let targetConfig = {};
  const sourceSettings = { domain: '', previewDomain: '', customDomain: false };
  const targetSettings = {
    domain: '',
    path: '/play/target-generated',
    previewDomain: '',
    previewPath: '/play/target-preview-generated',
    customDomain: false,
    pubRoot: false,
    preRoot: false,
  };
  const calls = { create: 0, config: 0, save: 0 };
  fs.mkdirSync(home, { recursive: true });
  const { jobs, job } = createIssueJob(home, converted, [
    { owner: 'CONVERTER' },
    { owner: 'SOURCE', repairAllowed: true },
    { owner: 'UNKNOWN' },
  ]);

  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/ih5/app/user/userinfo') {
        await readBody(request);
        return sendJson(response, { id: 900, eid: 901 });
      }
      if (url.pathname === '/ih5/editor/work/get') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (body.nid === sourceNid) return sendJson(response, { nid: sourceNid, gid: 0, memberType: 1, workId: 'source-work-1', edtVer: '4.1', ntype: 1 });
        return sendJson(response, { nid: targetNid, gid: 0, memberType: 1, workId: targetWorkId, edtVer: '4.1', extra: { ver: 2 }, ntype: 91 });
      }
      if (url.pathname.startsWith('/work/load/')) {
        const nid = Number(url.searchParams.get('nid'));
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return response.end(encodePlatformWork(nid === sourceNid ? converted : targetWork));
      }
      if (url.pathname === '/ih5/editor/work/getConfig') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        if (body.type === 'settings') return sendJson(response, body.nid === sourceNid ? sourceSettings : targetSettings);
        return sendJson(response, body.nid === sourceNid ? { customVars: { environment: 'test' } } : targetConfig);
      }
      if (url.pathname === '/ih5/app/user/getDefaultConfig') {
        await readBody(request);
        return sendJson(response, { default: true });
      }
      if (url.pathname === '/work/saveAs') {
        calls.create += 1;
        targetWork = decodePlatformWork(await readBody(request));
        return sendJson(response, { nid: targetNid, workId: targetWorkId });
      }
      if (url.pathname === '/ih5/editor/work/setConfig') {
        calls.config += 1;
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        targetConfig = body.config;
        return sendJson(response, {});
      }
      if (url.pathname.startsWith('/work/save/')) {
        calls.save += 1;
        targetWork = decodePlatformWork(await readBody(request));
        targetWorkId = 'target-work-1';
        return sendJson(response, { nid: targetNid, workId: targetWorkId });
      }
      return sendJson(response, { detail: `unexpected ${url.pathname}` }, 404);
    } catch (error) {
      return sendJson(response, { detail: error.message }, 500);
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_IVX_TOKEN',
      writeMode: 'explicit',
      allowInsecureLocalhost: true,
    },
  }));

  try {
    const normalSave = await runCli(home, token, [
      'job', 'resume-save', '--job', job.jobId, '--confirm-live-write', 'SAVE_V5',
    ]);
    assert.equal(normalSave.code, 1);
    assert.equal(JSON.parse(normalSave.stderr).code, 'JOB_STATE_MISMATCH');
    assert.deepEqual(calls, { create: 0, config: 0, save: 0 });

    const weakConfirmation = await runCli(home, token, [
      'job', 'resume-diagnostic-save', '--job', job.jobId, '--confirm-live-write', 'SAVE_V5',
    ]);
    assert.equal(weakConfirmation.code, 1);
    assert.equal(JSON.parse(weakConfirmation.stderr).code, 'LIVE_WRITE_CONFIRMATION_REQUIRED');
    assert.deepEqual(calls, { create: 0, config: 0, save: 0 });

    const diagnosticSave = await runCli(home, token, [
      'job', 'resume-diagnostic-save', '--job', job.jobId,
      '--confirm-live-write', 'SAVE_V5_WITH_KNOWN_ISSUES',
    ]);
    assert.equal(diagnosticSave.code, 0, diagnosticSave.stderr || diagnosticSave.stdout);
    const output = JSON.parse(diagnosticSave.stdout).result;
    assert.equal(output.status, 'DIAGNOSTIC_COPY_CREATED');
    assert.equal(output.target.nid, targetNid);
    assert.deepEqual(calls, { create: 1, config: 1, save: 1 });

    const authorization = JSON.parse(fs.readFileSync(path.join(jobs.jobDir(job.jobId), 'reports', 'diagnostic-save-authorization.json'), 'utf8'));
    assert.equal(authorization.evidence.issueCount, 3);
    assert.deepEqual(authorization.evidence.issueCountsByOwner, {
      CONVERTER: 1,
      SOURCE: 1,
      TEST_HARNESS: 0,
      ENVIRONMENT: 0,
      PLATFORM: 0,
      KNOWLEDGE: 0,
      AUTHORIZATION: 0,
      UNKNOWN: 1,
    });
    assert.equal(authorization.output.terminalStatus, 'DIAGNOSTIC_COPY_CREATED');
    const journal = JSON.parse(fs.readFileSync(path.join(jobs.jobDir(job.jobId), 'reports', 'platform-save-journal.json'), 'utf8'));
    assert.equal(journal.intent.kind, 'known-issues-diagnostic');
    assert.equal(JSON.stringify({ output, authorization, journal }).includes(token), false);

    for (const [owner, repairAllowed, sourceStatus, expectedCalls] of [
      ['SOURCE', true, 'AI_REPAIR_REQUIRED', { create: 2, config: 1, save: 2 }],
      ['UNKNOWN', false, 'NEEDS_REVIEW', { create: 3, config: 1, save: 3 }],
      ['PLATFORM', false, 'NEEDS_REVIEW', { create: 4, config: 1, save: 4 }],
      ['AUTHORIZATION', false, 'NEEDS_REVIEW', { create: 5, config: 1, save: 5 }],
    ]) {
      const issueJob = createIssueJob(home, converted, [{ owner, repairAllowed }]);
      assert.equal(issueJob.job.status, sourceStatus);
      const result = await runCli(home, token, [
        'job', 'resume-diagnostic-save', '--job', issueJob.job.jobId,
        '--confirm-live-write', 'SAVE_V5_WITH_KNOWN_ISSUES',
      ]);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).result.status, 'DIAGNOSTIC_COPY_CREATED');
      assert.deepEqual(calls, expectedCalls);
      const issueAuthorization = JSON.parse(fs.readFileSync(path.join(issueJob.jobs.jobDir(issueJob.job.jobId), 'reports', 'diagnostic-save-authorization.json'), 'utf8'));
      assert.equal(issueAuthorization.sourceStatus, sourceStatus);
      assert.equal(issueAuthorization.evidence.issueCountsByOwner[owner], 1);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
