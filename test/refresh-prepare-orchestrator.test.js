import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { JobStore } from '../src/jobs/job-store.js';
import { RefreshPrepareOrchestrator } from '../src/refresh/refresh-prepare-orchestrator.js';
import { RefreshStore } from '../src/refresh/refresh-store.js';

const NOW = new Date('2026-08-14T04:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const sourceNid = 110;
const targetNid = 220;
const runtime = {
  workflow: { version: '0.6.0', sha256: HASH_A },
  converter: { version: '1.2.2', sha256: HASH_B },
  knowledge: { version: '0.1.4', sha256: HASH_C, contentSha256: HASH_A, schemaVersion: 1, ruleIds: [] },
};

function roots(event) {
  return {
    case: { id: 'case-root', type: 'ih5-case', props: { nid: sourceNid }, events: { list: [event] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
}

const v4 = roots({ tree: { type: 'root' } });
const convertedV5 = roots({ ast: { op: 'val', val: true } });
const targetV5 = (() => {
  const value = structuredClone(convertedV5);
  value.case.props.nid = targetNid;
  return value;
})();

function lineageJob(jobs, gid = null, { completed = true } = {}) {
  let job = jobs.create({ sourceNid, gid, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  job = jobs.transition(job.jobId, 'CONVERTED', { patch: { target: { artifact: 'v5/app.v5.json' } } });
  for (const status of ['VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'POST_SAVE_VERIFIED', { patch: { target: { ...job.target, nid: targetNid, workId: 'target-work-1' } } });
  if (!completed) return job;
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { ...job.target, nid: targetNid, workId: 'target-work-1' } } });
}

class FakeAdapter {
  constructor() {
    this.sourceInfo = { nid: sourceNid, gid: 0, memberType: 3, workId: 'source-work-2', edt_ver: '4.1', ntype: 90 };
    this.targetInfo = { nid: targetNid, gid: 0, memberType: 3, workId: 'target-work-1', extra: { ver: 2 }, ntype: 90, previewDomain: 'preview.example' };
    this.targetAllowed = true;
    this.secretConfig = { apiCredentialValue: 'must-not-be-persisted' };
    this.caseInfoCalls = [];
    this.targetPreflightCalls = 0;
  }
  async getCurrentUser() { return { id: 1 }; }
  async getCaseInfo(nid) {
    this.caseInfoCalls.push(nid);
    return structuredClone(nid === sourceNid ? this.sourceInfo : this.targetInfo);
  }
  async preflightTargetUpdate() {
    this.targetPreflightCalls += 1;
    return { allowed: this.targetAllowed, decision: this.targetAllowed ? 'ALLOWED' : 'DENIED', reason: this.targetAllowed ? 'TEST' : 'TARGET_ROLE_NOT_EDITABLE', target: structuredClone(this.targetInfo) };
  }
  async loadWork({ nid }) { return structuredClone(nid === sourceNid ? v4 : targetV5); }
  async getWorkEnvironment() {
    return {
      workInfo: structuredClone(this.targetInfo),
      config: structuredClone(this.secretConfig),
      settings: { previewDomain: 'preview.example', previewPath: '/case' },
    };
  }
}

class FakeConverter {
  constructor() { this.calls = 0; }
  async convert() {
    this.calls += 1;
    return { v5CaseJson: structuredClone(convertedV5), descriptor: { version: '1.2.2' }, diagnostics: null };
  }
}

function fixture({ lineageGid = null } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-refresh-prepare-'));
  const paths = createAppPaths(path.join(temporary, 'home'));
  const jobs = new JobStore(paths);
  const lineage = lineageJob(jobs, lineageGid);
  const refreshes = new RefreshStore(paths, { now: () => new Date(NOW), randomBytes: () => Buffer.from('1234567890', 'hex') });
  const adapter = new FakeAdapter();
  const converter = new FakeConverter();
  const orchestrator = new RefreshPrepareOrchestrator({ refreshes, jobs, adapter, converter, runtime, now: () => new Date(NOW) });
  return { temporary, paths, jobs, lineage, refreshes, adapter, converter, orchestrator };
}

test('Refresh prepare pins current source/target/config, rewrites target identity, and persists no config value', async () => {
  const context = fixture();
  try {
    const prepared = await context.orchestrator.prepare({ sourceNid, targetNid });
    assert.equal(prepared.refresh.status, 'AWAITING_REFRESH_AUTHORIZATION');
    assert.equal(prepared.plan.target.lineageJobId, context.lineage.jobId);
    assert.equal(prepared.plan.configurationPolicy, 'PRESERVE_TARGET_CONFIGURATION');
    const candidate = JSON.parse(fs.readFileSync(path.join(context.refreshes.refreshDir(prepared.refresh.refreshId), 'candidate', 'app.v5.json'), 'utf8'));
    assert.equal(candidate.case.props.nid, targetNid);
    const persisted = fs.readdirSync(context.refreshes.refreshDir(prepared.refresh.refreshId), { recursive: true })
      .filter((entry) => String(entry).endsWith('.json'))
      .map((entry) => fs.readFileSync(path.join(context.refreshes.refreshDir(prepared.refresh.refreshId), entry), 'utf8'))
      .join('\n');
    assert.equal(persisted.includes('must-not-be-persisted'), false);
    assert.equal(context.converter.calls, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare blocks before conversion when target edit permission is denied', async () => {
  const context = fixture();
  context.adapter.targetAllowed = false;
  try {
    await assert.rejects(context.orchestrator.prepare({ sourceNid, targetNid }), { code: 'TARGET_PERMISSION_DENIED' });
    assert.equal(context.converter.calls, 0);
    const blocked = context.refreshes.load(context.refreshes.list({ targetNid })[0].refreshId);
    assert.equal(blocked.status, 'REFRESH_BLOCKED');
    assert.deepEqual(blocked.plan, { planId: null, planSha256: null, artifact: null, authorizationId: null });
    assert.deepEqual(blocked.result, { targetWorkId: null, targetSha256: null, newReviewId: null, supersededReviewIds: [] });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare requires an explicit gid for a Group source', async () => {
  const context = fixture();
  context.adapter.sourceInfo.gid = 99;
  try {
    await assert.rejects(context.orchestrator.prepare({ sourceNid, targetNid }), { code: 'SOURCE_GID_REQUIRED' });
    assert.equal(context.converter.calls, 0);
    assert.deepEqual(context.refreshes.list({ targetNid }), []);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare accepts a Group source only when the trusted lineage has the same gid', async () => {
  const context = fixture({ lineageGid: 99 });
  context.adapter.sourceInfo.gid = 99;
  try {
    const prepared = await context.orchestrator.prepare({ sourceNid, targetNid, gid: 99 });
    assert.equal(prepared.plan.source.gid, 99);
    assert.equal(prepared.plan.target.lineageJobId, context.lineage.jobId);
    assert.equal(context.converter.calls, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare proves a legacy Group lineage with current platform gid without mutating the old Job', async () => {
  const context = fixture({ lineageGid: null });
  context.adapter.sourceInfo.gid = 99;
  const legacyBefore = context.jobs.load(context.lineage.jobId);
  try {
    const prepared = await context.orchestrator.prepare({
      sourceNid,
      targetNid,
      gid: 99,
      lineageJobId: context.lineage.jobId,
    });
    assert.equal(prepared.refresh.source.gid, 99);
    assert.equal(prepared.plan.source.gid, 99);
    assert.equal(prepared.plan.target.lineageJobId, context.lineage.jobId);
    assert.equal(prepared.plan.source.workId, 'source-work-2');
    assert.equal(prepared.plan.target.workId, 'target-work-1');
    assert.equal(prepared.plan.createdAt, NOW.toISOString());
    assert.equal(prepared.plan.expiresAt, '2026-08-14T12:00:00.000Z');
    for (const digest of [
      prepared.plan.source.sha256,
      prepared.plan.target.sha256,
      prepared.plan.target.configSha256,
      prepared.plan.target.settingsSha256,
      prepared.plan.target.routingSha256,
      prepared.plan.candidate.sha256,
      prepared.plan.diagnostics.sha256,
    ]) assert.match(digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(context.jobs.load(context.lineage.jobId), legacyBefore);
    assert.equal(context.converter.calls, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare rejects a legacy Group gid mismatch before creating a Refresh', async () => {
  const context = fixture({ lineageGid: null });
  context.adapter.sourceInfo.gid = 99;
  try {
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid,
      gid: 100,
      lineageJobId: context.lineage.jobId,
    }), { code: 'SOURCE_GID_MISMATCH' });
    assert.deepEqual(context.refreshes.list({ targetNid }), []);
    assert.equal(context.adapter.targetPreflightCalls, 0);
    assert.equal(context.converter.calls, 0);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare does not rebind a historical non-null gid to a different current Group', async () => {
  const context = fixture({ lineageGid: 98 });
  context.adapter.sourceInfo.gid = 99;
  try {
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid,
      gid: 99,
      lineageJobId: context.lineage.jobId,
    }), { code: 'REFRESH_LINEAGE_NOT_FOUND' });
    assert.deepEqual(context.refreshes.list({ targetNid }), []);
    assert.equal(context.adapter.targetPreflightCalls, 0);
    assert.equal(context.converter.calls, 0);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare rejects a gid for a personal source before creating a Refresh', async () => {
  const context = fixture({ lineageGid: null });
  try {
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid,
      gid: 99,
      lineageJobId: context.lineage.jobId,
    }), { code: 'SOURCE_GID_MISMATCH' });
    assert.deepEqual(context.refreshes.list({ targetNid }), []);
    assert.equal(context.adapter.targetPreflightCalls, 0);
    assert.equal(context.converter.calls, 0);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare keeps invalid and incomplete source-target lineage as not found', async () => {
  const context = fixture({ lineageGid: null });
  const incomplete = lineageJob(context.jobs, null, { completed: false });
  try {
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid,
      lineageJobId: incomplete.jobId,
    }), { code: 'REFRESH_LINEAGE_NOT_FOUND' });
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid: targetNid + 1,
      lineageJobId: context.lineage.jobId,
    }), { code: 'REFRESH_LINEAGE_NOT_FOUND' });
    assert.deepEqual(context.refreshes.list({ sourceNid }), []);
    assert.deepEqual(context.adapter.caseInfoCalls, []);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare keeps multiple compatible legacy Group lineages ambiguous', async () => {
  const context = fixture({ lineageGid: null });
  lineageJob(context.jobs, null);
  context.adapter.sourceInfo.gid = 99;
  try {
    await assert.rejects(context.orchestrator.prepare({ sourceNid, targetNid, gid: 99 }), { code: 'REFRESH_LINEAGE_AMBIGUOUS' });
    assert.deepEqual(context.refreshes.list({ targetNid }), []);
    assert.equal(context.adapter.targetPreflightCalls, 0);
    assert.equal(context.converter.calls, 0);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Refresh prepare blocks if the source Group identity changes after compatibility proof', async () => {
  const context = fixture({ lineageGid: null });
  context.adapter.sourceInfo.gid = 99;
  const originalGetCaseInfo = context.adapter.getCaseInfo.bind(context.adapter);
  let sourceReads = 0;
  context.adapter.getCaseInfo = async (nid) => {
    const info = await originalGetCaseInfo(nid);
    if (nid === sourceNid && ++sourceReads > 1) info.gid = 100;
    return info;
  };
  try {
    await assert.rejects(context.orchestrator.prepare({
      sourceNid,
      targetNid,
      gid: 99,
      lineageJobId: context.lineage.jobId,
    }), { code: 'REFRESH_SOURCE_CHANGED' });
    const blocked = context.refreshes.load(context.refreshes.list({ targetNid })[0].refreshId);
    assert.equal(blocked.status, 'REFRESH_BLOCKED');
    assert.deepEqual(blocked.plan, { planId: null, planSha256: null, artifact: null, authorizationId: null });
    assert.deepEqual(blocked.result, { targetWorkId: null, targetSha256: null, newReviewId: null, supersededReviewIds: [] });
    assert.equal(context.converter.calls, 0);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});
