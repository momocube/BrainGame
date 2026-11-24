import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { validateTouchServiceHello } from '../touch-protocol.mjs';

const execFile = promisify(execFileCallback);

export function touchServiceUrlFromConfig(config, fallbackUrl = null) {
  if (config?.webSocketOutput?.enabled !== true) throw new Error('TouchService 的 WebSocket 輸出未啟用');
  if (fallbackUrl) return fallbackUrl;
  const port = Number(config?.webSocketOutput?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('TouchService 的 WebSocket port 無效');
  }
  return `ws://127.0.0.1:${port}/`;
}

export function createRuntimeTouchServiceConfig(source, { serviceRoot, userDataPath, venueProfileRelativePath }) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('TouchService config 格式無效');
  const config = structuredClone(source);
  config.venueProfile = path.resolve(serviceRoot, venueProfileRelativePath);
  config.log = { ...(config.log ?? {}), dir: path.join(userDataPath, 'touch-service', 'logs'), console: false };
  config.ui = { ...(config.ui ?? {}), autoLaunch: false, trayEnabled: false };
  return config;
}

export function probeTouchService(url, profile, timeoutMs = 1_500, WebSocketConstructor = WebSocket) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    try { socket = new WebSocketConstructor(url, { handshakeTimeout: timeoutMs }); }
    catch (error) { resolve({ ok: false, error: error.message }); return; }
    const timer = setTimeout(() => finish({ ok: false, error: '等待 TouchService hello 逾時' }), timeoutMs + 100);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore a socket that failed before opening */ }
      resolve(result);
    }

    socket.once('message', (payload) => {
      try {
        const hello = JSON.parse(payload.toString());
        validateTouchServiceHello(hello, profile);
        finish({ ok: true, hello });
      } catch (error) {
        finish({ ok: false, error: error.message });
      }
    });
    socket.once('error', (error) => finish({ ok: false, error: error.message }));
    socket.once('close', () => finish({ ok: false, error: 'TouchService 在 hello 前關閉連線' }));
  });
}

export async function touchServiceProcessExists() {
  if (process.platform !== 'win32') return false;
  const { stdout } = await execFile('tasklist.exe', [
    '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq TouchService.exe'
  ], { windowsHide: true, timeout: 3_000 });
  return /^\s*"TouchService\.exe"/im.test(stdout);
}

function writeRuntimeConfig(filePath, config) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

