#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PUBLIC_RELEASE_PROFILE } from '../src/distribution-profile.js';
import { loadReleaseEnvelope } from '../src/releases/release-envelope.js';
import { sha256File } from '../src/fs/secure-json.js';

const scriptFile = fileURLToPath(import.meta.url);

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

function run(command, args, { cwd, input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, input, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function ghJson(args, options = {}) {
  const result = run('gh', args, options);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function apiJson(method, endpoint, body, { allowFailure = false } = {}) {
  const result = run('gh', ['api', '--method', method, endpoint, '--input', '-'], {
    input: body === undefined ? undefined : JSON.stringify(body),
    allowFailure,
  });
  if (result.status !== 0) return { failed: true, result };
  return { failed: false, value: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function assertFileHash(file, expected, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`${label} SHA-256 changed after preparation`);
}

function createChannelBranch(repo, branch, channelPath, manifestBytes, message) {
  const blob = apiJson('POST', `repos/${repo}/git/blobs`, {
    content: manifestBytes.toString('base64'),
    encoding: 'base64',
  }).value;
  const tree = apiJson('POST', `repos/${repo}/git/trees`, {
    tree: [{ path: channelPath, mode: '100644', type: 'blob', sha: blob.sha }],
  }).value;
  const commit = apiJson('POST', `repos/${repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [],
  }).value;
  apiJson('POST', `repos/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  });
  return commit.sha;
}

function updateChannelBranch(repo, branch, channelPath, manifestBytes, message) {
  const existing = run('gh', ['api', `repos/${repo}/contents/${channelPath}?ref=${encodeURIComponent(branch)}`], { allowFailure: true });
  const body = {
    message,
    content: manifestBytes.toString('base64'),
    branch,
  };
  if (existing.status === 0) body.sha = JSON.parse(existing.stdout).sha;
  const updated = apiJson('PUT', `repos/${repo}/contents/${channelPath}`, body);
  return updated.value.commit.sha;
}

async function publishRelease(options) {
  if (!options.plan) throw new Error('--plan is required');
  const planFile = path.resolve(options.plan);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (options.confirm !== plan.publish?.requiredConfirmation) {
    throw new Error(`Publication requires --confirm ${plan.publish?.requiredConfirmation || 'PUBLISH_STABLE_RELEASE'}`);
  }
  assertFileHash(plan.artifact.file, plan.artifact.sha256, 'Artifact');
  assertFileHash(plan.payload.file, plan.payload.sha256, 'Payload');
  assertFileHash(plan.manifest.file, plan.manifest.sha256, 'Signed manifest');
  const verifiedManifest = await loadReleaseEnvelope(plan.manifest.file, {
    publicKeyPem: PUBLIC_RELEASE_PROFILE.publicKeyPem,
  });
  if (verifiedManifest.payload.kind !== plan.kind || verifiedManifest.payload.latest !== plan.version) {
    throw new Error('Signed manifest does not match the release plan');
  }
  const packageDir = path.resolve(plan.source.packageDir);
  const status = run('git', ['status', '--porcelain'], { cwd: packageDir });
  if (status.stdout.trim()) throw new Error('Source repository must be clean before publication');
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: packageDir }).stdout.trim();
  if (!plan.source.commit || head !== plan.source.commit) throw new Error('Source commit differs from the prepared release plan');

  const repository = ghJson(['repo', 'view', plan.repo, '--json', 'visibility,url']);
  if (repository.visibility !== 'PUBLIC') throw new Error(`GitHub repository must be public before publication: ${plan.repo}`);
  run('gh', ['api', `repos/${plan.repo}/commits/${head}`]);
  const existingRelease = run('gh', ['release', 'view', plan.tag, '--repo', plan.repo, '--json', 'isDraft,assets'], { allowFailure: true });
  if (existingRelease.status === 0) throw new Error(`GitHub Release already exists: ${plan.repo} ${plan.tag}`);

  run('gh', [
    'release', 'create', plan.tag,
    plan.artifact.file,
    plan.manifest.file,
    '--repo', plan.repo,
    '--target', head,
    '--title', plan.title,
    '--notes', `Signed stable ${plan.kind} release ${plan.version}.`,
    '--draft',
  ]);
  const draft = ghJson(['release', 'view', plan.tag, '--repo', plan.repo, '--json', 'isDraft,assets']);
  const assetNames = new Set((draft.assets || []).map((asset) => asset.name));
  if (!draft.isDraft || !assetNames.has(plan.artifact.name) || !assetNames.has(plan.manifest.name)) {
    throw new Error('Draft Release verification failed; it was left unpublished for review');
  }
  run('gh', ['release', 'edit', plan.tag, '--repo', plan.repo, '--draft=false', '--latest']);

  const branch = plan.manifest.channelBranch;
  const ref = run('gh', ['api', `repos/${plan.repo}/git/ref/heads/${branch}`], { allowFailure: true });
  const manifestBytes = fs.readFileSync(plan.manifest.file);
  const message = `release: promote ${plan.kind} ${plan.version}`;
  const channelCommit = ref.status === 0
    ? updateChannelBranch(plan.repo, branch, plan.manifest.channelPath, manifestBytes, message)
    : createChannelBranch(plan.repo, branch, plan.manifest.channelPath, manifestBytes, message);
  return {
    published: true,
    repo: plan.repo,
    tag: plan.tag,
    releaseUrl: `https://github.com/${plan.repo}/releases/tag/${plan.tag}`,
    channel: {
      branch,
      path: plan.manifest.channelPath,
      commit: channelCommit,
    },
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptFile;
if (invokedDirectly) {
  try {
    const result = await publishRelease(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

export { publishRelease };
