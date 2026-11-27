import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GameEngine, GAME_NAMES, GAME_IDS, preflightGameQuestions } from './game-engine.mjs';
import { createStageSnapshot } from './stage-view.mjs';
import { TouchFrameGuard, validateTouchServiceHello } from './touch-protocol.mjs';
import { TouchDiagnostics } from './touch-diagnostics.mjs';
import { handleMouseInput } from './mouse-input.mjs';
import { createOperationalLog } from './operational-log.mjs';
import { createSessionArchiveStore } from './session-archive.mjs';
import { readTouchInteractionEnabled } from './touch-service-status.mjs';
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
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const defaultRules = validateGameRules(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8')));
const zones = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-zones.704.json'), 'utf8')),
  profilePlan: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-layouts.704.json'), 'utf8'))
};
const touchProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));
validatePlayerZoneConfig(zones, touchProfile);
const touchFrameGuard = new TouchFrameGuard(touchProfile);
const STAGE_DISCONNECT_GRACE_MS = 4_000;
const STAGE_RENDER_TIMEOUT_MS = 4_000;
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
// Every app launch starts in standby. Archive the previous session before replacing
// its active snapshot, keeping settled scores while discarding unfinished play.
if (restoredState?.sessionId) {
  sessionArchive.save(restoredState);
  if (restoredState.phase !== 'final_results') {
    sessionArchive.save({ ...restoredState, phase: 'final_results', currentRound: null,
      updatedAt: new Date().toISOString() });
  }
}

const subscribers = new Set();
let gameTick;
let closePromise = null;
let touchSocket = null;
let touchProtocolReady = false;
let touchSelfCheckActive = false;
let touchSelfCheckRemainingSeconds = 0;
let touchInteractionEnabled = null;
let touchInteractionError = null;
let touchConfigProbe = null;
let touchFrameTimedOut = false;
let touchVerifiedVenue = null;
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
  rules, zones,
  onSave: persist,
  onChange: () => publish(),
  onInput: (input) => operationalLog.write({
    type: 'player-input', action: input.action.type ?? input.action.key ?? 'touch', sessionId: input.sessionId,
    details: input
  })
});
const touchDiagnostics = new TouchDiagnostics({
  canvas: zones.canvas,
  zones: engine.zones,
  questionPanels: engine.layout.questionPanels,
  layout: engine.snapshot().layout,
  reservedRects: zones.reservedRects,
  faces: touchProfile.faces,
  mapTouch: (event) => ({
    cadPoint: engine.touchCadPoint(event.px),
    position: engine.canvasPosition(event.face, event.px)
  })
});
persist(engine.state);

function viewForStage() {
  return createStageSnapshot(engine, engine.rules, zones);
}

function stageConnectionCount() {
  return [...subscribers].filter((client) => client.view === 'stage').length;
}

function stageReadyClients(now = Date.now()) {
  return [...subscribers].filter((client) => client.view === 'stage' &&
    client.lastPaintAt && now - client.lastPaintAt <= STAGE_RENDER_TIMEOUT_MS);
}

function stateFor(view = 'staff') {
  if (view === 'stage') return viewForStage();
  if (view === 'diagnostics') {
    touchDiagnostics.updateLayout({
      zones: engine.zones,
      questionPanels: engine.layout.questionPanels,
      layout: engine.snapshot().layout
    });
    return touchDiagnostics.snapshot({
      ready: engine.inputsReady,
      detail: engine.inputDetail,
      releaseTimeoutMs: engine.touchReleaseTimeoutMs >= 10 ? engine.touchReleaseTimeoutMs : null,
      interactionEnabled: touchInteractionEnabled
    });
  }
  const readyStageConnections = stageReadyClients().length;
  const snapshot = engine.snapshot();
  snapshot.input.interactionEnabled = touchInteractionEnabled;
  return {
    ...snapshot, finalRankings: engine.finalRankings(),
    output: {
      stageConnections: stageConnectionCount(),
      stageReadyConnections: readyStageConnections,
      stageReady: readyStageConnections > 0
    }
  };
}

function publish() {
  if (!subscribers.size) return;
  let stageNeedsPublish = false;
  for (const client of subscribers) {
    if (client.view === 'stage') {
      stageNeedsPublish = true;
      continue;
    }
    try { client.response.write(`id: ${client.id}\ndata: ${JSON.stringify(stateFor(client.view))}\n\n`); }
    catch { subscribers.delete(client); }
  }
  if (stageNeedsPublish) scheduleStagePublish();
}

