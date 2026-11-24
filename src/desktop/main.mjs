import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDefaultDisplaySettings, createDisplaySettings, describeDisplayPlanReason, resolveDisplayPlan } from './display-layout.mjs';
import { createInstanceHandoff, validateInstanceHandoff } from './instance-handoff.mjs';
import { resolveOperationManualPath } from './operation-manual.mjs';
import { ensureTouchService, resolveTouchServiceRoot, stopManagedTouchService } from './touch-service-manager.mjs';

// Work around GPU compositor artifacts on the rotated CAVE projection display.
// Electron requires this setting before the app reaches its ready state.
app.disableHardwareAcceleration();

const APP_ROOT = app.getAppPath();
const instanceLaunchData = createInstanceHandoff(process.execPath, app.isPackaged ? [] : [APP_ROOT]);
const hasSingleInstance = app.requestSingleInstanceLock(instanceLaunchData);
if (!hasSingleInstance) app.quit();

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const PRELOAD_FILE = path.join(APP_ROOT, 'src', 'desktop', 'preload.cjs');
let baseUrl = null;
let serverRuntime = null;
let storedSettings = null;
let displayPlan = null;
let runtimeInfo = { mode: 'starting', warning: null };
let staffWindow = null;
let stageWindow = null;
let setupWindow = null;
let isReconfiguring = false;
let isQuitting = false;
let isHandoffInProgress = false;
let runtimeStartupFailed = false;
let runtimeStartupPromise = null;
let displayCheckTimer = null;
let managedTouchService = null;

function readSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'display-settings.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.error('螢幕設定讀取失敗：', error.message); return null; }
}

function writeSettings(settings) {
  const settingsFile = path.join(app.getPath('userData'), 'display-settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = `${settingsFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, settingsFile);
}

function availableDisplays() {
  const primaryId = String(screen.getPrimaryDisplay().id);
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id), index: index + 1, primary: String(display.id) === primaryId,
    bounds: { ...display.bounds }, workArea: { ...display.workArea },
    pixelSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    },
    scaleFactor: display.scaleFactor, rotation: display.rotation,
    internal: Boolean(display.internal)
  }));
}

function projectionResolutionWarning(display) {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  if (width === 2688 && height === 3840) return null;
  return `遊戲使用 2688×3840 原生畫布全螢幕投播；第二螢幕目前解析度約 ${width}×${height}，如需 1:1 輸出，請在 Windows 顯示設定選擇 2688×3840。`;
}

function currentPlan() {
  return resolveDisplayPlan(storedSettings, screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}

function safeWindowOptions(display, options = {}) {
  const area = display?.workArea ?? display?.bounds ?? { x: 0, y: 0, width: 1280, height: 800 };
  return {
    x: area.x, y: area.y, width: Math.max(640, area.width), height: Math.max(480, area.height),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_FILE, contextIsolation: true, nodeIntegration: false, sandbox: true
    },
    ...options
  };
}

function secureWebContents(window, allowedOrigin) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    try {
      const url = new URL(target);
      const localPath = url.protocol === 'file:' ? path.resolve(fileURLToPath(url)) : '';
      const allowed = allowedOrigin === 'file:'
        ? localPath.startsWith(`${PUBLIC_DIR}${path.sep}`)
        : url.origin === allowedOrigin;
      if (!allowed) event.preventDefault();
    } catch { event.preventDefault(); }
  });
}

function notifyDisplayWarning(message) {
  runtimeInfo.warning = message;
  if (staffWindow && !staffWindow.isDestroyed()) staffWindow.webContents.send('desktop:display-warning', message);
}

async function pauseForDisplayChange() {
  try {
    const stateResponse = await fetch(`${baseUrl}/api/state`, { signal: AbortSignal.timeout(1200) });
    const state = await stateResponse.json();
    if (!['idle', 'final_results', 'paused'].includes(state.phase)) {
      await fetch(`${baseUrl}/api/control`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }), signal: AbortSignal.timeout(1200)
      });
    }
  } catch (error) { console.warn('螢幕變更時無法暫停場次：', error.message); }
}

