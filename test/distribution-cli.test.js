import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { sha256File } from '../src/fs/secure-json.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');

function pack(root) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.join(root, JSON.parse(result.stdout)[0].filename);
}

function createWorkflowPackage(root, version, protocolVersion) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: '@test/workflow',
    version,
    type: 'module',
    files: ['src', 'agents'],
  }));
  fs.writeFileSync(path.join(root, 'src', 'cli.js'), `export { runCli } from ${JSON.stringify(pathToFileURL(path.join(projectRoot, 'src', 'cli.js')).href)};\n`);
  fs.writeFileSync(path.join(root, 'agents', 'codex', 'SKILL.md'), `codex protocol ${protocolVersion}\n`);
  fs.writeFileSync(path.join(root, 'agents', 'claude', 'SKILL.md'), `claude protocol ${protocolVersion}\n`);
  return pack(root);
}

function createConverterPackage(root, version) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: '@test/converter',
    version,
    type: 'module',
    files: ['index.js'],
  }));
  fs.writeFileSync(path.join(root, 'index.js'), `
    export function convertV4CaseJsonToV5CaseJson({ v4CaseJson }) {
      const output = structuredClone(v4CaseJson);
      for (const root of [output.case, output.stage, output.server]) {
        for (const event of root?.events?.list || []) {
          delete event.tree;
          event.ast = { op: 'root', args: [] };
        }
      }
      return output;
    }
    export function convertV4CaseJsonToV5CaseJsonDetailed(args) {
      return {
        v5CaseJson: convertV4CaseJsonToV5CaseJson(args),
        diagnostics: {
          schemaVersion: 1,
          kind: 'tov5parser-conversion-diagnostics',
          summary: {
            total: 0, droppedTotal: 0, customExprTotal: 0, uniqueTotal: 0,
            returnedRecordCount: 0, truncated: false,
            categoryTruncated: false, phaseTruncated: false,
          },
          records: [],
        },
      };
    }
  `);
  return pack(root);
}

function descriptor(packageName, tarball, extra = {}) {
  return {
    packageName,
    artifact: { url: tarball, sha256: sha256File(tarball) },
    ...extra,
  };
}

function writeManifest(file, kind, latest, versions) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    kind,
    channel: 'stable',
    latest,
    minimumSupported: null,
    revoked: [],
    versions,
  }));
}

function run(args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

function runFailure(args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stdout);
  return JSON.parse(result.stderr);
}

