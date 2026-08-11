import os from 'node:os';
import path from 'node:path';

export function resolveAppHome(env = process.env) {
  const configured = env.IVX_MIGRATION_HOME?.trim();
  return path.resolve(configured || path.join(os.homedir(), '.ivx-v4-v5'));
}

export function createAppPaths(appHome = resolveAppHome()) {
  return {
    home: appHome,
    config: path.join(appHome, 'config.json'),
    registry: path.join(appHome, 'registry.json'),
    current: path.join(appHome, 'current.json'),
    jobs: path.join(appHome, 'jobs'),
    locks: path.join(appHome, 'locks'),
    logs: path.join(appHome, 'logs'),
    workflows: path.join(appHome, 'workflows'),
    converters: path.join(appHome, 'converters'),
    cache: path.join(appHome, 'cache'),
    agents: path.join(appHome, 'agents'),
  };
}

export function resolveWorkspaceReferenceDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), '.ivx-migration');
}
