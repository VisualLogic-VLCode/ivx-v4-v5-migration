import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppPaths } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateFile, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError } from '../errors.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

export class AgentInstaller {
  constructor({ appPaths = createAppPaths(), env = process.env } = {}) {
    this.paths = appPaths;
    this.env = env;
    ensurePrivateDir(this.paths.agents);
  }

  targets() {
    const home = os.homedir();
    const codexHome = this.env.CODEX_HOME ? path.resolve(this.env.CODEX_HOME) : path.join(home, '.codex');
    const claudeHome = this.env.CLAUDE_HOME ? path.resolve(this.env.CLAUDE_HOME) : path.join(home, '.claude');
    return [
      {
        agent: 'codex',
        source: path.join(packageRoot, 'agents', 'codex', 'SKILL.md'),
        target: path.join(codexHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'),
      },
      {
        agent: 'claude',
        source: path.join(packageRoot, 'agents', 'claude', 'SKILL.md'),
        target: path.join(claudeHome, 'skills', 'v4-to-v5-workflow', 'SKILL.md'),
      },
    ];
  }

  sync({ force = false } = {}) {
    const registryPath = path.join(this.paths.agents, 'installed.json');
    const registry = readJson(registryPath, { schemaVersion: 1, files: {} });
    const results = [];
    for (const target of this.targets()) {
      const nextContent = fs.readFileSync(target.source, 'utf8');
      const nextHash = hash(nextContent);
      const currentContent = fs.existsSync(target.target) ? fs.readFileSync(target.target, 'utf8') : null;
      const currentHash = currentContent === null ? null : hash(currentContent);
      const managedHash = registry.files[target.target]?.hash || null;
      if (currentHash === nextHash) {
        results.push({ agent: target.agent, status: 'current', target: target.target, hash: nextHash });
        registry.files[target.target] = { agent: target.agent, hash: nextHash, updatedAt: new Date().toISOString() };
        continue;
      }
      const manuallyModified = currentHash && managedHash !== currentHash;
      if (manuallyModified && !force) {
        throw new WorkflowError('AGENT_FILE_CONFLICT', `Refusing to overwrite a modified ${target.agent} adapter`, {
          target: target.target,
          hint: 'Re-run agents sync with --force to back up and replace it.',
        });
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
    writePrivateJson(registryPath, registry);
    return results;
  }
}
