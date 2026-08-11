import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppPaths } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError } from '../errors.js';

const defaultPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

export class AgentInstaller {
  constructor({ appPaths = createAppPaths(), env = process.env, packageRoot = defaultPackageRoot } = {}) {
    this.paths = appPaths;
    this.env = env;
    this.packageRoot = path.resolve(packageRoot);
    ensurePrivateDir(this.paths.agents);
  }

  targets() {
    const home = os.homedir();
    const codexHome = this.env.CODEX_HOME ? path.resolve(this.env.CODEX_HOME) : path.join(home, '.codex');
    const claudeHome = this.env.CLAUDE_HOME ? path.resolve(this.env.CLAUDE_HOME) : path.join(home, '.claude');
    return [
      {
        agent: 'codex',
        source: path.join(this.packageRoot, 'agents', 'codex', 'SKILL.md'),
        target: path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'),
      },
      {
        agent: 'claude',
        source: path.join(this.packageRoot, 'agents', 'claude', 'SKILL.md'),
        target: path.join(claudeHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'),
      },
    ];
  }

  status({ protocolVersion = null } = {}) {
    const registryPath = path.join(this.paths.agents, 'installed.json');
    const registry = readJson(registryPath, { schemaVersion: 1, files: {} });
    const files = [];
    for (const target of this.targets()) {
      const nextContent = fs.readFileSync(target.source, 'utf8');
      const nextHash = hash(nextContent);
      const currentContent = fs.existsSync(target.target) ? fs.readFileSync(target.target, 'utf8') : null;
      const currentHash = currentContent === null ? null : hash(currentContent);
      const managedHash = registry.files[target.target]?.hash || null;
      const status = currentHash === nextHash
        ? 'current'
        : currentHash === null
          ? 'missing'
          : managedHash && managedHash === currentHash
            ? 'outdated'
            : 'modified';
      files.push({
        agent: target.agent,
        status,
        target: target.target,
        sourceHash: nextHash,
        currentHash,
        managedHash,
      });
    }
    const installedProtocolVersion = registry.protocolVersion ?? null;
    return {
      protocolVersion: {
        desired: protocolVersion,
        installed: installedProtocolVersion,
        current: protocolVersion == null || installedProtocolVersion === protocolVersion,
      },
      current: files.every((item) => item.status === 'current')
        && (protocolVersion == null || installedProtocolVersion === protocolVersion),
      conflicts: files.filter((item) => item.status === 'modified').map((item) => item.target),
      files,
    };
  }

  sync({ force = false, protocolVersion = null } = {}) {
    const registryPath = path.join(this.paths.agents, 'installed.json');
    const registry = readJson(registryPath, { schemaVersion: 1, files: {} });
    const before = this.status({ protocolVersion });
    if (before.conflicts.length > 0 && !force) {
      throw new WorkflowError('AGENT_FILE_CONFLICT', 'Refusing to overwrite modified Agent adapters', {
        targets: before.conflicts,
        hint: 'Re-run agents sync with --force to back up and replace them.',
      });
    }
    const results = [];
    for (const target of this.targets()) {
      const nextContent = fs.readFileSync(target.source, 'utf8');
      const nextHash = hash(nextContent);
      const currentContent = fs.existsSync(target.target) ? fs.readFileSync(target.target, 'utf8') : null;
      const currentHash = currentContent === null ? null : hash(currentContent);
      if (currentHash === nextHash) {
        results.push({ agent: target.agent, status: 'current', target: target.target, hash: nextHash });
        registry.files[target.target] = { agent: target.agent, hash: nextHash, updatedAt: new Date().toISOString() };
        continue;
      }
      let backup = null;
      if (currentContent !== null) {
        backup = `${target.target}.backup-${timestamp()}`;
        ensurePrivateDir(path.dirname(backup));
        writePrivateFile(backup, currentContent);
      }
      writePrivateFile(target.target, nextContent);
      registry.files[target.target] = { agent: target.agent, hash: nextHash, updatedAt: new Date().toISOString() };
      results.push({ agent: target.agent, status: currentContent === null ? 'installed' : 'updated', target: target.target, backup, hash: nextHash });
    }
    if (protocolVersion != null) registry.protocolVersion = protocolVersion;
    writePrivateJson(registryPath, registry);
    return results;
  }
}
