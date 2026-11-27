import { objectOrthographicSvg, objectPerspectiveSvg } from './object-views.mjs';
import { orthographicSvg, remainingSolidCells } from './solid-views.mjs';
import { countedScore, createFeedbackTimeline, confettiParticles } from './player-feedback.mjs';
import { createIdleParticles } from './idle-scene.mjs';
import { pokerTiming, pokerStage } from './poker-timing.mjs';
import { CAD_SCENE, PROJECTION_CANVAS, calculateProjectionFit } from './projection-layout.mjs';
import { installMouseInput } from './mouse-input.mjs';
import { EXIT_BUTTONS, canPlayerExit } from './exit-control.mjs';
import { TUTORIAL_BUTTON_DIAMETER } from './tutorial-control.mjs';

import { renderPerspectiveSceneSvg } from './map-scene.mjs';
import { slitherlinkBoardSvg } from './slitherlink-board.mjs';
import { sharedTutorialWalls, illustratedTutorial } from './tutorial-presentation.mjs';
import { getGameTutorial } from './tutorial-content.mjs';
import { compareStageStateFreshness, scoreboardColumnCount, stageStructureKey } from './stage-rendering.mjs';

const $ = (selector) => document.querySelector(selector);
const venueWidth = CAD_SCENE.width, venueHeight = CAD_SCENE.height;
const projectionWidth = PROJECTION_CANVAS.width, projectionHeight = PROJECTION_CANVAS.height;
const venue = $('#venue');
const projectionCanvas = $('#projection-canvas');
const idleParticles = createIdleParticles($('#idle-particles'));
const gameNames = {
  minesweeper: '踩地雷', zero_sum_grid: '數字方格', cube_count: '3D 數方塊',
  solid_puzzle: '立體拼圖', memory_poker: '記憶撲克', map_view: '地圖定位', memory_sequence: '數字速記',
  slitherlink: '數迴'
};
const GAME_ICONS = { minesweeper: '01_minesweeper', zero_sum_grid: '02_zero_sum_grid', cube_count: '03_count_cubes', solid_puzzle: '04_spatial_puzzle', memory_poker: '05_memory_poker', map_view: '06_map_position', memory_sequence: '07_number_memory', slitherlink: '08_slitherlink' };
// Share deterministic object SVGs across up to eight player walls; bounded across rounds.
const objectSvgCache = new Map();
function objectSvg(object, perspective = false) {
  const key = `${perspective ? '3d' : 'ortho'}:${JSON.stringify(object)}`;
  if (!objectSvgCache.has(key)) {
    if (objectSvgCache.size >= 64) objectSvgCache.clear();
    objectSvgCache.set(key, perspective ? objectPerspectiveSvg(object) : objectOrthographicSvg(object));
  }
  return objectSvgCache.get(key);
}
let state;
let lastRenderedStructureKey = null;
const lastSequenceWrongCount = new Map();
const mineErrorFeedback = new Map();
const feedbackTimeline = createFeedbackTimeline();
const floor = $('#floor');
let tutorialProgress = { active: false, heldMs: 0, requiredMs: 1000, receivedAt: 0 };

function paintTutorialProgress() {
  const button = floor.querySelector('.shared-tutorial-complete');
  if (!button) return;
  const hold = tutorialProgress;
  const elapsed = hold.active ? Math.min(hold.requiredMs, hold.heldMs + Math.min(250, performance.now() - hold.receivedAt)) : 0;
  const percent = Math.min(100, elapsed / Math.max(1, hold.requiredMs) * 100);
  button.style.setProperty('--hold-progress', `${percent}%`);
  button.setAttribute('aria-valuenow', String(Math.floor(percent)));
  setTextIfChanged(button.querySelector('.tutorial-hold-time'), `${(elapsed / 1000).toFixed(1)} / ${(hold.requiredMs / 1000).toFixed(1)} 秒`);
  setTextIfChanged(button.querySelector('.tutorial-hold-label'), percent >= 100 ? '開始遊戲' : '長按開始');
}
function animateTutorialProgress() {
  paintTutorialProgress();
  paintScoreCounters();
  requestAnimationFrame(animateTutorialProgress);
}
requestAnimationFrame(animateTutorialProgress);

