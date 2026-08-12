#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
