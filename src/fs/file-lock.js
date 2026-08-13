import fs from 'node:fs';
import { WorkflowError } from '../errors.js';

function lockOwnerIsDead(lockPath) {
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return false;
  }
  const pid = Number(metadata?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

export function acquireFileLock(lockPath, metadata, { code, message }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(handle, `${JSON.stringify(metadata)}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === 0 && lockOwnerIsDead(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      throw new WorkflowError(code, message);
    }
  }
  throw new WorkflowError(code, message);
}

export function releaseFileLock(lockPath, handle) {
  try { fs.closeSync(handle); } catch {}
  try { fs.unlinkSync(lockPath); } catch {}
}

export function withFileLock(lockPath, metadata, error, callback) {
  const handle = acquireFileLock(lockPath, metadata, error);
  const release = () => releaseFileLock(lockPath, handle);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(release);
    release();
    return result;
  } catch (cause) {
    release();
    throw cause;
  }
}
