import fs from 'node:fs';
import path from 'node:path';
import { createAppPaths } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError, invariant } from '../errors.js';

function plural(kind) {
  invariant(['workflow', 'converter'].includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
  return kind === 'workflow' ? 'workflows' : 'converters';
}

export class RuntimeRegistry {
  constructor(appPaths = createAppPaths()) {
    this.paths = appPaths;
    ensurePrivateDir(appPaths.workflows);
    ensurePrivateDir(appPaths.converters);
  }

  readCurrent() {
    return readJson(this.paths.current, {
      schemaVersion: 1,
      workflow: null,
      converter: null,
      history: [],
    });
  }

  runtimeDir(kind, version) {
    invariant(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version)), 'INVALID_VERSION', `Invalid runtime version: ${version}`);
    return path.join(this.paths[plural(kind)], String(version));
  }

  descriptor(kind, version) {
    return readJson(path.join(this.runtimeDir(kind, version), '.ivx-runtime.json'), null);
  }

  list(kind) {
    const root = this.paths[plural(kind)];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.descriptor(kind, entry.name))
      .filter(Boolean)
      .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
  }

  activate(kind, version) {
    const descriptor = this.descriptor(kind, version);
    if (!descriptor) throw new WorkflowError('RUNTIME_NOT_INSTALLED', `${kind} ${version} is not installed`);
    const current = this.readCurrent();
    const previous = current[kind];
    current[kind] = descriptor;
    current.updatedAt = new Date().toISOString();
    current.history = Array.isArray(current.history) ? current.history : [];
    if (previous && previous.version !== version) {
      current.history.unshift({ kind, descriptor: previous, replacedAt: current.updatedAt });
      current.history = current.history.slice(0, 20);
    }
    writePrivateJson(this.paths.current, current);
    return current;
  }

  rollback(kind) {
    const current = this.readCurrent();
    const index = current.history.findIndex((entry) => entry.kind === kind && this.descriptor(kind, entry.descriptor?.version));
    if (index < 0) throw new WorkflowError('RUNTIME_ROLLBACK_UNAVAILABLE', `No previous ${kind} runtime is available`);
    const target = current.history[index].descriptor;
    current.history.splice(index, 1);
    if (current[kind]) current.history.unshift({ kind, descriptor: current[kind], replacedAt: new Date().toISOString() });
    current[kind] = target;
    current.updatedAt = new Date().toISOString();
    writePrivateJson(this.paths.current, current);
    return current;
  }
}
