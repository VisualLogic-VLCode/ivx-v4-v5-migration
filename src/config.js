import { createAppPaths } from './paths.js';
import { ensurePrivateDir, readJson, writePrivateJson } from './fs/secure-json.js';
import { WorkflowError } from './errors.js';

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  releaseManifestUrl: null,
  releaseManifests: {
    workflow: null,
    converter: null,
  },
  releasePublicKeyPem: null,
  allowUnsignedLocalManifests: false,
  update: {
    channel: 'stable',
    workflowPolicy: 'prompt',
    converterPolicy: 'prompt',
    checkIntervalHours: 24,
  },
  platform: {
    baseUrl: null,
    tokenEnv: 'IVX_MIGRATION_TOKEN',
    writeMode: 'disabled',
    allowInsecureLocalhost: false,
  },
  jobs: {
    createWorkspaceReference: false,
    retentionDays: 30,
  },
});

const UPDATE_POLICIES = new Set(['prompt', 'auto', 'never']);

function mergeConfig(base, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const output = { ...base };
  for (const [key, child] of Object.entries(value)) {
    if (
      child && typeof child === 'object' && !Array.isArray(child) &&
      base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      output[key] = mergeConfig(base[key], child);
    } else {
      output[key] = child;
    }
  }
  return output;
}

export function validateConfig(config) {
  for (const key of ['workflowPolicy', 'converterPolicy']) {
    if (!UPDATE_POLICIES.has(config.update?.[key])) {
      throw new WorkflowError(
        'INVALID_CONFIG',
        `update.${key} must be prompt, auto, or never`,
      );
    }
  }
  if (Object.hasOwn(config, 'token') || Object.hasOwn(config.platform || {}, 'token')) {
    throw new WorkflowError(
      'TOKEN_PERSISTENCE_FORBIDDEN',
      'User tokens must not be stored in config.json',
    );
  }
  if (!['disabled', 'explicit'].includes(config.platform?.writeMode)) {
    throw new WorkflowError('INVALID_CONFIG', 'platform.writeMode must be disabled or explicit');
  }
  return config;
}

export function loadConfig(appPaths = createAppPaths()) {
  ensurePrivateDir(appPaths.home);
  const stored = readJson(appPaths.config, {});
  return validateConfig(mergeConfig(DEFAULT_CONFIG, stored));
}

export function saveConfig(config, appPaths = createAppPaths()) {
  validateConfig(config);
  writePrivateJson(appPaths.config, config);
  return config;
}
