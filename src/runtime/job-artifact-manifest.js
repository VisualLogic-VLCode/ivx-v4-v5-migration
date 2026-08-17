import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { invariant } from '../errors.js';
import { sha256File } from '../fs/secure-json.js';

const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function portable(relativePath) {
  return relativePath.split(path.sep).join('/');
}
function contentType(file) {
  if (file.endsWith('.json')) return 'application/json';
  if (/\.(?:md|txt|log|js|mjs|cjs|css|html|xml|yaml|yml)$/i.test(file)) return 'text/plain';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function digestEntries(entries) {
  return crypto.createHash('sha256').update(JSON.stringify(entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    sha256: entry.sha256,
  })))).digest('hex');
}

export function createJobArtifactManifest({ jobs, jobId, now = () => new Date() } = {}) {
  jobs.load(jobId);
  const root = jobs.jobDir(jobId);
  const rootStat = fs.lstatSync(root);
  invariant(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'JOB_ARTIFACT_ROOT_UNSAFE', 'Job artifact root must be a regular directory without symlinks');
  const entries = [];
  let totalBytes = 0;
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      invariant(!stat.isSymbolicLink(), 'JOB_ARTIFACT_SYMLINK_FORBIDDEN', 'Job artifacts cannot contain symlinks', { path: portable(path.relative(root, absolute)) });
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      invariant(stat.isFile(), 'JOB_ARTIFACT_TYPE_FORBIDDEN', 'Job artifacts must contain only regular files and directories', { path: portable(path.relative(root, absolute)) });
      totalBytes += stat.size;
      invariant(entries.length < MAX_FILES && totalBytes <= MAX_TOTAL_BYTES, 'JOB_ARTIFACT_LIMIT_EXCEEDED', 'Job artifact tree exceeds the safe manifest limits');
      const relativePath = portable(path.relative(root, absolute));
      entries.push({ path: relativePath, size: stat.size, sha256: sha256File(absolute), contentType: contentType(relativePath) });
    }
  };
  visit(root);
  const createdAt = now().toISOString();
  return {
    schemaVersion: 1,
    kind: 'job-artifact-manifest',
    jobId,
    root,
    entries,
    fileCount: entries.length,
    totalBytes,
    sha256: digestEntries(entries),
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'PRIVATE',
  };
}
