import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { RuntimeRegistry } from '../src/releases/runtime-registry.js';
import { reviewRuntimePins, workflowRuntimePinForJob } from '../src/reviews/runtime-pins.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function registry({ current = {}, installed = {} } = {}) {
  return {
    readCurrent: () => ({ workflow: null, converter: null, knowledge: null, ...current }),
    descriptor: (kind, version) => installed[`${kind}:${version}`] || null,
  };
}

function jobWith(workflow) {
  return {
    runtime: {
      workflow,
      converter: { version: '1.2.5', entrySha256: HASH_B },
      knowledge: {
        version: '0.1.5',
        sha256: HASH_C,
        contentSha256: HASH_D,
        schemaVersion: 1,
        ruleIds: ['V4-V5-TEST'],
      },
    },
  };
}

function workflowDescriptor({
  version = '0.7.2',
  packageName = '@ivx/ivx-v4-v5-migration',
  artifactSha256 = HASH_A,
} = {}) {
  return { kind: 'workflow', version, packageName, artifactSha256 };
}

test('Review pins preserve a direct immutable Job digest without consulting installed provenance', () => {
  let descriptorReads = 0;
  const resolved = reviewRuntimePins(jobWith({ version: '0.7.2', packageName: '@ivx/ivx-v4-v5-migration', sha256: HASH_A }), {
    readCurrent: () => { throw new Error('current runtime must not be read for a direct pin'); },
    descriptor: () => { descriptorReads += 1; return null; },
  });
  assert.equal(descriptorReads, 0);
  assert.deepEqual(resolved.workflow, { version: '0.7.2', sha256: HASH_A });
  assert.deepEqual(resolved.knowledge.ruleIds, ['V4-V5-TEST']);
});

test('Review pins recover an exact installed legacy Workflow digest after activation advances', () => {
  const legacy = workflowDescriptor();
  const active = workflowDescriptor({ version: '0.7.3', artifactSha256: HASH_B });
  const resolved = reviewRuntimePins(jobWith({ version: '0.7.2', packageName: legacy.packageName }), registry({
    current: { workflow: active },
    installed: { 'workflow:0.7.2': legacy },
  }));
  assert.deepEqual(resolved.workflow, { version: '0.7.2', sha256: HASH_A });
});

test('Review pins reject conflicting exact and active descriptors for the same legacy version', () => {
  const exact = workflowDescriptor({ artifactSha256: HASH_A });
  const active = workflowDescriptor({ artifactSha256: HASH_B });
  assert.throws(
    () => reviewRuntimePins(jobWith({ version: '0.7.2', packageName: exact.packageName }), registry({
      current: { workflow: active },
      installed: { 'workflow:0.7.2': exact },
    })),
    (error) => error.code === 'REVIEW_RUNTIME_PIN_MISMATCH',
  );
});

test('Review pins reject invalid installed artifact digests', () => {
  const invalid = workflowDescriptor({ artifactSha256: 'not-a-sha256' });
  assert.throws(
    () => reviewRuntimePins(jobWith({ version: '0.7.2', packageName: invalid.packageName }), registry({
      installed: { 'workflow:0.7.2': invalid },
    })),
    (error) => error.code === 'REVIEW_RUNTIME_PIN_MISSING',
  );
});

test('new Job Workflow pins inherit the active artifact digest only for exact identity', () => {
  const active = workflowDescriptor({ version: '0.7.3', artifactSha256: HASH_A });
  const resolved = workflowRuntimePinForJob(registry({ current: { workflow: active } }), {
    version: '0.7.3',
    packageName: active.packageName,
  });
  assert.deepEqual(resolved, { version: '0.7.3', packageName: active.packageName, sha256: HASH_A });
});

test('new Job Workflow pins do not borrow a digest from a different active version', () => {
  const active = workflowDescriptor({ version: '0.7.3', artifactSha256: HASH_A });
  const resolved = workflowRuntimePinForJob(registry({ current: { workflow: active } }), {
    version: '0.7.2',
    packageName: active.packageName,
  });
  assert.deepEqual(resolved, { version: '0.7.2', packageName: active.packageName });
});

test('new Job Workflow pins reject an active package identity contradiction', () => {
  const active = workflowDescriptor({ version: '0.7.3', packageName: '@unexpected/workflow' });
  assert.throws(
    () => workflowRuntimePinForJob(registry({ current: { workflow: active } }), {
      version: '0.7.3',
      packageName: '@ivx/ivx-v4-v5-migration',
    }),
    (error) => error.code === 'REVIEW_RUNTIME_PIN_MISMATCH',
  );
});

test('current CLI Job creation persists the exact active Workflow artifact digest', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-current-cli-job-pin-'));
  const home = path.join(temporary, 'home');
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const runtimeRegistry = new RuntimeRegistry(createAppPaths(home));
  const directory = runtimeRegistry.runtimeDir('workflow', packageJson.version);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, '.ivx-runtime.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'workflow',
    version: packageJson.version,
    packageName: packageJson.name,
    artifactSha256: HASH_A,
    packagePath: projectRoot,
    compatibility: { converter: '>=1.0.0 <2.0.0', agentProtocolVersion: 8 },
  }), { mode: 0o600 });
  runtimeRegistry.activate('workflow', packageJson.version);
  const cliUrl = pathToFileURL(path.join(projectRoot, 'src', 'cli.js')).href;
  const script = `import { runCli } from ${JSON.stringify(cliUrl)}; process.exitCode = await runCli(['job', 'create', '--nid', '12345678']);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: projectRoot,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const job = JSON.parse(result.stdout).result;
    assert.deepEqual(job.runtime.workflow, {
      version: packageJson.version,
      packageName: packageJson.name,
      sha256: HASH_A,
    });
    const privateJob = JSON.parse(fs.readFileSync(path.join(home, 'jobs', job.jobId, 'state.json'), 'utf8'));
    assert.deepEqual(privateJob.runtime.workflow, {
      version: packageJson.version,
      packageName: packageJson.name,
      sha256: HASH_A,
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
