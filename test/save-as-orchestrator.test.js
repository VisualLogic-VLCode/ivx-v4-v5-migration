import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppPaths } from '../src/paths.js';
import { JobStore } from '../src/jobs/job-store.js';
import { MIGRATION_INTENTS } from '../src/jobs/intents.js';
import { SAVE_INTENTS, SaveAsOrchestrator, rewriteCaseNidForFinalSave } from '../src/platform/save-as-orchestrator.js';

const sourceNid = 123;
const targetNid = 456;
const converted = {
  case: { id: 'case', type: 'ih5-case', uis: { revertVersion: 2 }, props: { nid: 123 } },
  stage: { id: 'stage', type: 'stage', props: { ref: 'n123_table', modDbId: 'n123_mod' } },
  server: { id: 'server', type: 'server' },
};

function readyJob(jobs, { intent = MIGRATION_INTENTS.CREATE_V5, relatedPriorJobIds = [] } = {}) {
  let job = jobs.create({ sourceNid, intent, relatedPriorJobIds, workflowRuntime: { version: '1.0.0' }, converterRuntime: { version: '2.0.0' }, mode: 'platform' });
  job = jobs.transition(job.jobId, 'UPDATE_CHECKED');
  job = jobs.transition(job.jobId, 'AUTHORIZED');
  job = jobs.transition(job.jobId, 'VERSION_CLASSIFIED');
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-7', inputSha256: 'a'.repeat(64) } } });
  job = jobs.transition(job.jobId, 'CONVERTED', { patch: { target: { artifact: 'v5/app.v5.json' } } });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', converted, { pretty: false });
  job = jobs.transition(job.jobId, 'VALIDATED');
  job = jobs.transition(job.jobId, 'ISSUES_CLASSIFIED');
  return jobs.transition(job.jobId, 'READY_TO_SAVE');
}

