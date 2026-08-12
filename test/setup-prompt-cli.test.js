import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { writePrivateFile } from '../src/fs/secure-json.js';

test('setup prompt configures only the managed Token path before runtime installation', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-setup-prompt-cli-'));
  const appHome = path.join(temporary, 'home');
  const previousHome = process.env.IVX_MIGRATION_HOME;
  const testToken = 'local-cli-wiring-test-token';
  let promptCalls = 0;
  process.env.IVX_MIGRATION_HOME = appHome;
  try {
    await assert.rejects(runCli([
      'setup',
      '--prompt-token',
      '--workflow-manifest', path.join(temporary, 'intentionally-missing-workflow.json'),
      '--converter-manifest', path.join(temporary, 'intentionally-missing-converter.json'),
      '--allow-unsigned-local', 'true',
    ], {
      promptPlatformToken({ appPaths }) {
        promptCalls += 1;
        const tokenFile = path.join(appPaths.home, 'secrets', 'platform-token');
        writePrivateFile(tokenFile, `${testToken}\n`);
        return { tokenFile };
      },
    }));
    assert.equal(promptCalls, 1);
    const configText = fs.readFileSync(path.join(appHome, 'config.json'), 'utf8');
    const config = JSON.parse(configText);
    assert.equal(config.platform.tokenFile, path.join(appHome, 'secrets', 'platform-token'));
    assert.equal(config.platform.baseUrl, 'https://dev.ivx.cn');
    assert.equal(configText.includes(testToken), false);
    assert.equal(fs.statSync(config.platform.tokenFile).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(appHome, 'current.json')), false);
  } finally {
    if (previousHome === undefined) delete process.env.IVX_MIGRATION_HOME;
    else process.env.IVX_MIGRATION_HOME = previousHome;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
