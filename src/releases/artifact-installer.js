import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { WorkflowError, invariant } from '../errors.js';
import { ensurePrivateDir, sha256File, writePrivateJson } from '../fs/secure-json.js';
import { fetchBytes } from './http-fetch.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { validateKnowledgePackage } from '../knowledge/contracts.js';
import { assertRuntimeSet, runtimeSetFromCurrent } from './runtime-compatibility.js';

async function downloadArtifact(location, target) {
  if (/^https:\/\//i.test(location)) {
    const bytes = await fetchBytes(location, {
      errorCode: 'RUNTIME_DOWNLOAD_FAILED',
      label: 'Runtime artifact',
    });
    fs.writeFileSync(target, bytes, { mode: 0o600 });
    return;
  }
  const source = /^file:\/\//i.test(location) ? fileURLToPath(location) : path.resolve(location);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function packageInstallPath(staging, packageName) {
  return path.join(staging, 'node_modules', ...packageName.split('/'));
}

export class ArtifactInstaller {
  constructor({ appPaths, registry = new RuntimeRegistry(appPaths) } = {}) {
    this.registry = registry;
    this.paths = registry.paths;
    ensurePrivateDir(this.paths.cache);
  }

  async install(kind, version, descriptor, { activate = true } = {}) {
    invariant(descriptor?.artifact?.url, 'RUNTIME_ARTIFACT_INVALID', 'Runtime artifact URL is required');
    invariant(descriptor?.artifact?.sha256, 'RUNTIME_ARTIFACT_INVALID', 'Runtime artifact SHA-256 is required');
    invariant(descriptor?.packageName, 'RUNTIME_ARTIFACT_INVALID', 'Runtime packageName is required');
    const target = this.registry.runtimeDir(kind, version);
    const existing = this.registry.descriptor(kind, version);
    if (existing) {
      invariant(existing.artifactSha256 === descriptor.artifact.sha256, 'RUNTIME_INTEGRITY_FAILED', 'Installed runtime hash differs from the release descriptor');
      if (activate) {
        assertRuntimeSet(runtimeSetFromCurrent(this.registry.readCurrent(), { [kind]: existing }));
        this.registry.activate(kind, version);
      }
      return existing;
    }

    const nonce = crypto.randomBytes(6).toString('hex');
    const staging = ensurePrivateDir(path.join(this.paths.cache, `install-${kind}-${version}-${nonce}`));
    const tarball = path.join(staging, 'runtime.tgz');
    try {
      await downloadArtifact(descriptor.artifact.url, tarball);
      const actualSha256 = sha256File(tarball);
      invariant(actualSha256 === descriptor.artifact.sha256, 'RUNTIME_INTEGRITY_FAILED', 'Downloaded runtime SHA-256 does not match release descriptor', {
        expected: descriptor.artifact.sha256,
        actual: actualSha256,
      });
      const installRoot = ensurePrivateDir(path.join(staging, 'install'));
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const result = spawnSync(npm, [
        'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
        '--prefix', installRoot, tarball,
      ], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new WorkflowError('RUNTIME_INSTALL_FAILED', `npm failed to install ${kind} ${version}`, {
          stdout: result.stdout?.slice(-4000),
          stderr: result.stderr?.slice(-4000),
        });
      }
      const packageRoot = packageInstallPath(installRoot, descriptor.packageName);
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
      invariant(packageJson.version === version, 'RUNTIME_VERSION_MISMATCH', 'Runtime package version differs from release descriptor', {
        expected: version,
        actual: packageJson.version,
      });
      const knowledge = kind === 'knowledge'
        ? validateKnowledgePackage(packageRoot, descriptor, version)
        : null;
      const temporaryTarget = `${target}.installing-${nonce}`;
      fs.cpSync(packageRoot, temporaryTarget, { recursive: true, errorOnExist: true });
      const installed = {
        schemaVersion: 1,
        kind,
        version,
        packageName: descriptor.packageName,
        artifactSha256: actualSha256,
        installedAt: new Date().toISOString(),
        capabilities: descriptor.capabilities || {},
        compatibility: {
          workflow: descriptor.compatibleWorkflow || null,
          converter: descriptor.compatibleConverter || null,
          agentProtocolVersion: descriptor.agentProtocolVersion || null,
          jobSchemaVersion: descriptor.jobSchemaVersion || null,
          agentProtocol: descriptor.compatibleAgentProtocol || null,
        },
        ...(knowledge ? {
          knowledgeSchemaVersion: knowledge.manifest.knowledgeSchemaVersion,
          contentSha256: knowledge.manifest.contentSha256,
          cardCount: knowledge.cardCount,
        } : {}),
        packagePath: target,
      };
      writePrivateJson(path.join(temporaryTarget, '.ivx-runtime.json'), installed);
      fs.renameSync(temporaryTarget, target);
      if (activate) {
        assertRuntimeSet(runtimeSetFromCurrent(this.registry.readCurrent(), { [kind]: installed }));
        this.registry.activate(kind, version);
      }
      return installed;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
