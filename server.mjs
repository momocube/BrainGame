import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GameEngine, GAME_NAMES, GAME_IDS } from './game-engine.mjs';
import { createStageSnapshot } from './stage-view.mjs';
import { TouchFrameGuard, validateTouchServiceHello } from './touch-protocol.mjs';
import { TouchDiagnostics } from './touch-diagnostics.mjs';
import { createOperationalLog } from './operational-log.mjs';
import { createSessionArchiveStore } from './session-archive.mjs';
import { applyEditableRuleSettings, getEditableRuleSettings, validateGameRules } from './game-rules.mjs';
import { validatePlayerZoneConfig } from './player-zone-geometry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.GAME_DATA_DIR ?? path.join(ROOT, 'data'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const STATE_FILE = path.join(DATA_DIR, 'session-state.json');
const HOST = process.env.GAME_HOST ?? '127.0.0.1';
const PORT = Number(process.env.GAME_PORT ?? 7040);
const TOUCH_URL = process.env.TOUCH_SERVICE_URL ?? 'ws://127.0.0.1:20111/';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const defaultRules = validateGameRules(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8')));
const zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-zones.704.json'), 'utf8'));
const touchProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));
validatePlayerZoneConfig(zones, touchProfile);
const touchFrameGuard = new TouchFrameGuard(touchProfile);
const operationalLog = createOperationalLog({ dataDir: DATA_DIR });
const rulesOverrideFile = path.join(DATA_DIR, 'game-rules.override.json');
let rules = defaultRules;
try {
  if (fs.existsSync(rulesOverrideFile)) {
    const savedSettings = JSON.parse(fs.readFileSync(rulesOverrideFile, 'utf8'));
    rules = applyEditableRuleSettings(defaultRules, savedSettings);
  }
} catch (error) {
  operationalLog.write({ level: 'error', type: 'game-rules', action: 'override-rejected', details: { message: error.message } });
  console.error('遊戲規則覆寫檔無效，將使用預設規則：', error.message);
}
const sessionArchive = createSessionArchiveStore({ dataDir: DATA_DIR, zones: zones.players, rules });
let restoredState = null;
try { restoredState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') console.error('無法讀取場次狀態，將以新狀態啟動：', error.message); }
let savedSessionId = restoredState?.sessionId ?? null;
let savedSessionPhase = restoredState?.phase ?? 'idle';

const subscribers = new Set();
let gameTick;
let closePromise = null;
function persist(state) {
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temp, STATE_FILE);
  try { sessionArchive.save(state); }
  catch (error) {
    operationalLog.write({ level: 'error', type: 'session-archive', action: 'save-failed', sessionId: state.sessionId, details: { message: error.message } });
  }
  if (state.sessionId && state.sessionId !== savedSessionId) {
    operationalLog.write({ type: 'session', action: 'started', sessionId: state.sessionId, details: { startedAt: state.sessionStartedAt } });
  }
  if (state.sessionId && state.phase === 'final_results' && savedSessionPhase !== 'final_results') {
    operationalLog.write({ type: 'session', action: 'finished', sessionId: state.sessionId, details: { elapsedMs: state.sessionElapsedMs, expired: Boolean(state.sessionExpired) } });
  }
  savedSessionId = state.sessionId ?? null;
  savedSessionPhase = state.phase;
}
const engine = new GameEngine({
  rules, zones, initialState: restoredState,
  onSave: persist,
  onChange: () => publish(),
  onInput: (input) => operationalLog.write({
    type: 'player-input', action: input.action.type ?? input.action.key ?? 'touch', sessionId: input.sessionId,
    details: input
  })
});
const touchDiagnostics = new TouchDiagnostics({
  canvas: zones.canvas,
  zones: zones.players,
  reservedRects: zones.reservedRects,
  faces: touchProfile.faces,
  mapTouch: (event) => ({
    cadPoint: engine.touchCadPoint(event.px),
    position: engine.canvasPosition(event.face, event.px)
  })
});
if (engine.state.sessionId) {
  try { sessionArchive.save(engine.state); }
  catch (error) {
    operationalLog.write({ level: 'error', type: 'session-archive', action: 'startup-migration-failed', sessionId: engine.state.sessionId, details: { message: error.message } });
  }
}

function viewForStage() {
  return createStageSnapshot(engine, engine.rules, zones);
}

