import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentInstaller } from '../src/agents/installer.js';
import { createAppPaths } from '../src/paths.js';

test('agent adapters install, detect manual edits, and back up forced updates', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-agent-install-'));
  const codexHome = path.join(temporary, 'codex');
  const claudeHome = path.join(temporary, 'claude');
  try {
    const installer = new AgentInstaller({
      appPaths: createAppPaths(path.join(temporary, 'app')),
      env: { CODEX_HOME: codexHome, CLAUDE_HOME: claudeHome },
    });
    const missing = installer.status({ protocolVersion: 1 });
    assert.equal(missing.current, false);
    assert.deepEqual(missing.files.map((item) => item.status), ['missing', 'missing']);
    const installed = installer.sync({ protocolVersion: 1 });
    assert.deepEqual(installed.map((item) => item.status), ['installed', 'installed']);
    assert.equal(installer.status({ protocolVersion: 1 }).current, true);
    const codexTarget = installer.targets()[0].target;
    fs.appendFileSync(codexTarget, '\nmanual change\n');
    const modified = installer.status({ protocolVersion: 2 });
    assert.deepEqual(modified.conflicts, [codexTarget]);
    assert.equal(modified.protocolVersion.current, false);
    assert.throws(() => installer.sync(), /Refusing to overwrite/);
    const forced = installer.sync({ force: true, protocolVersion: 2 });
    assert.equal(forced[0].status, 'updated');
    assert.equal(fs.existsSync(forced[0].backup), true);
    assert.equal(installer.status({ protocolVersion: 2 }).current, true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
