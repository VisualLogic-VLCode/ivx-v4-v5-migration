import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(projectRoot, 'bin', 'ivx-migrate.js');

function runCli({ home, cwd }, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, IVX_MIGRATION_HOME: home },
    encoding: 'utf8',
  });
}

function resultJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).result;
}

test('managed CLI inventories ignore stale Agent planning prose', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-managed-state-authority-'));
  const home = path.join(temporary, 'home');
  try {
    fs.writeFileSync(path.join(temporary, 'task_plan.md'), '# prior run\nJob mig_20260825000000_stale is SUCCEEDED\n');
    fs.writeFileSync(path.join(temporary, 'findings.md'), 'target V5 nid 12232615 exists\n');
    fs.writeFileSync(path.join(temporary, 'progress.md'), 'Review rev_20260825000000_stale was created\n');

    assert.deepEqual(resultJson(runCli({ home, cwd: temporary }, ['job', 'list'])), { jobs: [] });
    assert.deepEqual(resultJson(runCli({ home, cwd: temporary }, ['refresh', 'list'])), { refreshes: [] });
    assert.deepEqual(resultJson(runCli({ home, cwd: temporary }, ['review', 'list'])), { reviews: [] });

    const missing = runCli({ home, cwd: temporary }, ['job', 'status', '--job', 'mig_20260825000000_stale']);
    assert.notEqual(missing.status, 0);
    assert.equal(JSON.parse(missing.stderr).code, 'JOB_NOT_FOUND');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI help exposes the authoritative managed Job inventory', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-managed-state-help-'));
  try {
    const help = resultJson(runCli({ home: path.join(temporary, 'home'), cwd: temporary }, ['help']));
    assert.ok(help.usage.includes('ivx-migrate job list'));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('distributed Agent Skills require managed inventories and reject prose-derived lineage', () => {
  for (const relativePath of ['agents/codex/SKILL.md', 'agents/claude/SKILL.md']) {
    const skill = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.match(skill, /job list/);
    assert.match(skill, /refresh list/);
    assert.match(skill, /review list/);
    assert.match(skill, /planning (?:files|documents)/i);
    assert.match(skill, /conversation history/i);
    assert.match(skill, /not (?:managed state|authoritative|establish managed lineage)/i);
    assert.match(skill, /platform V5/i);
  }
});

test('user guidance distinguishes managed state from workspace history', () => {
  for (const relativePath of [
    'docs/AI-USER-GUIDE.md',
    'docs/QUICKSTART.md',
    'docs/templates/AI-AGENT-STARTER-PROMPT.md',
  ]) {
    const guide = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.match(guide, /job list/);
    assert.match(guide, /task_plan\.md/);
    assert.match(guide, /(?:不是|不能作为).*(?:受管状态|正式记录|谱系)/);
  }
});