function stateFor(view = 'staff') {
  if (view === 'stage') return viewForStage();
  if (view === 'diagnostics') return touchDiagnostics.snapshot({ ready: engine.inputsReady, detail: engine.inputDetail });
  return {
    ...engine.snapshot(), finalRankings: engine.finalRankings(),
    output: { stageConnections: [...subscribers].filter((client) => client.view === 'stage').length }
  };
}

function publish() {
  if (!subscribers.size) return;
  for (const client of subscribers) {
    try { client.response.write(`data: ${JSON.stringify(stateFor(client.view))}\n\n`); }
    catch { subscribers.delete(client); }
  }
}

function publishDiagnostics() {
  const clients = [...subscribers].filter((client) => client.view === 'diagnostics');
  if (!clients.length) return;
  const message = `data: ${JSON.stringify(stateFor('diagnostics'))}\n\n`;
  for (const client of clients) {
    try { client.response.write(message); }
    catch { subscribers.delete(client); }
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function sendCsv(response, filename, value) {
  const body = Buffer.from(value, 'utf8');
  response.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8', 'content-length': body.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function sendDownloadJson(response, filename, value) {
  const body = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8', 'content-length': body.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('請求內容超過 64 KB');
    chunks.push(chunk);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function performControl(body) {
  switch (body.action) {
    case 'start-session': engine.startSession(); break;
    case 'pause': engine.pause('工作人員暫停'); break;
    case 'resume': engine.resume(); break;
    case 'end-session': engine.endSession(); break;
    case 'return-to-standby': engine.returnToStandby(); break;
    case 'cancel-round': engine.cancelRound(); break;
    case 'restart-round': engine.restartRound(); break;
    case 'return-to-lobby': engine.returnToLobby(); break;
    case 'start-after-tutorial': engine.startAfterTutorial(); break;
    case 'select-game': engine.selectGame(body.gameId); break;
    case 'select-random-game': engine.selectRandomGame(); break;
    case 'join-zone': engine.join(body.zoneId); break;
    case 'ready-zone': engine.setReady(body.zoneId); break;
    default: throw new Error(`未知控制操作：${String(body.action)}`);
  }
  operationalLog.write({
    type: 'staff-control', action: String(body.action), sessionId: engine.state.sessionId,
    details: {
      zoneId: typeof body.zoneId === 'string' ? body.zoneId : null,
      gameId: engine.state.selectedGame,
      phase: engine.state.phase
    }
  });
  return stateFor('staff');
}

function serveStatic(request, response, pathname) {
  const route = pathname === '/' ? '/staff.html' : pathname === '/stage' ? '/stage.html' : pathname;
  const file = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(route)}`);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden' });
  fs.readFile(file, (error, bytes) => {
    if (error) return sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: '找不到頁面' });
    response.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': bytes.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff'
    });
    response.end(bytes);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { ok: true, phase: engine.state.phase, touch: engine.inputsReady });
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const requestedView = url.searchParams.get('view');
      const view = ['stage', 'diagnostics'].includes(requestedView) ? requestedView : 'staff';
      return sendJson(response, 200, stateFor(view));
    }
    if (request.method === 'GET' && url.pathname === '/api/rules') {
      return sendJson(response, 200, {
        settings: getEditableRuleSettings(engine.rules),
        editable: ['idle', 'final_results'].includes(engine.state.phase)
      });
    }
    if (request.method === 'PUT' && url.pathname === '/api/rules') {
      if (!['idle', 'final_results'].includes(engine.state.phase)) {
        throw new Error('場次進行中不可修改遊戲設定；請先結束場次。');
      }
      const payload = await readBody(request);
      const nextRules = applyEditableRuleSettings(engine.rules, payload.settings);
      const tempFile = `${rulesOverrideFile}.${process.pid}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(getEditableRuleSettings(nextRules), null, 2), 'utf8');
      fs.renameSync(tempFile, rulesOverrideFile);
      engine.applyRules(nextRules);
      rules = nextRules;
      operationalLog.write({ type: 'game-rules', action: 'settings-saved', details: { enabledGames: engine.gameOrder, rulesVersion: rules.rulesVersion } });
      return sendJson(response, 200, { ok: true, settings: getEditableRuleSettings(rules) });
    }
    if (request.method === 'GET' && url.pathname === '/api/sessions') {
      return sendJson(response, 200, { sessions: sessionArchive.list() });
    }
    const exportMatch = request.method === 'GET' && url.pathname.match(/^\/api\/sessions\/([^/]+)\.csv$/);
    if (exportMatch) {
      const sessionId = exportMatch[1];
      const csv = sessionArchive.csv(sessionId);
      if (csv == null) return sendJson(response, 404, { error: '找不到場次紀錄' });
      return sendCsv(response, `704-session-${sessionId}.csv`, csv);
    }
    const archiveMatch = request.method === 'GET' && url.pathname.match(/^\/api\/sessions\/([^/]+)\.json$/);
    if (archiveMatch) {
      const sessionId = archiveMatch[1];
      const archive = sessionArchive.get(sessionId);
      if (archive == null) return sendJson(response, 404, { error: '找不到場次紀錄' });
      return sendDownloadJson(response, `704-session-${sessionId}.json`, archive);
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      const requestedView = url.searchParams.get('view');
      const view = ['stage', 'diagnostics'].includes(requestedView) ? requestedView : 'staff';
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive', 'x-accel-buffering': 'no'
      });
      response.write(`data: ${JSON.stringify(stateFor(view))}\n\n`);
      const client = { response, view };
      subscribers.add(client);
      response.on('close', () => {
        const removed = subscribers.delete(client);
        if (removed && view === 'stage' && !shuttingDown) publish();
      });
      if (view === 'stage') publish();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/control') {
      return sendJson(response, 200, { ok: true, state: performControl(await readBody(request)) });
    }
    if (request.method === 'GET') return serveStatic(request, response, url.pathname);
    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    operationalLog.write({
      level: 'error', type: 'http', action: 'request-failed', sessionId: engine.state.sessionId,
      details: { method: request.method, path: url.pathname, message: error.message || '請求失敗' }
    });
    sendJson(response, 400, { error: error.message || '請求失敗' });
  }
});

