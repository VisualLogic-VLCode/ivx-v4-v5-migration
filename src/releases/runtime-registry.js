import fs from 'node:fs';
import path from 'node:path';
import { createAppPaths } from '../paths.js';
import { ensurePrivateDir, readJson, writePrivateJson } from '../fs/secure-json.js';
import { WorkflowError, invariant } from '../errors.js';

function plural(kind) {
  invariant(['workflow', 'converter', 'knowledge'].includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
  return { workflow: 'workflows', converter: 'converters', knowledge: 'knowledge' }[kind];
}

export class RuntimeRegistry {
  constructor(appPaths = createAppPaths()) {
    this.paths = appPaths;
    ensurePrivateDir(appPaths.workflows);
    ensurePrivateDir(appPaths.converters);
    ensurePrivateDir(appPaths.knowledge);
  }

  readCurrent() {
    return readJson(this.paths.current, {
      schemaVersion: 1,
      workflow: null,
      converter: null,
      knowledge: null,
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
    return this.activateSet({ [kind]: version });
  }

  activateSet(versions) {
    invariant(versions && typeof versions === 'object' && !Array.isArray(versions), 'INVALID_RUNTIME_SET', 'Runtime activation set must be an object');
    const descriptors = Object.fromEntries(Object.entries(versions).map(([kind, version]) => {
      plural(kind);
      const descriptor = this.descriptor(kind, version);
      if (!descriptor) throw new WorkflowError('RUNTIME_NOT_INSTALLED', `${kind} ${version} is not installed`);
      return [kind, descriptor];
    }));
    const current = this.readCurrent();
    const updatedAt = new Date().toISOString();
    current.history = Array.isArray(current.history) ? current.history : [];
    for (const [kind, descriptor] of Object.entries(descriptors)) {
      const previous = current[kind];
      current[kind] = descriptor;
      if (previous && previous.version !== descriptor.version) {
        current.history.unshift({ kind, descriptor: previous, replacedAt: updatedAt });
      }
    }
    current.history = current.history.slice(0, 30);
    current.updatedAt = updatedAt;
    writePrivateJson(this.paths.current, current);
    return current;
  }

  rollbackTarget(kind) {
    const current = this.readCurrent();
    const index = current.history.findIndex((entry) => entry.kind === kind && this.descriptor(kind, entry.descriptor?.version));
    if (index < 0) throw new WorkflowError('RUNTIME_ROLLBACK_UNAVAILABLE', `No previous ${kind} runtime is available`);
    return { current, index, target: current.history[index].descriptor };
  }

  rollback(kind, { validate } = {}) {
    const { current, index, target } = this.rollbackTarget(kind);
    if (validate) validate({ ...current, [kind]: target });
    current.history.splice(index, 1);
    if (current[kind]) current.history.unshift({ kind, descriptor: current[kind], replacedAt: new Date().toISOString() });
    current[kind] = target;
    current.updatedAt = new Date().toISOString();
    writePrivateJson(this.paths.current, current);
    return current;
  }
}