function updateVenueScale() {
  const bounds = projectionCanvas.getBoundingClientRect();
  const fit = calculateProjectionFit(bounds.width, bounds.height);
  if (!fit) return;
  venue.style.left = `${fit.left}px`;
  venue.style.top = `${fit.top}px`;
  venue.style.width = `${fit.sceneWidth}px`;
  venue.style.height = `${fit.sceneHeight}px`;
  venue.style.setProperty('--venue-scale', String(fit.scale));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function addText(parent, className, text) { parent.append(el('div', className, text)); }
function secondsLeft(ms) { return `${Math.max(0, Math.ceil(ms / 1000))}s`; }
function rectStyle(rect) {
  return `left:${rect.x / venueWidth * 100}%;top:${rect.y / venueHeight * 100}%;width:${rect.width / venueWidth * 100}%;height:${rect.height / venueHeight * 100}%`;
}
function setTextIfChanged(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function sharedMenuTile(option, data, split) {
  const tile = el('div', `shared-game-tile${option.id === 'random' ? ' random-game' : ''}`);
  const icons = GAME_ICONS;
  if (icons[option.id]) {
    const glow = el('div', 'shared-game-icon-glow');
    const icon = el('img', 'shared-game-icon'); icon.src = `/icons/${icons[option.id]}.png`; icon.alt = '';
    glow.append(icon); tile.append(glow);
  } else if (option.id === 'random') {
    const glow = el('div', 'shared-game-icon-glow random-icon-collage');
    glow.setAttribute('aria-label', '各款遊戲圖示組合');
    for (const file of Object.values(GAME_ICONS)) {
      const icon = el('img', 'random-game-mini-icon'); icon.src = '/icons/' + file + '.png'; icon.alt = ''; glow.append(icon);
    }
    tile.append(glow);
  }
  tile.append(el('strong', '', option.name));
  tile.append(el('small', '', option.id === 'random' ? '全體共同抽選一款遊戲' : `全體共同遊玩・${option.rounds} 輪`));
  tile.append(el('span', 'shared-game-prompt', data.phase === 'lobby' ? (split ? '觸碰此半邊選擇' : '觸碰此區域選擇') : '全場確認中'));
  if (data.phase === 'lobby' && !(data.layout?.participantCount > 0)) {
    tile.setAttribute('aria-disabled', 'true');
    const mask = el('div', 'lobby-player-required');
    mask.append(el('strong', '', '請先選擇玩家'), el('small', '', '請由工作人員加入玩家'), el('span', '', '尚未開放選擇遊戲'));
    tile.append(mask);
  }
  return tile;
}

/** A single illustrated presentation spans each physical wall, independent of player count. */
function renderSharedTutorialWall(wall, data) {
  const node = el('section', 'tutorial-wall');
  node.style.cssText = rectStyle(wall.rect);
  node.dataset.wallId = wall.id;
  const content = el('div', 'tutorial-wall-content');
  const sideways = wall.rotationDegrees % 180 !== 0;
  content.style.width = `${sideways ? wall.rect.height : wall.rect.width}px`;
  content.style.height = `${sideways ? wall.rect.width : wall.rect.height}px`;
  content.style.transform = `translate(-50%, -50%) rotate(${wall.rotationDegrees}deg)`;
  const header = el('div', 'tutorial-wall-header');
  const icon = el('img', 'tutorial-wall-icon'); icon.src = `/icons/${GAME_ICONS[data.selectedGame]}.png`; icon.alt = '';
  header.append(icon, el('strong', '', gameNames[data.selectedGame]), el('span', '', '一起看示範'));
  const story = illustratedTutorial(data.selectedGame, data.gameRules?.games?.[data.selectedGame]);
  const demo = el('div', 'tutorial-demo');
  const frames = el('div', 'tutorial-frames');
  const steps = el('ol', 'tutorial-visual-steps');
  story.frames.forEach((frame, index) => {
    const slide = el('div', 'tutorial-frame');
    slide.style.setProperty('--slide-delay', `${index === 0 ? 0 : (index - 3) * 3}s`);
    slide.setAttribute('aria-label', frame.label);
    if (frame.svg) slide.innerHTML = frame.svg;
    else slide.append(renderTutorialSolid(data.selectedGame, index, data.gameRules?.games?.[data.selectedGame]));
    frames.append(slide);
    const step = el('li', 'tutorial-visual-step');
    step.style.setProperty('--slide-delay', `${index === 0 ? 0 : (index - 3) * 3}s`);
    step.append(el('span', 'tutorial-step-number', String(index + 1)), el('span', '', frame.label));
    steps.append(step);
  });
  demo.append(frames, steps);
  content.append(header, demo, el('div', 'tutorial-wall-footer', '看完示範後，任一玩家長按地板中央開始'));
  node.append(content);
  return node;
}
function renderTutorialSolid(gameId, step, config = {}) {
  const box = el('div', 'tutorial-solid-demo');
  if (gameId === 'cube_count') {
    box.append(createIsometricSvg([[0,0,0],[1,0,0],[0,0,1]], {
      viewWidth: 640, viewHeight: 320, margin: 25, label: '兩個底層方塊加一個上層方塊'
    }));
    box.append(el('div', step === 2 ? 'tutorial-demo-confirm' : 'tutorial-demo-caption',
      ['上下層都要數', '底層 2 ＋ 上層 1 ＝ 3', '輸入 3 → 確定'][step]));
  } else {
    const missing = [[0,0,1],[0,1,1],[0,0,2],[0,1,2]];
    const views = el('div', 'tutorial-orthographic');
    const remaining = config.questionMode === 'remaining_solid_views';
    if (step === 0) views.innerHTML = orthographicSvg(remaining ? remainingSolidCells([2,2,3], missing) : missing, { bounds: [2,2,3], target: !remaining });
    else views.append(renderShapeCells(missing));
    box.append(views);
    box.append(el('div', step === 2 ? 'tutorial-demo-confirm' : 'tutorial-demo-caption',
      [remaining ? '三視圖顯示現有物件，找出缺少部分' : '黃色是缺口投影', '找出能補回完整外框的零件', '選取零件 → 確定'][step]));
  }
  return box;
}

/** One wall of the shared lobby menu; the last wall may hold several options side by side. */
function renderSharedMenuZone(zone, options, data) {
  if (!options?.length) return null;
  const node = el('section', 'zone shared-menu-zone');
  node.dataset.menuZoneId = zone.id;
  node.dataset.gameId = options.map((option) => option.id).join(' ');
  node.style.cssText = rectStyle(zone.rect);
  const inner = el('div', 'zone-inner');
  const content = el('div', 'zone-content shared-menu-content');
  content.style.width = '640px'; content.style.height = '640px';
  content.style.transform = `rotate(${zone.rotationDegrees}deg)`;
  const header = el('div', 'zone-header');
  const body = el('div', 'zone-body shared-menu-body');
  if (options.length === 1) body.append(sharedMenuTile(options[0], data, false));
  else {
    const split = el('div', 'shared-menu-split');
    split.style.setProperty('--split', String(options.length));
    for (const option of options) split.append(sharedMenuTile(option, data, true));
    body.append(split);
  }
  content.append(header, body);
  if (data.phase === 'game_preview' && options.some((option) => option.id === data.selectedGame)) {
    const mask = el('div', 'shared-preview-wall-mask');
    mask.setAttribute('aria-hidden', 'true');
    const confirm = el('div', 'shared-preview-wall-action shared-preview-wall-confirm');
    confirm.append(el('strong', '', '確定'), el('small', '', '進入教學'));
    const cancel = el('div', 'shared-preview-wall-action shared-preview-wall-cancel');
    cancel.append(el('strong', '', '取消'), el('small', '', '返回選單'));
    mask.append(confirm, cancel);
    content.append(mask);
  }
  inner.append(content); node.append(inner);
  return node;
}

function renderZone(zone, view, data) {
  const node = el('section', 'zone'); node.dataset.zoneId = zone.id; node.style.cssText = rectStyle(zone.rect);
  const inner = el('div', 'zone-inner');
  const content = el('div', 'zone-content');
  content.style.width = '640px'; content.style.height = '640px';
  content.style.transform = `rotate(${zone.rotationDegrees}deg)`;
  const header = el('div', 'zone-header');
  const body = el('div', 'zone-body');
  content.append(header, body); inner.append(content); node.append(inner);
  const panel = view?.[zone.id];

  if (!panel?.joined) {
    body.classList.add('zone-body-centered');
    body.append(el('div', 'join-prompt', '等待工作人員加入'), el('div', 'subprompt', '加入後依 P 編號前往對應答題區'));
    return node;
  }
  if (data.phase === 'lobby') {
    header.append(el('div', 'zone-head', `累積 ${(panel.score ?? 0).toFixed(1)} 分`));
    header.append(el('div', 'zone-detail', '全場共用選單・請共同決定一款'));
    body.classList.add('zone-body-centered');
    body.append(el('div', 'shared-menu-reminder', '本區遊戲選項與其他牆面選項共組一份全場選單。'));
    return node;
  }
  if (data.phase === 'tutorial') {
    header.append(el('div', 'zone-head', gameNames[data.selectedGame] ?? '小遊戲'));
    const text = renderTutorial(data.selectedGame, data.gameRules?.games?.[data.selectedGame] ?? {});
    body.classList.add('tutorial-body');
    body.append(text, el('div', 'tutorial-shared-hint', '全體共用：請到地板中央長踩「完成教學」按鈕。'));
    return node;
  }
  if (data.phase === 'game_preview') {
    header.append(el('div', 'zone-head', gameNames[data.selectedGame] ?? '小遊戲'));
    body.classList.add('game-preview-body');
    body.append(el('div', 'game-preview-copy', '請在所選遊戲牆面觸碰圓形「確定」或「取消」按鈕。'));
    return node;
  }
  if (data.phase === 'countdown') {
    const number = Math.max(1, Math.ceil((data.currentRound?.countdownMs ?? 0) / 1000));
    header.classList.add('player-countdown-header');
    header.append(el('div', 'player-game-title', gameNames[data.currentRound?.gameId] ?? '遊戲'), el('div', 'zone-detail', `第 ${data.currentRound?.round ?? ''} 輪`));
    body.classList.add('zone-body-centered'); body.append(el('div', 'floor-title game-countdown', String(number))); return node;
  }
  if (data.phase === 'round_results') {
    renderZoneResult(header, body, panel, data); return node;
  }
  if (data.phase !== 'playing' || !data.currentRound) {
    header.append(el('div', 'zone-head', `累積 ${(panel.score ?? 0).toFixed(1)} 分`));
    body.classList.add('zone-body-centered'); return node;
  }
  const round = data.currentRound, q = round.question ?? {};
  const sequenceWrongCount = panel.sequence?.wrongCount ?? 0;
  const flashSequenceError = round.gameId === 'memory_sequence' && sequenceWrongCount > (lastSequenceWrongCount.get(zone.id) ?? 0);
  if (round.gameId === 'memory_sequence') lastSequenceWrongCount.set(zone.id, sequenceWrongCount);
  const gameConfig = data.gameRules?.games?.[round.gameId] ?? {};
  const timer = round.gameId === 'memory_poker' ? pokerPhase(round.elapsedMs, gameConfig)
    : round.gameId === 'memory_sequence' ? sequencePhase(round, gameConfig) : secondsLeft(round.limitMs - round.elapsedMs);
  header.classList.add('player-game-header');
  const title = el('div', 'player-game-title');
  title.append(el('span', '', gameNames[round.gameId]), el('span', 'player-round-progress', `${round.round}/${gameConfig.rounds}`));
  header.append(title);
  const clock = el('div', 'player-game-clock');
  clock.append(el('span', 'player-time-label'), el('strong', 'player-time-value'), el('span', '', '秒'));
  header.append(clock); updatePlayerClock(clock, timer);
  if (round.gameId === 'minesweeper') {
    header.append(el('div', 'zone-detail', `安全格 ${panel.mine?.safeProgress ?? 0} / ${(q.cols ?? gameConfig.boardColumns) * (q.rows ?? gameConfig.boardRows) - (q.mineCount ?? 0)}　踩雷 ${panel.mine?.hits?.length ?? 0}　旗標 ${panel.mine?.flags?.length ?? 0}　罰時 ${secondsLeft(panel.mine?.penaltyMs ?? 0)}`));
  } else if (round.gameId === 'zero_sum_grid' || round.gameId === 'cube_count') {
    const numericEntryEnabled = Boolean(data.gameRules?.common?.layout?.numericEntryRect);
    const lockText = panel.lockRemainingMs > 0 ? `鎖答 ${secondsLeft(panel.lockRemainingMs)}` : '';
    header.append(el('div', `zone-detail${numericEntryEnabled ? ' numeric-lock-detail' : ''}`,
      numericEntryEnabled ? lockText : `目前輸入：${panel.entry || '—'}${lockText ? `　${lockText}` : ''}`));
  } else if (round.gameId === 'memory_poker') {
    header.append(el('div', 'zone-detail', `${gameConfig.communityCards} 張公共牌＋${gameConfig.selectedCardsRequired} 張自選牌，取最佳 5 張`));
  } else if (round.gameId === 'memory_sequence') {
    header.classList.add('sequence-game-header');
    const hearts = el('div', 'sequence-hearts');
    const remaining = panel.sequence?.hearts ?? 0;
    hearts.setAttribute('aria-label', `剩餘 ${remaining} 顆愛心`);
    for (let i = 0; i < Math.min(gameConfig.heartsPerRound ?? 3, 5); i++) hearts.append(el('span', i < remaining ? 'heart-full' : 'heart-empty', i < remaining ? '♥' : '♡'));
    if ((gameConfig.heartsPerRound ?? 3) > 5) hearts.textContent = `♥ × ${remaining}`;
    clock.append(hearts);
    header.append(el('div', 'zone-detail', round.elapsedMs < (q.memorySeconds ?? 0) * 1000
      ? '記憶數字位置' : `下一個：${(panel.sequence?.progress ?? 0) + 1}　最佳：${panel.sequence?.bestProgress ?? 0}`));
  } else if (round.gameId === 'slitherlink') {
    const edges = panel.slither?.edges ?? [];
    header.append(el('div', 'zone-detail',
      `線段 ${edges.filter((state) => state === 1).length}　叉 ${edges.filter((state) => state === 2).length}　點一下：線 → 叉 → 清除`));
  }
  const isDone = panel.done || panel.eliminated;
  if (isDone) {
    body.classList.add('zone-body-centered');
    body.append(el('div', 'floor-title', panel.eliminated ? '本輪結束' : '答對了!'), el('div', 'compact-info', '等待其他玩家'));
    if (!panel.eliminated) appendCelebration(body, zone.id);
    if (flashSequenceError && panel.eliminated) {
      const flash = el('div', 'sequence-wrong-flash sequence-wrong-flash-zone');
      flash.setAttribute('aria-hidden', 'true');
      node.append(flash);
    }
    return node;
  }
  if (round.gameId === 'minesweeper') renderMineZone(body, panel.mine, q, gameConfig, data.gameRules.common.layout);
  else if (round.gameId === 'zero_sum_grid' || round.gameId === 'cube_count') renderKeypad(body, data.gameRules?.common?.layout, panel.entry, panel.lockRemainingMs);
  else if (round.gameId === 'solid_puzzle') renderChoices(body, q.choices ?? [], panel.selection, 'piece', panel.choiceOrder, gameConfig);
  else if (round.gameId === 'map_view') renderMapPlayer(body, q, panel.selection, gameConfig);
  else if (round.gameId === 'memory_poker') renderPokerZone(body, panel, q, round.elapsedMs, gameConfig);
  else if (round.gameId === 'memory_sequence') renderSequenceZone(body, panel.sequence, round, false, flashSequenceError);
  else if (round.gameId === 'slitherlink') renderSlitherlinkZone(body, panel.slither, q, gameConfig);
  if (panel.error && (!panel.error.includes('鎖答') || panel.lockRemainingMs > 0)) header.append(el('div', 'zone-feedback', panel.error));
  updateAnswerErrorOverlay(content, panel);
  if (round.gameId === 'minesweeper') renderMineErrorFeedback(content, zone.id, panel.mine, round.id);
  return node;
}

function renderMineErrorFeedback(content, zoneId, mine, roundId) {
  const previous = mineErrorFeedback.get(zoneId);
  const sameRound = previous?.roundId === roundId;
  const hits = mine?.hits?.length ?? 0;
  const until = hits > (sameRound ? previous.hits : 0) ? performance.now() + 900 : (sameRound ? previous.until : 0);
  mineErrorFeedback.set(zoneId, { roundId, hits, until });
  const remaining = until - performance.now();
  if (remaining <= 0) return;
  const mask = el('div', 'answer-error-overlay mine-error-feedback');
  mask.setAttribute('role', 'status');
  mask.append(el('strong', '', '錯誤'), el('span', 'answer-error-countdown', '踩中地雷，可繼續作答'));
  content.append(mask);
  window.setTimeout(() => mask.remove(), remaining);
}

function updatePlayerClock(clock, timer) {
  if (!clock) return;
  const match = /^(.*?)(\d+)s$/.exec(timer);
  setTextIfChanged(clock.querySelector('.player-time-label'), match?.[1]?.trim() || '剩餘');
  setTextIfChanged(clock.querySelector('.player-time-value'), match?.[2] ?? timer);
}

/** Use the server's remaining lock time, including after pause/resume or reconnect. */
function updateAnswerErrorOverlay(content, panel) {
  let mask = content.querySelector('.answer-error-overlay:not(.mine-error-feedback)');
  if (!(panel.lockRemainingMs > 0) || panel.done || panel.eliminated) {
    mask?.remove();
    return;
  }
  if (!mask) {
    mask = el('div', 'answer-error-overlay');
    mask.setAttribute('role', 'status');
    mask.append(el('strong', '', '錯誤'), el('span', 'answer-error-countdown'));
    content.append(mask);
  }
  setTextIfChanged(mask.querySelector('.answer-error-countdown'), `${secondsLeft(panel.lockRemainingMs)} 後可繼續作答`);
}

/** Player wall board: the SVG uses the same 640×640 local coordinates as touch hit-testing. */
function renderSlitherlinkZone(body, slither = {}, q = {}, config = {}, solution = null) {
  const board = el('div', 'slither-zone-board');
  board.innerHTML = slitherlinkBoardSvg({
    cols: q.cols ?? config.boardColumns, rows: q.rows ?? config.boardRows,
    clues: q.clues ?? [], edges: slither?.edges ?? [], solution,
    rect: config.boardRect ?? { x: 80, y: 144, width: 480, height: 480 },
    viewBox: '0 128 640 512', className: 'slither-svg', label: '數迴作答盤'
  });
  body.classList.add('slither-body');
  body.append(board);
  if (!solution && config.undoRect) {
    const undo = el('div', 'slither-undo' + (slither.canUndo ? '' : ' disabled'), '↶ 上一步');
    const rect = config.undoRect;
    undo.style.cssText = `left:${rect.x}px;top:${rect.y - 128}px;width:${rect.width}px;height:${rect.height}px`;
    undo.setAttribute('role', 'button');
    undo.setAttribute('aria-disabled', String(!slither.canUndo));
    body.append(undo);
  }
}

function renderMineZone(body, mine = {}, q = {}, config = {}, layout = {}) {
  body.classList.add('mine-body');
  const flagMode = mine.mode === 'flag';
  const board = el('div', 'answer-grid mine-board' + (flagMode ? ' mode-flag' : ' mode-reveal'));
  const cols = q.cols ?? config.boardColumns ?? 8, rows = q.rows ?? config.boardRows ?? 6;
  const position = (node, rect) => {
    node.style.cssText = `left:${rect.x}px;top:${rect.y - (layout.interactiveRect?.y ?? 128)}px;width:${rect.width}px;height:${rect.height}px`;
  };
  position(board, config.boardRect ?? { x: 64, y: 192, width: 512, height: 384 });
  board.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
  board.style.gridTemplateRows = `repeat(${rows},minmax(0,1fr))`;
  for (let i = 0; i < cols * rows; i++) {
    const cell = el('div', 'answer-cell');
    if (mine.revealed?.includes(i)) {
      cell.classList.add('open'); const value = mine.numbers?.[i]; cell.textContent = value === 0 ? '' : value === -1 ? '✹' : String(value ?? '');
      if (value === -1) cell.classList.add('mine');
    } else if (mine.flags?.includes(i)) { cell.classList.add('flag'); cell.textContent = '⚑'; }
    else if (i === q.anchor && !(mine.revealed?.length)) { cell.classList.add('anchor'); cell.textContent = '起'; }
    board.append(cell);
  }
  const toolbar = el('div', 'ready-button mine-toolbar ' + (flagMode ? 'mode-flag' : 'mode-reveal'));
  toolbar.append(el('strong', '', flagMode ? '⚑ 標記模式' : '揭露模式'),
    el('small', '', flagMode ? '點此切換揭露' : '點此切換標記'));
  position(toolbar, config.toolbarRect ?? { x: 64, y: 128, width: 512, height: 64 });
  body.append(board, toolbar);
}

function renderKeypad(body, layout = {}, entry = '', lockRemainingMs = 0) {
  const entryRect = layout.numericEntryRect;
  const keypadRect = layout.numericKeypadRect ?? layout.interactiveRect ?? { width: 640, height: 512 };
  if (entryRect) {
    const display = el('div', 'numeric-entry-display');
    display.style.width = `${entryRect.width}px`; display.style.height = `${entryRect.height}px`;
    display.append(el('div', 'numeric-entry-label', '目前輸入'), el('div', 'numeric-entry-value', entry || '—'));
    body.append(display);
  }
  const pad = el('div', 'number-pad');
  pad.style.width = `${keypadRect.width}px`; pad.style.height = `${keypadRect.height}px`;
  const labels = { backspace: '更正', clear: '重作', confirm: '確定' };
  if (layout.numericConfirmRect) {
    const r = layout.numericConfirmRect;
    const confirm = el('div', 'key confirm numeric-confirm', '確定');
    confirm.style.cssText = `left:${r.x}px;top:${r.y - (layout.interactiveRect?.y ?? 128)}px;width:${r.width}px;height:${r.height}px`;
    body.append(confirm);
  }
  for (const key of layout.numericKeypadKeys ?? []) {
    if (key === 'spacer' || key === 'confirm' && layout.numericConfirmRect) { pad.append(el('div', 'key key-spacer')); continue; }
    const modifier = key === 'confirm' ? ' confirm' : key === 'clear' ? ' clear' : key === 'backspace' ? ' backspace' : '';
    pad.append(el('div', `key${modifier}`, labels[key] ?? key));
  }
  body.append(pad);
}

function renderChoices(body, choices, selection, kind, choiceOrder = null, config = {}) {
  const grid = el('div', 'choice-grid');
  grid.style.gridTemplateColumns = `repeat(${config.choiceGridColumns ?? 2}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${config.choiceGridRows ?? 3}, minmax(0, 1fr))`;
  const choicesById = new Map(choices.map((item) => [item.id, item]));
  const orderedChoices = choiceOrder?.length === choices.length
    ? choiceOrder.map((id) => choicesById.get(id)).filter(Boolean) : choices;
  for (const item of orderedChoices.slice(0, 6)) {
    const tile = el('div', `choice-tile${selection === item.id ? ' selected' : ''}`);
    tile.append(el('strong', '', item.id));
    if (kind === 'object') {
      const model = el('div', 'piece-svg object-piece'); model.innerHTML = objectSvg(item.object, true); tile.append(model);
    } else if (kind === 'map') tile.append(el('small', '', `${item.heading}・${item.x + 1},${item.y + 1}`));
    else tile.append(renderShapeCells(item.cells ?? []));
    grid.append(tile);
  }
  body.classList.add('puzzle-choice-body');
  const confirm = el('div', 'ready-button confirm-button puzzle-confirm');
  confirm.append(el('span', 'choice-selection-count', `已選 ${selection ? 1 : 0} / 1`), el('span', '', '確定'));
  for (const [node, rect] of [[grid, config.choiceGridRect], [confirm, config.confirmRect]]) {
    if (rect) node.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y - 128}px;width:${rect.width}px;height:${rect.height}px`;
  }
  body.append(grid, confirm);
}

function renderMapPlayer(body, q = {}, selection = null, config = {}) {
  if (q.kind === 'object_views') { renderChoices(body, q.choices ?? [], selection, 'object', null, config); return; }
  const mapHeight = config.mapPanelRect?.height ?? 256;
  const answerRect = config.choiceGridRect ?? { height: 192 };
  const columns = config.choiceGridColumns ?? 3, rows = config.choiceGridRows ?? 2;
  const layout = el('div', 'map-player-layout');
  layout.style.height = `${mapHeight + answerRect.height}px`;
  layout.style.gridTemplateRows = `${mapHeight}px ${answerRect.height}px`;
  const mapArea = el('div', 'map-player-map-area');
  mapArea.style.height = `${mapHeight}px`;
  mapArea.style.gridTemplateRows = `26px ${Math.max(0, mapHeight - 26)}px`;
  mapArea.append(el('div', 'map-player-caption', '俯視地圖　・　北 ↑'), renderMapGrid(q));
  const choices = el('div', 'map-choice-grid');
  choices.style.height = `${answerRect.height}px`;
  choices.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  choices.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  const headings = { N: '北', E: '東', S: '南', W: '西' };
  const arrows = { N: '↑', E: '→', S: '↓', W: '←' };
  for (const item of (q.choices ?? []).slice(0, 6)) {
    const tile = el('div', `choice-tile map-choice-tile${selection === item.id ? ' selected' : ''}`);
    tile.append(el('strong', '', item.id));
    tile.append(el('small', '', `(${item.x + 1}, ${item.y + 1})　${headings[item.heading] ?? item.heading} ${arrows[item.heading] ?? ''}`));
    choices.append(tile);
  }
  layout.append(mapArea, choices);
  body.append(layout, el('div', 'ready-button confirm-button map-confirm', selection ? `已選 ${selection}・按此確認` : '選擇 A–F 後按確認'));
}

function renderShapeCells(cells) {
  return createIsometricSvg(cells, {
    azimuthDegrees: -55, elevationDegrees: 30,
    viewWidth: 320, viewHeight: 180, margin: 12,
    className: 'piece-svg', edgeWidth: 1.5, label: '立體方塊零件'
  });
}

function renderPokerZone(body, panel, q, elapsedMs, config) {
  body.classList.add('poker-body');
  const { communityEnd, memoryEnd, selectionEnd } = pokerTiming(config);
  const stage = pokerStage(elapsedMs, config);
  if (stage === 'community') {
    body.append(el('div', 'poker-preview-message', '先看公共牌'), el('div', 'compact-info', '接著記憶 16 張牌的位置'));
    return;
  }
  const memory = stage === 'memory';
  const grid = el('div', 'memory-grid poker-grid');
  grid.style.cssText = `position:absolute;left:${config.cardGridRect.x}px;top:${config.cardGridRect.y - 128}px;width:${config.cardGridRect.width}px;height:${config.cardGridRect.height}px`;
  const cards = q.cards;
  for (let i = 0; i < 16; i++) {
    const selected = panel.selected?.includes(i);
    const label = memory ? cards?.[i] : String.fromCharCode(65 + i);
    const card = el('div', `${memory ? 'card-face' : 'card-back'}${selected ? ' selected' : ''}`, label ?? String.fromCharCode(65 + i));
    if (memory && /[♦♥]/.test(label ?? '')) card.classList.add('red');
    grid.append(card);
  }
  const info = el('div', `compact-info poker-info${memory ? '' : ' selection-count'}`, memory ? '記憶牌面與位置' : `已選 ${panel.selected?.length ?? 0} / ${config.selectedCardsRequired ?? 3}`);
  info.style.cssText = `position:absolute;left:${config.selectionInfoRect.x}px;top:${config.selectionInfoRect.y - 128}px;width:${config.selectionInfoRect.width}px;height:${config.selectionInfoRect.height}px`;
  body.append(grid, info);
  if (!memory && elapsedMs < selectionEnd) {
    const confirm = el('div', 'ready-button confirm-button poker-confirm', panel.locked ? '已確認' : `選滿 ${config.selectedCardsRequired ?? 3} 張後按確認`);
    const rect = config.confirmRect;
    confirm.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y - 128}px;width:${rect.width}px;height:${rect.height}px`;
    body.append(confirm);
  }
}

function renderSequenceZone(body, sequence = {}, round, forceReveal = false, flashWrong = false) {
  const memoryMs = (round.question?.memorySeconds ?? 0) * 1000;
  const memory = forceReveal || round.elapsedMs < memoryMs;
  const cols = round.question?.cols ?? 10, rows = round.question?.rows ?? 8;
  const values = sequence.values ?? Array(cols * rows).fill(0);
  const grid = el('div', 'answer-grid sequence-grid');
  for (let i = 0; i < cols * rows; i++) {
    const cell = el('div', 'answer-cell');
    if (values[i] > 0) {
      cell.classList.add('sequence-number'); cell.textContent = String(values[i]);
    } else if (!memory && sequence.covered?.[i]) {
      cell.classList.add('sequence-covered');
    }
    grid.append(cell);
  }
  const board = el('div', 'sequence-board-wrap');
  board.append(grid);
  if (!forceReveal && flashWrong) {
    const flash = el('div', 'sequence-wrong-flash');
    flash.setAttribute('aria-hidden', 'true');
    board.append(flash);
  }
  body.append(board);
}

function paintScoreCounters() {
  for (const node of document.querySelectorAll('[data-score-from]')) {
    const value = countedScore(Number(node.dataset.scoreFrom), Number(node.dataset.scoreTo), performance.now() - Number(node.dataset.scoreStarted));
    setTextIfChanged(node, String(value));
  }
}

function appendCelebration(body, zoneId) {
  const started = feedbackTimeline.start('success:' + zoneId, performance.now());
  const elapsed = performance.now() - started;
  if (elapsed >= 2200 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const burst = el('div', 'answer-confetti');
  burst.setAttribute('aria-hidden', 'true');
  for (const particle of confettiParticles()) {
    const piece = el('i', 'confetti-piece');
    piece.style.cssText = '--dx:' + particle.x + 'px;--dy:' + particle.y + 'px;--spin:' + particle.rotation + 'deg;background:' + particle.color + ';animation-delay:' + (particle.delay - elapsed) + 'ms';
    burst.append(piece);
  }
  body.append(burst);
}

function renderZoneResult(header, body, panel, data) {
  const resultRow = data.results?.[0]?.rows?.find(result => result.zoneId === panel.zoneId);
  const added = resultRow?.score ?? 0;
  const total = panel.score ?? 0;
  header.parentElement.classList.add('player-results-content');
  const rankLabel = resultRow?.rank ? '第 ' + resultRow.rank + ' 名' : '未完成';
  header.append(el('div', 'zone-result-heading', (data.results?.[0]?.gameName ?? '本輪結算') + '・' + rankLabel),
    resultScore(added, resultRow?.rank, true), el('div', 'zone-result-detail', '本題得分'));
  body.classList.add('player-total-panel');
  const counter = resultScore(total);
  counter.classList.add('player-total-score');
  counter.dataset.scoreFrom = String(Math.max(0, total - added));
  counter.dataset.scoreTo = String(total);
  counter.dataset.scoreStarted = String(feedbackTimeline.start('score:' + panel.zoneId, performance.now()));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) counter.dataset.scoreStarted = String(performance.now() - 1600);
  counter.textContent = String(countedScore(Number(counter.dataset.scoreFrom), total, performance.now() - Number(counter.dataset.scoreStarted)));
  body.append(el('div', 'player-total-label', '積分'), counter);
  if (resultRow?.completed && data.currentRound?.gameId !== 'memory_poker') {
    body.append(el('div', 'result-success-label', '答對了!'));
    appendCelebration(body, panel.zoneId);
  }
}

function pokerPhase(elapsedMs, config) {
  const { communityEnd, memoryEnd, selectionEnd } = pokerTiming(config);
  const revealEnd = selectionEnd + config.revealCountdownSeconds * 1000;
  if (elapsedMs < communityEnd) return `公共牌 ${secondsLeft(communityEnd - elapsedMs)}`;
  if (elapsedMs < memoryEnd) return `記憶 ${secondsLeft(memoryEnd - elapsedMs)}`;
  if (elapsedMs < selectionEnd) return `選牌 ${secondsLeft(selectionEnd - elapsedMs)}`;
  if (elapsedMs < revealEnd) return `揭曉 ${secondsLeft(revealEnd - elapsedMs)}`;
  return '揭曉';
}
function sequencePhase(round, config) {
  const memoryMs = (round.question?.memorySeconds ?? 0) * 1000;
  if (round.elapsedMs < memoryMs) return `記憶 ${secondsLeft(memoryMs - round.elapsedMs)}`;
  return `作答 ${secondsLeft(config.answerSeconds * 1000 - (round.elapsedMs - memoryMs))}`;
}

function renderFloor(data) {
  floor.replaceChildren();
  floor.classList.toggle('shared-floor-controls-active', data.phase === 'tutorial');
  if (data.phase === 'idle') {
    const logo = el('img', 'idle-logo');
    logo.src = '/icons/logo-704.png';
    logo.alt = '腦力競賽・光域704';
    logo.draggable = false;
    floor.append(logo);
    return;
  }
  if (data.phase === 'lobby') {
    const joined = data.layout?.participantCount ?? 0;
    const box = el('div', 'shared-floor-screen shared-lobby-floor');
    box.append(el('div', 'lobby-player-count', `已選擇 ${joined} 位玩家`));
    if (joined > 0) {
      const markers = el('div', 'lobby-player-circles');
      markers.setAttribute('aria-label', `已選擇 ${joined} 位玩家`);
      for (let i = 0; i < joined; i++) {
        const circle = el('div', 'lobby-player-circle', String(i + 1));
        circle.setAttribute('aria-hidden', 'true');
        markers.append(circle);
      }
      box.append(markers);
    }
    box.append(el('div', `floor-subtitle${joined ? '' : ' lobby-player-warning'}`, joined
      ? '請共同選擇牆面上的一款遊戲'
      : '請由工作人員先選擇玩家，再選擇遊戲'));
    floor.append(box);
    return;
  }
  if (data.phase === 'game_preview' && data.selectedGame) {
    const guide = getGameTutorial(data.selectedGame, data.gameRules?.games?.[data.selectedGame] ?? {});
    const box = el('div', 'shared-floor-screen shared-preview-floor');
    box.append(el('div', 'floor-title', `${gameNames[data.selectedGame] ?? '小遊戲'}・遊戲介紹`));
    box.append(el('div', 'shared-floor-description', `${guide.goal}　${guide.schedule}`));
    box.append(el('div', 'shared-floor-notice', '請在牆面所選遊戲上，觸碰圓形「確定」或「取消」按鈕。'));
    if (data.notice) box.append(el('div', 'shared-floor-notice staff-preview-notice', data.notice));
    floor.append(box);
    return;
  }
  if (data.phase === 'tutorial' && data.selectedGame) {
    const box = el('div', 'shared-floor-screen shared-tutorial-floor');
    box.append(el('div', 'floor-title', '教學完成・全體共用'));
    box.append(el('div', 'shared-floor-description', '看完牆面示範後，任一玩家長按中央開始'));
    const controls = el('div', 'shared-floor-controls shared-tutorial-controls');
    controls.style.width = `${TUTORIAL_BUTTON_DIAMETER}px`;
    controls.style.height = `${TUTORIAL_BUTTON_DIAMETER}px`;
    const button = el('div', 'shared-floor-action shared-tutorial-complete');
    button.setAttribute('role', 'progressbar');
    button.setAttribute('aria-label', '長按完成教學，全體開始遊戲');
    button.setAttribute('aria-valuemin', '0'); button.setAttribute('aria-valuemax', '100');
    const label = el('div', 'tutorial-hold-content');
    label.append(el('strong', 'tutorial-hold-label', '長按開始'), el('span', 'tutorial-hold-time'),
      el('small', '', '持續按住・滿圈即開始'));
    button.append(label); controls.append(button);
    box.append(controls);
    floor.append(box);
    return;
  }
  if (data.phase === 'countdown') return renderCountdown(data, floor);
  if (!['player-panels', 'player-only'].includes(data.layout?.questionDisplayMode)) {
    renderQuestionDisplay(data, floor);
    return;
  }
  if (data.phase === 'idle') return showTitle('704 腦力競賽', '等待工作人員開始場次', floor);
  if (['lobby', 'game_preview', 'tutorial', 'countdown'].includes(data.phase)) {
    const count = data.layout.participantCount ?? 0;
    const title = count < 4 ? `${count} 位玩家・使用 4 人場域版型` : `${count} 人場域版型已套用`;
    const subtitle = count
      ? `依加入順序配置 P1–P${count}；請移至牆面相同編號的答題區。新增玩家由工作人員操作。`
      : '等待工作人員加入玩家；加入後依 P 編號前往相同編號區域。';
    showTitle(title, subtitle, floor);
    if (data.phase === 'game_preview' && data.selectedGame) {
      floor.append(el('div', 'floor-subtitle', data.notice ?? `請確認「${gameNames[data.selectedGame] ?? '小遊戲'}」或返回選單。`));
    } else if (data.phase === 'tutorial' && data.selectedGame) {
      floor.append(el('div', 'floor-subtitle', `${gameNames[data.selectedGame] ?? '小遊戲'}：${tutorial[data.selectedGame] ?? ''}`));
    } else if (data.phase === 'countdown') {
      floor.append(el('div', 'floor-title', String(Math.max(1, Math.ceil((data.currentRound?.countdownMs ?? 0) / 1000)))));
    }
    return;
  }
  if (data.phase === 'paused' || data.phase === 'resume_countdown') return showTitle(data.phase === 'paused' ? '遊戲暫停' : '即將繼續', data.notice ?? '', floor);
  if (data.phase === 'round_results') return renderRoundStandings(data, floor);
  if (data.phase === 'final_results') return renderFinalResult(data, floor);
  if (data.phase === 'playing') return renderPlayerProgress(data, floor);
  showTitle('704 腦力競賽', data.notice ?? '', floor);
}

function renderQuestionDisplay(data, target) {
  target.replaceChildren();
  if (data.phase === 'idle') return showTitle('704 腦力競賽', '等待工作人員開始場次', target);
  if (data.phase === 'lobby') {
    const count = data.layout?.participantCount ?? 0;
    const profile = data.layout?.profileCount ?? 4;
    if (!count) return showTitle('等待玩家加入', '由工作人員在後台加入玩家；玩家依加入順序取得 P 編號', target);
    return showTitle(`${count} 位玩家・${profile} 人場域版型`, `版型已依人數更新；請移至牆面相同 P 編號的答題區。新增玩家由工作人員在後台加入。`, target);
  }
  if (data.phase === 'game_preview') {
    const gameId = data.selectedGame;
    const guide = getGameTutorial(gameId, data.gameRules?.games?.[gameId] ?? {});
    return showTitle(`${gameNames[gameId] ?? '小遊戲'}・遊戲介紹`, `${guide.goal}　${guide.schedule}　${data.notice ?? '確認後進入教學；取消返回選單。'}`, target);
  }
  if (data.phase === 'tutorial') {
    const guide = getGameTutorial(data.selectedGame, data.gameRules?.games?.[data.selectedGame] ?? {});
    return showTitle(gameNames[data.selectedGame] ?? '遊戲教學', `${guide.goal}　${guide.schedule}`, target);
  }
  if (data.phase === 'paused' || data.phase === 'resume_countdown') return showTitle(data.phase === 'paused' ? '遊戲暫停' : '即將繼續', data.notice ?? '', target);
  if (data.phase === 'countdown') return renderCountdown(data, target);
  if (data.phase === 'round_results') return renderRoundResult(data, target);
  if (data.phase === 'final_results') return renderFinalResult(data, target);
  if (data.phase !== 'playing' || !data.currentRound) return showTitle('704 腦力競賽', data.notice ?? '', target);
  const round = data.currentRound;
  if (round.gameId === 'zero_sum_grid') target.append(renderZeroGrid(round.question));
  else if (round.gameId === 'cube_count') target.append(renderCubeViews(round.question, null, data.gameRules?.games?.cube_count));
  else if (round.gameId === 'solid_puzzle') target.append(renderPuzzleFloor(round.question));
  else if (round.gameId === 'memory_poker') target.append(renderPokerFloor(round));
  else if (round.gameId === 'map_view') target.append(renderMapFirstPerson(round.question));
  else if (round.gameId === 'memory_sequence') showTitle('數字速記', `${round.question?.count ?? ''} 個數字　記憶 ${round.question?.memorySeconds ?? ''} 秒，蓋牌後依序點按`, target);
}

function renderCountdown(data, target) {
  const box = el('div', 'floor-stack');
  box.append(el('div', 'floor-title game-countdown', String(Math.max(1, Math.ceil((data.currentRound?.countdownMs ?? 0) / 1000)))), el('div', 'floor-subtitle', `${gameNames[data.currentRound?.gameId] ?? ''}・第 ${data.currentRound?.round ?? ''} 輪`));
  target.append(box);
}
function roundTimer(data) {
  const round = data.currentRound, config = data.gameRules?.games?.[round.gameId] ?? {};
  return round.gameId === 'memory_poker' ? pokerPhase(round.elapsedMs, config)
    : round.gameId === 'memory_sequence' ? sequencePhase(round, config) : secondsLeft(round.limitMs - round.elapsedMs);
}
function showTitle(title, subtitle, target = floor) {
  const box = el('div', 'floor-stack'); box.append(el('div', 'floor-title', title), el('div', 'floor-subtitle', subtitle)); target.append(box);
}

function renderTutorial(gameId, config) {
  const guide = getGameTutorial(gameId, config);
  const card = el('div', 'tutorial-card');
  card.append(el('div', 'tutorial-goal', guide.goal));
  const steps = el('ol', 'tutorial-steps');
  for (const step of guide.steps) steps.append(el('li', '', step));
  card.append(steps, el('div', 'tutorial-schedule', guide.schedule));
  return card;
}

function renderQuestionPanel(panel, data) {
  const node = el('section', 'question-panel'); node.style.cssText = rectStyle(panel.rect);
  const content = el('div', 'question-content');
  content.style.transform = `rotate(${panel.rotationDegrees}deg)`;
  node.append(content);
  if (['paused', 'resume_countdown'].includes(data.phase)) {
    showTitle(data.phase === 'paused' ? '遊戲暫停' : '即將繼續', data.notice ?? '', content);
  } else if (data.phase === 'lobby') {
    showTitle('請選擇遊戲', '請在周圍牆面共同選擇一款遊戲', content);
  } else if (data.phase === 'game_preview') {
    showTitle(`${gameNames[data.selectedGame] ?? '小遊戲'}・遊戲介紹`, '請在所選遊戲牆面觸碰圓形「確定」或「取消」按鈕。', content);
  } else {
    renderQuestionDisplay(data, content);
  }
  return node;
}

function renderPlayerProgress(data, target) {
  const wrap = el('div', 'floor-stack scoreboard-screen');
  wrap.append(el('div', 'floor-title', '本輪玩家進度'));
  wrap.append(el('div', 'floor-subtitle', `${gameNames[data.currentRound?.gameId] ?? ''}・第 ${data.currentRound?.round ?? ''} 輪`));
  const grid = el('div', 'result-grid scoreboard');
  const participantIds = data.currentRound?.participantIds ?? [];
  grid.style.gridTemplateColumns = `repeat(${scoreboardColumnCount(participantIds.length)}, minmax(0, 1fr))`;
  for (const zoneId of participantIds) {
    const player = data.playerViews?.[zoneId] ?? {};
    const status = player.eliminated ? '本輪淘汰' : player.done ? '答對了!' : '進行中';
    const item = el('div', 'result-person');
    item.append(el('strong', '', `${zoneId}・${status}`));
    item.append(el('small', '', `累積 ${(player.score ?? 0).toFixed(1)} 分${player.error ? `・${player.error}` : ''}`));
    grid.append(item);
  }
  wrap.append(grid);
  target.append(wrap);
}

function renderRoundStandings(data, target) {
  const result = data.results?.[0];
  const wrap = el('div', 'floor-stack scoreboard-screen');
  wrap.append(el('div', 'floor-title', `${result?.gameName ?? ''}・第 ${result?.round ?? ''} 輪結算`));
  wrap.append(el('div', 'floor-subtitle', '個人區顯示本題得分與積分；以下為名次與加分'));
  const grid = el('div', 'result-grid scoreboard result-scoreboard');
  const rows = [...(result?.rows ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  grid.style.gridTemplateColumns = `repeat(${target === floor && rows.length > 4 ? 4 : scoreboardColumnCount(rows.length)}, minmax(0, 1fr))`;
  for (const row of rows) {
    const item = el('div', 'result-person');
    item.append(el('strong', '', `${row.rank ? `第 ${row.rank} 名` : '未完成'}・${row.zoneId}`));
    item.append(resultScore(row.score, row.rank, true), el('small', '', row.completed ? '完成・本輪加分' : '未完成・本輪加分'));
    grid.append(item);
  }
  wrap.append(grid);
  target.append(wrap);
}
function renderZeroGrid(q = {}, answer = null) {
  const cols = q.cols ?? 5, rows = q.rows ?? 5;
  const wrap = el('div', 'floor-stack zero-grid');
  wrap.style.setProperty('--zero-cols', cols);
  wrap.style.setProperty('--zero-ratio', cols / rows);
  wrap.append(el('div', 'floor-title', answer ? `答案：${answer.count} 個` : '數字方格'), el('div', 'floor-subtitle', '計算所有總和為 0 的 2×2 方格（可重疊）'));
  const solved = new Set();
  for (const [x, y] of answer?.blocks ?? []) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) solved.add((y + dy) * cols + x + dx);
  const area = el('div', 'zero-board-area');
  const board = el('div', 'floor-board');
  board.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
  board.style.gridTemplateRows = `repeat(${rows},minmax(0,1fr))`;
  for (const [index, value] of (q.cells ?? Array(cols * rows).fill('')).entries()) {
    const cell = el('div', `floor-number${Number(value) < 0 ? ' negative' : ''}${solved.has(index) ? ' solution' : ''}`, String(value)); board.append(cell);
  }
  area.append(board); wrap.append(area); return wrap;
}
function renderCubeViews(q = {}, answer = null, config = {}) {
  const wrap = el('div', 'floor-stack');
  wrap.append(el('div', 'floor-title', answer ? `答案：${answer.total} 個小方塊` : '數出立體堆疊的小方塊總數'));
  const views = el('div', 'matrix-list cube-view-list');
  const azimuths = config.cameraAzimuthDegrees ?? [45, 165, 285];
  for (let index = 0; index < azimuths.length; index++) {
    const item = el('div', 'cube-view');
    item.append(el('div', 'cube-view-label', `視角 ${index + 1}・${azimuths[index]}°`));
    item.append(createCubeViewSvg(q, azimuths[index], config.cameraElevationDegrees ?? 35));
    views.append(item);
  }
  wrap.append(views); return wrap;
}

function createCubeViewSvg(q, azimuthDegrees, elevationDegrees) {
  const sizeX = q.cols ?? q.size ?? 3, sizeY = q.rows ?? q.size ?? 3;
  const heights = q.heights ?? [];
  const cells = [];
  for (let y = 0; y < sizeY; y++) for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < (heights[x + y * sizeX] ?? 0); z++) cells.push([x, y, z]);
  }
  return createIsometricSvg(cells, {
    azimuthDegrees, elevationDegrees, bounds: [sizeX, sizeY, q.maxHeight ?? 6],
    viewWidth: 320, viewHeight: 350, margin: 18, className: 'cube-svg',
    edgeWidth: 1.215,
    label: `方塊堆疊固定視角 ${azimuthDegrees} 度`
  });
}

