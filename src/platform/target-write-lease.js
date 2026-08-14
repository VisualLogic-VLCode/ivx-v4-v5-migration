import path from 'node:path';
import { invariant } from '../errors.js';
import { withFileLock } from '../fs/file-lock.js';

export function withTargetWriteLease(appPaths, targetNid, operation, callback) {
  const nid = Number(targetNid);
  invariant(Number.isSafeInteger(nid) && nid > 0, 'INVALID_TARGET_NID', 'Target write lease requires a positive nid');
  invariant(/^[a-z][a-z0-9-]*$/.test(operation), 'INVALID_OPERATION', 'Invalid target write operation');
  const lockPath = path.join(appPaths.locks, `target-${nid}.write.lock`);
  return withFileLock(lockPath, { pid: process.pid, targetNid: nid, operation, at: new Date().toISOString() }, {
    code: 'TARGET_WRITE_LOCKED',
    message: `Target ${nid} already has an active write operation`,
  }, callback);
}
