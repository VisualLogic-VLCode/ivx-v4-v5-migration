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
    const installed = installer.sync();
    assert.deepEqual(installed.map((item) => item.status), ['installed', 'installed']);
    const codexTarget = installer.targets()[0].target;
    fs.appendFileSync(codexTarget, '\nmanual change\n');
    assert.throws(() => installer.sync(), /Refusing to overwrite/);
    const forced = installer.sync({ force: true });
    assert.equal(forced[0].status, 'updated');
    assert.equal(fs.existsSync(forced[0].backup), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
