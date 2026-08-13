import { createAppPaths } from './paths.js';
import path from 'node:path';
import { ensurePrivateDir, readJson, writePrivateJson } from './fs/secure-json.js';
import { WorkflowError } from './errors.js';

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  releaseManifestUrl: null,
  releaseManifests: {
    workflow: null,
    converter: null,
    knowledge: null,
  },
  releasePublicKeyPem: null,
  releasePublicKeys: {
    workflow: null,
    converter: null,
    knowledge: null,
  },
  allowUnsignedLocalManifests: false,
  update: {
    channel: 'stable',
    workflowPolicy: 'prompt',
    converterPolicy: 'prompt',
    knowledgePolicy: 'prompt',
    agentPolicy: 'prompt',
    checkIntervalHours: 24,
  },
  platform: {
    baseUrl: null,
    tokenFile: null,
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
  for (const kind of ['workflow', 'converter', 'knowledge']) {
    if (config.releasePublicKeys?.[kind] !== null && typeof config.releasePublicKeys?.[kind] !== 'string') {
      throw new WorkflowError('INVALID_CONFIG', `releasePublicKeys.${kind} must be null or a PEM string`);
    }
  }
  for (const key of ['workflowPolicy', 'converterPolicy', 'knowledgePolicy', 'agentPolicy']) {
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
  if (config.platform?.tokenFile !== null) {
    if (typeof config.platform?.tokenFile !== 'string' || !path.isAbsolute(config.platform.tokenFile)) {
      throw new WorkflowError('INVALID_CONFIG', 'platform.tokenFile must be null or an absolute path');
    }
  }
  if (typeof config.platform?.tokenEnv !== 'string' || !config.platform.tokenEnv.trim()) {
    throw new WorkflowError('INVALID_CONFIG', 'platform.tokenEnv must be a non-empty environment-variable name');
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

export function adoptPublicKnowledgeProfile(config, profile, appPaths = createAppPaths()) {
  if (
    config.releaseManifests.knowledge
    || config.releasePublicKeys.knowledge
    || !profile?.manifests?.knowledge
    || !profile?.publicKeys?.knowledge
  ) return config;
  const isManagedPublicProfile = config.releaseManifests.workflow === profile.manifests.workflow
    && config.releaseManifests.converter === profile.manifests.converter
    && config.releasePublicKeyPem === profile.publicKeyPem;
  if (!isManagedPublicProfile) return config;
  return saveConfig({
    ...config,
    releaseManifests: { ...config.releaseManifests, knowledge: profile.manifests.knowledge },
    releasePublicKeys: { ...config.releasePublicKeys, knowledge: profile.publicKeys.knowledge },
  }, appPaths);
}
