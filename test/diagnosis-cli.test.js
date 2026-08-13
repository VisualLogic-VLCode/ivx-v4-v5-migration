import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { writePrivateJson } from '../src/fs/secure-json.js';
import { JobStore } from '../src/jobs/job-store.js';
import { createAppPaths } from '../src/paths.js';
import { RuntimeReviewStore } from '../src/reviews/review-store.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');
const NOW = '2026-08-13T10:00:00.000Z';

function runCli(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

function createCompletedJob(jobs) {
  let job = jobs.create({ sourceNid: 100, mode: 'platform' });
  for (const status of ['UPDATE_CHECKED', 'AUTHORIZED', 'VERSION_CLASSIFIED']) job = jobs.transition(job.jobId, status);
  job = jobs.transition(job.jobId, 'SOURCE_LOADED', { patch: { source: { workId: 'source-work-1' } } });
  for (const status of ['CONVERTED', 'VALIDATED', 'ISSUES_CLASSIFIED', 'READY_TO_SAVE', 'SAVE_AS_CREATED', 'FINAL_SAVED', 'POST_SAVE_VERIFIED']) job = jobs.transition(job.jobId, status);
  return jobs.transition(job.jobId, 'SUCCEEDED', { patch: { target: { nid: 200, workId: 'target-work-1' } } });
}

test('review diagnosis CLI is recoverable across independent Agent processes', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-diagnosis-cli-'));
  try {
    const paths = createAppPaths(temporary);
    const jobs = new JobStore(paths);
    const job = createCompletedJob(jobs);
    const reviews = new RuntimeReviewStore(paths, { jobs });
    const review = reviews.create({
      jobId: job.jobId,
      capability: 'READ_ONLY',
      runtime: {
        workflow: { version: '0.4.0', sha256: 'a'.repeat(64) },
        converter: { version: '1.2.1', sha256: 'b'.repeat(64) },
        knowledge: { version: '0.1.0', sha256: 'c'.repeat(64), contentSha256: 'd'.repeat(64), schemaVersion: 1, ruleIds: [] },
      },
      targetSnapshot: { value: 'baseline' },
    });
    reviews.transition(review.reviewId, 'ENVIRONMENT_PREFLIGHT');
    reviews.transition(review.reviewId, 'RUNTIME_TESTING');
    reviews.transition(review.reviewId, 'MISMATCH_DETECTED');
    const comparison = {
      schemaVersion: 2,
      kind: 'runtime-comparison',
      comparisonId: 'comparison-cli',
      reviewId: review.reviewId,
      cycleId: 'cycle-cli',
      scenarioId: 'scenario-cli',
      sourceTraceId: 'trace-v4',
      targetTraceId: 'trace-v5',
      environment: { comparisonId: 'env-cli', status: 'ENVIRONMENT_EQUIVALENT' },
      status: 'MISMATCH_DETECTED',
      assertions: [{ assertionId: 'assert-cli', status: 'FAILED', reasonCode: 'NORMALIZED_VALUES_DIFFER', sourceObservationIds: ['obs-v4'], targetObservationIds: ['obs-v5'], normalizations: [] }],
      coverage: { total: 1, passed: 0, failed: 1, inconclusive: 0 },
      runtime: { driver: 'playwright', driverVersion: '1.62.1', sourceBrowserVersion: '140', targetBrowserVersion: '140', modes: ['UNATTENDED'], humanTakeover: false },
      evaluatedAt: NOW,
      createdAt: NOW,
      createdBy: 'CLI',
      sensitivity: 'REDACTED',
    };
    writePrivateJson(path.join(reviews.runtimeCycleDir(review.reviewId, 'cycle-cli'), 'comparisons', 'scenario-cli.json'), comparison);
    const candidate = runCli(temporary, ['review', 'diagnosis-candidates', '--review', review.reviewId]).candidates[0];
    const checkpoint = runCli(temporary, ['review', 'diagnostic-checkpoint', '--review', review.reviewId]);
    const classificationFile = path.join(temporary, 'classification.json');
    const eligibilityFile = path.join(temporary, 'eligibility.json');
    fs.writeFileSync(classificationFile, JSON.stringify({
      schemaVersion: 2,
      kind: 'issue-classification',
      jobId: job.jobId,
      reviewId: review.reviewId,
      classifiedAt: NOW,
      createdBy: 'AGENT',
      sensitivity: 'REDACTED',
      issues: [{
        issueId: candidate.issueId,
        clusterId: 'cluster-cli',
        cause: 'UNKNOWN',
        responsibleParty: 'UNKNOWN',
        repairTarget: 'NONE',
        confidence: 0.4,
        reason: 'Evidence is not sufficient for a unique cause.',
        evidenceRefs: [candidate.evidenceRef],
        knowledgeRuleIds: [],
        autoRepairAllowed: false,
      }],
    }));
    fs.writeFileSync(eligibilityFile, JSON.stringify({
      checkpoint,
      prerequisites: {
        authentication: 'SATISFIED',
        serverPermission: 'SATISFIED',
        userAuthorization: 'MISSING',
        platformWritePath: 'SATISFIED',
        revisionSafety: 'SATISFIED',
        writeOutcomeKnown: 'SATISFIED',
      },
    }));
    const diagnosed = runCli(temporary, ['review', 'diagnose', '--review', review.reviewId, '--file', classificationFile, '--eligibility-file', eligibilityFile]);
    assert.equal(diagnosed.results[0].decision.decision, 'AUTO_REPAIR_STOPPED');
    assert.equal(diagnosed.results[0].eligibility.status, 'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH');
    assert.equal(runCli(temporary, ['review', 'diagnosis-list', '--review', review.reviewId]).diagnoses.length, 1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