let shuttingDown = false;
let touchSocket = null;
let retryDelayMs = 1000;
let lastTouchFrameAt = 0;
let touchStatus = '尚未連線';
function connectTouchService() {
  if (shuttingDown) return;
  if (typeof WebSocket !== 'function') {
    touchStatus = '此 Node.js 未提供 WebSocket client';
    operationalLog.write({ level: 'error', type: 'touch-service', action: 'websocket-unavailable', sessionId: engine.state.sessionId });
    engine.setInputStatus(false, touchStatus);
    setTimeout(connectTouchService, 10_000).unref();
    return;
  }
  touchStatus = `連線中：${TOUCH_URL}`;
  engine.setInputStatus(false, touchStatus);
  let socket;
  try { socket = new WebSocket(TOUCH_URL); }
  catch (error) {
    touchStatus = `TouchService 連線失敗：${error.message}`;
    engine.setInputStatus(false, touchStatus);
    setTimeout(connectTouchService, retryDelayMs).unref();
    retryDelayMs = Math.min(10_000, retryDelayMs * 2);
    return;
  }
  touchSocket = socket;
  let verified = false;
  let verifiedVenue = null;
  socket.addEventListener('open', () => {
    lastTouchFrameAt = Date.now();
    touchStatus = '已連線，等待 TouchService hello';
    operationalLog.write({ type: 'touch-service', action: 'socket-opened', sessionId: engine.state.sessionId, details: { url: TOUCH_URL } });
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type) {
        if (message.type === 'hello') {
          validateTouchServiceHello(message, touchProfile);
          touchFrameGuard.reset();
          engine.clearTouchContacts();
          touchDiagnostics.reset();
          verified = true;
          verifiedVenue = message.venue;
          engine.touchReleaseTimeoutMs = Number.isFinite(message.releaseTimeoutMs) ? Math.max(0, message.releaseTimeoutMs) : 0;
          retryDelayMs = 1000;
          if (message.autoLockActive !== undefined && typeof message.autoLockActive !== 'boolean') {
            throw new Error('TouchService hello 的 autoLockActive 必須是布林值');
          }
          const autoLockActive = message.autoLockActive === true;
          const remainingSeconds = Number.isFinite(message.autoLockRemainingSeconds)
            ? Math.max(0, Math.ceil(message.autoLockRemainingSeconds)) : 0;
          touchStatus = autoLockActive
            ? `TouchService 啟動自檢中・約 ${remainingSeconds} 秒後開放觸控`
            : `TouchService v1 / venue ${message.venue}`;
          engine.setInputStatus(!autoLockActive, touchStatus);
          operationalLog.write({ type: 'touch-service', action: 'hello-verified', sessionId: engine.state.sessionId, details: { venue: message.venue, version: message.v } });
          if (autoLockActive) {
            operationalLog.write({ type: 'touch-service', action: 'startup-self-check-active', sessionId: engine.state.sessionId, details: { venue: message.venue, remainingSeconds } });
          }
        } else if (message.type === 'locks' && verified && message.autoLockActive !== undefined) {
          if (typeof message.autoLockActive !== 'boolean') {
            throw new Error('TouchService locks 的 autoLockActive 必須是布林值');
          }
          const autoLockActive = message.autoLockActive;
          const remainingSeconds = Number.isFinite(message.autoLockRemainingSeconds)
            ? Math.max(0, Math.ceil(message.autoLockRemainingSeconds)) : 0;
          touchStatus = autoLockActive
            ? `TouchService 啟動自檢中・約 ${remainingSeconds} 秒後開放觸控`
            : `TouchService v1 / venue ${verifiedVenue}`;
          engine.setInputStatus(!autoLockActive, touchStatus);
          operationalLog.write({
            type: 'touch-service', action: autoLockActive ? 'startup-self-check-active' : 'startup-self-check-complete',
            sessionId: engine.state.sessionId, details: { venue: verifiedVenue, remainingSeconds }
          });
        }
        return;
      }
      if (!verified) return;
      if (!touchFrameGuard.accept(message)) return;
      lastTouchFrameAt = Date.now();
      touchDiagnostics.accept(message);
      publishDiagnostics();
      engine.handleTouchFrame(message);
    } catch (error) {
      touchStatus = `TouchService 訊息錯誤：${error.message}`;
      operationalLog.write({ level: 'error', type: 'touch-service', action: 'message-rejected', sessionId: engine.state.sessionId, details: { message: error.message } });
      engine.setInputStatus(false, touchStatus);
      try { socket.close(); } catch { /* ignore */ }
    }
  });
  socket.addEventListener('error', () => {
    touchStatus = 'TouchService WebSocket 發生錯誤';
    operationalLog.write({ level: 'error', type: 'touch-service', action: 'socket-error', sessionId: engine.state.sessionId });
  });
  socket.addEventListener('close', () => {
    if (touchSocket === socket) touchSocket = null;
    engine.clearTouchContacts();
    touchDiagnostics.clear();
    touchFrameGuard.reset();
    if (!shuttingDown) {
      touchStatus = 'TouchService 已中斷，正在重新連線';
      operationalLog.write({ level: 'warn', type: 'touch-service', action: 'disconnected', sessionId: engine.state.sessionId });
      engine.setInputStatus(false, touchStatus);
      setTimeout(connectTouchService, retryDelayMs).unref();
      retryDelayMs = Math.min(10_000, retryDelayMs * 2);
    }
  });
}

