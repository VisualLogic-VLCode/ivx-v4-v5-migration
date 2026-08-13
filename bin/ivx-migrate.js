#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const LAUNCHER_RECOVERY_CONFIRMATION = 'RECOVER_SIGNED_RUNTIME';

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || ''));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function optionValue(argv, name) {
  const direct = argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function launcherRecoveryRequested(argv) {
  const value = optionValue(argv, '--launcher-recovery');
  if (value === null) return false;
  if (value !== LAUNCHER_RECOVERY_CONFIRMATION) {
    const error = new Error(`Launcher recovery requires --launcher-recovery ${LAUNCHER_RECOVERY_CONFIRMATION}`);
    error.code = 'LAUNCHER_RECOVERY_CONFIRMATION_REQUIRED';
    throw error;
  }
  if (!['setup', 'update', 'rollback', 'agents'].includes(argv[0])) {
    const error = new Error('Launcher recovery is restricted to setup, update, rollback, or Agent synchronization');
    error.code = 'LAUNCHER_RECOVERY_COMMAND_FORBIDDEN';
    throw error;
  }
  return true;
}

async function loadWorkflowCli(argv) {
  const appHome = path.resolve(process.env.IVX_MIGRATION_HOME?.trim() || path.join(os.homedir(), '.ivx-v4-v5'));
  const bundledCli = new URL('../src/cli.js', import.meta.url);
  if (argv[0] === 'setup' && argv.some((value) => value === '--prompt-token' || value.startsWith('--prompt-token='))) {
    return import(bundledCli.href);
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(path.join(appHome, 'current.json'), 'utf8'));
  } catch {
    return import(bundledCli.href);
  }
  if (launcherRecoveryRequested(argv)) {
    const comparison = compareVersions(bundledPackage.version, current?.workflow?.version);
    if (comparison === null || comparison < 0) {
      const error = new Error('Bundled Launcher is older than the active managed Workflow and cannot recover it');
      error.code = 'LAUNCHER_RECOVERY_DOWNGRADE_FORBIDDEN';
      throw error;
    }
    return import(bundledCli.href);
  }
  const packagePath = current?.workflow?.packagePath;
  if (!packagePath) return import(bundledCli.href);
  const workflowRoot = path.resolve(appHome, 'workflows');
  const resolvedPackage = path.resolve(packagePath);
  if (!resolvedPackage.startsWith(`${workflowRoot}${path.sep}`)) {
    const error = new Error('Configured Workflow runtime is outside the managed workflow directory');
    error.code = 'WORKFLOW_RUNTIME_PATH_FORBIDDEN';
    error.details = { packagePath: resolvedPackage, workflowRoot };
    throw error;
  }
  const runtimeCli = path.join(resolvedPackage, 'src', 'cli.js');
  if (!fs.existsSync(runtimeCli)) {
    const error = new Error(`Installed Workflow runtime has no CLI entry: ${runtimeCli}`);
    error.code = 'WORKFLOW_RUNTIME_INVALID';
    throw error;
  }
  return import(`${pathToFileURL(runtimeCli).href}?runtime=${encodeURIComponent(current.workflow.version || '')}`);
}

try {
  const argv = process.argv.slice(2);
  const { runCli } = await loadWorkflowCli(argv);
  const exitCode = await runCli(argv);
  process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
} catch (error) {
  const output = {
    ok: false,
    code: error?.code || 'UNEXPECTED_ERROR',
    message: error?.message || String(error),
  };
  if (error?.details !== undefined) output.details = error.details;
  process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = 1;
}
