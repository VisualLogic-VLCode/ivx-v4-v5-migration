import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('CLI dry-run completes without platform access and pins converter version', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-cli-dry-run-'));
  const converter = path.join(temporary, 'converter');
  fs.mkdirSync(converter);
  fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: '@test/converter', version: '9.9.9', type: 'module' }));
  fs.writeFileSync(path.join(converter, 'index.js'), `
    export function loadRuntimeMaps() {}
    export function convertV4CaseJsonToV5CaseJson({ v4CaseJson }) {
      const output = structuredClone(v4CaseJson);
      const stack = [output];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (value.events && Array.isArray(value.events.list)) {
          value.events.list = value.events.list.map((event) =>
            event.tree ? { ast: { op: 'root', args: [] } } : event
          );
        }
        for (const child of Object.values(value)) stack.push(child);
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
  const work = {
    case: { id: 'case-root', type: 'ih5-case', events: { list: [{ tree: { type: 'root', children: [] } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
  const input = path.join(temporary, 'app.json');
  fs.writeFileSync(input, JSON.stringify(work));
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, 'bin', 'ivx-migrate.js'),
      'dry-run', '--input', input, '--nid', '12345678', '--converter-path', converter,
    ], {
      cwd: projectRoot,
      env: { ...process.env, IVX_MIGRATION_HOME: path.join(temporary, 'home') },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.result.status, 'DRY_RUN_SUCCEEDED');
    assert.equal(output.result.runtime.converter.version, '9.9.9');
    const jobDir = path.join(temporary, 'home', 'jobs', output.result.jobId);
    assert.equal(fs.existsSync(path.join(jobDir, 'v5', 'app.v5.json')), true);
    assert.equal(fs.existsSync(path.join(jobDir, 'reports', 'validation.json')), true);
    assert.equal(fs.existsSync(path.join(jobDir, 'reports', 'converter-diagnostics.json')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(jobDir, 'reports', 'conversion-manifest.json'), 'utf8'));
    assert.equal(manifest.diagnosticsAvailable, true);
    assert.equal(manifest.diagnosticCount, 0);
    assert.equal(manifest.droppedDiagnosticCount, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI dry-run blocks unavailable or dropped converter diagnostics for local analysis', () => {
  const basicConverter = `
    export function convertV4CaseJsonToV5CaseJson({ v4CaseJson }) {
      const output = structuredClone(v4CaseJson);
      output.case.events.list = [{ ast: { op: 'root', args: [] } }];
      return output;
    }
  `;
  const droppedDetailed = `
    export function convertV4CaseJsonToV5CaseJsonDetailed(args) {
      return {
        v5CaseJson: convertV4CaseJsonToV5CaseJson(args),
        diagnostics: {
          schemaVersion: 1,
          kind: 'tov5parser-conversion-diagnostics',
          summary: {
            total: 2, droppedTotal: 2, customExprTotal: 0, uniqueTotal: 1,
            returnedRecordCount: 1, truncated: false,
            categoryTruncated: false, phaseTruncated: false,
          },
          limits: { maxRecords: 5000 },
          records: [{
            outcome: 'dropped', phase: 'ast-convert', count: 2,
            message: 'unsupported source formula', nodeId: 'case-root',
          }],
        },
      };
    }
  `;
  const work = {
    case: { id: 'case-root', type: 'ih5-case', events: { list: [{ tree: { type: 'root', children: [] } }] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };

  for (const scenario of [
    { name: 'unavailable', detailed: '', rule: 'CONVERTER_DIAGNOSTICS_UNAVAILABLE', artifact: false },
    { name: 'dropped', detailed: droppedDetailed, rule: 'CONVERTER_LOGIC_DROPPED', artifact: true },
  ]) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `ivx-cli-diag-${scenario.name}-`));
    const home = path.join(temporary, 'home');
    const converter = path.join(temporary, 'converter');
    fs.mkdirSync(converter);
    fs.writeFileSync(path.join(converter, 'package.json'), JSON.stringify({ name: `@test/${scenario.name}`, version: '1.0.0', type: 'module' }));
    fs.writeFileSync(path.join(converter, 'index.js'), `${basicConverter}\n${scenario.detailed}`);
    const input = path.join(temporary, 'app.json');
    fs.writeFileSync(input, JSON.stringify(work));
    try {
      const result = spawnSync(process.execPath, [
        path.join(projectRoot, 'bin', 'ivx-migrate.js'),
        'dry-run', '--input', input, '--nid', '12345678', '--converter-path', converter,
      ], {
        cwd: projectRoot,
        env: { ...process.env, IVX_MIGRATION_HOME: home },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout);
      assert.equal(output.result.status, 'ISSUES_CLASSIFIED');
      const jobDir = path.join(home, 'jobs', output.result.jobId);
      const validation = JSON.parse(fs.readFileSync(path.join(jobDir, 'reports', 'validation.json'), 'utf8'));
      assert.equal(validation.issues.some((issue) => issue.rule === scenario.rule), true);
      assert.equal(
        fs.existsSync(path.join(jobDir, 'reports', 'converter-diagnostics.json')),
        scenario.artifact,
      );
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});