function completeReadyJob(jobs, job, nid) {
  for (const status of ['SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid, workId: `target-work-${nid}` } } });
}

function diagnosticReadyJob(jobs) {
  let job = jobs.create({ sourceNid, workflowRuntime: { version: '1.0.0' }, converterRuntime: { version: '2.0.0' }, mode: 'platform' });
  job = jobs.transition(job.jobId, 'UPDATE_CHECKED');
  job = jobs.transition(job.jobId, 'AUTHORIZED');
  job = jobs.transition(job.jobId, 'VERSION_CLASSIFIED');
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-7', inputSha256: 'a'.repeat(64) } } });
  job = jobs.transition(job.jobId, 'CONVERTED', { patch: { target: { artifact: 'v5/app.v5.json' } } });
  jobs.writeArtifact(job.jobId, 'v5/app.v5.json', converted, { pretty: false });
  job = jobs.transition(job.jobId, 'VALIDATED');
  job = jobs.transition(job.jobId, 'ISSUES_CLASSIFIED');
  job = jobs.transition(job.jobId, 'BLOCKED_CONVERTER_DEFECT');
  jobs.writeArtifact(job.jobId, 'reports/diagnostic-save-authorization.json', {
    schemaVersion: 1,
    kind: 'known-issues-diagnostic-save-authorization',
    jobId: job.jobId,
    sourceStatus: 'BLOCKED_CONVERTER_DEFECT',
    confirmation: 'SAVE_V5_WITH_KNOWN_ISSUES',
  });
  return jobs.transition(job.jobId, 'READY_TO_SAVE_DIAGNOSTIC_COPY', {
    patch: {
      diagnosticSave: {
        kind: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
        authorizationArtifact: 'reports/diagnostic-save-authorization.json',
      },
    },
  });
}

class FakeAdapter {
  constructor() {
    this.sourceInfo = { nid: sourceNid, gid: 0, memberType: 1, workId: 'source-work-7' };
    this.targetInfo = { nid: targetNid, gid: 0, memberType: 1, workId: 'target-work-0' };
    this.sourceConfig = { customVars: { kept: 'yes' } };
    this.defaultConfig = { default: true, wechat: { noJs: false } };
    this.targetConfig = {};
    this.targetWork = structuredClone(converted);
    this.calls = { create: 0, config: 0, save: 0 };
    this.failFinalOnceAfterWrite = false;
    this.failConfigOnceAfterWrite = false;
    this.failCreateOutcome = false;
    this.invalidCreateResponse = false;
    this.forcePostSaveMismatch = false;
    this.permissionDecision = { allowed: true, decision: 'ALLOWED', reason: 'TEST' };
  }

  async preflightSaveAs() { return structuredClone(this.permissionDecision); }
  async recheckSourceRevision({ workId }) { return { unchanged: workId === this.sourceInfo.workId, expectedWorkId: workId, currentWorkId: this.sourceInfo.workId }; }
  async getDefaultUserConfig() { return structuredClone(this.defaultConfig); }
  async getWorkConfig(nid) { return structuredClone(nid === sourceNid ? this.sourceConfig : this.targetConfig); }
  async setWorkConfig(_nid, config) {
    this.calls.config += 1;
    this.targetConfig = structuredClone(config);
    if (this.failConfigOnceAfterWrite) {
      this.failConfigOnceAfterWrite = false;
      throw Object.assign(new Error('config response lost'), { code: 'PLATFORM_NETWORK_FAILED' });
    }
    return {};
  }
  async saveAsV5() {
    this.calls.create += 1;
    if (this.failCreateOutcome) throw Object.assign(new Error('connection lost'), { code: 'PLATFORM_NETWORK_FAILED' });
    if (this.invalidCreateResponse) return {};
    return structuredClone(this.targetInfo);
  }
  async getCaseInfo(nid) { return structuredClone(nid === sourceNid ? this.sourceInfo : this.targetInfo); }
  async loadWork({ nid }) { return structuredClone(nid === sourceNid ? converted : this.targetWork); }
  async saveWork({ work }) {
    this.calls.save += 1;
    this.targetInfo.workId = `target-work-${this.calls.save}`;
    this.targetWork = this.forcePostSaveMismatch ? structuredClone(converted) : structuredClone(work);
    if (this.failFinalOnceAfterWrite) {
      this.failFinalOnceAfterWrite = false;
      throw Object.assign(new Error('response lost'), { code: 'PLATFORM_NETWORK_FAILED', details: { outcome: 'UNKNOWN_AFTER_WRITE_ATTEMPT' } });
    }
    return structuredClone(this.targetInfo);
  }
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-save-as-'));
  const jobs = new JobStore(createAppPaths(path.join(temporary, 'home')));
  const job = readyJob(jobs);
  const adapter = new FakeAdapter();
  return { temporary, jobs, job, adapter, orchestrator: new SaveAsOrchestrator({ jobs, adapter }) };
}

test('resumable Save As completes creation, config, nid rewrite, save, and read-back', async () => {
  const context = fixture();
  try {
    const result = await context.orchestrator.run(context.job.jobId);
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.target.nid, targetNid);
    assert.deepEqual(context.adapter.calls, { create: 1, config: 1, save: 1 });
    assert.equal(context.adapter.targetWork.case.props.nid, targetNid);
    assert.equal(context.adapter.targetWork.stage.props.ref, 'n456_table');
    assert.equal(context.adapter.targetWork.stage.props.modDbId, 'n123_mod');
    assert.equal(Object.hasOwn(context.adapter.targetWork.case.uis, 'revertVersion'), false);
    const journal = JSON.parse(fs.readFileSync(context.orchestrator.journalFile(context.job.jobId), 'utf8'));
    assert.equal(journal.phase, 'POST_SAVE_VERIFIED');
    assert.equal(JSON.stringify(journal).includes('kept'), false);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('Additional V5 Save As rejects and checkpoints a non-distinct prior target nid without replay', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-additional-save-as-'));
  const jobs = new JobStore(createAppPaths(path.join(temporary, 'home')));
  const prior = completeReadyJob(jobs, readyJob(jobs), targetNid);
  const additional = readyJob(jobs, {
    intent: MIGRATION_INTENTS.CREATE_ADDITIONAL_V5,
    relatedPriorJobIds: [prior.jobId],
  });
  const adapter = new FakeAdapter();
  const orchestrator = new SaveAsOrchestrator({ jobs, adapter });
  try {
    await assert.rejects(orchestrator.run(additional.jobId), { code: 'SAVE_AS_TARGET_IDENTITY_CONFLICT' });
    assert.equal(jobs.load(additional.jobId).status, 'SAVE_INCOMPLETE');
    const journal = JSON.parse(fs.readFileSync(orchestrator.journalFile(additional.jobId), 'utf8'));
    assert.equal(journal.phase, 'TARGET_IDENTITY_CONFLICT');
    assert.equal(journal.target.nid, targetNid);
    await assert.rejects(orchestrator.run(additional.jobId), { code: 'SAVE_AS_TARGET_IDENTITY_CONFLICT' });
    assert.equal(adapter.calls.create, 1);
    assert.equal(adapter.calls.config, 0);
    assert.equal(adapter.calls.save, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('diagnostic Save As preserves its intent and completes as a diagnostic copy instead of success', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-diagnostic-save-as-'));
  const jobs = new JobStore(createAppPaths(path.join(temporary, 'home')));
  const job = diagnosticReadyJob(jobs);
  const adapter = new FakeAdapter();
  const diagnostic = new SaveAsOrchestrator({
    jobs,
    adapter,
    saveIntent: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
  });
  try {
    const result = await diagnostic.run(job.jobId);
    assert.equal(result.status, 'DIAGNOSTIC_COPY_CREATED');
    assert.equal(result.target.nid, targetNid);
    assert.equal(result.diagnosticSave.result, 'CREATED');
    const journal = JSON.parse(fs.readFileSync(diagnostic.journalFile(job.jobId), 'utf8'));
    assert.equal(journal.intent.kind, SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC);
    assert.equal(journal.intent.authorizationArtifact, 'reports/diagnostic-save-authorization.json');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('validated and diagnostic Save As paths cannot resume each other', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-save-intent-'));
  const jobs = new JobStore(createAppPaths(path.join(temporary, 'home')));
  const job = diagnosticReadyJob(jobs);
  const adapter = new FakeAdapter();
  const diagnostic = new SaveAsOrchestrator({
    jobs,
    adapter,
    saveIntent: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
  });
  adapter.failFinalOnceAfterWrite = true;
  try {
    await assert.rejects(diagnostic.run(job.jobId), { code: 'FINAL_SAVE_OUTCOME_UNKNOWN' });
    assert.equal(jobs.load(job.jobId).status, 'SAVE_INCOMPLETE');
    await assert.rejects(new SaveAsOrchestrator({ jobs, adapter }).run(job.jobId), { code: 'SAVE_INTENT_MISMATCH' });
    const result = await diagnostic.run(job.jobId);
    assert.equal(result.status, 'DIAGNOSTIC_COPY_CREATED');
    assert.equal(adapter.calls.create, 1);
    assert.equal(adapter.calls.save, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('diagnostic Save As refuses to start without its persisted authorization', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-save-authorization-'));
  const jobs = new JobStore(createAppPaths(path.join(temporary, 'home')));
  const job = diagnosticReadyJob(jobs);
  const adapter = new FakeAdapter();
  fs.unlinkSync(path.join(jobs.jobDir(job.jobId), 'reports', 'diagnostic-save-authorization.json'));
  try {
    await assert.rejects(new SaveAsOrchestrator({
      jobs,
      adapter,
      saveIntent: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
    }).run(job.jobId), { code: 'DIAGNOSTIC_SAVE_AUTHORIZATION_MISSING' });
    assert.deepEqual(adapter.calls, { create: 0, config: 0, save: 0 });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('unknown final-save response resumes by read-back without creating or saving again', async () => {
  const context = fixture();
  context.adapter.failFinalOnceAfterWrite = true;
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'FINAL_SAVE_OUTCOME_UNKNOWN' });
    assert.equal(context.jobs.load(context.job.jobId).status, 'SAVE_INCOMPLETE');
    const result = await context.orchestrator.run(context.job.jobId);
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(context.adapter.calls, { create: 1, config: 1, save: 1 });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('unknown config response resumes by config read-back without replaying creation or config write', async () => {
  const context = fixture();
  context.adapter.failConfigOnceAfterWrite = true;
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'PLATFORM_NETWORK_FAILED' });
    assert.equal(context.jobs.load(context.job.jobId).status, 'SAVE_INCOMPLETE');
    const result = await context.orchestrator.run(context.job.jobId);
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(context.adapter.calls, { create: 1, config: 1, save: 1 });
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('unknown target creation outcome is never replayed automatically', async () => {
  const context = fixture();
  context.adapter.failCreateOutcome = true;
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'SAVE_AS_OUTCOME_UNKNOWN' });
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'SAVE_AS_RECONCILIATION_REQUIRED' });
    assert.equal(context.adapter.calls.create, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('unknown group permission never reaches target creation', async () => {
  const context = fixture();
  context.adapter.permissionDecision = { allowed: false, decision: 'UNKNOWN', reason: 'UNKNOWN_SERVER_POLICY' };
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'TARGET_PERMISSION_UNKNOWN' });
    assert.equal(context.adapter.calls.create, 0);
    assert.equal(context.jobs.load(context.job.jobId).status, 'READY_TO_SAVE');
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('incomplete target creation response is treated as unknown and never replayed', async () => {
  const context = fixture();
  context.adapter.invalidCreateResponse = true;
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'SAVE_AS_OUTCOME_UNKNOWN' });
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'SAVE_AS_RECONCILIATION_REQUIRED' });
    assert.equal(context.adapter.calls.create, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('post-save mismatch remains incomplete and is not reported as success', async () => {
  const context = fixture();
  context.adapter.forcePostSaveMismatch = true;
  try {
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'POST_SAVE_VERIFICATION_FAILED' });
    assert.equal(context.jobs.load(context.job.jobId).status, 'SAVE_INCOMPLETE');
    await assert.rejects(context.orchestrator.run(context.job.jobId), { code: 'POST_SAVE_RECONCILIATION_REQUIRED' });
    assert.equal(context.adapter.calls.save, 1);
  } finally {
    fs.rmSync(context.temporary, { recursive: true, force: true });
  }
});

test('nid rewrite mirrors editor behavior while preserving modDbId source ownership', () => {
  const rewritten = rewriteCaseNidForFinalSave(converted, sourceNid, targetNid);
  assert.equal(rewritten.stage.props.ref, 'n456_table');
  assert.equal(rewritten.stage.props.modDbId, 'n123_mod');
});
