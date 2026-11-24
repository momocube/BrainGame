import fs from 'node:fs';
import path from 'node:path';

export const INSTANCE_HANDOFF_PROTOCOL = '704-brain-game-instance-handoff';

export function createInstanceHandoff(execPath, args = [], { platform = process.platform } = {}) {
  if (typeof execPath !== 'string' || !execPath || !Array.isArray(args)) {
    throw new TypeError('單一實例交接資料格式錯誤。');
  }
  const pathApi = platform === 'win32' ? path.win32 : path;
  return {
    protocol: INSTANCE_HANDOFF_PROTOCOL,
    version: 1,
    execPath: pathApi.resolve(execPath),
    args: [...args]
  };
}

export function validateInstanceHandoff(data, {
  platform = process.platform,
  currentExecPath = process.execPath,
  existsSync = fs.existsSync
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const invalid = (reason) => ({ ok: false, reason });

  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      data.protocol !== INSTANCE_HANDOFF_PROTOCOL || data.version !== 1) {
    return invalid('啟動交接資料格式不符。');
  }
  if (typeof data.execPath !== 'string' || !data.execPath || data.execPath.includes('\0') ||
      !pathApi.isAbsolute(data.execPath)) {
    return invalid('新程式執行路徑無效。');
  }

  const execPath = pathApi.normalize(data.execPath);
  const expectedName = pathApi.basename(currentExecPath);
  const incomingName = pathApi.basename(execPath);
  const namesMatch = platform === 'win32'
    ? expectedName.toLowerCase() === incomingName.toLowerCase()
    : expectedName === incomingName;
  if (!expectedName || !namesMatch) return invalid('新程式名稱與目前桌面程式不符。');
  if (!existsSync(execPath)) return invalid('新程式執行檔不存在。');

  if (!Array.isArray(data.args) || data.args.length > 1 || data.args.some((arg) =>
    typeof arg !== 'string' || arg.includes('\0') || arg.length > 4096 ||
    (arg.length > 0 && !pathApi.isAbsolute(arg)))) {
    return invalid('新程式啟動參數無效。');
  }

  return { ok: true, execPath, args: [...data.args] };
}
