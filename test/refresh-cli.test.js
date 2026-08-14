import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { RefreshStore } from '../src/refresh/refresh-store.js';
import { revisionValueDigest } from '../src/reviews/revision-diff.js';

const cli = path.resolve(import.meta.dirname, '..', 'bin', 'ivx-migrate.js');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function run(home, args) {
  const execution = spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  return { execution, payload: JSON.parse(execution.stdout || execution.stderr) };
}

test('Refresh CLI rejects a protocol-6 runtime before loading a Converter or contacting the platform', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-refresh-cli-protocol-'));
  try {
    const home = path.join(temporary, 'home');
    const paths = createAppPaths(home);
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths.current, JSON.stringify({
      schemaVersion: 1,
      workflow: {
        version: '0.5.2',
        artifactSha256: HASH_A,
        compatibility: { agentProtocolVersion: 6 },
      },
      converter: null,
      knowledge: null,
      history: [],
    }), { mode: 0o600 });

    const result = run(home, ['refresh', 'prepare', '--source-nid', '110', '--target-nid', '220']);
    assert.equal(result.execution.status, 1);
    assert.equal(result.payload.code, 'REFRESH_AGENT_PROTOCOL_INCOMPATIBLE');
    assert.equal(fs.existsSync(paths.refreshes), true);
    assert.deepEqual(fs.readdirSync(paths.refreshes), []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Refresh CLI exposes status/list and persists an exact authorization file', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-refresh-cli-'));
  try {
    const home = path.join(temporary, 'home');
    const store = new RefreshStore(createAppPaths(home));
    const runtime = {
      workflow: { version: '0.6.0', sha256: HASH_A },
      converter: { version: '1.2.2', sha256: HASH_B },
      knowledge: { version: '0.1.4', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
    };
    const refresh = store.create({
      sourceNid: 110,
      targetNid: 220,
      lineageJobId: 'mig_20260814040000_abcde',
      runtime,
    });
    const candidate = { case: { id: 'target' }, stage: {}, server: {} };
    store.writeArtifact(refresh.refreshId, 'candidate/app.v5.json', candidate, { pretty: false });
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString();
    const plan = {
      schemaVersion: 2,
      kind: 'refresh-plan',
      planId: 'plan-cli-1',
      refreshId: refresh.refreshId,
      source: { nid: 110, gid: null, workId: 'source-work-1', sha256: HASH_A, classificationArtifact: 'reports/source-version.json' },
      target: {
        nid: 220,
        workId: 'target-work-1',
        sha256: HASH_B,
        configSha256: HASH_A,
        settingsSha256: HASH_B,
        routingSha256: HASH_C,
        lineageJobId: 'mig_20260814040000_abcde',
        classificationArtifact: 'reports/target-version.json',
      },
      runtime,
      candidate: { artifact: 'candidate/app.v5.json', sha256: revisionValueDigest(candidate), validationArtifact: 'reports/validation.json', structuralValidationPassed: true, issueCount: 0, blockerCount: 0 },
      identityRewrite: { sourceNid: 110, targetNid: 220 },
      configurationPolicy: 'PRESERVE_TARGET_CONFIGURATION',
      diagnostics: { manifestArtifact: 'reports/diagnostics-manifest.json', converterDiagnosticsArtifact: null, sha256: HASH_C, total: 0 },
      expiresAt,
      createdAt: createdAt.toISOString(),
      createdBy: 'CLI',
      sensitivity: 'PRIVATE',
    };
    const planned = store.setPlan(refresh.refreshId, plan);
    const authorization = {
      schemaVersion: 2,
      kind: 'refresh-authorization',
      authorizationId: 'auth-cli-1',
      refreshId: refresh.refreshId,
      planId: plan.planId,
      planSha256: planned.planSha256,
      source: { workId: plan.source.workId, sha256: plan.source.sha256 },
      target: {
        nid: plan.target.nid,
        workId: plan.target.workId,
        sha256: plan.target.sha256,
        configSha256: plan.target.configSha256,
        settingsSha256: plan.target.settingsSha256,
        routingSha256: plan.target.routingSha256,
      },
      candidateSha256: plan.candidate.sha256,
      diagnosticsSha256: plan.diagnostics.sha256,
      maxTargetRevisions: 1,
      confirmation: 'REFRESH_EXISTING_V5',
      expiresAt,
      createdAt: createdAt.toISOString(),
      createdBy: 'USER',
      sensitivity: 'PRIVATE',
    };
    const authorizationFile = path.join(temporary, 'authorization.json');
    fs.writeFileSync(authorizationFile, JSON.stringify(authorization), { mode: 0o600 });

    const status = run(home, ['refresh', 'status', '--refresh-id', refresh.refreshId]);
    assert.equal(status.execution.status, 0);
    assert.equal(status.payload.result.status, 'AWAITING_REFRESH_AUTHORIZATION');
    const listed = run(home, ['refresh', 'list', '--target-nid', '220']);
    assert.equal(listed.execution.status, 0);
    assert.deepEqual(listed.payload.result.refreshes.map((entry) => entry.refreshId), [refresh.refreshId]);
    const authorized = run(home, ['refresh', 'authorize', '--refresh-id', refresh.refreshId, '--file', authorizationFile]);
    assert.equal(authorized.execution.status, 0);
    assert.equal(authorized.payload.result.refresh.status, 'REFRESH_READY_TO_APPLY');
    assert.equal(store.load(refresh.refreshId).plan.authorizationId, authorization.authorizationId);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