function createIdentifyWindow(display, role) {
  const window = new BrowserWindow({
    ...safeWindowOptions(display, {
      x: display.bounds.x, y: display.bounds.y,
      width: display.bounds.width, height: display.bounds.height,
      frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
      fullscreen: true, backgroundColor: '#07101d',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
  });
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(PUBLIC_DIR, 'display-identify.html'), { query: { role } });
  const timer = setTimeout(() => { if (!window.isDestroyed()) window.close(); }, 8000);
  window.on('closed', () => clearTimeout(timer));
  return window;
}

function closeSetupWindow() {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  const current = setupWindow;
  setupWindow = null;
  current.close();
}

function openSetupWindow(reason = null) {
  if (!baseUrl) return;
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    setupWindow.webContents.reload();
    return;
  }
  const primary = screen.getPrimaryDisplay();
  setupWindow = new BrowserWindow({
    ...safeWindowOptions(primary, {
      width: Math.min(1040, primary.workArea.width), height: Math.min(800, primary.workArea.height),
      minWidth: 720, minHeight: 620, show: false, title: '704 腦力競賽｜螢幕設定',
      webPreferences: {
        preload: PRELOAD_FILE, contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    })
  });
  secureWebContents(setupWindow, 'file:');
  setupWindow.once('ready-to-show', () => setupWindow?.show());
  setupWindow.on('closed', () => { setupWindow = null; });
  setupWindow.loadFile(path.join(PUBLIC_DIR, 'display-setup.html'), { query: { reason: reason ?? '' } });
}

function closeOperationalWindows() {
  isReconfiguring = true;
  const previous = [stageWindow, staffWindow];
  stageWindow = null;
  staffWindow = null;
  for (const window of previous) if (window && !window.isDestroyed()) window.close();
}

function openOperationalWindows(plan) {
  if (!plan.staffDisplay) {
    openSetupWindow(plan.reason);
    isReconfiguring = false;
    return;
  }
  displayPlan = plan;
  const warning = plan.mode === 'preview' ? describeDisplayPlanReason(plan.reason)
    : plan.mode === 'venue' ? projectionResolutionWarning(plan.gameDisplay) : null;
  runtimeInfo = {
    mode: plan.mode,
    warning,
    staffDisplayId: String(plan.staffDisplay.id),
    gameDisplayId: plan.gameDisplay ? String(plan.gameDisplay.id) : null
  };

  const staffBounds = plan.mode === 'preview'
    ? { x: plan.staffDisplay.workArea.x, y: plan.staffDisplay.workArea.y,
        width: Math.floor(plan.staffDisplay.workArea.width * 0.55), height: plan.staffDisplay.workArea.height }
    : { ...plan.staffDisplay.workArea };
  const stageBounds = plan.mode === 'preview'
    ? { x: plan.staffDisplay.workArea.x + staffBounds.width, y: plan.staffDisplay.workArea.y,
        width: plan.staffDisplay.workArea.width - staffBounds.width, height: plan.staffDisplay.workArea.height }
    : { ...plan.gameDisplay.bounds };

  staffWindow = new BrowserWindow({
    ...safeWindowOptions(plan.staffDisplay, {
      ...staffBounds, show: false, title: '704 腦力競賽｜工作人員控制台',
      webPreferences: { preload: PRELOAD_FILE, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
  });
  secureWebContents(staffWindow, new URL(baseUrl).origin);
  staffWindow.once('ready-to-show', () => {
    staffWindow?.show();
    if (plan.mode !== 'preview') staffWindow?.maximize();
    if (runtimeInfo.warning) notifyDisplayWarning(runtimeInfo.warning);
  });
  staffWindow.on('closed', () => { staffWindow = null; });
  staffWindow.loadURL(`${baseUrl}/`);

  stageWindow = new BrowserWindow({
    ...safeWindowOptions(plan.gameDisplay, {
      ...stageBounds, show: false, title: '704 腦力競賽｜遊戲畫面',
      frame: plan.mode !== 'venue', fullscreen: plan.mode === 'venue',
      backgroundColor: '#05080e',
      webPreferences: {
        preload: PRELOAD_FILE, contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false
      }
    })
  });
  secureWebContents(stageWindow, new URL(baseUrl).origin);
  stageWindow.once('ready-to-show', () => {
    stageWindow?.show();
    if (plan.mode === 'venue') stageWindow?.setFullScreen(true);
  });
  stageWindow.on('closed', () => { stageWindow = null; });
  stageWindow.loadURL(`${baseUrl}/stage`);
  isReconfiguring = false;
}

function applyDisplaySettings(settings) {
  storedSettings = settings;
  writeSettings(settings);
  closeOperationalWindows();
  closeSetupWindow();
  openOperationalWindows(currentPlan());
}

function menuTemplate() {
  return [{
    label: '704 腦力競賽',
    submenu: [
      { label: '螢幕設定…', click: async () => { await pauseForDisplayChange(); openSetupWindow(currentPlan().reason); } },
      { type: 'separator' }, { role: 'quit', label: '結束程式' }
    ]
  }];
}

ipcMain.handle('desktop:get-runtime-info', () => ({ ...runtimeInfo }));
ipcMain.handle('desktop:get-display-setup', () => ({
  displays: availableDisplays(), settings: storedSettings,
  reason: currentPlan().reason, warning: runtimeInfo.warning
}));
ipcMain.handle('desktop:identify-display', (event, displayId) => {
  const display = screen.getAllDisplays().find((item) => String(item.id) === String(displayId));
  if (!display) throw new Error('該螢幕已中斷連線，請重新整理設定頁。');
  createIdentifyWindow(display, `螢幕 ${displayId}`);
  return true;
});
ipcMain.handle('desktop:save-display-settings', (event, value) => {
  const settings = createDisplaySettings(value ?? {}, screen.getAllDisplays());
  applyDisplaySettings(settings);
  return { ok: true, runtimeInfo: { ...runtimeInfo } };
});
ipcMain.handle('desktop:continue-preview', () => {
  const displays = screen.getAllDisplays();
  if (displays.length !== 1) throw new Error('只有一個螢幕時才能使用開發預覽。');
  storedSettings = null;
  closeOperationalWindows();
  closeSetupWindow();
  openOperationalWindows(resolveDisplayPlan(null, displays, screen.getPrimaryDisplay().id));
  return { ok: true };
});
ipcMain.handle('desktop:open-display-setup', async () => {
  await pauseForDisplayChange();
  openSetupWindow(currentPlan().reason);
  return { ok: true };
});
ipcMain.handle('desktop:focus-stage', () => {
  if (!stageWindow || stageWindow.isDestroyed()) {
    openOperationalWindows(currentPlan());
  }
  stageWindow?.show();
  stageWindow?.focus();
  return Boolean(stageWindow);
});
ipcMain.handle('desktop:open-operation-manual', async () => {
  const manualPath = resolveOperationManualPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: APP_ROOT
  });
  if (!fs.existsSync(manualPath)) throw new Error(`找不到現場操作手冊：${manualPath}`);
  const error = await shell.openPath(manualPath);
  if (error) throw new Error(`無法開啟現場操作手冊：${error}`);
  return { ok: true };
});

async function recheckDisplays() {
  const plan = currentPlan();
  if (displayPlan?.mode === 'venue' && plan.mode !== 'venue') {
    await pauseForDisplayChange();
    stageWindow?.close();
    stageWindow = null;
    runtimeInfo = { ...runtimeInfo, warning: describeDisplayPlanReason(plan.reason) };
    notifyDisplayWarning(runtimeInfo.warning);
    openSetupWindow(plan.reason);
  } else if (displayPlan?.mode === 'preview' && plan.mode === 'preview' &&
      plan.staffDisplay && displayPlan.staffDisplay &&
      (plan.staffDisplay.id !== displayPlan.staffDisplay.id ||
       JSON.stringify(plan.staffDisplay.bounds) !== JSON.stringify(displayPlan.staffDisplay.bounds))) {
    await pauseForDisplayChange();
    openSetupWindow(plan.reason);
  } else if (displayPlan?.mode === 'preview' && screen.getAllDisplays().length >= 2) {
    await pauseForDisplayChange();
    openSetupWindow('unconfigured');
  }
}

function scheduleDisplayCheck() {
  clearTimeout(displayCheckTimer);
  displayCheckTimer = setTimeout(() => recheckDisplays().catch((error) => console.error(error)), 250);
}

if (hasSingleInstance) {
  app.on('second-instance', (_event, _argv, _workingDirectory, launchData) => {
    const request = validateInstanceHandoff(launchData);
    if (!request.ok) {
      console.warn(`忽略無效的重複啟動要求：${request.reason}`);
      if (staffWindow && !staffWindow.isDestroyed()) staffWindow.focus();
      else setupWindow?.focus();
      return;
    }
    if (isHandoffInProgress) return;
    isHandoffInProgress = true;
    runtimeStartupPromise.then(() => {
      if (runtimeStartupFailed || isQuitting) return;
      try {
        app.relaunch({ execPath: request.execPath, args: request.args });
        app.quit();
      } catch (error) {
        isHandoffInProgress = false;
        console.error('新版本接手失敗，保留目前程式：', error);
        if (staffWindow && !staffWindow.isDestroyed()) staffWindow.focus();
        else setupWindow?.focus();
      }
    });
  });
  app.on('window-all-closed', () => { if (!isReconfiguring && process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    clearTimeout(displayCheckTimer);
    Promise.resolve().then(async () => {
      await serverRuntime?.closeGameServer?.();
      await stopManagedTouchService(managedTouchService);
    }).finally(() => app.exit(0));
  });
  runtimeStartupPromise = app.whenReady().then(async () => {
    process.env.GAME_HOST = '127.0.0.1';
    process.env.GAME_PORT = '0';
    process.env.GAME_DATA_DIR = path.join(app.getPath('userData'), 'data');
    const touchSettings = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config', 'touch-service.desktop.json'), 'utf8'));
    const touchProfile = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config', 'venue-704.json'), 'utf8'));
    const touchService = await ensureTouchService({
      settings: { ...touchSettings, webSocketUrl: process.env.TOUCH_SERVICE_URL ?? touchSettings.webSocketUrl },
      profile: touchProfile,
      userDataPath: app.getPath('userData'),
      serviceRoot: resolveTouchServiceRoot(touchSettings, {
        appRoot: APP_ROOT,
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
        overrideRoot: process.env.TOUCH_SERVICE_ROOT
      })
    });
    managedTouchService = touchService.process;
    process.env.TOUCH_SERVICE_URL = touchService.url;
    console.info(`[TouchService 啟動器] ${touchService.status}：${touchService.url}`);
    const serverModule = await import(pathToFileURL(path.join(APP_ROOT, 'src', 'server.mjs')).href);
    const address = await serverModule.serverReady;
    serverRuntime = serverModule;
    baseUrl = `http://127.0.0.1:${address.port}`;
    storedSettings = readSettings();
    if (!storedSettings || storedSettings.schemaVersion !== 1) {
      const automaticSettings = createDefaultDisplaySettings(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
      if (automaticSettings) {
        storedSettings = automaticSettings;
        writeSettings(automaticSettings);
      }
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
    screen.on('display-added', scheduleDisplayCheck);
    screen.on('display-removed', scheduleDisplayCheck);
    screen.on('display-metrics-changed', scheduleDisplayCheck);
    const plan = currentPlan();
    if (plan.mode === 'setup') openSetupWindow(plan.reason);
    else openOperationalWindows(plan);
  }).catch((error) => {
    runtimeStartupFailed = true;
    console.error('704 桌面程式啟動失敗：', error);
    dialog.showErrorBox('704 腦力競賽無法啟動', error.message);
    app.exit(1);
  });
}
