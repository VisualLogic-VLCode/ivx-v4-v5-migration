import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
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

function allFileText(root) {
  const texts = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else texts.push(fs.readFileSync(target).toString('utf8'));
    }
  };
  visit(root);
  return texts.join('\n');
}

test('CLI platform migration uses caller token, converts, saves, checkpoints, and verifies', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-platform-cli-'));
  const home = path.join(temporary, 'home');
  const converter = path.join(temporary, 'converter');
  const token = 'integration-user-token-never-persist';
  const sourceNid = 100;
  const targetNid = 200;
  const sourceWork = {
    case: { id: 'case', type: 'ih5-case', props: { nid: sourceNid }, events: { list: [{ tree: { type: 'root' } }] } },
    stage: { id: 'stage', type: 'stage', events: { list: [] } },
    server: { id: 'server', type: 'server', events: { list: [] } },
  };
  let targetWork = null;
  let targetWorkId = 'target-work-0';
  let targetConfig = {};
  const calls = { create: 0, config: 0, save: 0 };
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(converter, { recursive: true });
  fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: '@test/platform-converter', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(converter, 'index.js'), `
    export function convertV4CaseJsonToV5CaseJson({ v4CaseJson }) {
      const output = structuredClone(v4CaseJson);
      output.case.events.list = [{ ast: { op: 'root', args: [] } }];
      return output;
    }
  `);

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
        const encoded = encodePlatformWork(nid === sourceNid ? sourceWork : targetWork);
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return response.end(encoded);
      }
      if (url.pathname === '/ih5/editor/work/getConfig') {
        const body = JSON.parse((await readBody(request)).toString('utf8'));
        return sendJson(response, body.nid === sourceNid ? { customVars: { environment: 'test' } } : targetConfig);
      }
      if (url.pathname === '/ih5/app/user/getDefaultConfig') {
        await readBody(request);
        return sendJson(response, { default: true, wechat: { noJs: false } });
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
  const address = server.address();
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      tokenEnv: 'TEST_IVX_TOKEN',
      writeMode: 'explicit',
      allowInsecureLocalhost: true,
    },
  }));
  try {
    const result = await runCli(home, token, [
      'migrate', '--nid', String(sourceNid), '--converter-path', converter,
      '--save', '--confirm-live-write', 'SAVE_V5',
    ]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.result.status, 'SUCCEEDED');
    assert.deepEqual(calls, { create: 1, config: 1, save: 1 });
    assert.equal(targetWork.case.props.nid, targetNid);
    assert.equal(targetConfig.default, undefined);
    assert.deepEqual(targetConfig.customVars, { environment: 'test' });
    assert.equal(allFileText(home).includes(token), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI reports an existing V5 case and never calls the converter or Save As', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-platform-v5-'));
  const home = path.join(temporary, 'home');
  const converter = path.join(temporary, 'converter');
  const token = 'v5-skip-token';
  const v5Work = {
    case: { id: 'case', type: 'ih5-case', events: { list: [{ ast: { op: 'root', args: [] } }] } },
    stage: { id: 'stage', type: 'stage', events: { list: [] } },
    server: { id: 'server', type: 'server', events: { list: [] } },
  };
  let writeCalls = 0;
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(converter, { recursive: true });
  fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: '@test/must-not-run', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(converter, 'index.js'), `
    export function convertV4CaseJsonToV5CaseJson() { throw new Error('converter must not run for V5'); }
  `);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (['/work/saveAs', '/ih5/editor/work/setConfig'].includes(url.pathname) || url.pathname.startsWith('/work/save/')) writeCalls += 1;
    if (url.pathname === '/ih5/app/user/userinfo') return sendJson(response, { id: 900 });
    if (url.pathname === '/ih5/editor/work/get') return sendJson(response, { nid: 300, gid: 0, memberType: 1, workId: 'v5-work-1', edtVer: '4.1', extra: { ver: 2 }, ntype: 91 });
    if (url.pathname.startsWith('/work/load/')) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return response.end(encodePlatformWork(v5Work));
    }
    return sendJson(response, { detail: `unexpected ${url.pathname}` }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    platform: {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'TEST_IVX_TOKEN',
      writeMode: 'disabled',
      allowInsecureLocalhost: true,
    },
  }));
  try {
    const result = await runCli(home, token, ['migrate', '--nid', '300', '--converter-path', converter]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).result.status, 'SKIPPED_ALREADY_V5');
    assert.equal(writeCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI distinguishes token rejection from source permission denial without persisting either token', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-platform-permissions-'));
  const converter = path.join(temporary, 'converter');
  fs.mkdirSync(converter, { recursive: true });
  fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: '@test/permission-converter', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(converter, 'index.js'), 'export function convertV4CaseJsonToV5CaseJson(value) { return value.v4CaseJson; }');
  const server = http.createServer(async (request, response) => {
    const token = String(request.headers.authorization || '').replace(/^Bearer /, '');
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/ih5/app/user/userinfo') {
      if (token === 'rejected-token') return sendJson(response, { detail: 'not authenticated' }, 401);
      return sendJson(response, { id: 900 });
    }
    if (url.pathname === '/ih5/editor/work/get') return sendJson(response, { detail: 'not a member' }, 403);
    return sendJson(response, { detail: `unexpected ${url.pathname}` }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [token, expected] of [['rejected-token', 'AUTH_FAILED'], ['source-denied-token', 'SOURCE_PERMISSION_DENIED']]) {
      const home = path.join(temporary, expected.toLowerCase());
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
        platform: {
          baseUrl: `http://127.0.0.1:${server.address().port}`,
          tokenEnv: 'TEST_IVX_TOKEN',
          writeMode: 'disabled',
          allowInsecureLocalhost: true,
        },
      }));
      const result = await runCli(home, token, ['migrate', '--nid', '400', '--converter-path', converter]);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).result.status, expected);
      assert.equal(allFileText(home).includes(token), false);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
