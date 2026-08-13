import { spawnSync } from 'node:child_process';
import { WorkflowError, invariant } from '../errors.js';

export const MACOS_RUNTIME_TAKEOVER_SCRIPT = `
try
  display dialog "请在已经打开的浏览器窗口中完成当前步骤。完成后回到此处继续；不要在聊天中发送账号、Cookie 或验证码。" buttons {"取消", "已完成，继续"} default button "已完成，继续" cancel button "取消" with title "iVX 运行时人工接管"
on error number -128
  error number -128
end try
`;

export function waitForVisibleRuntimeTakeover({ platform = process.platform, runProcess = spawnSync } = {}) {
  invariant(platform === 'darwin', 'RUNTIME_VISIBLE_TAKEOVER_UNAVAILABLE', 'The built-in visible runtime takeover prompt currently requires macOS');
  let result;
  try {
    result = runProcess('/usr/bin/osascript', ['-e', MACOS_RUNTIME_TAKEOVER_SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new WorkflowError('RUNTIME_VISIBLE_TAKEOVER_UNAVAILABLE', 'The native runtime takeover prompt could not be opened');
  }
  if (result?.status !== 0) {
    const cancelled = /(?:User canceled|\(-128\)|number -128)/iu.test(String(result?.stderr || ''));
    if (cancelled) throw new WorkflowError('RUNTIME_VISIBLE_TAKEOVER_CANCELLED', 'Visible runtime takeover was cancelled');
    throw new WorkflowError('RUNTIME_VISIBLE_TAKEOVER_UNAVAILABLE', 'The native runtime takeover prompt could not be completed');
  }
  return { completed: true };
}
