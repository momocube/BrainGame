const $ = (selector) => document.querySelector(selector);
const phaseNames = {
  idle: '待機', lobby: '大廳', tutorial: '遊戲教學', countdown: '開輪倒數',
  playing: '遊戲進行中', round_results: '輪次結算', paused: '已暫停',
  resume_countdown: '恢復倒數', final_results: '總結算'
};
let state;
let archiveRefreshKey = null;
let ruleSettings = null;
let diagnosticsStream = null;
let lastDiagnosticsData = null;

const gameLabels = {
  minesweeper: '踩地雷', zero_sum_grid: '數字方格', cube_count: '3D 數方塊',
  solid_puzzle: '立體拼圖', memory_poker: '記憶撲克', map_view: '2D／3D 地圖定位',
  memory_sequence: '數字速記'
};
const ruleFieldLabels = {
  rounds: '輪數', playSeconds: '每輪時限（秒）',
  wrongAnswerLockSeconds: '答錯鎖答（秒）',
  penaltySecondsPerDistinctMine: '每顆不同地雷罰秒',
  memorySeconds: '記憶時間（秒）', selectionSeconds: '選牌時間（秒）',
  revealCountdownSeconds: '揭曉倒數（秒）', answerSeconds: '作答時間（秒）',
  heartsPerRound: '每輪心數', optionCount: '選項數',
  minimumDistinctVisibleClues: '至少可見線索數',
  minesByRound: '每輪地雷數', numberCountByRound: '每輪數字數',
  memorySecondsByRound: '每輪記憶秒數', difficultyBands: '難度級距'
};

const diagnosticColors = ['#ff6b6b', '#5be0cb', '#8e83ff', '#ffd166', '#58a6ff', '#ff8bd1', '#9be564', '#f59e42'];

