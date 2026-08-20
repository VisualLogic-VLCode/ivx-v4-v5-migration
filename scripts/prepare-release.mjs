#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AGENT_PROTOCOL_VERSION } from '../src/distribution-profile.js';
import { createSignedReleaseEnvelope } from '../src/releases/release-envelope.js';
import { sha256File } from '../src/fs/secure-json.js';

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), '..');

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function run(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeNewJson(file, value, mode = 0o600) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode });
}

function packageDefaults(kind) {
  if (kind === 'workflow') {
    return {
      repo: 'VisualLogic-VLCode/ivx-v4-v5-migration',
      assetBase: 'ivx-v4-v5-migration',
      compatibleConverter: '>=1.2.0 <2.0.0',
    };
  }
  if (kind === 'converter') {
    return {
      repo: 'VisualLogic-VLCode/tov5parser',
      assetBase: 'tov5parser',
      compatibleWorkflow: '>=0.3.1 <1.0.0',
    };
  }
  throw new Error('--kind must be workflow or converter');
}

function releaseDescriptor({ kind, packageJson, artifactUrl, artifactSha256, options, defaults }) {
  if (kind === 'workflow') {
    return {
      packageName: packageJson.name,
      compatibleConverter: options['compatible-converter'] || defaults.compatibleConverter,
      agentProtocolVersion: Number(options['agent-protocol-version'] || AGENT_PROTOCOL_VERSION),
      jobSchemaVersion: Number(options['job-schema-version'] || 1),
      runtimeTestMode: 'AGENT_NATIVE',
      capabilities: {
        managedRuntimeUpdates: true,
        structuredConverterDiagnostics: true,
        resumablePlatformSaveAs: true,
        autonomousReadOnlyExploration: true,
        agentNativeRuntimeTest: true,
        agentNativeObservationDiagnosis: true,
        agentNativeRepairRegression: true,
        agentNativeBusinessFlowCoverage: true,
        agentNativeCoverageReconciliation: true,
        agentNativeAuthorizedSideEffectTesting: true,
      },
      artifact: { url: artifactUrl, sha256: artifactSha256 },
    };
  }
  return {
    packageName: packageJson.name,
    compatibleWorkflow: options['compatible-workflow'] || defaults.compatibleWorkflow,
    capabilities: { diagnostics: true },
    artifact: { url: artifactUrl, sha256: artifactSha256 },
  };
}

function sourceState(packageDir) {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: packageDir, allowFailure: true });
  const status = run('git', ['status', '--porcelain'], { cwd: packageDir, allowFailure: true });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status !== 0 || Boolean(status.stdout.trim()),
  };
}

export function prepareRelease(options = {}) {
  const kind = options.kind;
  const defaults = packageDefaults(kind);
  const packageDir = path.resolve(options['package-dir'] || (kind === 'workflow' ? repoRoot : path.join(repoRoot, '..', 'tov5parser')));
  const packageFile = path.join(packageDir, 'package.json');
  const packageJson = readJson(packageFile);
  const version = String(options.version || packageJson.version);
  if (version !== String(packageJson.version)) {
    throw new Error(`Requested version ${version} does not match package.json ${packageJson.version}`);
  }
  const repo = options.repo || defaults.repo;
  const tag = options.tag || `v${version}`;
  const privateKeyFile = path.resolve(options['private-key'] || path.join(os.homedir(), '.ivx-v4-v5-maintainer', 'keys', 'release-private-key.pem'));
  if (!fs.existsSync(privateKeyFile)) throw new Error(`Release private key is missing: ${privateKeyFile}`);
  if (process.platform !== 'win32' && (fs.statSync(privateKeyFile).mode & 0o077) !== 0) {
    throw new Error('Release private key must not be accessible by group or others');
  }

  const outputDir = path.resolve(options.output || path.join(repoRoot, 'release-out', `${kind}-${version}`));
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `ivx-release-${kind}-`));
  let generatedTarball;
  try {
    const packed = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'pack', '--json', '--pack-destination', temporary,
    ], { cwd: packageDir });
    const packedInfo = JSON.parse(packed.stdout)[0];
    generatedTarball = path.join(temporary, packedInfo.filename);
    const assetName = `${options['asset-base'] || defaults.assetBase}-${version}.tgz`;
    const artifactFile = path.join(outputDir, assetName);
    fs.copyFileSync(generatedTarball, artifactFile, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(artifactFile, 0o600);
    const artifactSha256 = sha256File(artifactFile);
    const artifactUrl = `https://github.com/${repo}/releases/download/${tag}/${assetName}`;
    const previousPayload = options['previous-payload'] ? readJson(path.resolve(options['previous-payload'])) : null;
    if (previousPayload && previousPayload.kind !== kind) throw new Error('Previous payload kind does not match release kind');
    const payload = {
      schemaVersion: 1,
      kind,
      channel: 'stable',
      latest: version,
      minimumSupported: options['minimum-supported'] || previousPayload?.minimumSupported || version,
      revoked: options.revoked
        ? String(options.revoked).split(',').map((value) => value.trim()).filter(Boolean)
        : previousPayload?.revoked || [],
      versions: {
        ...(previousPayload?.versions || {}),
        [version]: releaseDescriptor({ kind, packageJson, artifactUrl, artifactSha256, options, defaults }),
      },
    };
    const payloadFile = path.join(outputDir, `${kind}-stable.payload.json`);
    const manifestFile = path.join(outputDir, `${kind}-stable.json`);
    writeNewJson(payloadFile, payload);
    const privateKeyPem = fs.readFileSync(privateKeyFile, 'utf8');
    writeNewJson(manifestFile, createSignedReleaseEnvelope(payload, privateKeyPem));
    const source = sourceState(packageDir);
    const plan = {
      schemaVersion: 1,
      kind,
      version,
      repo,
      tag,
      title: `${kind === 'workflow' ? 'Workflow' : 'Converter'} ${version}`,
      source: { packageDir, ...source },
      artifact: { file: artifactFile, name: assetName, sha256: artifactSha256, url: artifactUrl },
      payload: { file: payloadFile, sha256: sha256File(payloadFile) },
      manifest: {
        file: manifestFile,
        name: `${kind}-stable.json`,
        sha256: sha256File(manifestFile),
        channelBranch: 'release-channel',
        channelPath: `${kind}-stable.json`,
      },
      publish: {
        draftFirst: true,
        promoteChannelLast: true,
        requiredConfirmation: 'PUBLISH_STABLE_RELEASE',
      },
    };
    const planFile = path.join(outputDir, 'github-release-plan.json');
    writeNewJson(planFile, plan);
    return { ...plan, planFile };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptFile;
if (invokedDirectly) {
  try {
    const result = prepareRelease(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
