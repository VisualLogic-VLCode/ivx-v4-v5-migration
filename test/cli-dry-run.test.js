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
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