function createIsometricSvg(cells, options = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const width = options.viewWidth ?? 320, height = options.viewHeight ?? 300, margin = options.margin ?? 18;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (options.className) svg.setAttribute('class', options.className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.label ?? '立體方塊模型');

  const azimuth = (options.azimuthDegrees ?? 45) * Math.PI / 180;
  const elevation = (options.elevationDegrees ?? 35) * Math.PI / 180;
  const camera = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
  const right = [-Math.sin(azimuth), Math.cos(azimuth), 0];
  const up = [-Math.sin(elevation) * Math.cos(azimuth), -Math.sin(elevation) * Math.sin(azimuth), Math.cos(elevation)];
  const project = ([x, y, z]) => [x * right[0] + y * right[1], -(x * up[0] + y * up[1] + z * up[2])];
  const occupied = new Set(cells.map((cell) => cell.join(',')));
  const ghost = options.wireframeVoxels ?? [];
  const faces = [];
  const palette = options.palette ?? { top: '#79ddd0', sideX: '#31869b', sideY: '#24677f', edge: '#153249' };
  const has = (x, y, z) => occupied.has(`${x},${y},${z}`);
  const addFace = (corners, center, fill) => faces.push({
    points: corners.map(project), depth: center[0] * camera[0] + center[1] * camera[1] + center[2] * camera[2], fill
  });

  for (const [x, y, z] of cells) {
    if (!has(x, y, z + 1)) addFace(
      [[x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1]], [x+.5,y+.5,z+1], palette.top
    );
    if (camera[0] >= 0 && !has(x + 1, y, z)) addFace(
      [[x+1,y,z],[x+1,y+1,z],[x+1,y+1,z+1],[x+1,y,z+1]], [x+1,y+.5,z+.5], palette.sideX
    );
    if (camera[0] < 0 && !has(x - 1, y, z)) addFace(
      [[x,y+1,z],[x,y,z],[x,y,z+1],[x,y+1,z+1]], [x,y+.5,z+.5], palette.sideX
    );
    if (camera[1] >= 0 && !has(x, y + 1, z)) addFace(
      [[x,y+1,z],[x+1,y+1,z],[x+1,y+1,z+1],[x,y+1,z+1]], [x+.5,y+1,z+.5], palette.sideY
    );
    if (camera[1] < 0 && !has(x, y - 1, z)) addFace(
      [[x+1,y,z],[x,y,z],[x,y,z+1],[x+1,y,z+1]], [x+.5,y,z+.5], palette.sideY
    );
  }

  const bounds = options.bounds ?? (cells.length ? [
    Math.max(...cells.map(([x]) => x)) + 1,
    Math.max(...cells.map(([, y]) => y)) + 1,
    Math.max(...cells.map(([, , z]) => z)) + 1
  ] : [1, 1, 1]);
  const allCells = [...cells, ...ghost];
  const cornersOf = ([x, y, z]) => [[x,y,z],[x+1,y,z],[x,y+1,z],[x+1,y+1,z],
    [x,y,z+1],[x+1,y,z+1],[x,y+1,z+1],[x+1,y+1,z+1]];
  const points = allCells.flatMap(cornersOf);
  if (options.outlineBounds) points.push(
    [0,0,0],[bounds[0],0,0],[0,bounds[1],0],[bounds[0],bounds[1],0],
    [0,0,bounds[2]],[bounds[0],0,bounds[2]],[0,bounds[1],bounds[2]],[bounds[0],bounds[1],bounds[2]]
  );
  const projected = points.map(project);
  if (!projected.length) return svg;
  const minX = Math.min(...projected.map((point) => point[0]));
  const maxX = Math.max(...projected.map((point) => point[0]));
  const minY = Math.min(...projected.map((point) => point[1]));
  const maxY = Math.max(...projected.map((point) => point[1]));
  const scale = Math.min((width - margin * 2) / (maxX - minX || 1), (height - margin * 2) / (maxY - minY || 1));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const place = (point) => {
    const [x, y] = project(point);
    return [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale];
  };
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    const polygon = document.createElementNS(ns, 'polygon');
    polygon.setAttribute('points', face.points.map(([x, y]) => `${offsetX + (x - minX) * scale},${offsetY + (y - minY) * scale}`).join(' '));
    polygon.setAttribute('fill', face.fill); polygon.setAttribute('stroke', palette.edge); polygon.setAttribute('stroke-width', options.edgeWidth ?? '0.135');
    svg.append(polygon);
  }

  const edges = [[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]];
  const drawEdges = (corners, stroke, widthValue, dash, opacity) => {
    for (const [a, b] of edges) {
      const line = document.createElementNS(ns, 'line');
      const [x1, y1] = place(corners[a]), [x2, y2] = place(corners[b]);
      line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', stroke); line.setAttribute('stroke-width', widthValue);
      if (dash) line.setAttribute('stroke-dasharray', dash);
      if (opacity != null) line.setAttribute('opacity', opacity);
      svg.append(line);
    }
  };
  for (const cell of ghost) drawEdges(cornersOf(cell), '#ffcf32', '3.5', null);
  if (options.outlineBounds) {
    drawEdges([[0,0,0],[bounds[0],0,0],[0,bounds[1],0],[bounds[0],bounds[1],0],
      [0,0,bounds[2]],[bounds[0],0,bounds[2]],[0,bounds[1],bounds[2]],[bounds[0],bounds[1],bounds[2]]], '#ffffff', '1.5', null, '0.9');
  }
  return svg;
}
function renderPuzzleFloor(q = {}, answer = null) {
  const wrap = el('div', 'floor-stack');
  if (answer) {
    const choice = q.choices?.find((item) => item.id === answer.correctId);
    wrap.classList.add('puzzle-answer-piece');
    wrap.append(el('div', 'floor-title', `正確零件：${answer.correctId}`));
    if (choice) { const shape = renderShapeCells(choice.cells); shape.classList.add('puzzle-answer-svg'); shape.dataset.choiceId = choice.id; wrap.append(shape); }
    return wrap;
  }
  wrap.append(el('div', 'floor-title', '選出能補滿缺口的零件'), el('div', 'floor-subtitle', `目標外框 ${q.target?.join(' × ') ?? ''}　缺口 ${q.missing?.length ?? 0} 個方塊`));
  const views = el('div', 'puzzle-orthographic');
  const target = q.target ?? [3,3,2];
  const remaining = q.kind === 'remaining_solid_views';
  views.innerHTML = orthographicSvg(remaining ? remainingSolidCells(target, q.missing ?? []) : q.missing ?? [], { bounds: target, target: !remaining });
  wrap.append(views);
  wrap.append(el('div', 'puzzle-legend', remaining ? '綠色：現有物件・補回完整外框・零件可旋轉' : '黃色：缺口投影・舊場次題目・零件可旋轉'));
  return wrap;
}
function renderPokerFloor(round) {
  const gameConfig = state?.gameRules?.games?.memory_poker ?? { communityCards: 4, selectedCardsRequired: 3 };
  const wrap = el('div', 'floor-stack poker-public-display'); wrap.append(el('div', 'floor-title', `${gameConfig.communityCards} 張公共牌＋${gameConfig.selectedCardsRequired} 張自選牌，取最佳 5 張`));
  const cards = round.question?.community;
  if (cards?.length) {
    const row = el('div', 'card-row');
    const suitNames = { '♠': '黑桃', '♥': '紅心', '♦': '方塊', '♣': '梅花' };
    for (const label of cards) {
      const suit = label.match(/[♠♥♦♣]/)?.[0] ?? '';
      const rank = label.replace(/[♠♥♦♣]/g, '');
      const card = el('div', `public-card${/[♦♥]/.test(suit) ? ' red' : ''}`);
      card.setAttribute('aria-label', `${suitNames[suit] ?? ''}${rank}`);
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 200 300'); svg.setAttribute('aria-hidden', 'true');
      for (const [text, x, y, size, className] of [[rank, 100, 92, 78, 'public-card-rank'], [suit, 100, 214, 114, 'public-card-suit'],
        [suitNames[suit] ?? '', 100, 278, 24, 'public-card-suit-name']]) {
        const node = document.createElementNS(ns, 'text');
        node.setAttribute('x', x); node.setAttribute('y', y); node.setAttribute('font-size', size);
        node.setAttribute('text-anchor', 'middle'); node.setAttribute('class', className); node.textContent = text;
        svg.append(node);
      }
      card.append(svg); row.append(card);
    }
    wrap.append(row);
  } else wrap.append(el('div', 'floor-subtitle', '公共牌即將公開'));
  return wrap;
}
function renderMapFloor(q = {}, answer = null) {
  if (q.kind === 'object_views') return renderObjectQuestion(q, answer);
  const wrap = el('div', 'floor-stack');
  wrap.append(el('div', 'floor-title', answer ? `正確位置：${answer.correctId}・${answer.correct?.heading ?? ''}` : '對照第一人稱景象與俯視地圖'));
  const layout = el('div', 'map-layout');
  const map = renderMapGrid(q, answer?.correctId);
  const perspective = renderFirstPersonScene(q);
  layout.append(map, perspective); wrap.append(layout);
  const clues = el('div', 'landmark-row'); for (const mark of q.landmarks ?? []) clues.append(el('span', 'landmark-chip', `${mark.label} 地標`));
  wrap.append(clues); return wrap;
}
function renderMapGrid(q = {}, answerId = null) {
  const map = el('div', 'map-grid'); map.style.setProperty('--size', q.size ?? 7);
  const landmarks = new Map((q.landmarks ?? []).map((item) => [`${item.x},${item.y}`, item.label]));
  const candidates = new Map();
  for (const item of q.choices ?? []) {
    const key = `${item.x},${item.y}`;
    candidates.set(key, [...(candidates.get(key) ?? []), item]);
  }
  for (let y = 0; y < (q.size ?? 7); y++) for (let x = 0; x < (q.size ?? 7); x++) {
    const open = q.grid?.[y]?.[x] === '.';
    const cell = el('div', `map-cell${open ? ' open' : ''}`);
    if (landmarks.has(`${x},${y}`)) { cell.classList.add('landmark'); cell.dataset.label = landmarks.get(`${x},${y}`); }
    const choicesHere = candidates.get(`${x},${y}`) ?? [];
    if (choicesHere.length) {
      cell.classList.add('candidate');
      const group = el('div', 'candidate-list');
      const arrows = { N: '↑', E: '→', S: '↓', W: '←' };
      for (const choice of choicesHere) {
        const marker = el('span', `candidate-mark${choice.id === answerId ? ' solution' : ''}`, choice.id);
        marker.append(el('span', 'candidate-arrow', arrows[choice.heading] ?? ''));
        marker.title = `${choice.id}：${choice.heading}`;
        group.append(marker);
      }
      cell.append(group);
    }
    map.append(cell);
  }
  return map;
}
function renderFirstPersonScene(q = {}) {
  const perspective = el('div', 'perspective');
  perspective.innerHTML = renderPerspectiveSceneSvg(q.firstPersonView);
  return perspective;
}
function renderObjectQuestion(q, answer = null) {
  const wrap = el('div', 'floor-stack object-question');
  wrap.append(el('div', 'floor-title', answer ? '正確物件：' + answer.correctId : '看三視圖，找出相同的立體物件'));
  const graphic = el('div', 'puzzle-orthographic');
  const correct = answer && q.choices?.find(c => c.id === answer.correctId);
  graphic.innerHTML = correct ? objectSvg(correct.object, true) : objectSvg(q.object);
  wrap.append(graphic, el('div', 'puzzle-legend', '上視圖在正上方・右側視圖在右方・選項朝向固定'));
  return wrap;
}
function renderMapFirstPerson(q = {}) {
  if (q.kind === 'object_views') return renderObjectQuestion(q);
  const wrap = el('div', 'floor-stack map-first-person');
  wrap.append(el('div', 'floor-title', '固定第一人稱景象'), renderFirstPersonScene(q));
  return wrap;
}
function renderRoundResult(data, target = floor) {
  const result = data.results?.[0];
  const wrap = el('div', 'floor-stack round-results-screen');
  wrap.append(el('div', 'floor-title', `${result?.gameName ?? ''}・第 ${result?.round ?? ''} 輪結算`));
  const round = data.currentRound, q = round?.question ?? {};
  const answerPanel = el('div', 'round-result-question');
  if (result?.gameId === 'zero_sum_grid') answerPanel.append(renderZeroGrid(q, result.answer));
  else if (result?.gameId === 'cube_count') answerPanel.append(renderCubeViews(q, result.answer, data.gameRules?.games?.cube_count));
  else if (result?.gameId === 'solid_puzzle') answerPanel.append(renderPuzzleFloor(q, result.answer));
  else if (result?.gameId === 'memory_poker') answerPanel.append(renderPokerFloor(round));
  else if (result?.gameId === 'map_view') answerPanel.append(renderMapFloor(q, result.answer));
  else if (result?.gameId === 'memory_sequence') answerPanel.append(el('div', 'floor-subtitle', '請查看牆面，揭露本區數字順序與本輪最佳進度'));
  wrap.append(answerPanel);
  const grid = el('div', 'result-grid scoreboard result-scoreboard');
  const rows = [...(result?.rows ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  grid.style.gridTemplateColumns = `repeat(${target === floor && rows.length > 4 ? 4 : scoreboardColumnCount(rows.length)}, minmax(0, 1fr))`;
  for (const row of rows) {
    const item = el('div', 'result-person');
    item.append(el('strong', '', `${row.rank ? `第 ${row.rank} 名` : '未完成'}・${row.zoneId}`));
    item.append(resultScore(row.score, row.rank, true), el('small', '', row.completed ? '完成・本輪加分' : '未完成・本輪加分')); grid.append(item);
  }
  wrap.append(grid); target.append(wrap);
}
function renderFinalResult(data, target = floor) {
  const wrap = el('div', 'floor-stack scoreboard-screen'); wrap.append(el('div', 'floor-title', '本場總成績'));
  const grid = el('div', 'result-grid scoreboard result-scoreboard');
  const rankings = data.finalRankings ?? [];
  grid.style.gridTemplateColumns = `repeat(${target === floor && rankings.length > 4 ? 4 : scoreboardColumnCount(rankings.length)}, minmax(0, 1fr))`;
  for (const row of rankings) {
    const item = el('div', 'result-person'); item.append(el('strong', '', `第 ${row.rank} 名・${row.zoneId}`));
    item.append(resultScore(row.score, row.rank), el('small', '', `總分・完成 ${row.roundsPlayed} 輪`)); grid.append(item);
  }
  wrap.append(grid); target.append(wrap);
}

function resultScore(score, rank, added = false) {
  const text = `${added ? '+' : ''}${score}`;
  const value = el('div', 'result-score-value', text);
  value.dataset.rank = String(rank ?? '');
  value.style.setProperty('--score-width', String(Math.max(2, text.length) * .66));
  value.setAttribute('aria-label', `${added ? '加' : ''}${score} 分`);
  return value;
}

function renderReservedArea(item) {
  const node = el('div', 'reserved-overlay');
  node.setAttribute('aria-hidden', 'true');
  node.style.cssText = rectStyle(item.rect);
  return node;
}

function renderExitControl(data) {
  const control = data.sharedExitControl;
  if (!control) return null;
  const enabled = canPlayerExit(data, data.gameRules.common.sessionDurationSeconds * 1000);
  const node = el('section', 'shared-exit-control');
  node.style.cssText = rectStyle(control.rect);
  node.style.transform = `rotate(${control.rotationDegrees ?? 0}deg)`;
  node.setAttribute('aria-label', '全體退出小遊戲並回到大廳');
  const confirming = Boolean(data.exitConfirmation);
  node.classList.toggle('disabled', !enabled);
  node.setAttribute('aria-disabled', String(!enabled));
  if (confirming) {
    node.classList.add('confirming');
    node.append(el('div', 'shared-exit-title', '全體退出'), el('div', 'shared-exit-note', '成績保留'));
  }
  for (const action of confirming ? ['confirm', 'cancel'] : ['request']) {
    const button = el('div', `shared-exit-button shared-exit-${action}`,
      { request: '退出遊戲', confirm: '確認退出', cancel: '取消' }[action]);
    const rect = EXIT_BUTTONS[action];
    button.style.cssText = `left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%`;
    button.setAttribute('aria-label', action === 'confirm' ? '確認全體回到大廳；保留已結算成績，取消未結算本輪' : button.textContent);
    node.append(button);
  }
  return node;
}

function render(data) {
  if (!data) return;
  const structureKey = stageStructureKey(data);
  state = data;
  if (!['paused', 'resume_countdown'].includes(data.phase)) feedbackTimeline.setScope((data.sessionId ?? '') + ':' + (data.currentRound?.id ?? data.results?.[0]?.roundId ?? ''));
  tutorialProgress = { ...data.tutorialHold, active: data.phase === 'tutorial' && Boolean(data.tutorialHold?.active), receivedAt: performance.now() };
  const idle = data.phase === 'idle';
  venue.classList.toggle('idle-mode', idle);
  idleParticles.setActive(idle);
  $('#mouse-test-hint').hidden = idle || !data.input?.mouseTest;
  venue.classList.toggle('mouse-test-enabled', Boolean(data.input?.mouseTest));
  venue.classList.toggle('exit-confirming', Boolean(data.exitConfirmation));
  if (structureKey === lastRenderedStructureKey) {
    updateVolatileStageText(data);
    return;
  }
  const views = data.playerViews ?? {};
  const zones = $('#zones'); zones.replaceChildren();
  if (data.phase === 'lobby' || data.phase === 'game_preview') {
    const options = [...(data.availableGames ?? []), { id: 'random', name: '隨機遊戲', rounds: null }];
    const optionById = new Map(options.map((option) => [option.id, option]));
    const slots = data.menuSlots ?? (data.menuZones ?? []).map((zone, index) => ({
      zoneId: zone.id, optionIds: options[index] ? [options[index].id] : []
    }));
    for (const zone of data.menuZones ?? []) {
      const slot = slots.find((item) => item.zoneId === zone.id);
      const zoneOptions = (slot?.optionIds ?? []).map((id) => optionById.get(id)).filter(Boolean);
      const node = renderSharedMenuZone(zone, zoneOptions, data);
      if (node) zones.append(node);
    }
    if (data.phase === 'lobby') {
      // TouchService face 0 is the physical Wall Left; local y=0–128 is rows 10 and 9.
      const leftWall = sharedTutorialWalls((data.menuZones ?? []).filter(zone => zone.rotationDegrees === 0 && zone.rect.y === 0))[0];
      if (leftWall) {
        const heading = el('div', 'shared-lobby-heading', '請選擇遊戲');
        heading.style.cssText = rectStyle({ ...leftWall.rect, height: 128 });
        heading.dataset.face = '0';
        zones.append(heading);
      }
    }
  } else if (data.phase === 'tutorial') {
    for (const wall of sharedTutorialWalls(data.menuZones ?? [])) zones.append(renderSharedTutorialWall(wall, data));
  } else if (!idle) {
    for (const panel of data.questionPanels ?? []) zones.append(renderQuestionPanel(panel, data));
    for (const zone of data.zones ?? []) zones.append(renderZone(zone, views, data));
  }
  if (!idle) {
    for (const area of data.reservedRects ?? []) zones.append(renderReservedArea(area));
    const exitControl = renderExitControl(data);
    if (exitControl) zones.append(exitControl);
  }
  renderFloor(data);
  if (data.phase === 'playing' && data.currentRound) {
    for (const target of document.querySelectorAll('.question-content')) target.append(el('div', 'round-timer', roundTimer(data)));
  }
  const overlay = $('#overlay');
  if (data.phase === 'paused' || data.phase === 'resume_countdown') {
    overlay.hidden = false; const card = el('div', 'overlay-card', data.phase === 'paused' ? '暫停中' : '準備繼續');
    card.append(el('small', '', data.phase === 'paused' ? '等待工作人員恢復' : secondsLeft(data.countdownMs ?? 0))); overlay.replaceChildren(card);
  } else { overlay.hidden = true; overlay.replaceChildren(); }
  const connection = $('#connection'); connection.textContent = data.input?.ready ? 'TOUCH LINK OK' : 'WAITING FOR TOUCH SERVICE';
  lastRenderedStructureKey = structureKey;
}

function updateVolatileStageText(data) {
  if (data.phase === 'playing' && data.currentRound) {
    const round = data.currentRound;
    const config = data.gameRules?.games?.[round.gameId] ?? {};
    const timer = round.gameId === 'memory_poker' ? pokerPhase(round.elapsedMs, config)
      : round.gameId === 'memory_sequence' ? sequencePhase(round, config) : secondsLeft(round.limitMs - round.elapsedMs);
    for (const node of document.querySelectorAll('.round-timer')) setTextIfChanged(node, timer);
    for (const zone of $('#zones').querySelectorAll('.zone')) {
      const panel = data.playerViews?.[zone.dataset.zoneId];
      if (!panel?.joined) continue;
      updatePlayerClock(zone.querySelector('.player-game-clock'), timer);
      updateAnswerErrorOverlay(zone.querySelector('.zone-content'), panel);
      if (panel.error?.includes('鎖答') && !(panel.lockRemainingMs > 0)) zone.querySelector('.zone-feedback')?.remove();
      if (round.gameId === 'zero_sum_grid' || round.gameId === 'cube_count') {
        setTextIfChanged(zone.querySelector('.numeric-entry-value'), panel.entry || '—');
        const lockText = panel.lockRemainingMs > 0 ? `鎖答 ${secondsLeft(panel.lockRemainingMs)}` : '';
        setTextIfChanged(zone.querySelector('.numeric-lock-detail'), lockText);
        if (!data.gameRules?.common?.layout?.numericEntryRect) {
          setTextIfChanged(zone.querySelector('.zone-detail'), `目前輸入：${panel.entry || '—'}${lockText ? `　${lockText}` : ''}`);
        }
      }
    }
    return;
  }

  if (data.phase === 'countdown') {
    const number = String(Math.max(1, Math.ceil((data.currentRound?.countdownMs ?? 0) / 1000)));
    for (const node of document.querySelectorAll('.game-countdown')) setTextIfChanged(node, number);
  } else if (data.phase === 'resume_countdown') {
    setTextIfChanged($('#overlay .overlay-card small'), secondsLeft(data.countdownMs ?? 0));
  }
}

updateVenueScale();
window.addEventListener('resize', updateVenueScale);
const events = new EventSource('/api/events?view=stage');
let stageClientId = null;
let stageRendered = false;
let stageStreamConnected = false;
let stageEventSequence = 0;
let lastStageEventAt = 0;
let stageStatePollInFlight = false;
let lastStagePaintReportAt = 0;
let lastStagePaintClientId = null;
let lastStageRenderAt = 0;
let lastStageRenderDurationMs = 0;
let lastStageRenderGapMs = null;
let pendingStageState = null;
let pendingStageRenderTimer = null;
const MIN_STAGE_RENDER_INTERVAL_MS = 200;
const STAGE_STATE_POLL_INTERVAL_MS = 1_000;
const STAGE_STATE_POLL_AFTER_SILENCE_MS = 1_500;
function reportStagePaint() {
  if (!stageRendered || !stageClientId || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (lastStagePaintClientId === stageClientId && now - lastStagePaintReportAt < 900) return;
  const clientId = stageClientId;
  lastStagePaintReportAt = now;
  lastStagePaintClientId = clientId;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!stageRendered || stageClientId !== clientId || document.visibilityState !== 'visible') return;
      fetch('/api/stage-ready', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId, visibilityState: document.visibilityState,
          renderDurationMs: lastStageRenderDurationMs, renderGapMs: lastStageRenderGapMs
        })
      }).then((response) => {
        if (response.status === 409 && stageClientId === clientId) stageRendered = false;
      }).catch(() => {});
    });
  });
}
function queueStageRender(data) {
  pendingStageState = data;
  if (pendingStageRenderTimer !== null) return;
  const delay = Math.max(0, MIN_STAGE_RENDER_INTERVAL_MS - (Date.now() - lastStageRenderAt));
  pendingStageRenderTimer = window.setTimeout(() => {
    pendingStageRenderTimer = null;
    const latestState = pendingStageState;
    pendingStageState = null;
    if (!latestState) return;
    stageRendered = false;
    const renderStartedAt = performance.now();
    lastStageRenderGapMs = lastStageRenderAt ? Math.max(0, Date.now() - lastStageRenderAt) : null;
    try {
      render(latestState);
      lastStageRenderDurationMs = Math.round((performance.now() - renderStartedAt) * 10) / 10;
      lastStageRenderAt = Date.now();
      stageRendered = Boolean(stageClientId);
      reportStagePaint();
    } catch (error) { console.error(error); }
  }, delay);
}

