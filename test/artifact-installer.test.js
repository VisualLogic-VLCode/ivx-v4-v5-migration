import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ArtifactInstaller } from '../src/releases/artifact-installer.js';
import { RuntimeRegistry } from '../src/releases/runtime-registry.js';
import { createAppPaths } from '../src/paths.js';
import { sha256File } from '../src/fs/secure-json.js';

test('artifact installer verifies and installs an immutable npm tarball without scripts', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-runtime-install-'));
  const packageRoot = path.join(temporary, 'package');
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@test/ivx-converter',
    version: '1.2.3',
    type: 'module',
    files: ['index.js'],
  }));
  fs.writeFileSync(path.join(packageRoot, 'index.js'), 'export const version = "1.2.3";\n');
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packed = spawnSync(npm, ['pack', '--json'], { cwd: packageRoot, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = path.join(packageRoot, JSON.parse(packed.stdout)[0].filename);
    const paths = createAppPaths(path.join(temporary, 'home'));
    const registry = new RuntimeRegistry(paths);
    const installer = new ArtifactInstaller({ appPaths: paths, registry });
    const installed = await installer.install('converter', '1.2.3', {
      packageName: '@test/ivx-converter',
      artifact: { url: tarball, sha256: sha256File(tarball) },
      compatibleWorkflow: '>=0.1.0 <1.0.0',
    });
    assert.equal(installed.version, '1.2.3');
    assert.equal(registry.readCurrent().converter.version, '1.2.3');
    assert.equal(fs.existsSync(path.join(registry.runtimeDir('converter', '1.2.3'), 'index.js')), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
