import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkflowError, invariant } from '../errors.js';
import { sha256File } from '../fs/secure-json.js';

export class LocalConverterProvider {
  constructor({ packagePath, expectedVersion, expectedSha256 } = {}) {
    invariant(packagePath, 'CONVERTER_PATH_REQUIRED', 'A converter package path is required');
    this.packagePath = path.resolve(packagePath);
    this.expectedVersion = expectedVersion || null;
    this.expectedSha256 = expectedSha256 || null;
    this.module = null;
    this.descriptor = null;
  }

  async load() {
    const packageJsonPath = path.join(this.packagePath, 'package.json');
    const entryPath = path.join(this.packagePath, 'index.js');
    invariant(fs.existsSync(packageJsonPath), 'INVALID_CONVERTER_PACKAGE', `Missing converter package.json: ${packageJsonPath}`);
    invariant(fs.existsSync(entryPath), 'INVALID_CONVERTER_PACKAGE', `Missing converter entry: ${entryPath}`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (this.expectedVersion && packageJson.version !== this.expectedVersion) {
      throw new WorkflowError('CONVERTER_VERSION_MISMATCH', 'Installed converter version does not match the pinned version', {
        expected: this.expectedVersion,
        actual: packageJson.version,
      });
    }
    const entrySha256 = sha256File(entryPath);
    if (this.expectedSha256 && entrySha256 !== this.expectedSha256) {
      throw new WorkflowError('CONVERTER_INTEGRITY_FAILED', 'Converter entry hash does not match the pinned hash', {
        expected: this.expectedSha256,
        actual: entrySha256,
      });
    }
    const module = await import(`${pathToFileURL(entryPath).href}?integrity=${entrySha256}`);
    invariant(
      typeof module.convertV4CaseJsonToV5CaseJson === 'function',
      'CONVERTER_API_INCOMPATIBLE',
      'Converter does not export convertV4CaseJsonToV5CaseJson',
    );
    if (typeof module.loadRuntimeMaps === 'function') module.loadRuntimeMaps();
    this.module = module;
    this.descriptor = {
      packageName: packageJson.name || null,
      version: packageJson.version || null,
      entrySha256,
      packagePath: this.packagePath,
      capabilities: {
        diagnostics: typeof module.convertV4CaseJsonToV5CaseJsonDetailed === 'function',
      },
    };
    return this.descriptor;
  }

  async convert({ v4CaseJson, ntype } = {}) {
    if (!this.module) await this.load();
    if (typeof this.module.convertV4CaseJsonToV5CaseJsonDetailed === 'function') {
      const result = await this.module.convertV4CaseJsonToV5CaseJsonDetailed({ v4CaseJson, ntype });
      invariant(result?.v5CaseJson, 'CONVERTER_INVALID_RESULT', 'Detailed converter did not return v5CaseJson');
      return {
        v5CaseJson: result.v5CaseJson,
        diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
        descriptor: this.descriptor,
      };
    }
    const v5CaseJson = await this.module.convertV4CaseJsonToV5CaseJson({ v4CaseJson, ntype });
    return {
      v5CaseJson,
      diagnostics: null,
      descriptor: this.descriptor,
    };
  }
}
