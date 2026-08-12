import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { invariant, WorkflowError } from '../errors.js';
import { writePrivateFile } from '../fs/secure-json.js';
import { MAX_TOKEN_FILE_BYTES, readPlatformTokenFile } from './token-source.js';

export const MACOS_TOKEN_DIALOG_SCRIPT = `
try
  set promptResult to display dialog "请输入当前用户 Token。内容仅保存在本机私有文件中。" default answer "" with hidden answer buttons {"取消", "继续"} default button "继续" cancel button "取消" with title "iVX V4→V5 转换工作流"
  return text returned of promptResult
on error number -128
  error number -128
end try
`;

function stripOneFinalNewline(value) {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}

function runMacosTokenDialog(runProcess) {
  let result;
  try {
    result = runProcess('/usr/bin/osascript', ['-e', MACOS_TOKEN_DIALOG_SCRIPT], {
      encoding: 'utf8',
      maxBuffer: MAX_TOKEN_FILE_BYTES + 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new WorkflowError(
      'VISIBLE_TOKEN_PROMPT_UNAVAILABLE',
      'The native secure Token prompt could not be opened',
    );
  }
  if (result?.status !== 0) {
    const cancelled = /(?:User canceled|\(-128\)|number -128)/iu.test(String(result?.stderr || ''));
    if (cancelled) {
      throw new WorkflowError('TOKEN_PROMPT_CANCELLED', 'Token entry was cancelled; setup did not continue');
    }
    throw new WorkflowError(
      'VISIBLE_TOKEN_PROMPT_UNAVAILABLE',
      'The native secure Token prompt could not be completed',
    );
  }
  return String(result.stdout ?? '');
}

export function promptAndPersistPlatformToken({
  appPaths,
  platform = process.platform,
  runProcess = spawnSync,
} = {}) {
  invariant(appPaths?.home, 'APP_HOME_REQUIRED', 'Application home is required for secure Token storage');
  invariant(
    platform === 'darwin',
    'VISIBLE_TOKEN_PROMPT_UNAVAILABLE',
    'The built-in visible secure Token prompt currently requires macOS',
    { platform },
  );
  const raw = runMacosTokenDialog(runProcess);
  const token = stripOneFinalNewline(raw);
  invariant(
    Buffer.byteLength(raw, 'utf8') > 0
      && Buffer.byteLength(raw, 'utf8') <= MAX_TOKEN_FILE_BYTES
      && token.length > 0
      && !/[\s\0]/u.test(token),
    'TOKEN_PROMPT_CONTENT_INVALID',
    `Token input must be one non-whitespace value no larger than ${MAX_TOKEN_FILE_BYTES} bytes`,
  );

  const tokenFile = path.join(appPaths.home, 'secrets', 'platform-token');
  writePrivateFile(tokenFile, `${token}\n`);
  readPlatformTokenFile(tokenFile);
  return { tokenFile };
}
