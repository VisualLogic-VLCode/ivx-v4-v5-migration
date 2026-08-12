import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError, invariant } from '../errors.js';

export const MAX_TOKEN_FILE_BYTES = 16 * 1024;

export function normalizeTokenFilePath(value) {
  invariant(typeof value === 'string' && value.trim(), 'TOKEN_FILE_PATH_INVALID', 'Token file path must be a non-empty string');
  return path.resolve(value.trim());
}

function validateTokenFileStats(stats, tokenFile) {
  invariant(stats.isFile(), 'TOKEN_FILE_TYPE_INVALID', 'Token file must be a regular file', { tokenFile });
  const mode = stats.mode & 0o777;
  invariant(mode === 0o600, 'TOKEN_FILE_PERMISSIONS_INVALID', 'Token file permissions must be exactly 0600', {
    tokenFile,
    actualMode: mode.toString(8).padStart(4, '0'),
    requiredMode: '0600',
  });
  if (typeof process.getuid === 'function') {
    invariant(stats.uid === process.getuid(), 'TOKEN_FILE_OWNER_INVALID', 'Token file must be owned by the current user', { tokenFile });
  }
  invariant(stats.size > 0 && stats.size <= MAX_TOKEN_FILE_BYTES, 'TOKEN_FILE_SIZE_INVALID', `Token file must contain between 1 and ${MAX_TOKEN_FILE_BYTES} bytes`, {
    tokenFile,
    size: stats.size,
    maximum: MAX_TOKEN_FILE_BYTES,
  });
  return stats;
}

export function readPlatformTokenFile(value) {
  const tokenFile = normalizeTokenFilePath(value);
  invariant(process.platform !== 'win32', 'TOKEN_FILE_UNSUPPORTED_PLATFORM', 'Token files currently require macOS or Linux permission semantics; use the configured environment variable on Windows', { tokenFile });
  let descriptor;
  let raw;
  try {
    descriptor = fs.openSync(tokenFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    validateTokenFileStats(fs.fstatSync(descriptor), tokenFile);
    raw = fs.readFileSync(descriptor, 'utf8');
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    if (error?.code === 'ELOOP') {
      throw new WorkflowError('TOKEN_FILE_SYMLINK_FORBIDDEN', 'Token file must not be a symbolic link', { tokenFile });
    }
    if (error?.code === 'ENOENT') {
      throw new WorkflowError('TOKEN_FILE_NOT_FOUND', 'Token file is not available', { tokenFile });
    }
    throw new WorkflowError('TOKEN_FILE_READ_FAILED', 'Token file could not be read', { tokenFile });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const token = raw.endsWith('\r\n')
    ? raw.slice(0, -2)
    : raw.endsWith('\n')
      ? raw.slice(0, -1)
      : raw;
  invariant(token.length > 0 && !/[\s\0]/u.test(token), 'TOKEN_FILE_CONTENT_INVALID', 'Token file must contain exactly one non-whitespace token with at most one final newline', { tokenFile });
  return { token, tokenFile };
}

export function resolvePlatformToken({ explicitTokenFile, platform = {}, env = process.env } = {}) {
  const selectedTokenFile = explicitTokenFile !== undefined ? explicitTokenFile : platform.tokenFile;
  if (selectedTokenFile !== null && selectedTokenFile !== undefined) {
    const loaded = readPlatformTokenFile(selectedTokenFile);
    return {
      ...loaded,
      source: 'file',
      tokenEnv: platform.tokenEnv || null,
    };
  }
  const tokenEnv = typeof platform.tokenEnv === 'string' ? platform.tokenEnv.trim() : '';
  const token = tokenEnv ? env[tokenEnv] : undefined;
  invariant(typeof token === 'string' && token.trim(), 'PLATFORM_TOKEN_REQUIRED', `Platform token is required in environment variable ${tokenEnv || '(not configured)'}`);
  return {
    token: token.trim(),
    source: 'environment',
    tokenFile: null,
    tokenEnv,
  };
}

export function inspectPlatformToken(options = {}) {
  const platform = options.platform || {};
  const selectedTokenFile = options.explicitTokenFile !== undefined
    ? options.explicitTokenFile
    : platform.tokenFile;
  const source = selectedTokenFile !== null && selectedTokenFile !== undefined
    ? 'file'
    : 'environment';
  let tokenFile = null;
  if (source === 'file') {
    try {
      tokenFile = normalizeTokenFilePath(selectedTokenFile);
    } catch {}
  }
  try {
    const resolved = resolvePlatformToken(options);
    return {
      available: true,
      source: resolved.source,
      tokenFile: resolved.tokenFile,
      tokenEnv: resolved.tokenEnv,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      source,
      tokenFile,
      tokenEnv: platform.tokenEnv || null,
      error: {
        code: error?.code || 'TOKEN_SOURCE_INVALID',
        message: error?.message || 'Token source is invalid',
      },
    };
  }
}