const heartbeatWatch = setInterval(() => {
  if (touchSocket?.readyState === 1 && lastTouchFrameAt && Date.now() - lastTouchFrameAt > 3000) {
    const wasReady = engine.inputsReady;
    touchStatus = '超過 3 秒未收到 TouchService frame';
    engine.setInputStatus(false, touchStatus);
    if (wasReady) {
      touchDiagnostics.clear();
      publishDiagnostics();
    }
  }
}, 500);
heartbeatWatch.unref();
gameTick = setInterval(() => engine.tick(), 100);
gameTick.unref();

export const serverReady = new Promise((resolve, reject) => {
  const onError = (error) => reject(error);
  server.once('error', onError);
  server.listen(PORT, HOST, () => {
    server.off('error', onError);
    const address = server.address();
    console.log(`704 腦力競賽服務：http://${HOST}:${address.port}`);
    console.log(`TouchService：${TOUCH_URL}`);
    operationalLog.write({ type: 'server', action: 'started', details: { host: HOST, port: address.port, touchServiceUrl: TOUCH_URL } });
    connectTouchService();
    resolve(address);
  });
});

export function closeGameServer() {
  if (closePromise) return closePromise;
  shuttingDown = true;
  operationalLog.write({ type: 'server', action: 'stopped', sessionId: engine.state.sessionId });
  clearInterval(heartbeatWatch);
  clearInterval(gameTick);
  try { touchSocket?.close(); } catch { /* ignore */ }
  for (const client of subscribers) client.response.end();
  subscribers.clear();
  closePromise = new Promise((resolve) => {
    if (!server.listening) return resolve();
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 1500);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return closePromise;
}

console.log(`已載入 ${GAME_IDS.length} 款遊戲：${GAME_IDS.map((id) => GAME_NAMES[id]).join('、')}`);

const isMainModule = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  const shutdown = () => closeGameServer().finally(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  serverReady.catch((error) => {
    console.error(`遊戲服務啟動失敗：${error.message}`);
    process.exitCode = 1;
  });
}