function acceptStageState(data, source, requestSequence = stageEventSequence) {
  if (!data) return;
  if (source === 'poll' && requestSequence !== stageEventSequence) return;
  const freshestKnown = pendingStageState ?? state;
  if (freshestKnown && compareStageStateFreshness(data, freshestKnown) < 0) return;
  queueStageRender(data);
}

async function pollStageState() {
  if (stageStatePollInFlight) return;
  stageStatePollInFlight = true;
  const requestSequence = stageEventSequence;
  try {
    const response = await fetch('/api/state?view=stage', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    acceptStageState(await response.json(), 'poll', requestSequence);
  } catch (error) {
    if (!stageStreamConnected && !state) $('#connection').textContent = `SERVICE ERROR: ${error.message}`;
  } finally {
    stageStatePollInFlight = false;
  }
}

const initialStateRequestSequence = stageEventSequence;
fetch('/api/state?view=stage', { cache: 'no-store' })
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((snapshot) => acceptStageState(snapshot, 'poll', initialStateRequestSequence))
  .catch((error) => { if (!state) $('#connection').textContent = `SERVICE ERROR: ${error.message}`; });

events.onmessage = (event) => {
  try {
    stageClientId = event.lastEventId || stageClientId;
    stageStreamConnected = true;
    stageEventSequence++;
    lastStageEventAt = Date.now();
    acceptStageState(JSON.parse(event.data), 'stream');
  } catch (error) { console.error(error); }
};
events.onerror = () => { stageStreamConnected = false; stageRendered = false; $('#connection').textContent = 'RECONNECTING'; };
window.setInterval(reportStagePaint, 1000);
window.setInterval(() => {
  if (!stageStreamConnected || Date.now() - lastStageEventAt >= STAGE_STATE_POLL_AFTER_SILENCE_MS) pollStageState();
}, STAGE_STATE_POLL_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reportStagePaint();
});
document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.(); });
installMouseInput(venue, () => ({ enabled: state?.input?.mouseTest,
  clientId: stageClientId, revision: state?.input?.phaseRevision }),
  (message) => { $('#connection').textContent = message; });