test('setup, managed converter updates, Agent protocol sync, and rollback work in a clean home', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-distribution-cli-'));
  const home = path.join(temporary, 'home');
  const codexHome = path.join(temporary, 'codex');
  const claudeHome = path.join(temporary, 'claude');
  const workflowManifest = path.join(temporary, 'workflow-stable.json');
  const converterManifest = path.join(temporary, 'converter-stable.json');
  const tokenFile = path.join(temporary, 'platform.token');
  const token = 'setup-file-token-must-not-be-printed';
  const workflow100 = createWorkflowPackage(path.join(temporary, 'workflow-1.0.0'), '1.0.0', 1);
  const converter100 = createConverterPackage(path.join(temporary, 'converter-1.0.0'), '1.0.0');
  const env = {
    ...process.env,
    IVX_MIGRATION_HOME: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: claudeHome,
  };
  try {
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    fs.chmodSync(tokenFile, 0o600);
    assert.equal(run(['version'], env).agentProtocolVersion, 8);
    writeManifest(workflowManifest, 'workflow', '1.0.0', {
      '1.0.0': descriptor('@test/workflow', workflow100, {
        compatibleConverter: '>=1.0.0 <2.0.0',
        agentProtocolVersion: 1,
        jobSchemaVersion: 1,
      }),
    });
    writeManifest(converterManifest, 'converter', '1.0.0', {
      '1.0.0': descriptor('@test/converter', converter100, {
        compatibleWorkflow: '>=1.0.0 <2.0.0',
        capabilities: { diagnostics: true },
      }),
    });

    const setup = run([
      'setup',
      '--workflow-manifest', workflowManifest,
      '--converter-manifest', converterManifest,
      '--allow-unsigned-local', 'true',
      '--token-file', tokenFile,
    ], env);
    assert.deepEqual(setup.runtimes.installed.map((item) => `${item.kind}:${item.version}`), [
      'workflow:1.0.0',
      'converter:1.0.0',
    ]);
    assert.equal(setup.agents.protocolVersion, 1);
    assert.equal(setup.platform.baseUrl, 'https://dev.ivx.cn');
    assert.equal(setup.platform.tokenFile, tokenFile);
    assert.equal(setup.platform.tokenSource, 'file');
    assert.equal(setup.platform.tokenAvailable, true);
    assert.equal(setup.platform.tokenError, null);
    assert.equal(JSON.stringify(setup).includes(token), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).platform.baseUrl, 'https://dev.ivx.cn');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).platform.tokenFile, tokenFile);
    assert.equal(fs.readFileSync(path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'), 'utf8'), 'codex protocol 1\n');

    const initialDoctor = run(['doctor'], env);
    assert.equal(initialDoctor.platformConfigured, true);
    assert.equal(initialDoctor.platformBaseUrl, 'https://dev.ivx.cn');
    assert.equal(initialDoctor.tokenAvailable, true);
    assert.equal(initialDoctor.tokenSource, 'file');
    assert.equal(initialDoctor.tokenFile, tokenFile);
    assert.equal(initialDoctor.tokenError, null);
    assert.equal(JSON.stringify(initialDoctor).includes(token), false);

    const customizedSetup = run([
      'setup',
      '--workflow-manifest', workflowManifest,
      '--converter-manifest', converterManifest,
      '--allow-unsigned-local', 'true',
      '--platform-base-url', 'https://editor.example.test/',
    ], env);
    assert.equal(customizedSetup.platform.baseUrl, 'https://editor.example.test');
    assert.equal(run(['doctor'], env).platformBaseUrl, 'https://editor.example.test');

    const repeatedSetup = run([
      'setup',
      '--workflow-manifest', workflowManifest,
      '--converter-manifest', converterManifest,
      '--allow-unsigned-local', 'true',
    ], env);
    assert.equal(repeatedSetup.platform.baseUrl, 'https://editor.example.test');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).platform.baseUrl, 'https://editor.example.test');

    const workFile = path.join(temporary, 'work.json');
    const metadataFile = path.join(temporary, 'metadata.json');
    fs.writeFileSync(workFile, JSON.stringify({
      case: { id: 'case-root', type: 'ih5-case', events: { list: [{ tree: { type: 'root', children: [] } }] } },
      stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
      server: { id: 'server-root', type: 'server', events: { list: [] } },
    }));
    fs.writeFileSync(metadataFile, JSON.stringify({ edtVer: '4.1', ntype: 1 }));
    const dryRun = run(['dry-run', '--input', workFile, '--metadata', metadataFile, '--nid', '12345678'], env);
    assert.equal(dryRun.status, 'DRY_RUN_SUCCEEDED');
    assert.equal(dryRun.runtime.converter.version, '1.0.0');

    const converter110 = createConverterPackage(path.join(temporary, 'converter-1.1.0'), '1.1.0');
    writeManifest(converterManifest, 'converter', '1.1.0', {
      '1.0.0': descriptor('@test/converter', converter100, { compatibleWorkflow: '>=1.0.0 <2.0.0' }),
      '1.1.0': descriptor('@test/converter', converter110, {
        compatibleWorkflow: '>=1.0.0 <2.0.0',
        capabilities: { diagnostics: true },
      }),
    });
    const updateCheck = run(['update', 'check'], env);
    assert.equal(updateCheck.runtimes.converter.status, 'UPDATE_AVAILABLE');
    const converterUpdate = run(['update', 'apply', '--kind', 'converter'], env);
    assert.equal(converterUpdate.runtimes.current.converter.version, '1.1.0');
    assert.equal(converterUpdate.runtimes.restartRequired, false);

    const workflow110 = createWorkflowPackage(path.join(temporary, 'workflow-1.1.0'), '1.1.0', 2);
    writeManifest(workflowManifest, 'workflow', '1.1.0', {
      '1.0.0': descriptor('@test/workflow', workflow100, { agentProtocolVersion: 1 }),
      '1.1.0': descriptor('@test/workflow', workflow110, {
        compatibleConverter: '>=1.0.0 <2.0.0',
        agentProtocolVersion: 2,
        jobSchemaVersion: 1,
      }),
    });
    const converter200 = createConverterPackage(path.join(temporary, 'converter-2.0.0'), '2.0.0');
    writeManifest(converterManifest, 'converter', '2.0.0', {
      '1.0.0': descriptor('@test/converter', converter100, { compatibleWorkflow: '>=1.0.0 <2.0.0' }),
      '1.1.0': descriptor('@test/converter', converter110, { compatibleWorkflow: '>=1.0.0 <2.0.0' }),
      '2.0.0': descriptor('@test/converter', converter200, { compatibleWorkflow: '>=2.0.0 <3.0.0' }),
    });
    const workflowUpdate = run(['update', 'apply', '--kind', 'workflow'], env);
    assert.equal(workflowUpdate.runtimes.current.workflow.version, '1.1.0');
    assert.equal(workflowUpdate.runtimes.current.converter.version, '1.1.0');
    assert.equal(workflowUpdate.runtimes.restartRequired, true);
    assert.equal(workflowUpdate.agents.protocolVersion.installed, 2);
    assert.equal(fs.readFileSync(path.join(claudeHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'), 'utf8'), 'claude protocol 2\n');

    fs.appendFileSync(path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'), 'local customization\n');
    const conflictedRollback = runFailure(['rollback', '--kind', 'workflow'], env);
    assert.equal(conflictedRollback.code, 'AGENT_FILE_CONFLICT');
    assert.equal(run(['doctor'], env).workflow.version, '1.1.0');
    fs.writeFileSync(path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'), 'codex protocol 2\n');

    const workflowRollback = run(['rollback', '--kind', 'workflow'], env);
    assert.equal(workflowRollback.current.workflow.version, '1.0.0');
    assert.equal(workflowRollback.restartRequired, true);
    assert.equal(workflowRollback.agents.protocolVersion.desired, 1);
    assert.equal(workflowRollback.agents.protocolVersion.installed, 1);
    assert.equal(workflowRollback.agents.current, true);
    assert.equal(fs.readFileSync(path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'), 'utf8'), 'codex protocol 1\n');
    const rollbackDoctor = run(['doctor'], env);
    assert.equal(rollbackDoctor.workflow.version, '1.0.0');
    assert.equal(rollbackDoctor.agents.protocolVersion.installed, 1);
    assert.equal(rollbackDoctor.agents.current, true);

    const repeatedWorkflowUpdate = run(['update', 'apply', '--kind', 'workflow'], env);
    assert.equal(repeatedWorkflowUpdate.runtimes.current.workflow.version, '1.1.0');
    assert.equal(repeatedWorkflowUpdate.agents.protocolVersion.installed, 2);
    const releaseWorkflowRollback = run(['release', 'rollback', '--kind', 'workflow'], env);
    assert.equal(releaseWorkflowRollback.current.workflow.version, '1.0.0');
    assert.equal(releaseWorkflowRollback.agents.protocolVersion.installed, 1);
    assert.equal(releaseWorkflowRollback.agents.current, true);

    const rollback = run(['rollback', '--kind', 'converter'], env);
    assert.equal(rollback.current.converter.version, '1.0.0');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('setup rejects an incompatible runtime pair before installing either package', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-distribution-incompatible-'));
  const home = path.join(temporary, 'home');
  const workflowManifest = path.join(temporary, 'workflow-stable.json');
  const converterManifest = path.join(temporary, 'converter-stable.json');
  const workflow = createWorkflowPackage(path.join(temporary, 'workflow-1.0.0'), '1.0.0', 1);
  const converter = createConverterPackage(path.join(temporary, 'converter-2.0.0'), '2.0.0');
  const env = {
    ...process.env,
    IVX_MIGRATION_HOME: home,
    CODEX_HOME: path.join(temporary, 'codex'),
    CLAUDE_HOME: path.join(temporary, 'claude'),
  };
  try {
    writeManifest(workflowManifest, 'workflow', '1.0.0', {
      '1.0.0': descriptor('@test/workflow', workflow, {
        compatibleConverter: '>=1.0.0 <2.0.0',
        agentProtocolVersion: 1,
      }),
    });
    writeManifest(converterManifest, 'converter', '2.0.0', {
      '2.0.0': descriptor('@test/converter', converter, {
        compatibleWorkflow: '>=1.0.0 <2.0.0',
      }),
    });

    const failure = runFailure([
      'setup',
      '--workflow-manifest', workflowManifest,
      '--converter-manifest', converterManifest,
      '--allow-unsigned-local', 'true',
    ], env);
    assert.equal(failure.code, 'RUNTIME_VERSION_INCOMPATIBLE');
    assert.equal(fs.existsSync(path.join(home, 'current.json')), false);
    assert.deepEqual(fs.readdirSync(path.join(home, 'workflows')), []);
    assert.deepEqual(fs.readdirSync(path.join(home, 'converters')), []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('setup rejects an insecure external platform address before installing runtimes', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-distribution-insecure-platform-'));
  const home = path.join(temporary, 'home');
  const env = {
    ...process.env,
    IVX_MIGRATION_HOME: home,
    CODEX_HOME: path.join(temporary, 'codex'),
    CLAUDE_HOME: path.join(temporary, 'claude'),
  };
  try {
    const failure = runFailure([
      'setup',
      '--platform-base-url', 'http://dev.ivx.cn',
    ], env);
    assert.equal(failure.code, 'PLATFORM_BASE_URL_INSECURE');
    assert.equal(fs.existsSync(path.join(home, 'config.json')), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('setup rejects an unsafe token file before saving config or installing runtimes', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-distribution-insecure-token-'));
  const home = path.join(temporary, 'home');
  const tokenFile = path.join(temporary, 'platform.token');
  fs.writeFileSync(tokenFile, 'secret', { mode: 0o644 });
  fs.chmodSync(tokenFile, 0o644);
  const env = {
    ...process.env,
    IVX_MIGRATION_HOME: home,
    CODEX_HOME: path.join(temporary, 'codex'),
    CLAUDE_HOME: path.join(temporary, 'claude'),
  };
  try {
    const failure = runFailure(['setup', '--token-file', tokenFile], env);
    assert.equal(failure.code, 'TOKEN_FILE_PERMISSIONS_INVALID');
    assert.equal(fs.existsSync(path.join(home, 'config.json')), false);

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
      platform: { tokenFile },
    }), { mode: 0o600 });
    const doctor = run(['doctor'], env);
    assert.equal(doctor.tokenAvailable, false);
    assert.equal(doctor.tokenSource, 'file');
    assert.equal(doctor.tokenFile, tokenFile);
    assert.equal(doctor.tokenError.code, 'TOKEN_FILE_PERMISSIONS_INVALID');
    assert.equal(JSON.stringify(doctor).includes('secret'), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
