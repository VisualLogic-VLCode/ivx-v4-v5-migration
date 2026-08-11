import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

function invoke(home, args) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin', 'ivx-migrate.js'), ...args], {
    cwd: projectRoot,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

test('Agent classification and constrained Patch return a dry-run Job to validation', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-ai-repair-flow-'));
  const home = path.join(temporary, 'home');
  const converter = path.join(temporary, 'converter');
  fs.mkdirSync(converter);
  fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: '@test/broken-converter', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(converter, 'index.js'), `
    export function convertV4CaseJsonToV5CaseJson({ v4CaseJson }) {
      const output = structuredClone(v4CaseJson);
      output.case.events.list = [{ ast: { op: 'root', args: [{ op: 'jsfn', val: '(() =>', args: [] }] } }];
      return output;
    }
  `);
  const input = path.join(temporary, 'app.json');
  fs.writeFileSync(input, JSON.stringify({
    case: { id: 'case-root', type: 'ih5-case', events: { list: [{ tree: { type: 'root' } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  }));
  try {
    const dryRun = invoke(home, ['dry-run', '--input', input, '--nid', '123', '--converter-path', converter]);
    assert.equal(dryRun.status, 'ISSUES_CLASSIFIED');
    const validation = JSON.parse(fs.readFileSync(path.join(home, 'jobs', dryRun.jobId, 'reports', 'validation.json'), 'utf8'));
    const syntaxIssue = validation.issues.find((issue) => issue.rule === 'JSFN_SYNTAX');
    assert.ok(syntaxIssue);
    const classificationPath = path.join(temporary, 'classification.json');
    fs.writeFileSync(classificationPath, JSON.stringify({
      schemaVersion: 1,
      issues: validation.issues.map((issue) => ({
        issueId: issue.issueId,
        owner: 'SOURCE',
        confidence: 0.95,
        reason: 'Test-only source repair flow',
        repairAllowed: true,
      })),
    }));
    const classified = invoke(home, ['job', 'classify', '--job', dryRun.jobId, '--file', classificationPath]);
    assert.equal(classified.status, 'AI_REPAIR_REQUIRED');
    const patchPath = path.join(temporary, 'repair.json');
    fs.writeFileSync(patchPath, JSON.stringify([
      { op: 'replace', path: '/case/events/list/0/ast/args/0/val', value: '() => null' },
    ]));
    const repaired = invoke(home, ['job', 'apply-patch', '--job', dryRun.jobId, '--file', patchPath]);
    assert.equal(repaired.status, 'DRY_RUN_SUCCEEDED');
    assert.equal(fs.existsSync(path.join(home, 'jobs', dryRun.jobId, 'v5', 'app.v5.patched.json')), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
