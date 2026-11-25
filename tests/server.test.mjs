import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const touchProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startMockTouchService({ interactionEnabled = true } = {}) {
  let configAvailable = true;
  const httpServer = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/config') {
      if (!configAvailable) {
        response.writeHead(503).end();
        return;
      }
      const body = JSON.stringify({ interactionEnabled, touchMode: 'grid' });
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });
  const webSocketServer = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit('connection', client, request));
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  return {
    address: () => httpServer.address(),
    clients: webSocketServer.clients,
    on: (...args) => webSocketServer.on(...args),
    setConfigAvailable(value) { configAvailable = value; },
    setInteractionEnabled(value) { interactionEnabled = value; },
    close(callback) {
      for (const client of webSocketServer.clients) client.terminate();
      httpServer.close(callback);
    }
  };
}

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Game server exited early: ${output()}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return response.json();
    } catch { /* The listener may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Game server did not become healthy: ${output()}`);
}

function touchHello({ autoLockActive = false, autoLockRemainingSeconds = 0 } = {}) {
  return {
    type: 'hello', v: 1, venue: touchProfile.venue,
    canvas: { w: touchProfile.canvas.width, h: touchProfile.canvas.height },
    releaseTimeoutMs: 170,
    autoLockActive, autoLockRemainingSeconds,
    faces: touchProfile.faces.map((face, index) => {
      const cellW = face.orientation === 'vertical' ? 32 : 16;
      const cellH = face.orientation === 'vertical' ? 16 : 32;
      return {
        index, name: face.name, originX: face.originX, originY: face.originY,
        width: face.colCount * cellW, height: face.rowCount * cellH,
        cols: face.colCount, rows: face.rowCount, cellW, cellH
      };
    })
  };
}

function touchFrame(seq, events, alive) {
  return {
    v: 1, seq, t: Date.now(), venue: touchProfile.venue,
    canvas: { w: touchProfile.canvas.width, h: touchProfile.canvas.height }, events, alive
  };
}

async function waitUntil(read, predicate, description, attempts = 40) {
  let lastValue = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const lastState = lastValue && typeof lastValue === 'object'
    ? ` (last phase: ${lastValue.phase ?? 'unknown'}; ${lastValue.input?.detail ?? lastValue.notice ?? lastValue.error ?? ''}; interaction=${lastValue.input?.interactionEnabled ?? lastValue.touchInteractionEnabled ?? 'unknown'})` : '';
  throw new Error(`Timed out waiting for ${description}${lastState}`);
}

async function readStageClientId(reader) {
  let buffered = '';
  const decoder = new TextDecoder();
  for (let attempt = 0; attempt < 10; attempt++) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Stage event stream closed before its client ID arrived');
    buffered += decoder.decode(value, { stream: true });
    const clientId = buffered.match(/^id: ([0-9a-f-]{36})$/m)?.[1];
    if (clientId) return clientId;
  }
  throw new Error(`Stage event stream did not include a client ID: ${buffered.slice(0, 200)}`);
}

function createSseJsonReader(reader) {
  const decoder = new TextDecoder();
  let buffered = '';
  return async () => {
    while (true) {
      const boundary = buffered.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const data = frame.split(/\r?\n/).find((line) => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE stream closed before its state arrived');
      buffered += decoder.decode(value, { stream: true });
    }
  };
}

async function acknowledgeStagePaint(baseUrl, clientId) {
  const response = await fetch(`${baseUrl}/api/stage-ready`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId })
  });
  const value = await response.json();
  assert.equal(response.status, 200, value.error ?? 'stage render acknowledgement failed');
  assert.equal(value.ok, true);
  return value;
}

function startServerProcess({ port, dataDir, touchPort }) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      GAME_HOST: '127.0.0.1',
      GAME_PORT: String(port),
      GAME_DATA_DIR: dataDir,
      TOUCH_SERVICE_URL: `ws://127.0.0.1:${touchPort}/`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}

test('HTTP service starts a session, handles random selection, and reports stage connections', async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const touchService = await startMockTouchService();
  let touchClient = null;
  let reconnectTouchHeartbeat = null;
  let reconnectTouchSequence = 1;
  let stageClientId = null;
  let stageTestHeartbeat = null;
  let staffAbort = null;
  let staffReader = null;
  touchService.on('connection', (socket) => {
    touchClient = socket;
    socket.send(JSON.stringify(touchHello({ autoLockActive: true, autoLockRemainingSeconds: 10 })));
  });
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'server-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      GAME_HOST: '127.0.0.1',
      GAME_PORT: String(port),
      GAME_DATA_DIR: dataDir,
      TOUCH_SERVICE_URL: `ws://127.0.0.1:${touchService.address().port}/`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });

  const postControl = async (body) => {
    const response = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const value = await response.json();
    assert.equal(response.status, 200, value.error ?? 'control request failed');
    return value.state;
  };
  try {
    const health = await waitForHealth(baseUrl, child, () => output);
    assert.equal(health.phase, 'idle');
    const selfCheck = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input?.detail?.includes('啟動自檢'),
      'TouchService startup self-check status'
    );
    assert.equal(selfCheck.input.ready, false, 'TouchService must not be ready while its startup self-check blocks input');
    assert.equal(selfCheck.input.releaseTimeoutMs, 170, 'diagnostics reports the negotiated TouchService release delay during startup self-check');
    const blockedStartResponse = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start-session' })
    });
    assert.equal(blockedStartResponse.status, 400);
    assert.match((await blockedStartResponse.json()).error, /TouchService 尚未就緒/);
    assert.equal((await fetch(`${baseUrl}/api/state`).then((response) => response.json())).phase, 'idle',
      'a rejected start leaves the engine in standby');
    touchClient.send(JSON.stringify({ type: 'locks', lockedCells: [], autoLockActive: false, autoLockRemainingSeconds: 0 }));
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch,
      'TouchService readiness after its startup self-check completes'
    );

    const preflightResponse = await fetch(`${baseUrl}/api/question-preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(preflightResponse.status, 200);
    const preflightPayload = await preflightResponse.json();
    assert.equal(preflightPayload.ok, true, JSON.stringify(preflightPayload.result.games.flatMap((game) => game.failures.map((failure) => ({ gameId: game.gameId, ...failure })))));
    assert.equal(preflightPayload.result.gameCount, 8);
    assert.equal(preflightPayload.result.totalRounds, 83);
    assert.equal(preflightPayload.result.checkedRounds, 83);
    assert.equal(preflightPayload.result.failedRounds, 0);
    assert.deepEqual(Object.keys(preflightPayload.result.games[0]).sort(), ['checkedRounds', 'failures', 'gameId', 'gameName', 'rounds']);
    const editableRules = await fetch(`${baseUrl}/api/rules`).then((response) => response.json());
    editableRules.settings.games.memory_sequence.enabled = false;
    const editedPreflight = await fetch(`${baseUrl}/api/question-preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: editableRules.settings })
    });
    const editedPreflightPayload = await editedPreflight.json();
    assert.equal(editedPreflight.status, 200);
    assert.equal(editedPreflightPayload.ok, true);
    assert.equal(editedPreflightPayload.result.gameCount, 7);
    assert.equal(editedPreflightPayload.result.totalRounds, 73);
    assert.equal((await fetch(`${baseUrl}/api/rules`).then((response) => response.json())).settings.games.memory_sequence.enabled, true,
      'preflight checks draft settings without saving them');
    const badDraft = structuredClone(editableRules.settings);
    badDraft.games.minesweeper.rounds = 6;
    const rejectedDraft = await fetch(`${baseUrl}/api/question-preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: badDraft })
    });
    assert.equal(rejectedDraft.status, 400);
    assert.match((await rejectedDraft.json()).error, /必須恰好包含 6 輪設定/);
    const beforeSession = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert.equal(beforeSession.phase, 'idle', 'preflight does not start a game session');
    assert.equal(beforeSession.sessionId, null);

    const stage = await fetch(`${baseUrl}/stage`);
    assert.equal(stage.status, 200);
    assert.match(await stage.text(), /704 腦力競賽/);
    const projectionModule = await fetch(`${baseUrl}/projection-layout.mjs`);
    assert.equal(projectionModule.status, 200);
    assert.match(projectionModule.headers.get('content-type'), /^text\/javascript/);
    assert.match(await projectionModule.text(), /calculateProjectionFit/);
    const staff = await fetch(`${baseUrl}/`);
    assert.equal(staff.status, 200);
    const staffHtml = await staff.text();
    assert.match(staffHtml, /session-archive/);
    assert.match(staffHtml, /touch-diagnostics-open/);
    assert.match(staffHtml, /preflight-questions/);
    const diagnostics = await fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json());
    assert.equal(diagnostics.canvas.width, 3328);
    assert.equal(diagnostics.canvas.height, 2688);
    assert.equal(diagnostics.zones.length, 4);
    assert.equal(diagnostics.questionPanels.length, 4);
    assert.equal(diagnostics.layout.profileCount, 4);
    assert.equal(diagnostics.reservedRects[0].id, 'entrance-clearance');
    assert.equal(Object.hasOwn(diagnostics, 'currentRound'), false, 'diagnostics never expose game state');

    touchClient.send(JSON.stringify(touchFrame(1, [
      { id: 1, phase: 'down', face: 0, px: [320, 2_624] }
    ], [1])));
    const mappedTouch = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.frameSeq === 1,
      'the live diagnostic touch frame'
    );
    assert.equal(mappedTouch.active[0].position.zoneId, 'P1');
    assert.deepEqual(mappedTouch.active[0].cadPoint, { x: 704, y: 320 });

    touchClient.send(JSON.stringify(touchFrame(2, [
      { id: 2, phase: 'down', face: 5, px: [2_100, 2_100] }
    ], [1, 2])));
    const entranceTouch = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.frameSeq === 2,
      'the entrance-area diagnostic frame'
    );
    const entrancePoint = entranceTouch.active.find((point) => point.id === 2);
    assert.equal(entrancePoint.faceName, 'Entrance');
    assert.equal(entrancePoint.position, null, 'Entrance touches never map to a player');

    touchService.setInteractionEnabled(false);
    const disabledTouch = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input.interactionEnabled === false && !value.input.ready,
      'the TouchService global interaction switch to disable game readiness', 100
    );
    assert.match(disabledTouch.input.detail, /互動總開關已停用/);
    const disabledStart = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start-session' })
    });
    assert.equal(disabledStart.status, 400);
    assert.match((await disabledStart.json()).error, /互動總開關已停用/);
    touchService.setConfigAvailable(false);
    const unverifiedTouch = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input.interactionEnabled === null && !value.input.ready,
      'an unavailable TouchService config endpoint to fail closed'
    );
    assert.match(unverifiedTouch.input.detail, /無法確認互動總開關/);
    touchService.setConfigAvailable(true);
    touchService.setInteractionEnabled(true);
    touchClient.send(JSON.stringify(touchFrame(3, [], [1, 2])));
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch && value.touchInteractionEnabled === true,
      'TouchService interaction readiness to return after re-enabling'
    );

    touchClient.close();
    const disconnectedDiagnostics = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => !value.input.ready && value.active.length === 0,
      'clearing active contacts after service disconnect'
    );
    assert.equal(disconnectedDiagnostics.input.ready, false);
    const staffScript = await fetch(`${baseUrl}/staff.js`);
    assert.equal(staffScript.status, 200);
    const staffJavaScript = await staffScript.text();
    assert.match(staffJavaScript, /export-session-json/);
    assert.match(staffJavaScript, /openTouchDiagnostics/);
    assert.match(staffJavaScript, /runQuestionPreflight/);
    assert.match(staffJavaScript, /startSession\.disabled = data\.phase !== 'idle' \|\| !touch\.ready \|\| !stageReady/);
    assert.match(staffJavaScript, /stageReadyConnections/);
    assert.match(staffJavaScript, /pauseInfo\.reason/);
    assert.match(staffJavaScript, /【系統異常】/);
    assert.match(staffJavaScript, /觸發來源：/);
    assert.match(staffJavaScript, /暫停與恢復由工作人員控制/);
    assert.match(staffJavaScript, /TouchService 未就緒，暫時不能開始場次/);
    const stageScript = await fetch(`${baseUrl}/stage.js`).then((response) => response.text());
    assert.match(stageScript, /api\/stage-ready/);
    assert.match(stageScript, /api\/state\?view=stage/);
    assert.match(stageScript, /compareStageStateFreshness/);
    assert.match(stageScript, /STAGE_STATE_POLL_AFTER_SILENCE_MS/);
    assert.match(stageScript, /window\.setInterval\(reportStagePaint, 1000\)/);
    assert.match(stageScript, /MIN_STAGE_RENDER_INTERVAL_MS = 200/);
    assert.match(stageScript, /queueStageRender/);
    assert.match(stageScript, /document\.visibilityState !== 'visible'/);
    assert.match(stageScript, /visibilitychange/);
    assert.equal((await fetch(`${baseUrl}/api/state`).then((response) => response.json())).output.stageConnections, 0);

    let stageAbort = new AbortController();
    let stageEvents = await fetch(`${baseUrl}/api/events?view=stage`, { signal: stageAbort.signal });
    assert.match(stageEvents.headers.get('content-type'), /text\/event-stream/);
    let stageReader = stageEvents.body.getReader();
    stageClientId = await readStageClientId(stageReader);
    const connected = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert.equal(connected.output.stageConnections, 1);
    assert.equal(connected.output.stageReady, false, 'an SSE connection alone is not proof the projection rendered');

    const reconnectSelfCheck = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input?.detail?.includes('啟動自檢'),
      'TouchService reconnect self-check before starting a session'
    );
    assert.equal(reconnectSelfCheck.input.ready, false);
    touchClient.send(JSON.stringify({ type: 'locks', lockedCells: [], autoLockActive: false, autoLockRemainingSeconds: 0 }));
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch,
      'TouchService readiness after reconnect'
    );
    touchClient.send(JSON.stringify(touchFrame(1, [], [])));
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.frameSeq === 1,
      'first live frame after TouchService reconnect'
    );
    reconnectTouchHeartbeat = setInterval(() => {
      if (touchClient?.readyState === 1) {
        touchClient.send(JSON.stringify(touchFrame(++reconnectTouchSequence, [], [])));
      }
    }, 500);
    reconnectTouchHeartbeat.unref();

    const unrenderedStartResponse = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start-session' })
    });
    assert.equal(unrenderedStartResponse.status, 400);
    assert.match((await unrenderedStartResponse.json()).error, /尚未完成繪製/);

    await stageReader.cancel();
    stageAbort.abort();
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.output.stageConnections === 0,
      'the stage screen to disconnect before attempting to start'
    );
    const stalePaintResponse = await fetch(`${baseUrl}/api/stage-ready`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: stageClientId })
    });
    assert.equal(stalePaintResponse.status, 409, 'a disconnected stage client cannot renew its paint readiness');
    const noStageStartResponse = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start-session' })
    });
    assert.equal(noStageStartResponse.status, 400);
    assert.match((await noStageStartResponse.json()).error, /遊戲畫面尚未完成繪製/);
    assert.equal((await fetch(`${baseUrl}/api/state`).then((response) => response.json())).phase, 'idle',
      'a rejected start without a connected projection stays in standby');

    stageAbort = new AbortController();
    stageEvents = await fetch(`${baseUrl}/api/events?view=stage`, { signal: stageAbort.signal });
    assert.match(stageEvents.headers.get('content-type'), /text\/event-stream/);
    stageReader = stageEvents.body.getReader();
    stageClientId = await readStageClientId(stageReader);
    await acknowledgeStagePaint(baseUrl, stageClientId);
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.output.stageConnections === 1 && value.output.stageReady,
      'the stage screen to render and reconnect before starting'
    );

    touchService.setConfigAvailable(false);
    const startWithUnverifiableInteraction = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start-session' })
    });
    assert.equal(startWithUnverifiableInteraction.status, 400);
    assert.match((await startWithUnverifiableInteraction.json()).error, /無法確認互動總開關/);
    assert.equal((await fetch(`${baseUrl}/api/state`).then((response) => response.json())).phase, 'idle');
    touchService.setConfigAvailable(true);
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input.ready && value.input.interactionEnabled === true,
      'TouchService status to return before the fresh start check'
    );
    await acknowledgeStagePaint(baseUrl, stageClientId);

    await postControl({ action: 'start-session' });
    const activePreflightResponse = await fetch(`${baseUrl}/api/question-preflight`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(activePreflightResponse.status, 400);
    assert.match((await activePreflightResponse.json()).error, /場次進行中不可執行題目檢查/);
    await postControl({ action: 'join-zone', zoneId: 'P1' });
    await postControl({ action: 'select-game', gameId: 'zero_sum_grid' });
    const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessions = (await sessionsResponse.json()).sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].participantCount, 1);

    staffAbort = new AbortController();
    const staffEvents = await fetch(`${baseUrl}/api/events`, { signal: staffAbort.signal });
    assert.match(staffEvents.headers.get('content-type'), /text\/event-stream/);
    staffReader = staffEvents.body.getReader();
    const readStaffState = createSseJsonReader(staffReader);
    assert.equal((await readStaffState()).phase, 'game_preview', 'staff stream receives the selected-game preview before the tutorial');
    await postControl({ action: 'confirm-game-selection' });

    const stalledRender = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.output.stageConnections === 1 && !value.output.stageReady && value.phase === 'paused',
      'automatic pause when the connected projection stops reporting rendered frames',
      100
    );
    assert.match(stalledRender.notice, /^【系統異常】投影畫面仍連線/);
    assert.match(stalledRender.pauseInfo?.reason ?? '', /超過 4 秒沒有回報繪製/);
    assert.equal(stalledRender.pauseInfo?.source, 'stage-output');
    assert.equal(stalledRender.resumeTarget, 'tutorial');
    let staffPauseState = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      staffPauseState = await readStaffState();
      if (staffPauseState.phase === 'paused') break;
    }
    assert.equal(staffPauseState?.phase, 'paused', 'the staff SSE stream receives the automatic pause without polling');
    assert.equal(staffPauseState?.pauseInfo?.source, 'stage-output');
    assert.match(staffPauseState?.notice ?? '', /^【系統異常】/);
    assert.match(staffPauseState?.pauseInfo?.reason ?? '', /超過 4 秒沒有回報繪製/);
    await staffReader.cancel();
    staffAbort.abort();
    staffReader = null;
    staffAbort = null;
    const resumeBeforeProjectionRecovery = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' })
    });
    assert.equal(resumeBeforeProjectionRecovery.status, 400, 'staff cannot resume before the projection reports a fresh paint');
    assert.equal((await resumeBeforeProjectionRecovery.json()).error.includes('遊戲畫面'), true);
    await acknowledgeStagePaint(baseUrl, stageClientId);
    const renderedAgain = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && value.output.stageReady,
      'the same projection to report a fresh render while remaining paused'
    );
    assert.equal(renderedAgain.output.stageConnections, 1);
    stageTestHeartbeat = setInterval(() => { acknowledgeStagePaint(baseUrl, stageClientId).catch(() => {}); }, 500);
    stageTestHeartbeat.unref();
    await postControl({ action: 'resume' });
    const resumedTutorial = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'tutorial',
      'staff confirmation to resume after the projection render stalled',
      120
    );
    assert.equal(resumedTutorial.phase, 'tutorial');
    await postControl({ action: 'return-to-lobby' });

    touchService.setInteractionEnabled(false);
    const interactionDisabledPause = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && value.input.interactionEnabled === false,
      'the active session to pause when TouchService interactions are disabled'
    );
    assert.match(interactionDisabledPause.notice, /互動總開關已停用/);
    assert.equal(interactionDisabledPause.pauseInfo?.source, 'touch-service');
    const resumeBeforeTouchRecovery = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' })
    });
    assert.equal(resumeBeforeTouchRecovery.status, 400, 'staff cannot resume before TouchService is ready');
    assert.equal((await resumeBeforeTouchRecovery.json()).error.includes('TouchService'), true);
    touchService.setInteractionEnabled(true);
    const interactionRestoredWhilePaused = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.input.ready && value.input.interactionEnabled === true,
      'TouchService readiness to return while keeping the active session paused'
    );
    assert.equal(interactionRestoredWhilePaused.phase, 'paused', 'restored interaction requires staff to resume');
    assert.equal(interactionRestoredWhilePaused.resumeTarget, 'lobby');
    assert.equal(interactionRestoredWhilePaused.pauseInfo?.source, 'touch-service', 'the pause origin remains visible until staff resume');
    await postControl({ action: 'resume' });
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'lobby',
      'staff to resume after TouchService interactions are restored',
      120
    );

    await postControl({ action: 'join-zone', zoneId: 'P2' });
    const stateBeforeTouchDisconnect = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    const sessionIdBeforeTouchDisconnect = stateBeforeTouchDisconnect.sessionId;
    const participantIdsBeforeTouchDisconnect = [...stateBeforeTouchDisconnect.participantIds];
    const participantScoresBeforeTouchDisconnect = Object.fromEntries(participantIdsBeforeTouchDisconnect.map((id) => [id, {
      totalHalfPoints: stateBeforeTouchDisconnect.participants[id].totalHalfPoints,
      roundsPlayed: stateBeforeTouchDisconnect.participants[id].roundsPlayed
    }]));
    assert.deepEqual(participantIdsBeforeTouchDisconnect, ['P1', 'P2']);
    if (reconnectTouchHeartbeat) clearInterval(reconnectTouchHeartbeat);
    reconnectTouchHeartbeat = null;
    const disconnectedTouchClient = touchClient;
    disconnectedTouchClient.close();
    const activeTouchDisconnectPause = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && !value.input.ready && value.input.interactionEnabled === null,
      'the active session to pause and keep its participant roster after TouchService disconnects'
    );
    assert.equal(activeTouchDisconnectPause.resumeTarget, 'lobby');
    assert.equal(activeTouchDisconnectPause.sessionId, sessionIdBeforeTouchDisconnect);
    assert.deepEqual(activeTouchDisconnectPause.participantIds, participantIdsBeforeTouchDisconnect);
    assert.deepEqual(Object.fromEntries(participantIdsBeforeTouchDisconnect.map((id) => [id, {
      totalHalfPoints: activeTouchDisconnectPause.participants[id].totalHalfPoints,
      roundsPlayed: activeTouchDisconnectPause.participants[id].roundsPlayed
    }])), participantScoresBeforeTouchDisconnect);

    const activeReconnectSelfCheck = await waitUntil(
      async () => fetch(`${baseUrl}/api/state?view=diagnostics`).then((response) => response.json()),
      (value) => value.input?.detail?.includes('啟動自檢'),
      'TouchService reconnect self-check during an active session'
    );
    assert.equal(activeReconnectSelfCheck.input.ready, false);
    touchClient.send(JSON.stringify({ type: 'locks', lockedCells: [], autoLockActive: false, autoLockRemainingSeconds: 0 }));
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch,
      'TouchService readiness after reconnecting during the active session'
    );
    reconnectTouchSequence = 1;
    touchClient.send(JSON.stringify(touchFrame(reconnectTouchSequence, [], [])));
    const activeReconnectState = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.input.ready && value.phase === 'paused',
      'TouchService to reconnect without automatically resuming the active session'
    );
    assert.equal(activeReconnectState.sessionId, sessionIdBeforeTouchDisconnect);
    assert.deepEqual(activeReconnectState.participantIds, participantIdsBeforeTouchDisconnect);
    assert.deepEqual(Object.fromEntries(participantIdsBeforeTouchDisconnect.map((id) => [id, {
      totalHalfPoints: activeReconnectState.participants[id].totalHalfPoints,
      roundsPlayed: activeReconnectState.participants[id].roundsPlayed
    }])), participantScoresBeforeTouchDisconnect);
    reconnectTouchHeartbeat = setInterval(() => {
      if (touchClient?.readyState === 1) {
        touchClient.send(JSON.stringify(touchFrame(++reconnectTouchSequence, [], [])));
      }
    }, 500);
    reconnectTouchHeartbeat.unref();
    await postControl({ action: 'resume' });
    const resumedAfterTouchReconnect = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'lobby',
      'staff to resume the active session after TouchService reconnects',
      120
    );
    assert.deepEqual(resumedAfterTouchReconnect.participantIds, participantIdsBeforeTouchDisconnect);
    assert.deepEqual(Object.fromEntries(participantIdsBeforeTouchDisconnect.map((id) => [id, {
      totalHalfPoints: resumedAfterTouchReconnect.participants[id].totalHalfPoints,
      roundsPlayed: resumedAfterTouchReconnect.participants[id].roundsPlayed
    }])), participantScoresBeforeTouchDisconnect);

    touchService.setConfigAvailable(false);
    const interactionStatusLost = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && value.input.interactionEnabled === null,
      'the active session to pause when TouchService interaction status becomes unverifiable'
    );
    assert.match(interactionStatusLost.notice, /無法確認互動總開關/);
    assert.equal(interactionStatusLost.resumeTarget, 'lobby');
    touchService.setConfigAvailable(true);
    const interactionStatusRestored = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && value.input.ready && value.input.interactionEnabled === true,
      'TouchService status verification to recover without automatically resuming the session'
    );
    assert.equal(interactionStatusRestored.resumeTarget, 'lobby');
    await postControl({ action: 'resume' });
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'lobby',
      'staff to resume after TouchService interaction status verification is restored',
      120
    );

    await stageReader.cancel();
    stageAbort.abort();
    await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.output.stageConnections === 0,
      'the stage screen to disconnect during the lobby'
    );
    const automaticallyPaused = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'paused' && /^【系統異常】投影畫面已中斷/.test(value.notice),
      'automatic pause after the stage screen disconnects for four seconds',
      120
    );
    assert.equal(automaticallyPaused.resumeTarget, 'lobby');
    assert.equal(automaticallyPaused.pauseInfo?.source, 'stage-output');
    assert.match(automaticallyPaused.notice, /^【系統異常】投影畫面已中斷超過 4 秒/);
    assert.match(automaticallyPaused.pauseInfo?.reason ?? '', /重新開啟遊戲畫面/);

    stageAbort = new AbortController();
    stageEvents = await fetch(`${baseUrl}/api/events?view=stage`, { signal: stageAbort.signal });
    assert.match(stageEvents.headers.get('content-type'), /text\/event-stream/);
    stageReader = stageEvents.body.getReader();
    stageClientId = await readStageClientId(stageReader);
    await acknowledgeStagePaint(baseUrl, stageClientId);
    const reconnectedPaused = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.output.stageConnections === 1 && value.output.stageReady,
      'the stage screen to render and reconnect after the automatic pause'
    );
    assert.equal(reconnectedPaused.phase, 'paused', 'reconnecting the stage never resumes the session automatically');
    assert.equal(reconnectedPaused.output.stageReady, true);
    await postControl({ action: 'resume' });
    const resumedLobby = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'lobby',
      'staff confirmation to resume after the stage screen reconnects',
      120
    );
    assert.equal(resumedLobby.phase, 'lobby');

    const exported = await fetch(`${baseUrl}/api/sessions/${sessions[0].sessionId}.csv`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /text\/csv/);
    assert.match(exported.headers.get('content-disposition'), /attachment; filename=/);
    assert.match(await exported.text(), /P1,P1/);
    const fullArchive = await fetch(`${baseUrl}/api/sessions/${sessions[0].sessionId}.json`);
    assert.equal(fullArchive.status, 200);
    assert.match(fullArchive.headers.get('content-type'), /application\/json/);
    assert.equal((await fullArchive.json()).rulesSnapshot.rulesVersion, '1.0.14');
    assert.equal((await fetch(`${baseUrl}/api/sessions/not-a-session.csv`)).status, 404);

    const selected = await postControl({ action: 'select-random-game' });

    assert.equal(selected.phase, 'game_preview');
    assert.ok(selected.availableGames.some((game) => game.id === selected.selectedGame));
    assert.match(selected.notice, /隨機抽中/);
    assert.equal((await postControl({ action: 'confirm-game-selection' })).phase, 'tutorial');

    const finished = await postControl({ action: 'end-session' });
    assert.equal(finished.phase, 'final_results');
    const finishedSessionId = finished.sessionId;
    const returnedToStandby = await postControl({ action: 'return-to-standby' });
    assert.equal(returnedToStandby.phase, 'idle');
    assert.equal(returnedToStandby.sessionId, null);
    assert.deepEqual(returnedToStandby.participantIds, []);
    const preservedArchive = await fetch(`${baseUrl}/api/sessions/${finishedSessionId}.json`).then((response) => response.json());
    assert.equal(preservedArchive.phase, 'final_results', 'returning to standby must not overwrite the completed session archive');
    const idleState = JSON.parse(fs.readFileSync(path.join(dataDir, 'session-state.json'), 'utf8'));
    assert.equal(idleState.phase, 'idle', 'the active state must recover to standby after a restart');
    assert.equal(idleState.sessionId, null);

    await stageReader.cancel();
    stageAbort.abort();
    let disconnectedCount = 1;
    for (let attempt = 0; attempt < 20 && disconnectedCount !== 0; attempt++) {
      disconnectedCount = (await fetch(`${baseUrl}/api/state`).then((response) => response.json())).output.stageConnections;
      if (disconnectedCount) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(disconnectedCount, 0, 'closing the game screen updates the connection status');

    const logDirectory = path.join(dataDir, 'logs');
    const logRecords = fs.readdirSync(logDirectory).filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => fs.readFileSync(path.join(logDirectory, name), 'utf8').trim().split('\n'))
      .filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(logRecords.some((record) => record.type === 'session' && record.action === 'started'));
    assert.ok(logRecords.some((record) => record.type === 'stage-output' && record.action === 'disconnected-paused'));
    assert.ok(logRecords.some((record) => record.type === 'player-input' || record.type === 'staff-control'));
  } finally {
    if (reconnectTouchHeartbeat) clearInterval(reconnectTouchHeartbeat);
    if (stageTestHeartbeat) clearInterval(stageTestHeartbeat);
    if (staffReader) await staffReader.cancel().catch(() => {});
    staffAbort?.abort();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    for (const client of touchService.clients) client.terminate();
    await new Promise((resolve) => touchService.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a server process restart resumes from the last settled round and retries the interrupted round', async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const touchService = await startMockTouchService();
  touchService.on('connection', (socket) => socket.send(JSON.stringify(touchHello())));
  let touchSequence = 0;
  const heartbeat = setInterval(() => {
    const frame = JSON.stringify(touchFrame(++touchSequence, [], []));
    for (const client of touchService.clients) if (client.readyState === 1) client.send(frame);
  }, 500);
  heartbeat.unref();
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'server-recovery-test-'));
  let running = startServerProcess({ port, dataDir, touchPort: touchService.address().port });
  let child = running.child;

  const postControl = async (body) => {
    const response = await fetch(`${baseUrl}/api/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const value = await response.json();
    assert.equal(response.status, 200, value.error ?? `control request failed: ${body.action}`);
    return value.state;
  };
  const stageStreams = [];
  const connectStage = async () => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/api/events?view=stage`, { signal: abort.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const clientId = await readStageClientId(reader);
    await acknowledgeStagePaint(baseUrl, clientId);
    const renderHeartbeat = setInterval(() => { acknowledgeStagePaint(baseUrl, clientId).catch(() => {}); }, 500);
    renderHeartbeat.unref();
    stageStreams.push({ abort, reader, renderHeartbeat });
    return waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((stateResponse) => stateResponse.json()),
      (value) => value.output.stageConnections === 1 && value.output.stageReady,
      'the stage screen to render for the recovery test'
    );
  };

  try {
    await waitForHealth(baseUrl, child, running.output);
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch,
      'TouchService readiness before starting the recovery test'
    );
    await connectStage();
    await postControl({ action: 'start-session' });
    await postControl({ action: 'join-zone', zoneId: 'P1' });
    await postControl({ action: 'select-game', gameId: 'zero_sum_grid' });
    await postControl({ action: 'confirm-game-selection' });
    const beforeCrash = await postControl({ action: 'start-after-tutorial' });
    assert.equal(beforeCrash.phase, 'countdown');
    assert.equal(beforeCrash.currentRound.round, 1);
    const sessionId = beforeCrash.sessionId;

    const playingFirstRound = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'playing',
      'the first round to start',
      100
    );
    const answer = String(playingFirstRound.currentRound.question.answers.length);
    let contactId = 100;
    const sendTouch = (id, phase, u, v, alive) => {
      const cadX = 704 + u * 640;
      const cadY = v * 640;
      const event = { id, phase, face: 0, px: [cadY, 3_328 - cadX] };
      const frame = touchFrame(++touchSequence, [event], alive);
      for (const client of touchService.clients) if (client.readyState === 1) client.send(JSON.stringify(frame));
    };
    const tapKey = async (key) => {
      const keys = ['1', '2', '3', 'confirm', '4', '5', '6', 'backspace', '7', '8', '9', 'spacer', 'spacer', '0', 'spacer', 'clear'];
      const index = keys.indexOf(key);
      assert.notEqual(index, -1, `the keypad contains ${key}`);
      const column = index % 4, row = Math.floor(index / 4), id = contactId++;
      const u = ((column + 0.5) * 160) / 640;
      const v = (272 + (row + 0.5) * 92) / 640;
      sendTouch(id, 'down', u, v, [id]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      sendTouch(id, 'up', u, v, []);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    for (const digit of answer) await tapKey(digit);
    await tapKey('confirm');
    const settledRound = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'round_results',
      'the first round to settle after real TouchService frames'
    );
    assert.equal(settledRound.results.length, 1);
    assert.equal(settledRound.results[0].round, 1);
    assert.equal(settledRound.results[0].rows[0].completed, true);
    const completedScore = settledRound.participants.P1.totalHalfPoints;

    const interruptedState = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'countdown' && value.currentRound?.round === 2,
      'the next round to begin before the simulated crash',
      140
    );
    const interruptedQuestionId = interruptedState.currentRound.questionId;
    const savedStateFile = path.join(dataDir, 'session-state.json');
    assert.equal(JSON.parse(fs.readFileSync(savedStateFile, 'utf8')).currentRound.questionId, interruptedQuestionId);

    const crashedProcess = child;
    await new Promise((resolve) => {
      crashedProcess.once('exit', resolve);
      crashedProcess.kill('SIGKILL');
    });
    for (const stream of stageStreams) {
      clearInterval(stream.renderHeartbeat);
      stream.abort.abort();
    }

    running = startServerProcess({ port, dataDir, touchPort: touchService.address().port });
    child = running.child;
    const health = await waitForHealth(baseUrl, child, running.output);
    assert.equal(health.phase, 'paused', 'a recovered game waits for staff confirmation before accepting touch input');
    await waitUntil(
      async () => fetch(`${baseUrl}/health`).then((response) => response.json()),
      (value) => value.touch,
      'TouchService readiness after restarting the game server'
    );
    await connectStage();

    const recovered = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert.equal(recovered.sessionId, sessionId);
    assert.equal(recovered.phase, 'paused');
    assert.equal(recovered.resumeTarget, 'tutorial');
    assert.equal(recovered.selectedGame, 'zero_sum_grid');
    assert.equal(recovered.gameRoundIndex, 1);
    assert.equal(recovered.currentRound, null);
    assert.deepEqual(recovered.participantIds, ['P1']);
    assert.equal(recovered.participants.P1.totalHalfPoints, completedScore);
    assert.equal(recovered.participants.P1.roundsPlayed, 1);
    const archive = await fetch(`${baseUrl}/api/sessions/${sessionId}.json`).then((response) => response.json());
    assert.equal(archive.phase, 'paused');
    assert.equal(archive.results.length, 1, 'the completed first round remains archived');
    assert.equal(archive.results[0].round, 1);

    await postControl({ action: 'resume' });
    const tutorial = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'tutorial',
      'staff resume to restore the round tutorial',
      100
    );
    assert.equal(tutorial.selectedGame, 'zero_sum_grid');
    assert.equal(tutorial.currentRound, null);

    await postControl({ action: 'start-after-tutorial' });
    const playing = await waitUntil(
      async () => fetch(`${baseUrl}/api/state`).then((response) => response.json()),
      (value) => value.phase === 'playing',
      'the interrupted round to restart after the tutorial',
      100
    );
    assert.equal(playing.currentRound.round, 2);
    assert.notEqual(playing.currentRound.questionId, interruptedQuestionId);
  } finally {
    clearInterval(heartbeat);
    for (const stream of stageStreams) {
      clearInterval(stream.renderHeartbeat);
      try { await stream.reader.cancel(); } catch { /* The server process may already have exited. */ }
      stream.abort.abort();
    }
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    for (const client of touchService.clients) client.terminate();
    await new Promise((resolve) => touchService.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('mouse mode works without TouchService and the lobby API preserves persisted scores', async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'mouse-server-test-'));
  const { child, output } = startServerProcess({ port, dataDir, touchPort: await freePort() });
  const abort = new AbortController();
  let reader, heartbeat;
  const post = async (url, body) => {
    const response = await fetch(`${baseUrl}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...(await response.json()) };
  };
  const control = async (action, extra = {}) => {
    const result = await post('/api/control', { action, ...extra });
    assert.equal(result.status, 200, result.error);
    return result.state;
  };
  try {
    await waitForHealth(baseUrl, child, output);
    const events = await fetch(`${baseUrl}/api/events?view=stage`, { signal: abort.signal });
    reader = events.body.getReader();
    const clientId = await readStageClientId(reader);
    await acknowledgeStagePaint(baseUrl, clientId);
    heartbeat = setInterval(() => acknowledgeStagePaint(baseUrl, clientId).catch(() => {}), 500);
    const disabled = await post('/api/mouse-input', { clientId, phase: 'down', px: [1000, 1000] });
    assert.equal(disabled.status, 400);
    await control('set-mouse-test', { enabled: true });
    const started = await control('start-session');
    assert.equal(started.input.ready, true);
    assert.equal(started.input.mouseTest, true);
    assert.equal((await post('/api/control', { action: 'set-mouse-test', enabled: false })).status, 400);
    await control('join-zone', { zoneId: 'P1' });
    await control('join-zone', { zoneId: 'P2' });
    await control('select-game', { gameId: 'cube_count' });
    await control('confirm-game-selection');
    await control('start-after-tutorial');
    const state = await waitUntil(() => fetch(`${baseUrl}/api/state`).then((r) => r.json()),
      (s) => s.phase === 'playing', 'mouse-only countdown', 120);
    const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8'));
    const zone = state.zones.find((z) => z.id === 'P1');
    const rect = rules.common.layout.numericKeypadRect;
    const layout = rules.common.layout;
    for (const key of [...String(state.currentRound.question.total), 'confirm']) {
      const index = layout.numericKeypadKeys.indexOf(key);
      const x = rect.x + (index % layout.numericKeypadColumns + 0.5) * rect.width / layout.numericKeypadColumns;
      const y = rect.y + (Math.floor(index / layout.numericKeypadColumns) + 0.5) * rect.height / layout.numericKeypadRows;
      const angle = zone.rotationDegrees * Math.PI / 180;
      const cadX = zone.rect.x + zone.rect.width / 2 + (x - 320) * Math.cos(angle) - (y - 320) * Math.sin(angle);
      const cadY = zone.rect.y + zone.rect.height / 2 + (x - 320) * Math.sin(angle) + (y - 320) * Math.cos(angle);
      const px = [cadY, 3328 - cadX];
      for (const phase of ['down', 'up']) {
        const result = await post('/api/mouse-input', { clientId, phase, px, phaseRevision: state.input.phaseRevision });
        assert.equal(result.status, 200, result.error);
      }
    }
    const scored = await fetch(`${baseUrl}/api/state`).then((r) => r.json());
    assert.equal(scored.phase, 'round_results');
    assert.equal(scored.finalRankings[0].score, 1);
    const lobby = await control('return-to-lobby');
    assert.equal(lobby.phase, 'lobby');
    assert.equal(lobby.sessionId, started.sessionId);
    assert.deepEqual(lobby.finalRankings, scored.finalRankings);
    assert.deepEqual(lobby.results, scored.results);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'session-state.json'), 'utf8'));
    assert.equal(saved.phase, 'lobby');
    assert.equal(saved.participants.P1.totalHalfPoints, 2);
    assert.deepEqual(saved.results, scored.results);
    assert.equal((await post('/api/mouse-input', { clientId: 'unknown', phase: 'down', px: [1, 1] })).status, 400);
    await control('end-session');
    const disabledState = await control('set-mouse-test', { enabled: false });
    assert.equal(disabledState.input.mouseTest, false);
    assert.equal(disabledState.input.ready, false);
  } finally {
    clearInterval(heartbeat);
    if (reader) await reader.cancel().catch(() => {});
    abort.abort();
    child.kill();
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  }
});