let stagePublishTimer = null;
function scheduleStagePublish() {
  if (stagePublishTimer) return;
  stagePublishTimer = setTimeout(() => {
    stagePublishTimer = null;
    const clients = [...subscribers].filter((client) => client.view === 'stage');
    if (!clients.length) return;
    const data = JSON.stringify(stateFor('stage'));
    for (const client of clients) {
      try { client.response.write(`id: ${client.id}\ndata: ${data}\n\n`); }
      catch { subscribers.delete(client); }
    }
  }, 200);
  stagePublishTimer.unref?.();
}

function publishStaffState() {
  const clients = [...subscribers].filter((client) => client.view === 'staff');
  if (!clients.length) return;
  const message = `data: ${JSON.stringify(stateFor('staff'))}\n\n`;
  for (const client of clients) {
    try { client.response.write(message); }
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
    case 'start-session':
      engine.assertCanStartSession();
      if (!stageReadyClients().length) throw new Error('遊戲畫面尚未完成繪製，無法開始場次。');
      engine.startSession();
      break;
    case 'pause': engine.pause('工作人員暫停'); break;
    case 'resume':
      if (!stageReadyClients().length) throw new Error('遊戲畫面尚未完成繪製或回報逾時，無法繼續場次。');
      engine.resume();
      break;
    case 'end-session': engine.endSession(); break;
    case 'return-to-standby': engine.returnToStandby(); break;
    case 'cancel-round': engine.cancelRound(); break;
    case 'restart-round': engine.restartRound(); break;
    case 'return-to-lobby':
      if (['paused', 'resume_countdown'].includes(engine.state.phase)) {
        if (!stageReadyClients().length) throw new Error('遊戲畫面尚未完成繪製或回報逾時，無法回到大廳。');
      }
      engine.returnToLobby();
      break;
    case 'confirm-game-selection': engine.confirmGameSelection(); break;
    case 'start-after-tutorial': engine.startAfterTutorial(); break;
    case 'select-game': engine.selectGame(body.gameId); break;
    case 'select-random-game': engine.selectRandomGame(); break;
    case 'join-zone': engine.joinFromZone(body.zoneId); break;
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
      return sendJson(response, 200, {
        ok: true, phase: engine.state.phase, touch: engine.inputsReady,
        touchInteractionEnabled
      });
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
    if (request.method === 'POST' && url.pathname === '/api/question-preflight') {
      if (!['idle', 'final_results'].includes(engine.state.phase)) {
        throw new Error('場次進行中不可執行題目檢查；請在待機或總結算時檢查。');
      }
      const payload = await readBody(request);
      const candidateRules = payload.settings ? applyEditableRuleSettings(rules, payload.settings) : rules;
      const gameIds = GAME_IDS.filter((gameId) => candidateRules.games[gameId]?.enabled !== false);
      const result = preflightGameQuestions(candidateRules, { gameIds });
      operationalLog.write({
        type: 'question-preflight', action: result.passed ? 'passed' : 'failed',
        details: {
          gameCount: result.gameCount, totalRounds: result.totalRounds,
          checkedRounds: result.checkedRounds, failedRounds: result.failedRounds,
          durationMs: Math.round(result.durationMs)
        }
      });
      return sendJson(response, 200, { ok: result.passed, result });
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
      const client = { id: randomUUID(), response, view, connectedAt: Date.now(), lastPaintAt: 0 };
      response.write(`id: ${client.id}\ndata: ${JSON.stringify(stateFor(view))}\n\n`);
      subscribers.add(client);
      response.on('close', () => {
        const removed = subscribers.delete(client);
        if (view === 'stage') engine.clearTouchContacts(`mouse:${client.id}`);
        if (removed && view === 'stage' && !shuttingDown) publish();
      });
      if (view === 'stage') publish();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/stage-ready') {
      const payload = await readBody(request);
      const client = [...subscribers].find((item) => item.view === 'stage' && item.id === payload.clientId);
      if (!client) return sendJson(response, 409, { ok: false, error: '遊戲畫面連線已失效，請等待畫面重新連線。' });
      const previousPaintAgeMs = client.lastPaintAt ? Date.now() - client.lastPaintAt : null;
      client.lastPaintAt = Date.now();
      client.lastVisibilityState = payload.visibilityState === 'visible' || payload.visibilityState === 'hidden'
        ? payload.visibilityState : null;
      client.lastRenderDurationMs = Number.isFinite(payload.renderDurationMs) && payload.renderDurationMs >= 0
        ? Math.min(60_000, Math.round(payload.renderDurationMs * 10) / 10) : null;
      client.lastRenderGapMs = Number.isFinite(payload.renderGapMs) && payload.renderGapMs >= 0
        ? Math.min(60_000, Math.round(payload.renderGapMs)) : null;
      if (previousPaintAgeMs !== null && previousPaintAgeMs >= 2_500) {
        operationalLog.write({
          level: 'warn', type: 'stage-output', action: 'paint-recovered-after-gap', sessionId: engine.state.sessionId,
          details: {
            gapMs: previousPaintAgeMs, phase: engine.state.phase,
            visibilityState: client.lastVisibilityState,
            renderDurationMs: client.lastRenderDurationMs, renderGapMs: client.lastRenderGapMs
          }
        });
      }
      publishStaffState();
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/mouse-input') {
      const payload = await readBody(request);
      const client = [...subscribers].find((item) => item.view === 'stage' && item.id === payload.clientId);
      if (!client) throw new Error('遊戲畫面連線已失效，請重新開啟遊戲畫面');
      handleMouseInput(engine, payload, client.id);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/control') {
      const payload = await readBody(request);
      if (payload.action === 'start-session') {
        await refreshTouchServiceConfig(touchSocket, { forceFresh: true });
      }
      return sendJson(response, 200, { ok: true, state: performControl(payload) });
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
let retryDelayMs = 1000;
let lastTouchFrameAt = 0;
let touchStatus = '尚未連線';
function setInputReadiness(ready, detail) {
  engine.setInputStatus(ready, detail);
}

function updateTouchReadiness() {
  const socketOpen = touchSocket?.readyState === 1;
  const configReady = touchInteractionEnabled === true;
  const protocolReady = socketOpen && touchProtocolReady;
  const ready = protocolReady && !touchSelfCheckActive && configReady && !touchFrameTimedOut;
  let detail = touchStatus;
  if (!socketOpen || !touchProtocolReady) {
    detail = touchStatus;
  } else {
    const blocked = [];
    if (touchInteractionEnabled === null) {
      blocked.push(touchInteractionError
        ? `無法確認互動總開關：${touchInteractionError}`
        : '正在確認 TouchService 互動總開關');
    } else if (!touchInteractionEnabled) blocked.push('互動總開關已停用，請在 TouchService 管理頁恢復');
    if (touchSelfCheckActive) blocked.push(`TouchService 啟動自檢中・約 ${touchSelfCheckRemainingSeconds} 秒後開放觸控`);
    if (touchFrameTimedOut) blocked.push('超過 3 秒未收到 TouchService frame');
    detail = blocked.length
      ? `TouchService 未就緒・${blocked.join('；')}`
      : `TouchService v1 / venue ${touchVerifiedVenue}・互動已啟用`;
  }
  touchStatus = detail;
  setInputReadiness(ready, detail);
  publishDiagnostics();
}

async function refreshTouchServiceConfig(socket = touchSocket, { forceFresh = false } = {}) {
  if (shuttingDown) return;
  if (socket !== touchSocket) {
    if (forceFresh) return refreshTouchServiceConfig(touchSocket, { forceFresh: true });
    return;
  }
  if (!socket || socket.readyState !== 1 || !touchProtocolReady) {
    if (forceFresh) updateTouchReadiness();
    return;
  }
  if (touchConfigProbe) {
    const inFlightProbe = touchConfigProbe;
    await inFlightProbe;
    if (!forceFresh || shuttingDown) return;
    if (socket !== touchSocket) return refreshTouchServiceConfig(touchSocket, { forceFresh: true });
    if (!socket || socket.readyState !== 1 || !touchProtocolReady) {
      updateTouchReadiness();
      return;
    }
    if (touchConfigProbe) return refreshTouchServiceConfig(socket, { forceFresh: true });
  }
  const probe = (async () => {
    try {
      const enabled = await readTouchInteractionEnabled(TOUCH_URL);
      if (shuttingDown || socket !== touchSocket || !touchProtocolReady) return;
      const changed = enabled !== touchInteractionEnabled;
      touchInteractionEnabled = enabled;
      touchInteractionError = null;
      if (changed) {
        operationalLog.write({
          type: 'touch-service', action: enabled ? 'interaction-enabled' : 'interaction-disabled',
          sessionId: engine.state.sessionId, details: { enabled }
        });
      }
    } catch (error) {
      if (shuttingDown || socket !== touchSocket || !touchProtocolReady) return;
      const message = error.message || '無法讀取 TouchService 狀態';
      const changed = touchInteractionEnabled !== null || message !== touchInteractionError;
      touchInteractionEnabled = null;
      touchInteractionError = message;
      if (changed) {
        operationalLog.write({
          level: 'warn', type: 'touch-service', action: 'interaction-status-unavailable',
          sessionId: engine.state.sessionId, details: { message }
        });
      }
    } finally {
      updateTouchReadiness();
    }
  })();
  touchConfigProbe = probe;
  try { await probe; }
  finally { if (touchConfigProbe === probe) touchConfigProbe = null; }
}

function connectTouchService() {
  if (shuttingDown) return;
  touchProtocolReady = false;
  touchSelfCheckActive = false;
  touchSelfCheckRemainingSeconds = 0;
  touchInteractionEnabled = null;
  touchInteractionError = null;
  touchFrameTimedOut = false;
  engine.touchReleaseTimeoutMs = 0;
  if (typeof WebSocket !== 'function') {
    touchStatus = '此 Node.js 未提供 WebSocket client';
    operationalLog.write({ level: 'error', type: 'touch-service', action: 'websocket-unavailable', sessionId: engine.state.sessionId });
    setInputReadiness(false, touchStatus);
    setTimeout(connectTouchService, 10_000).unref();
    return;
  }
  touchStatus = `連線中：${TOUCH_URL}`;
  setInputReadiness(false, touchStatus);
  let socket;
  try { socket = new WebSocket(TOUCH_URL); }
  catch (error) {
    touchStatus = `TouchService 連線失敗：${error.message}`;
    setInputReadiness(false, touchStatus);
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
          touchVerifiedVenue = message.venue;
          engine.touchReleaseTimeoutMs = Number.isFinite(message.releaseTimeoutMs) ? Math.max(0, message.releaseTimeoutMs) : 0;
          retryDelayMs = 1000;
          if (message.autoLockActive !== undefined && typeof message.autoLockActive !== 'boolean') {
            throw new Error('TouchService hello 的 autoLockActive 必須是布林值');
          }
          const autoLockActive = message.autoLockActive === true;
          touchProtocolReady = true;
          touchSelfCheckActive = autoLockActive;
          const remainingSeconds = Number.isFinite(message.autoLockRemainingSeconds)
            ? Math.max(0, Math.ceil(message.autoLockRemainingSeconds)) : 0;
          touchSelfCheckRemainingSeconds = remainingSeconds;
          touchStatus = autoLockActive
            ? `TouchService 啟動自檢中・約 ${remainingSeconds} 秒後開放觸控`
            : `TouchService v1 / venue ${message.venue}`;
          updateTouchReadiness();
          refreshTouchServiceConfig(socket);
          operationalLog.write({ type: 'touch-service', action: 'hello-verified', sessionId: engine.state.sessionId, details: { venue: message.venue, version: message.v } });
          if (autoLockActive) {
            operationalLog.write({ type: 'touch-service', action: 'startup-self-check-active', sessionId: engine.state.sessionId, details: { venue: message.venue, remainingSeconds } });
          }
        } else if (message.type === 'locks' && verified && message.autoLockActive !== undefined) {
          if (typeof message.autoLockActive !== 'boolean') {
            throw new Error('TouchService locks 的 autoLockActive 必須是布林值');
          }
          const autoLockActive = message.autoLockActive;
          touchSelfCheckActive = autoLockActive;
          const remainingSeconds = Number.isFinite(message.autoLockRemainingSeconds)
            ? Math.max(0, Math.ceil(message.autoLockRemainingSeconds)) : 0;
          touchSelfCheckRemainingSeconds = remainingSeconds;
          touchStatus = autoLockActive
            ? `TouchService 啟動自檢中・約 ${remainingSeconds} 秒後開放觸控`
            : `TouchService v1 / venue ${verifiedVenue}`;
          updateTouchReadiness();
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
      const frameRecovered = touchFrameTimedOut;
      touchFrameTimedOut = false;
      touchDiagnostics.accept(message);
      publishDiagnostics();
      if (frameRecovered) updateTouchReadiness();
      if (engine.inputsReady) engine.handleTouchFrame(message);
    } catch (error) {
      touchStatus = `TouchService 訊息錯誤：${error.message}`;
      touchProtocolReady = false;
      operationalLog.write({ level: 'error', type: 'touch-service', action: 'message-rejected', sessionId: engine.state.sessionId, details: { message: error.message } });
      updateTouchReadiness();
      try { socket.close(); } catch { /* ignore */ }
    }
  });
  socket.addEventListener('error', () => {
    touchStatus = 'TouchService WebSocket 發生錯誤';
    touchProtocolReady = false;
    operationalLog.write({ level: 'error', type: 'touch-service', action: 'socket-error', sessionId: engine.state.sessionId });
    updateTouchReadiness();
  });
  socket.addEventListener('close', () => {
    if (touchSocket === socket) touchSocket = null;
    touchProtocolReady = false;
    touchSelfCheckActive = false;
    touchSelfCheckRemainingSeconds = 0;
    touchInteractionEnabled = null;
    touchInteractionError = null;
    touchFrameTimedOut = false;
    touchVerifiedVenue = null;
    engine.touchReleaseTimeoutMs = 0;
    engine.clearTouchContacts();
    touchDiagnostics.clear();
    touchFrameGuard.reset();
    if (!shuttingDown) {
      touchStatus = 'TouchService 已中斷，正在重新連線';
      operationalLog.write({ level: 'warn', type: 'touch-service', action: 'disconnected', sessionId: engine.state.sessionId });
      updateTouchReadiness();
      setTimeout(connectTouchService, retryDelayMs).unref();
      retryDelayMs = Math.min(10_000, retryDelayMs * 2);
    }
  });
}

const touchConfigWatch = setInterval(() => refreshTouchServiceConfig(), 1_000);
touchConfigWatch.unref();
const heartbeatWatch = setInterval(() => {
  if (touchSocket?.readyState === 1 && lastTouchFrameAt && Date.now() - lastTouchFrameAt > 3000) {
    const wasReady = engine.inputsReady;
    touchFrameTimedOut = true;
    updateTouchReadiness();
    if (wasReady) {
      touchDiagnostics.clear();
      publishDiagnostics();
    }
  }
}, 500);
heartbeatWatch.unref();
let stageDisconnectedAt = null;
const stageOutputWatch = setInterval(() => {
  const phase = engine.state.phase;
  if (['idle', 'final_results', 'paused'].includes(phase)) {
    stageDisconnectedAt = null;
    return;
  }

  const now = Date.now();
  const connections = [...subscribers].filter((client) => client.view === 'stage');
  const latestOutputAt = connections.length
    ? Math.max(...connections.map((client) => client.lastPaintAt || client.connectedAt))
    : 0;
  if (connections.length) {
    if (now - latestOutputAt < STAGE_DISCONNECT_GRACE_MS) {
      stageDisconnectedAt = null;
      return;
    }
    stageDisconnectedAt = latestOutputAt;
  } else stageDisconnectedAt ??= now;
  if (now - stageDisconnectedAt < STAGE_DISCONNECT_GRACE_MS) return;

  stageDisconnectedAt = null;
  const reason = connections.length
    ? `投影畫面仍連線，但已超過 ${STAGE_RENDER_TIMEOUT_MS / 1000} 秒沒有回報繪製；請確認遊戲視窗未隱藏、最小化或停止回應。`
    : `投影畫面已中斷超過 ${STAGE_DISCONNECT_GRACE_MS / 1000} 秒；請重新開啟遊戲畫面並確認投影輸出。`;
  engine.pause(reason, 'stage-output');
  if (engine.state.phase === 'paused') {
    operationalLog.write({
      level: 'warn', type: 'stage-output', action: 'disconnected-paused', sessionId: engine.state.sessionId,
      details: {
        reason, connectionCount: connections.length,
        graceMs: STAGE_DISCONNECT_GRACE_MS, renderTimeoutMs: STAGE_RENDER_TIMEOUT_MS, previousPhase: phase,
        latestPaintAgeMs: connections.length ? now - latestOutputAt : null,
        lastReports: connections.map((client) => ({
          visibilityState: client.lastVisibilityState ?? null,
          renderDurationMs: client.lastRenderDurationMs ?? null,
          renderGapMs: client.lastRenderGapMs ?? null
        }))
      }
    });
  }
}, 500);
stageOutputWatch.unref();
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
  clearInterval(touchConfigWatch);
  clearInterval(stageOutputWatch);
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