function drawTouchMap(data) {
  const canvas = $('#touch-map');
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !data?.canvas?.width || !data?.canvas?.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * dpr);
  canvas.height = Math.round(bounds.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(bounds.width / data.canvas.width, bounds.height / data.canvas.height);
  const offsetX = (bounds.width - data.canvas.width * scale) / 2;
  const offsetY = (bounds.height - data.canvas.height * scale) / 2;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);

  const width = data.canvas.width, height = data.canvas.height;
  ctx.fillStyle = '#0c1420'; ctx.fillRect(0, 0, width, height);
  const surfaces = [
    { x: 640, y: 0, width: 2048, height: 640, label: '對面長牆' },
    { x: 0, y: 640, width: 640, height: 1408, label: '左側牆' },
    { x: 2688, y: 640, width: 640, height: 1408, label: '右側牆' },
    { x: 640, y: 640, width: 2048, height: 1408, label: '地板' },
    { x: 640, y: 2048, width: 2048, height: 640, label: '入口側牆' }
  ];
  for (const surface of surfaces) {
    ctx.fillStyle = surface.label === '地板' ? '#172333' : '#142b3d';
    ctx.fillRect(surface.x, surface.y, surface.width, surface.height);
    ctx.strokeStyle = '#31485a'; ctx.lineWidth = 3;
    ctx.strokeRect(surface.x, surface.y, surface.width, surface.height);
  }
  ctx.strokeStyle = '#253a4c'; ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y <= height; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

  for (const [index, zone] of (data.zones ?? []).entries()) {
    const color = diagnosticColors[index % diagnosticColors.length], rect = zone.rect;
    ctx.fillStyle = `${color}22`; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = color; ctx.lineWidth = 12; ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = '#f4f8ff'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(zone.id, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.font = '24px sans-serif'; ctx.fillStyle = color;
    ctx.fillText(`${zone.rotationDegrees}°`, rect.x + rect.width / 2, rect.y + rect.height / 2 + 44);
  }
  for (const item of data.reservedRects ?? []) {
    const rect = item.rect;
    ctx.fillStyle = 'rgba(237, 70, 83, .72)'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = '#ff7180'; ctx.lineWidth = 12; ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('入口保留區・不可互動', rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  const now = Date.now();
  const points = [...(data.active ?? [])];
  for (const point of data.recent ?? []) {
    if (point.phase === 'up' && now - point.receivedAt < 1200) points.push(point);
  }
  for (const point of points) {
    if (!point.cadPoint) continue;
    const { x, y } = point.cadPoint;
    if (x < 0 || y < 0 || x > width || y > height) continue;
    const zoneIndex = point.position ? (data.zones ?? []).findIndex((zone) => zone.id === point.position.zoneId) : -1;
    const color = zoneIndex >= 0 ? diagnosticColors[zoneIndex % diagnosticColors.length] : '#ff525f';
    const age = now - point.receivedAt;
    ctx.globalAlpha = point.phase === 'up' ? Math.max(.1, 1 - age / 1200) : 1;
    ctx.beginPath(); ctx.arc(x, y, point.phase === 'up' ? 30 : 24, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${point.zoneId ?? '未配置'} ${point.phase}`, x + 30, y - 22);
  }
}

function renderTouchDiagnostics(data) {
  if (!data) return;
  lastDiagnosticsData = data;
  const status = $('#diagnostics-status');
  status.textContent = data.input?.ready ? `已連線・${data.input.detail}` : `未就緒・${data.input?.detail ?? '等待 TouchService'}`;
  status.className = `status-pill ${data.input?.ready ? 'online' : 'offline'}`;
  const rows = [...(data.recent ?? [])].slice(-24).reverse();
  const list = $('#touch-event-list'); list.replaceChildren();
  if (!rows.length) list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '等待 TouchService frame…' }));
  for (const point of rows) {
    const item = document.createElement('div'); item.className = 'touch-event-row';
    const zone = point.position ? `${point.position.zoneId}・U ${(point.position.u * 100).toFixed(1)}% / V ${(point.position.v * 100).toFixed(1)}%` : '無玩家區命中';
    const action = document.createElement('strong'); action.textContent = `${point.phase.toUpperCase()}・${point.faceName}`;
    const detail = document.createElement('small'); detail.textContent = `ID ${point.id}・${zone}`;
    item.append(action, detail); list.append(item);
  }
  drawTouchMap(data);
}

async function openTouchDiagnostics() {
  const dialog = $('#touch-diagnostics');
  if (!dialog.open) dialog.showModal();
  try {
    const response = await fetch('/api/state?view=diagnostics', { cache: 'no-store' });
    if (!response.ok) throw new Error('無法讀取觸控狀態');
    renderTouchDiagnostics(await response.json());
    if (!diagnosticsStream) {
      diagnosticsStream = new EventSource('/api/events?view=diagnostics');
      diagnosticsStream.onmessage = (event) => { try { renderTouchDiagnostics(JSON.parse(event.data)); } catch (error) { console.error(error); } };
      diagnosticsStream.onerror = () => { $('#diagnostics-status').textContent = '診斷串流重新連線中'; $('#diagnostics-status').className = 'status-pill checking'; };
    }
  } catch (error) {
    $('#diagnostics-status').textContent = `診斷載入失敗・${error.message}`;
    $('#diagnostics-status').className = 'status-pill offline';
  }
}

function setRulesEditable(editable) {
  const list = $('#rules-list');
  for (const control of list.querySelectorAll('input, textarea')) control.disabled = !editable;
  $('#save-rules').disabled = !editable || !ruleSettings;
  $('#rules-status').textContent = editable
    ? '待機／總結算可修改；新場次套用'
    : '場次進行中，設定已鎖定';
}

function renderRuleSettings(settings) {
  ruleSettings = structuredClone(settings);
  const list = $('#rules-list');
  list.replaceChildren();
  for (const [gameId, config] of Object.entries(settings.games ?? {})) {
    const card = document.createElement('article'); card.className = 'rule-game'; card.dataset.gameId = gameId;
    const head = document.createElement('div'); head.className = 'rule-game-head';
    const title = document.createElement('strong'); title.textContent = gameLabels[gameId] ?? gameId;
    const enabledLabel = document.createElement('label'); enabledLabel.className = 'rule-enabled';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.className = 'rule-enabled-input';
    enabled.checked = config.enabled !== false;
    enabledLabel.append(enabled, document.createTextNode('啟用'));
    head.append(title, enabledLabel); card.append(head);

    const fields = document.createElement('div'); fields.className = 'rule-fields';
    for (const [field, value] of Object.entries(config)) {
      if (field === 'enabled' || typeof value !== 'number') continue;
      const label = document.createElement('label'); label.className = 'rule-field';
      label.append(document.createTextNode(ruleFieldLabels[field] ?? field));
      const input = document.createElement('input'); input.type = 'number'; input.step = '1';
      input.value = String(value); input.dataset.field = field;
      label.append(input); fields.append(label);
    }
    card.append(fields);

    const jsonFields = Object.entries(config).filter(([, value]) => Array.isArray(value));
    if (jsonFields.length) {
      const details = document.createElement('details'); details.className = 'rule-details';
      const summary = document.createElement('summary'); summary.textContent = '每輪題目與難度設定';
      details.append(summary);
      for (const [field, value] of jsonFields) {
        const label = document.createElement('label'); label.className = 'rule-json-field';
        label.append(document.createTextNode((ruleFieldLabels[field] ?? field) + '（JSON）'));
        const textarea = document.createElement('textarea'); textarea.className = 'rule-json';
        textarea.spellcheck = false; textarea.dataset.field = field;
        textarea.rows = field === 'difficultyBands' ? 8 : 3;
        textarea.value = JSON.stringify(value, null, 2);
        label.append(textarea); details.append(label);
      }
      card.append(details);
    }
    list.append(card);
  }
  setRulesEditable(['idle', 'final_results'].includes(state?.phase));
}

async function refreshRuleSettings() {
  const status = $('#rules-status');
  status.textContent = '載入規則中…';
  try {
    const response = await fetch('/api/rules', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '無法讀取遊戲設定');
    renderRuleSettings(payload.settings);
    setRulesEditable(payload.editable && ['idle', 'final_results'].includes(state?.phase));
  } catch (error) {
    status.textContent = '設定載入失敗：' + error.message;
    $('#save-rules').disabled = true;
  }
}

async function saveRuleSettings() {
  if (!ruleSettings) return;
  const settings = structuredClone(ruleSettings);
  for (const card of $('#rules-list').querySelectorAll('.rule-game')) {
    const gameId = card.dataset.gameId;
    settings.games[gameId].enabled = card.querySelector('.rule-enabled-input').checked;
    for (const input of card.querySelectorAll('input[data-field]')) {
      settings.games[gameId][input.dataset.field] = Number(input.value);
    }
    for (const textarea of card.querySelectorAll('textarea[data-field]')) {
      try { settings.games[gameId][textarea.dataset.field] = JSON.parse(textarea.value); }
      catch { throw new Error(gameLabels[gameId] + '的「' + ruleFieldLabels[textarea.dataset.field] + '」JSON 格式錯誤'); }
    }
  }
  const status = $('#rules-status');
  status.textContent = '儲存中…';
  try {
    const response = await fetch('/api/rules', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '設定儲存失敗');
    renderRuleSettings(payload.settings);
    status.textContent = '設定已儲存；下一場開始時套用';
  } catch (error) {
    status.textContent = '設定未儲存：' + error.message;
  }
}

async function refreshSessions(preferredSessionId = state?.sessionId ?? null) {
  const response = await fetch('/api/sessions', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '無法讀取場次紀錄');
  const select = $('#session-archive');
  const previous = select.value;
  const sessions = payload.sessions ?? [];
  select.replaceChildren();
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.sessionId;
    const when = session.startedAt ? new Date(session.startedAt).toLocaleString('zh-TW', { hour12: false }) : '時間未知';
    const end = session.phase === 'final_results' ? '已結束' : '進行中／中斷';
    option.textContent = `${when}｜${end}｜${session.participantCount} 位玩家・${session.roundCount} 輪`;
    select.append(option);
  }
  if (!sessions.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '尚無場次紀錄';
    select.append(option);
  }
  const preferred = sessions.some((session) => session.sessionId === preferredSessionId) ? preferredSessionId
    : sessions.some((session) => session.sessionId === previous) ? previous : sessions[0]?.sessionId ?? '';
  select.value = preferred;
  $('#export-session').disabled = !select.value;
  $('#export-session-json').disabled = !select.value;
  $('#archive-status').textContent = sessions.length
    ? `本機保存 ${sessions.length} 場；未結束或中斷的場次也可匯出目前已保存資料。`
    : '尚無場次紀錄。開始一場遊戲後會自動保存。';
}

async function control(action, extra = {}) {
  $('#error').hidden = true;
  try {
    const response = await fetch('/api/control', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '控制操作失敗');
    render(result.state);
  } catch (error) {
    $('#error').textContent = error.message;
    $('#error').hidden = false;
  }
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderGames(data) {
  const list = $('#game-list');
  list.replaceChildren();
  for (const game of data.availableGames ?? []) {
    const button = document.createElement('button');
    button.className = 'button secondary game-choice';
    button.disabled = data.phase !== 'lobby' || !data.participantIds?.length;
    const name = document.createElement('span'); name.textContent = game.name;
    const count = document.createElement('small'); count.textContent = `${game.rounds} 輪`;
    button.append(name, count);
    button.addEventListener('click', () => control('select-game', { gameId: game.id }));
    list.append(button);
  }
}

function renderZones(data) {
  const list = $('#zone-list');
  list.replaceChildren();
  for (const zone of data.zones ?? []) {
    const participant = data.participants?.[zone.id];
    const item = document.createElement('article');
    item.className = `zone${participant ? ' joined' : ''}`;
    const label = document.createElement('strong'); label.textContent = zone.name;
    const status = document.createElement('small');
    status.textContent = participant ? (participant.ready ? '已加入・已準備' : '已加入') : '尚未加入';
    item.append(label, status);
    if (participant) {
      const score = document.createElement('div'); score.className = 'score';
      score.textContent = `${(participant.totalHalfPoints / 2).toFixed(participant.totalHalfPoints % 2 ? 1 : 0)} 分`;
      const rounds = document.createElement('small'); rounds.textContent = `已結算 ${participant.roundsPlayed} 輪`;
      item.append(score, rounds);
    } else {
      const join = document.createElement('button'); join.className = 'button secondary';
      join.disabled = data.phase !== 'lobby'; join.textContent = '工作人員代加入';
      join.addEventListener('click', () => control('join-zone', { zoneId: zone.id }));
      item.append(join);
    }
    list.append(item);
  }
}

function renderResults(data) {
  const list = $('#results-list');
  list.replaceChildren();
  if (!data.results?.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚無已結算輪次'; list.append(empty); return;
  }
  for (const result of data.results.slice(0, 12)) {
    const card = document.createElement('article'); card.className = 'result';
    const title = document.createElement('div'); title.className = 'result-title';
    const game = document.createElement('span'); game.textContent = `${result.gameName}・第 ${result.round} 輪`;
    const reason = document.createElement('small'); reason.textContent = result.reason;
    title.append(game, reason); card.append(title);
    const rows = [...result.rows].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    const summary = document.createElement('div'); summary.className = 'result-row';
    summary.textContent = rows.map((row) => `${row.rank ? `第${row.rank}名` : '未完成'} ${row.zoneId} +${row.score}分`).join('　');
    card.append(summary); list.append(card);
  }
}

function render(data) {
  if (!data) return;
  state = data;
  $('#phase-pill').textContent = phaseNames[data.phase] ?? data.phase;
  $('#notice').textContent = data.notice || '';
  const touch = data.input ?? { ready: false, detail: '尚未連線' };
  const touchPill = $('#touch-status');
  touchPill.textContent = touch.ready ? `TouchService 已連線｜${touch.detail}` : `TouchService 未就緒｜${touch.detail}`;
  touchPill.className = `status-pill ${touch.ready ? 'online' : 'offline'}`;
  const stageConnections = data.output?.stageConnections ?? 0;
  const stagePill = $('#stage-status');
  stagePill.textContent = stageConnections ? `遊戲畫面已連線・${stageConnections}` : '遊戲畫面未連線';
  stagePill.className = `status-pill ${stageConnections ? 'online' : 'offline'}`;
  $('#session-time').textContent = formatTime(data.remainingSessionMs ?? 2_700_000);
  const duration = 2_700_000;
  const remaining = Math.max(0, data.remainingSessionMs ?? duration);
  $('#session-progress').style.width = `${((duration - remaining) / duration) * 100}%`;
  const current = data.currentRound;
  $('#current-game').textContent = current?.gameId ? (data.availableGames.find((g) => g.id === current.gameId)?.name ?? current.gameId) : (data.selectedGame ? data.availableGames.find((g) => g.id === data.selectedGame)?.name ?? '準備中' : '尚未選擇');
  $('#round-count').textContent = current ? `${current.round} / ${data.availableGames.find((g) => g.id === current.gameId)?.rounds ?? '?'}` : '—';
  $('#participant-count').textContent = String(data.participantIds?.length ?? 0);
  $('#game-flow-label').textContent = data.selectedGame ? `${data.availableGames.find((g) => g.id === data.selectedGame)?.name ?? data.selectedGame}｜${phaseNames[data.phase] ?? data.phase}` : '請在大廳選擇遊戲';

  const active = !['idle', 'final_results'].includes(data.phase);
  $('#start-session').disabled = data.phase !== 'idle';
  $('#pause-session').disabled = !active || ['paused', 'resume_countdown'].includes(data.phase);
  $('#resume-session').disabled = data.phase !== 'paused';
  $('#end-session').disabled = data.phase === 'idle';
  $('#end-session').textContent = data.phase === 'final_results' ? '遊戲結束・返回待機' : '立即結束場次';
  $('#start-tutorial').disabled = data.phase !== 'tutorial';
  $('#return-lobby').disabled = data.phase !== 'tutorial';
  $('#restart-round').disabled = !['countdown', 'playing'].includes(data.phase);
  $('#cancel-round').disabled = !['countdown', 'playing'].includes(data.phase);
  if (ruleSettings) setRulesEditable(['idle', 'final_results'].includes(data.phase));
  renderGames(data);
  renderZones(data);
  renderResults(data);
  const archiveKey = `${data.sessionId ?? ''}|${data.phase}|${data.results?.length ?? 0}`;
  if (archiveKey !== archiveRefreshKey) {
    archiveRefreshKey = archiveKey;
    refreshSessions(data.sessionId).catch((error) => { $('#archive-status').textContent = `讀取場次紀錄失敗：${error.message}`; });
  }
}

$('#start-session').addEventListener('click', () => control('start-session'));
$('#pause-session').addEventListener('click', () => control('pause'));
$('#resume-session').addEventListener('click', () => control('resume'));
$('#end-session').addEventListener('click', () => control(state?.phase === 'final_results' ? 'return-to-standby' : 'end-session'));
$('#start-tutorial').addEventListener('click', () => control('start-after-tutorial'));
$('#return-lobby').addEventListener('click', () => control('return-to-lobby'));
$('#restart-round').addEventListener('click', () => control('restart-round'));
$('#cancel-round').addEventListener('click', () => control('cancel-round'));
$('#open-stage').addEventListener('click', () => {
  if (window.desktop?.isDesktop) window.desktop.focusStage();
  else window.open('/stage', '704-stage', 'popup,width=1600,height=1000');
});
$('#touch-diagnostics-open').addEventListener('click', () => openTouchDiagnostics());
$('#touch-diagnostics-close').addEventListener('click', () => $('#touch-diagnostics').close());
$('#touch-diagnostics').addEventListener('close', () => {
  diagnosticsStream?.close();
  diagnosticsStream = null;
});
window.addEventListener('resize', () => {
  if ($('#touch-diagnostics').open) drawTouchMap(lastDiagnosticsData);
});
$('#screen-settings').hidden = !window.desktop?.isDesktop;
$('#screen-settings').addEventListener('click', () => window.desktop?.openDisplaySetup());
$('#refresh-sessions').addEventListener('click', () => refreshSessions().catch((error) => {
  $('#archive-status').textContent = `讀取場次紀錄失敗：${error.message}`;
}));
$('#save-rules').addEventListener('click', () => saveRuleSettings().catch((error) => {
  $('#rules-status').textContent = '設定未儲存：' + error.message;
}));
$('#reload-rules').addEventListener('click', refreshRuleSettings);
$('#session-archive').addEventListener('change', () => {
  const disabled = !$('#session-archive').value;
  $('#export-session').disabled = disabled;
  $('#export-session-json').disabled = disabled;
});
function downloadSelectedSession(extension) {
  const sessionId = $('#session-archive').value;
  if (!sessionId) return;
  const link = document.createElement('a');
  link.href = `/api/sessions/${encodeURIComponent(sessionId)}.${extension}`;
  link.download = `704-session-${sessionId}.${extension}`;
  link.click();
}
$('#export-session').addEventListener('click', () => downloadSelectedSession('csv'));
$('#export-session-json').addEventListener('click', () => downloadSelectedSession('json'));
if (window.desktop?.isDesktop) {
  const displayWarning = $('#display-warning');
  const showDisplayWarning = (message) => {
    displayWarning.textContent = message || '';
    displayWarning.hidden = !message;
  };
  window.desktop.getRuntimeInfo().then((info) => showDisplayWarning(info.warning));
  window.desktop.onDisplayWarning(showDisplayWarning);
}

fetch('/api/state').then((response) => response.json()).then(render).catch((error) => {
  $('#error').textContent = `無法連線到本機服務：${error.message}`; $('#error').hidden = false;
});
refreshRuleSettings();
const events = new EventSource('/api/events');
events.onmessage = (event) => { try { render(JSON.parse(event.data)); } catch (error) { console.error(error); } };
events.onerror = () => { $('#touch-status').textContent = '遊戲服務重新連線中'; $('#touch-status').className = 'status-pill checking'; };