export function resolveTouchServiceRoot(settings, {
  appRoot,
  resourcesPath,
  isPackaged = false,
  overrideRoot = null,
  fileExists = fs.existsSync
} = {}) {
  if (overrideRoot) return path.resolve(overrideRoot);
  const bundledRoot = isPackaged
    ? (resourcesPath ? path.join(resourcesPath, settings?.bundledResourceName ?? 'touch-service') : null)
    : (appRoot ? path.resolve(appRoot, settings?.bundledDevelopmentRelativePath ?? 'runtime/touch-service') : null);
  const roots = [bundledRoot, settings?.serviceRoot].filter(Boolean).map((root) => path.resolve(root));
  const requiredFiles = [
    settings?.sourceConfigRelativePath ?? 'config.json',
    settings?.executableRelativePath ?? 'publish/win-x64/TouchService.exe',
    settings?.venueProfileRelativePath ?? 'venues/704.json'
  ];
  return roots.find((root) => requiredFiles.every((relativePath) => fileExists(path.resolve(root, relativePath))))
    ?? bundledRoot
    ?? settings?.serviceRoot
    ?? null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function ensureTouchService({
  settings,
  profile,
  userDataPath,
  serviceRoot = settings?.serviceRoot,
  platform = process.platform,
  fileExists = fs.existsSync,
  readFile = fs.readFileSync,
  writeConfig = writeRuntimeConfig,
  probe = probeTouchService,
  processExists = touchServiceProcessExists,
  spawnProcess = spawn,
  wait = sleep,
  now = Date.now,
  logger = console
}) {
  const fallbackUrl = settings?.webSocketUrl ?? 'ws://127.0.0.1:20111/';
  if (platform !== 'win32') return { status: 'unsupported-platform', url: fallbackUrl, process: null };
  if (!serviceRoot || !userDataPath || !profile) return { status: 'configuration-incomplete', url: fallbackUrl, process: null };

  const root = path.resolve(serviceRoot);
  const configPath = path.resolve(root, settings.sourceConfigRelativePath ?? 'config.json');
  const executablePath = path.resolve(root, settings.executableRelativePath ?? 'publish/win-x64/TouchService.exe');
  const venueProfilePath = path.resolve(root, settings.venueProfileRelativePath ?? 'venues/704.json');

  let sourceConfig;
  try {
    sourceConfig = JSON.parse(readFile(configPath, 'utf8'));
  } catch (error) {
    logger.warn?.(`[TouchService] 無法讀取設定 ${configPath}：${error.message}`);
    return { status: 'configuration-unavailable', url: fallbackUrl, process: null };
  }

  let url;
  try { url = touchServiceUrlFromConfig(sourceConfig, fallbackUrl); }
  catch (error) {
    logger.warn?.(`[TouchService] ${error.message}`);
    return { status: 'websocket-disabled', url: fallbackUrl, process: null };
  }

  let existing;
  try { existing = await probe(url, profile, settings.probeTimeoutMs ?? 1_500); }
  catch (error) { existing = { ok: false, error: error.message }; }
  if (existing.ok) return { status: 'connected-existing', url, process: null };
  if (settings.autoStart !== true) return { status: 'not-connected', url, process: null, error: existing.error };

  let anotherProcessExists;
  try { anotherProcessExists = await processExists(); }
  catch (error) {
    logger.warn?.(`[TouchService] 無法確認現有服務程序，為避免重複啟動而略過自動啟動：${error.message}`);
    return { status: 'process-state-unknown', url, process: null, error: existing.error };
  }
  if (anotherProcessExists) {
    logger.warn?.(`[TouchService] 偵測到服務程序但 WebSocket 尚未通過 704 驗證：${existing.error ?? '未知錯誤'}`);
    return { status: 'existing-process-unverified', url, process: null, error: existing.error };
  }
  if (!fileExists(executablePath) || !fileExists(venueProfilePath)) {
    logger.warn?.(`[TouchService] 找不到可啟動的 704 服務或場域檔：${executablePath}`);
    return { status: 'executable-unavailable', url, process: null };
  }

  let runtimeConfig;
  let child = null;
  try {
    runtimeConfig = createRuntimeTouchServiceConfig(sourceConfig, {
      serviceRoot: root, userDataPath, venueProfileRelativePath: settings.venueProfileRelativePath ?? 'venues/704.json'
    });
    const runtimeConfigPath = path.join(userDataPath, 'touch-service', 'config.json');
    const parsedUrl = new URL(url);
    runtimeConfig.webSocketOutput.port = Number(parsedUrl.port || (parsedUrl.protocol === 'wss:' ? 443 : 80));
    writeConfig(runtimeConfigPath, runtimeConfig);

    child = spawnProcess(executablePath, ['--config', runtimeConfigPath], {
      cwd: root, windowsHide: true, detached: false, stdio: 'ignore'
    });
    let spawnError = null;
    child.once('error', (error) => { spawnError = error; });
    const deadline = now() + (settings.startupTimeoutMs ?? 12_000);
    while (now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`TouchService 提前結束，結束碼 ${child.exitCode}`);
      const status = await probe(url, profile, settings.probeTimeoutMs ?? 1_500);
      if (status.ok) return { status: 'started', url, process: child };
      await wait(Math.min(250, Math.max(0, deadline - now())));
    }
    await stopManagedTouchService(child, settings.stopTimeoutMs ?? 2_000);
    logger.warn?.(`[TouchService] 啟動逾時：${url}`);
    return { status: 'startup-timeout', url, process: null };
  } catch (error) {
    if (child && child.exitCode === null) {
      await stopManagedTouchService(child, settings.stopTimeoutMs ?? 2_000);
    }
    logger.warn?.(`[TouchService] 自動啟動失敗：${error.message}`);
    return { status: 'startup-failed', url, process: null, error: error.message };
  }
}

export async function stopManagedTouchService(child, timeoutMs = 2_000) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill(); } catch { return; }
  await Promise.race([exited, sleep(timeoutMs)]);
  if (child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch { /* process is already stopping */ }
  }
}
