import { orthographicSignature } from '../public/solid-views.mjs';
import crypto from 'node:crypto';
import { pokerTiming } from '../public/poker-timing.mjs';
import { resolvePlayerLayout } from './player-layouts.mjs';
import { cubeColumnsAreReadable } from './cube-visibility.mjs';
import { validateGameRules } from './game-rules.mjs';
import { EXIT_CONTROL_ZONE, canPlayerExit, exitActionAt } from '../public/exit-control.mjs';
import { tutorialHoldTarget } from '../public/tutorial-control.mjs';
import {
  EDGE_BLANK, EDGE_LINE, clueCountsForLoop, countSolutions, edgeCount, generateSlitherlinkPuzzle,
  isSingleLoop, linesMatchSolution, nextEdgeState, slitherlinkEdgeAt
} from './slitherlink.mjs';

const GAME_ORDER = [
  'minesweeper', 'zero_sum_grid', 'cube_count', 'solid_puzzle',
  'memory_poker', 'map_view', 'memory_sequence', 'slitherlink'
];
const LABELS = {
  minesweeper: '踩地雷', zero_sum_grid: '數字方格', cube_count: '3D 數方塊',
  solid_puzzle: '立體拼圖', memory_poker: '記憶撲克',
  map_view: '地圖定位', memory_sequence: '數字速記', slitherlink: '數迴'
};
const CARD_RANKS = '23456789TJQKA';
const CARD_SUITS = ['♣', '♦', '♥', '♠'];
const RANDOM_GAME_ID = 'random';
const RNG_ALGORITHM = 'mulberry32-v1';
const QUESTION_GENERATOR_VERSION = '1.0.3';
// TouchService 704 uses a 2688×3840 canvas. Rotate clockwise, then remove
// the 512 px blank strip to match the 3328×2688 CAD player-zone profile.
const TOUCH_CANVAS_HEIGHT = 3840;
const TOUCH_CANVAS_CROP_PX = 512;
const PUZZLE_SHAPES = {
  4: [
    [[0,0,0],[1,0,0],[2,0,0],[3,0,0]],
    [[0,0,0],[1,0,0],[0,1,0],[1,1,0]],
    [[0,0,0],[1,0,0],[2,0,0],[1,1,0]],
    [[0,0,0],[1,0,0],[1,1,0],[2,1,0]],
    [[0,0,0],[1,0,0],[2,0,0],[2,1,0]],
    [[0,0,0],[1,0,0],[0,1,0],[0,0,1]]
  ],
  5: [
    [[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0]],
    [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[2,1,0]],
    [[0,0,0],[1,0,0],[2,0,0],[1,1,0],[1,2,0]],
    [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[0,2,0]],
    [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0]],
    [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,1]]
  ],
  6: [
    [[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],[5,0,0]],
    [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]],
    [[0,0,0],[1,0,0],[2,0,0],[1,1,0],[1,2,0],[1,1,1]],
    [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[0,2,0],[0,3,0]],
    [[0,0,0],[1,0,0],[2,0,0],[2,1,0],[2,2,0],[2,2,1]],
    [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1]]
  ]
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function seededRandom(seed) {
  let state = seed >>> 0;
  return (minOrMax, maybeMax) => {
    const min = maybeMax === undefined ? 0 : minOrMax;
    const max = maybeMax === undefined ? minOrMax : maybeMax;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
      throw new RangeError('亂數範圍必須是遞增的安全整數');
    }
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const fraction = ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    return min + Math.floor(fraction * (max - min));
  };
}

const createQuestionSeed = () => crypto.randomBytes(4).readUInt32LE(0);

const shuffle = (items, randomInt) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function permutations(items) {
  if (items.length === 1) return [items];
  return items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map((tail) => [item, ...tail]));
}

function permutationParity(permutation) {
  let inversions = 0;
  for (let i = 0; i < permutation.length; i++) for (let j = i + 1; j < permutation.length; j++) {
    if (permutation[i] > permutation[j]) inversions++;
  }
  return inversions % 2 === 0 ? 1 : -1;
}

const ROTATIONS_3D = permutations([0, 1, 2]).flatMap((axes) => {
  const parity = permutationParity(axes);
  return [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => {
    if (parity * sx * sy * sz !== 1) return null;
    const signs = [sx, sy, sz];
    return (point) => axes.map((axis, index) => point[axis] * signs[index]);
  })));
}).filter(Boolean);

function normalizeShape(cells) {
  const mins = [0, 1, 2].map((axis) => Math.min(...cells.map((cell) => cell[axis])));
  return cells.map((cell) => cell.map((value, axis) => value - mins[axis]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

function canonicalShape(cells) {
  return ROTATIONS_3D.map((rotate) => normalizeShape(cells.map(rotate))
    .map((cell) => cell.join(',')).join(';')).sort()[0];
}

function randomConnectedShape(size, bounds, randomInt) {
  const cells = [[randomInt(bounds[0]), randomInt(bounds[1]), randomInt(bounds[2])]];
  const occupied = new Set([cells[0].join(',')]);
  while (cells.length < size) {
    const frontier = new Map();
    for (const [x, y, z] of cells) for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const next = [x + dx, y + dy, z + dz], key = next.join(',');
      if (next[0] < 0 || next[1] < 0 || next[2] < 0 || next[0] >= bounds[0] || next[1] >= bounds[1] || next[2] >= bounds[2] || occupied.has(key)) continue;
      frontier.set(key, next);
    }
    if (!frontier.size) return null;
    const choices = [...frontier.values()], next = choices[randomInt(choices.length)];
    cells.push(next); occupied.add(next.join(','));
  }
  return normalizeShape(cells);
}

function difficultyBand(config, round) {
  const band = config.difficultyBands?.find((item) => round >= item.firstRound && round <= item.lastRound);
  if (!band) throw new Error(`第 ${round} 輪缺少難度設定`);
  return band;
}

function makeMineBoard(round, config, randomInt) {
  const cols = config.boardColumns, rows = config.boardRows;
  const start = config.mandatoryStartCellOneBased;
  const startX = start.column - 1, startY = start.row - 1;
  const anchor = startX + startY * cols;
  const radius = config.startSafeRadiusCells;
  const protectedCells = new Set();
  for (let y = Math.max(0, startY - radius); y <= Math.min(rows - 1, startY + radius); y++) {
    for (let x = Math.max(0, startX - radius); x <= Math.min(cols - 1, startX + radius); x++) protectedCells.add(x + y * cols);
  }
  const candidates = Array.from({ length: cols * rows }, (_, i) => i)
    .filter((i) => !protectedCells.has(i));
  const mineCount = config.minesByRound[round - 1];
  for (let attempt = 0; attempt < 5000; attempt++) {
    const mines = shuffle(candidates, randomInt).slice(0, mineCount);
    const mineSet = new Set(mines);
    const numbers = Array.from({ length: cols * rows }, (_, i) => {
      if (mineSet.has(i)) return -1;
      const x = i % cols, y = Math.floor(i / cols);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && mineSet.has(nx + ny * cols)) count++;
      }
      return count;
    });
    const board = { cols, rows, anchor, mines, numbers };
    if (canSolveMinesWithoutGuessing(board)) return board;
  }
  throw new Error(`無法產生第 ${round} 輪免猜測地雷盤`);
}

function makeZeroGrid(round, config, randomInt) {
  const band = difficultyBand(config, round);
  const cols = config.boardColumns, rows = config.boardRows;
  const { valueMin: lo, valueMax: hi, answerMin, answerMax } = band;
  const subCols = config.subgridColumns, subRows = config.subgridRows;
  for (let attempt = 0; attempt < 1200; attempt++) {
    const cells = Array.from({ length: cols * rows }, () => randomInt(lo, hi + 1));
    const answers = [];
    for (let y = 0; y <= rows - subRows; y++) for (let x = 0; x <= cols - subCols; x++) {
      let sum = 0;
      for (let dy = 0; dy < subRows; dy++) for (let dx = 0; dx < subCols; dx++) sum += cells[x + dx + (y + dy) * cols];
      if (sum === config.targetSum) answers.push([x, y]);
    }
    if (answers.length >= answerMin && answers.length <= answerMax) return { cells, answers, cols, rows };
  }
  throw new Error(`無法產生第 ${round} 輪有效數字方格題目`);
}

function makeCubeModel(round, config, randomInt) {
  const band = difficultyBand(config, round);
  const cols = band.baseColumns, rows = band.baseRows;
  const size = cols;
  const maxHeight = band.heightMax;
  for (let attempt = 0; attempt < 80; attempt++) {
    const heights = Array.from({ length: cols * rows }, () => randomInt(band.heightMin, maxHeight + 1));
    const total = heights.reduce((a, b) => a + b, 0);
    if (total > 0 && total <= config.numericInputMaximum && cubeColumnsAreReadable(
      heights, cols, rows, config.cameraAzimuthDegrees, config.cameraElevationDegrees
    )) return { size, cols, rows, maxHeight, heights, total };
  }
  throw new Error('無法產生有效方塊題目');
}

function makeSolidPuzzle(round, config, randomInt) {
  const band = difficultyBand(config, round);
  const target = band.targetDimensions;
  const volume = randomInt(band.missingCubesMin, band.missingCubesMax + 1);
  let correctShape = null;
  for (let attempt = 0; attempt < 100 && !correctShape; attempt++) {
    const candidate = randomConnectedShape(volume, target, randomInt);
    if (candidate?.some(([x, y, z]) => x === 0 || y === 0 || z === 0 ||
        x === target[0] - 1 || y === target[1] - 1 || z === target[2] - 1)) correctShape = candidate;
  }
  if (!correctShape) throw new Error('無法產生立體拼圖缺口');
  const correctKey = canonicalShape(correctShape);
  const correctViews = orthographicSignature(correctShape);
  const distractors = new Map();
  const distractorCount = config.optionCount - 1;
  for (let attempt = 0; attempt < 20_000 && distractors.size < distractorCount; attempt++) {
    const shape = randomConnectedShape(volume, target, randomInt);
    if (!shape) continue;
    const key = canonicalShape(shape);
    if (key !== correctKey && !distractors.has(key) &&
        !ROTATIONS_3D.some(rotate => orthographicSignature(shape.map(rotate)) === correctViews)) distractors.set(key, shape);
  }
  if (distractors.size < distractorCount) throw new Error(`無法為 ${volume} 方塊題目產生 ${config.optionCount} 種相異零件`);
  const choices = shuffle([{ cells: correctShape, correct: true }, ...[...distractors.values()].map((cells) => ({ cells, correct: false }))], randomInt)
    .map((choice, index) => ({ id: String.fromCharCode(65 + index), ...choice }));
  return {
    volume,
    target,
    missing: correctShape,
    choices,
    correctId: choices.find((x) => x.correct).id
  };
}

function makeDeck(config) {
  const deck = CARD_SUITS.flatMap((suit) => CARD_RANKS.split('').map((rank) => ({
    rank: CARD_RANKS.indexOf(rank) + 2, face: rank, suit,
    label: `${rank === 'T' ? '10' : rank}${suit}`
  })));
  if (config.deckSize !== deck.length || config.jokers !== 0) throw new Error('首版撲克牌設定需為無鬼牌 52 張牌組');
  return deck;
}

function makePoker(round, config, randomInt) {
  const deck = shuffle(makeDeck(config), randomInt);
  const totalCards = config.memoryCards + config.communityCards;
  const selected = deck.slice(0, totalCards);
  const cards = shuffle(selected.slice(0, config.memoryCards), randomInt);
  return { round, cards, community: selected.slice(config.memoryCards), cardLocations: 'ABCDEFGHIJKLMNOP' };
}

function makeMapQuestion(round, config, randomInt) {
  const band = difficultyBand(config, round);
  const cols = band.mapColumns, rows = band.mapRows;
  const landmarkCount = band.landmarkTypes;
  const labels = ['●', '◆', '▲', '✦', '■'];
  const directions = [{ name: 'N', dx: 0, dy: -1 }, { name: 'E', dx: 1, dy: 0 },
    { name: 'S', dx: 0, dy: 1 }, { name: 'W', dx: -1, dy: 0 }];

  for (let attempt = 0; attempt < 60; attempt++) {
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '#'));
    const cells = [[Math.floor(cols / 2), Math.floor(rows / 2)]];
    grid[cells[0][1]][cells[0][0]] = '.';
    const targetOpen = Math.ceil((cols - 2) * (rows - 2) * 0.74);
    while (cells.length < targetOpen) {
      const frontier = new Map();
      for (const [x, y] of cells) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (nx < 1 || ny < 1 || nx >= cols - 1 || ny >= rows - 1 || grid[ny][nx] === '.') continue;
        frontier.set(key, [nx, ny]);
      }
      if (!frontier.size) break;
      const options = [...frontier.values()];
      const next = options[randomInt(options.length)];
      grid[next[1]][next[0]] = '.'; cells.push(next);
    }
    const landmarkCells = shuffle(cells, randomInt).slice(0, landmarkCount);
    const landmarks = landmarkCells.map(([x, y], i) => ({ x, y, label: labels[i] }));
    const blockedStanding = new Set(landmarkCells.map(([x, y]) => `${x},${y}`));
    const standingCells = cells.filter(([x, y]) => !blockedStanding.has(`${x},${y}`));

    const clearLine = (x0, y0, x1, y1) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let step = 1; step < steps; step++) {
        const x = Math.round(x0 + (x1 - x0) * step / steps);
        const y = Math.round(y0 + (y1 - y0) * step / steps);
        if (grid[y]?.[x] !== '.') return false;
      }
      return true;
    };
    const cameraView = (x, y, heading) => {
      const forward = directions.find((direction) => direction.name === heading);
      const right = { dx: -forward.dy, dy: forward.dx };
      const visible = landmarks.flatMap((mark) => {
        const dx = mark.x - x, dy = mark.y - y;
        const depth = dx * forward.dx + dy * forward.dy;
        const side = dx * right.dx + dy * right.dy;
        if (depth <= 0 || depth > 6 || Math.abs(side) > depth || !clearLine(x, y, mark.x, mark.y)) return [];
        return [{ label: mark.label, side: side < 0 ? 'left' : side > 0 ? 'right' : 'center', depth: depth <= 2 ? 'near' : 'far' }];
      }).sort((a, b) => a.depth.localeCompare(b.depth) || a.side.localeCompare(b.side) || a.label.localeCompare(b.label));
      const signature = visible.map((item) => `${item.label}:${item.side}:${item.depth}`).join('|');
      return { visible, signature };
    };

    const candidates = shuffle(standingCells.flatMap(([x, y]) => directions.map(({ name }) => {
      const view = cameraView(x, y, name);
      return { x, y, heading: name, view: view.visible, signature: view.signature };
    })).filter((candidate) => candidate.signature), randomInt);
    const unique = new Map();
    for (const candidate of candidates) if (!unique.has(candidate.signature)) unique.set(candidate.signature, candidate);
    const distinctViews = [...unique.values()];
    const correctOptions = distinctViews.filter((candidate) => candidate.view.length >= 2);
    if (!correctOptions.length || distinctViews.length < config.optionCount) continue;
    const correct = correctOptions[randomInt(correctOptions.length)];
    const distractorCount = config.optionCount - 1;
    const distractors = shuffle(distinctViews.filter((candidate) => candidate.signature !== correct.signature), randomInt).slice(0, distractorCount);
    if (distractors.length < distractorCount) continue;
    const choices = shuffle([{ ...correct, correct: true }, ...distractors.map((candidate) => ({ ...candidate, correct: false }))], randomInt)
      .map((candidate, index) => ({ id: String.fromCharCode(65 + index), ...candidate }));
    const answer = choices.find((candidate) => candidate.correct);
    return {
      size: cols, cols, rows, grid, landmarks,
      firstPersonView: answer.view,
      choices: choices.map(({ id, x, y, heading, correct: isCorrect, signature, view }) => ({ id, x, y, heading, correct: isCorrect, signature, view })),
      correctId: answer.id,
      correct: { id: answer.id, x: answer.x, y: answer.y, heading: answer.heading }
    };
  }
  throw new Error(`無法產生第 ${round} 輪有六個可區分視角的地圖題`);
}

function makeMemorySequence(round, config, randomInt) {
  const cols = config.boardColumns, rows = config.boardRows;
  const count = config.numberCountByRound[round - 1];
  const seconds = config.memorySecondsByRound[round - 1];
  const canonical = shuffle(Array.from({ length: cols * rows }, (_, i) => i), randomInt).slice(0, count);
  const mirrorHorizontal = (index) => Math.floor(index / cols) * cols + (cols - 1 - index % cols);
  const mirrorVertical = (index) => (rows - 1 - Math.floor(index / cols)) * cols + index % cols;
  const positions = [canonical, canonical.map(mirrorHorizontal), canonical.map(mirrorVertical), canonical.map((index) => mirrorVertical(mirrorHorizontal(index)))];
  return { variantPositions: positions, count, memorySeconds: seconds, cols, rows };
}

function initialPlayerRound(gameId, question, rules, randomInt, sequenceVariantIndex = null) {
  if (gameId === 'minesweeper') return { revealed: [], flags: [], hits: [], safeProgress: 0, doneAtMs: null, penaltyMs: 0, mode: 'reveal' };
  if (gameId === 'zero_sum_grid' || gameId === 'cube_count') return { entry: '', wrongUntilMs: 0, doneAtMs: null, submissions: 0 };
  if (gameId === 'solid_puzzle') return {
    selection: null,
    choiceOrder: shuffle(question.choices.map(({ id }) => id), randomInt),
    wrongUntilMs: 0, doneAtMs: null, submissions: 0
  };
  if (gameId === 'map_view') return { selection: null, wrongUntilMs: 0, doneAtMs: null, submissions: 0 };
  if (gameId === 'memory_poker') return { selected: [], locked: false, hand: null, rankKey: null, doneAtMs: null };
  if (gameId === 'memory_sequence') {
    const variant = question.variantPositions[sequenceVariantIndex ?? randomInt(question.variantPositions.length)];
    const values = Array(question.cols * question.rows).fill(0);
    variant.forEach((cell, index) => { values[cell] = index + 1; });
    return { values, hearts: rules.games.memory_sequence.heartsPerRound, progress: 0, bestProgress: 0, firstReached: {}, doneAtMs: null, eliminatedAtMs: null, presses: 0, wrongCount: 0 };
  }
  if (gameId === 'slitherlink') {
    return { edges: Array(edgeCount(question.cols, question.rows)).fill(EDGE_BLANK), doneAtMs: null, moves: 0, history: [] };
  }
  return {};
}

function makeSlitherlink(round, config, randomInt) {
  const band = difficultyBand(config, round);
  return generateSlitherlinkPuzzle({
    cols: config.boardColumns, rows: config.boardRows,
    cluesMin: band.cluesMin, cluesMax: band.cluesMax,
    regionCellsMin: band.regionCellsMin, regionCellsMax: band.regionCellsMax,
    trialDepth: band.deductionTrialDepth
  }, randomInt);
}

function gridNeighbors(index, cols, rows) {
  const out = [], x = index % cols, y = Math.floor(index / cols);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(nx + ny * cols);
  }
  return out;
}

function revealSafe(board, player, index) {
  if (player.flags.includes(index) || player.revealed.includes(index) || board.mines.includes(index)) return;
  const queue = [index], seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current) || player.flags.includes(current) || player.revealed.includes(current) || board.mines.includes(current)) continue;
    seen.add(current); player.revealed.push(current);
    if (board.numbers[current] === 0) for (const next of gridNeighbors(current, board.cols, board.rows)) queue.push(next);
  }
  player.safeProgress = player.revealed.length;
}

function canSolveMinesWithoutGuessing(board) {
  const player = { revealed: [], flags: [], safeProgress: 0 };
  const knownMines = new Set();
  revealSafe(board, player, board.anchor);
  const target = board.cols * board.rows - board.mines.length;
  while (player.safeProgress < target) {
    const safe = new Set();
    const mineDeductions = new Set();
    const constraints = [];
    for (const index of player.revealed) {
      const unknown = gridNeighbors(index, board.cols, board.rows)
        .filter((next) => !player.revealed.includes(next) && !knownMines.has(next));
      const knownAround = gridNeighbors(index, board.cols, board.rows).filter((next) => knownMines.has(next)).length;
      const remaining = board.numbers[index] - knownAround;
      if (remaining < 0 || remaining > unknown.length) return false;
      if (!unknown.length) continue;
      constraints.push({ cells: new Set(unknown), remaining });
      if (remaining === 0) unknown.forEach((cell) => safe.add(cell));
      if (remaining === unknown.length) unknown.forEach((cell) => mineDeductions.add(cell));
    }
    for (let i = 0; i < constraints.length; i++) for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const a = constraints[i], b = constraints[j];
      if (a.cells.size >= b.cells.size || [...a.cells].some((cell) => !b.cells.has(cell))) continue;
      const difference = [...b.cells].filter((cell) => !a.cells.has(cell));
      const remaining = b.remaining - a.remaining;
      if (remaining < 0 || remaining > difference.length) return false;
      if (remaining === 0) difference.forEach((cell) => safe.add(cell));
      if (remaining === difference.length) difference.forEach((cell) => mineDeductions.add(cell));
    }
    for (const cell of safe) if (mineDeductions.has(cell) || board.mines.includes(cell)) return false;
    const newMines = [...mineDeductions].filter((cell) => !knownMines.has(cell));
    for (const cell of newMines) knownMines.add(cell);
    const safeCells = [...safe].filter((cell) => !player.revealed.includes(cell));
    if (!safeCells.length && !newMines.length) return false;
    for (const cell of safeCells) revealSafe(board, player, cell);
  }
  return player.safeProgress === target;
}

function evaluatePoker(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts].map(([rank, count]) => [count, rank]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const unique = [...new Set(ranks)];
  const straightHigh = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0]
    : unique.join(',') === '14,5,4,3,2' ? 5 : 0;
  if (flush && straightHigh) return { category: 8, name: '同花順', key: [8, straightHigh] };
  if (groups[0][0] === 4) return { category: 7, name: '鐵支', key: [7, groups[0][1], groups[1][1]] };
  if (groups[0][0] === 3 && groups[1][0] === 2) return { category: 6, name: '葫蘆', key: [6, groups[0][1], groups[1][1]] };
  if (flush) return { category: 5, name: '同花', key: [5, ...ranks] };
  if (straightHigh) return { category: 4, name: '順子', key: [4, straightHigh] };
  if (groups[0][0] === 3) return { category: 3, name: '三條', key: [3, groups[0][1], ...groups.slice(1).map((g) => g[1])] };
  if (groups[0][0] === 2 && groups[1][0] === 2) return { category: 2, name: '兩對', key: [2, groups[0][1], groups[1][1], groups[2][1]] };
  if (groups[0][0] === 2) return { category: 1, name: '一對', key: [1, groups[0][1], ...groups.slice(1).map((g) => g[1])] };
  return { category: 0, name: '高牌', key: [0, ...ranks] };
}

// Evaluate every five-card subset, without requiring any particular public or selected card.
export function evaluateBestPokerHand(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error('牌型評估需要 5 至 7 張牌');
  let best = null;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const selected = [a,b,c,d,e].map(index => cards[index]);
            const hand = evaluatePoker(selected);
            if (!best || compareKey(hand.key, best.key) > 0) best = { ...hand, cards: selected };
          }
  return best;
}

function compareKey(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function currentRoundLimit(gameId, question, rules) {
  const config = rules.games[gameId];
  if (gameId === 'memory_sequence') return question.memorySeconds * 1000 + config.answerSeconds * 1000;
  if (gameId === 'memory_poker') return pokerTiming(config).revealEnd;
  return config.playSeconds * 1000;
}

function generateQuestion(gameId, round, rules, randomInt) {
  const config = rules.games[gameId];
  switch (gameId) {
    case 'minesweeper': return makeMineBoard(round, config, randomInt);
    case 'zero_sum_grid': return makeZeroGrid(round, config, randomInt);
    case 'cube_count': return makeCubeModel(round, config, randomInt);
    case 'solid_puzzle': return makeSolidPuzzle(round, config, randomInt);
    case 'memory_poker': return makePoker(round, config, randomInt);
    case 'map_view': return makeMapQuestion(round, config, randomInt);
    case 'memory_sequence': return makeMemorySequence(round, config, randomInt);
    case 'slitherlink': return makeSlitherlink(round, config, randomInt);
    default: throw new Error(`未知遊戲：${gameId}`);
  }
}

function generatedQuestionError(message) {
  throw new Error(`題目驗證失敗：${message}`);
}

function sameList(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isConnectedShape(cells) {
  if (!cells.length) return false;
  const keys = new Set(cells.map((cell) => cell.join(',')));
  const visited = new Set([cells[0].join(',')]);
  const queue = [cells[0]];
  while (queue.length) {
    const [x, y, z] = queue.shift();
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const next = [x + dx, y + dy, z + dz], key = next.join(',');
      if (keys.has(key) && !visited.has(key)) { visited.add(key); queue.push(next); }
    }
  }
  return visited.size === cells.length;
}

function validateGeneratedQuestion(gameId, round, question, rules) {
  const config = rules.games[gameId];
  if (gameId === 'minesweeper') {
    const { cols, rows, anchor, mines, numbers } = question;
    const total = cols * rows;
    const mineSet = new Set(mines);
    if (total !== config.boardColumns * config.boardRows || numbers.length !== total || mineSet.size !== mines.length ||
        mines.length !== config.minesByRound[round - 1] || mines.some((index) => !Number.isInteger(index) || index < 0 || index >= total) ||
        mineSet.has(anchor) || numbers[anchor] !== 0) generatedQuestionError(`踩地雷第 ${round} 輪盤面尺寸、地雷數或安全起點錯誤`);
    const startX = anchor % cols, startY = Math.floor(anchor / cols);
    for (let y = Math.max(0, startY - config.startSafeRadiusCells); y <= Math.min(rows - 1, startY + config.startSafeRadiusCells); y++) {
      for (let x = Math.max(0, startX - config.startSafeRadiusCells); x <= Math.min(cols - 1, startX + config.startSafeRadiusCells); x++) {
        if (mineSet.has(x + y * cols)) generatedQuestionError(`踩地雷第 ${round} 輪安全起點周圍含地雷`);
      }
    }
    for (let index = 0; index < total; index++) {
      const x = index % cols, y = Math.floor(index / cols);
      let adjacent = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && mineSet.has(nx + ny * cols)) adjacent++;
      }
      if (numbers[index] !== (mineSet.has(index) ? -1 : adjacent)) generatedQuestionError(`踩地雷第 ${round} 輪數字與地雷位置不一致`);
    }
    if (!canSolveMinesWithoutGuessing(question)) generatedQuestionError(`踩地雷第 ${round} 輪無法依規則推理完成`);
    return;
  }

  if (gameId === 'zero_sum_grid') {
    const { cols, rows, cells, answers } = question;
    if (cols !== config.boardColumns || rows !== config.boardRows || cells.length !== cols * rows ||
        cells.some((value) => !Number.isInteger(value) || value < difficultyBand(config, round).valueMin || value > difficultyBand(config, round).valueMax)) {
      generatedQuestionError(`數字方格第 ${round} 輪尺寸或數值超出設定`);
    }
    const expected = [];
    for (let y = 0; y <= rows - config.subgridRows; y++) for (let x = 0; x <= cols - config.subgridColumns; x++) {
      let sum = 0;
      for (let dy = 0; dy < config.subgridRows; dy++) for (let dx = 0; dx < config.subgridColumns; dx++) {
        sum += cells[x + dx + (y + dy) * cols];
      }
      if (sum === config.targetSum) expected.push([x, y]);
    }
    const band = difficultyBand(config, round);
    if (expected.length < band.answerMin || expected.length > band.answerMax || !sameList(answers, expected)) {
      generatedQuestionError(`數字方格第 ${round} 輪答案數量或答案位置錯誤`);
    }
    return;
  }

  if (gameId === 'cube_count') {
    const band = difficultyBand(config, round);
    const { cols, rows, heights, total } = question;
    const expectedTotal = heights.reduce((sum, value) => sum + value, 0);
    if (cols !== band.baseColumns || rows !== band.baseRows || heights.length !== cols * rows ||
        heights.some((value) => !Number.isInteger(value) || value < band.heightMin || value > band.heightMax) ||
        total !== expectedTotal || total < config.numericInputMinimum || total > config.numericInputMaximum) {
      generatedQuestionError(`3D 數方塊第 ${round} 輪堆疊或總數錯誤`);
    }
    return;
  }

  if (gameId === 'solid_puzzle') {
    const dimensions = difficultyBand(config, round).targetDimensions;
    const insideTarget = (cells) => cells.every((cell) => cell.length === 3 && cell.every((value, axis) => Number.isInteger(value) && value >= 0 && value < dimensions[axis]));
    const correctChoices = question.choices.filter((choice) => choice.correct);
    const keys = question.choices.map((choice) => canonicalShape(choice.cells));
    const correct = question.choices.find((choice) => choice.id === question.correctId);
    if (question.target.some((value, axis) => value !== dimensions[axis]) || question.missing.length !== question.volume ||
        !insideTarget(question.missing) || !isConnectedShape(question.missing) || question.choices.length !== config.optionCount ||
        correctChoices.length !== 1 || !correct || !correct.correct || correct.cells.length !== question.volume ||
        !sameList(canonicalShape(correct.cells), canonicalShape(question.missing)) ||
        question.choices.some((choice) => choice.cells.length !== question.volume || !insideTarget(choice.cells) || !isConnectedShape(choice.cells)) ||
        new Set(keys).size !== keys.length) {
      generatedQuestionError(`立體拼圖第 ${round} 輪缺口或選項不唯一／無法補合`);
    }
    return;
  }

  if (gameId === 'memory_poker') {
    const cards = [...question.cards, ...question.community];
    const labels = cards.map((card) => card.label);
    const suits = new Set(CARD_SUITS);
    if (question.cards.length !== config.memoryCards || question.community.length !== config.communityCards ||
        labels.length !== config.memoryCards + config.communityCards || new Set(labels).size !== labels.length ||
        cards.some((card) => !Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14 || !suits.has(card.suit))) {
      generatedQuestionError(`記憶撲克第 ${round} 輪牌數、牌面或重複牌錯誤`);
    }
    return;
  }

  if (gameId === 'map_view') {
    const band = difficultyBand(config, round);
    const correctChoices = question.choices.filter((choice) => choice.correct);
    const correct = question.choices.find((choice) => choice.id === question.correctId);
    const distinctSignatures = new Set(question.choices.map((choice) => choice.signature));
    if (question.cols !== band.mapColumns || question.rows !== band.mapRows || question.grid.length !== band.mapRows ||
        question.grid.some((row) => row.length !== band.mapColumns) || question.landmarks.length !== band.landmarkTypes ||
        question.choices.length !== config.optionCount || correctChoices.length !== 1 || !correct ||
        distinctSignatures.size !== question.choices.length || correct.view.length < config.minimumDistinctVisibleClues ||
        !sameList(correct.view, question.firstPersonView) ||
        !sameList([question.correct.id, question.correct.x, question.correct.y, question.correct.heading],
          [correct.id, correct.x, correct.y, correct.heading])) {
      generatedQuestionError(`地圖定位第 ${round} 輪正解視角或選項辨識度錯誤`);
    }
    return;
  }

  if (gameId === 'memory_sequence') {
    const count = config.numberCountByRound[round - 1];
    const boardSize = config.boardColumns * config.boardRows;
    if (question.count !== count || question.memorySeconds !== config.memorySecondsByRound[round - 1] ||
        question.variantPositions.length !== 4 || question.variantPositions.some((positions) =>
          positions.length !== count || new Set(positions).size !== count ||
          positions.some((index) => !Number.isInteger(index) || index < 0 || index >= boardSize))) {
      generatedQuestionError(`數字速記第 ${round} 輪序列位置或時間設定錯誤`);
    }
    return;
  }

  if (gameId === 'slitherlink') {
    const band = difficultyBand(config, round);
    const { cols, rows, clues, solution } = question;
    const shown = clues?.filter((clue) => clue != null).length ?? -1;
    const counts = Array.isArray(solution) ? clueCountsForLoop(solution, cols, rows) : [];
    if (cols !== config.boardColumns || rows !== config.boardRows || !Array.isArray(clues) || clues.length !== cols * rows ||
        clues.some((clue, cell) => clue != null && (!Number.isInteger(clue) || clue < 0 || clue > 3 || clue !== counts[cell])) ||
        shown < band.cluesMin || shown > band.cluesMax || question.clueCount !== shown ||
        !isSingleLoop(solution, cols, rows) || countSolutions(cols, rows, clues, 2) !== 1) {
      generatedQuestionError(`數迴第 ${round} 輪提示數字、迴圈或唯一解錯誤`);
    }
    return;
  }

  generatedQuestionError(`沒有 ${gameId} 的題目驗證規則`);
}

/** Generate and verify every configured round without returning question content or answers. */
export function preflightGameQuestions(rules, {
  gameIds = GAME_ORDER.filter((gameId) => rules.games[gameId]?.enabled !== false),
  seedFactory = createQuestionSeed
} = {}) {
  if (!rules?.games || !Array.isArray(gameIds) || typeof seedFactory !== 'function') {
    throw new Error('題目檢查缺少有效遊戲規則或亂數來源');
  }
  const startedAt = process.hrtime.bigint();
  const games = [];
  for (const gameId of gameIds) {
    const config = rules.games[gameId];
    if (!GAME_ORDER.includes(gameId) || !config || !Number.isInteger(config.rounds) || config.rounds < 1) {
      throw new Error(`題目檢查收到無效遊戲：${String(gameId)}`);
    }
    const failures = [];
    let checkedRounds = 0;
    for (let round = 1; round <= config.rounds; round++) {
      try {
        const seed = seedFactory();
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('題目種子不是 32 位元無號整數');
        const question = generateQuestion(gameId, round, rules, seededRandom(seed));
        validateGeneratedQuestion(gameId, round, question, rules);
        checkedRounds++;
      } catch (error) {
        failures.push({ round, message: String(error.message ?? error).slice(0, 240) });
      }
    }
    games.push({
      gameId, gameName: config.displayName ?? LABELS[gameId], rounds: config.rounds,
      checkedRounds, failures
    });
  }
  const totalRounds = games.reduce((sum, game) => sum + game.rounds, 0);
  const checkedRounds = games.reduce((sum, game) => sum + game.checkedRounds, 0);
  const failedRounds = games.reduce((sum, game) => sum + game.failures.length, 0);
  return {
    passed: failedRounds === 0,
    gameCount: games.length,
    totalRounds,
    checkedRounds,
    failedRounds,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    games
  };
}

function questionIdFor(gameId, round, seed, rules) {
  const identity = JSON.stringify({
    gameId, round, seed,
    generatorVersion: QUESTION_GENERATOR_VERSION,
    rngAlgorithm: RNG_ALGORITHM,
    rulesVersion: rules.rulesVersion ?? null,
    commonRules: rules.common,
    gameRules: rules.games[gameId]
  });
  return crypto.createHash('sha256').update(identity).digest('hex');
}

export class GameEngine {
  constructor({ rules, zones, initialState = null, seedFactory = createQuestionSeed, onChange = () => {}, onSave = () => {}, onInput = () => {}, clock = nowMs }) {
    this.configuredRules = structuredClone(rules);
    this.restoredRulesError = null;
    let activeRules = this.configuredRules;
    if (initialState?.sessionId && initialState.rulesSnapshot) {
      try { activeRules = validateGameRules(structuredClone(initialState.rulesSnapshot)); }
      catch (error) { this.restoredRulesError = error; }
    }
    this.configureRules(this.restoredRulesError ? this.configuredRules : activeRules);
    this.zoneConfig = zones;
    this.menuZones = structuredClone([...zones.players, ...(zones.menuExtraZones ?? [])]);
    this.knownPlayerIds = new Set(zones.players.map((player) => player.id));
    this.onChange = onChange;
    this.onSave = onSave;
    this.onInput = onInput;
    this.seedFactory = seedFactory;
    this.clock = clock;
    this.lastTick = this.clock();
    this.inputsReady = false;
    this.inputDetail = '等待 TouchService';
    this.touchReleaseTimeoutMs = 0;
    this.contacts = new Map();
    this.batchDepth = 0;
    this.pendingRoundCheck = false;
    this.state = initialState ?? this.newState();
    this.phaseRevision = 0;
    this.savedPhase = this.state.phase;
    this.refreshPlayerLayout();
    this.recoverAfterRestart();
    this.refreshPlayerLayout();
  }

  refreshPlayerLayout() {
    this.layout = resolvePlayerLayout(this.zoneConfig, this.state.participantIds?.length ?? 0);
    this.zones = this.layout.players;
    this.zoneById = new Map(this.zones.map((player) => [player.id, player]));
  }

  configureRules(rules) {
    this.rules = structuredClone(rules);
    this.gameOrder = this.enabledGameIds(this.rules);
    this.gameNames = Object.fromEntries(Object.keys(this.rules.games).map((id) => [id, this.rules.games[id].displayName ?? LABELS[id]]));
  }

  newState() {
    return {
      rulesVersion: this.rules.rulesVersion,
      rulesSnapshot: structuredClone(this.rules),
      phase: 'idle', sessionId: null, sessionStartedAt: null, sessionElapsedMs: 0,
      sessionExpired: false, participantIds: [], participants: {},
      selectedGame: null, gameRoundIndex: 0, currentRound: null,
      results: [], notice: '', pauseInfo: null, exitConfirmation: null, updatedAt: new Date().toISOString()
    };
  }

  recoverAfterRestart() {
    this.state.exitConfirmation = null;
    if (this.restoredRulesError && this.state.sessionId && !['idle', 'final_results'].includes(this.state.phase)) {
      this.state.currentRound = null;
      this.state.selectedGame = null;
      this.state.readyIds = [];
      this.state.resumeTarget = null;
      this.state.phase = 'final_results';
      this.state.notice = '程式重新啟動；保存的場次規則無法通過目前版本驗證，已停止續玩並保留已結算成績。';
      this.save();
      return;
    }
    if (!this.state.rulesSnapshot) this.state.rulesSnapshot = structuredClone(this.rules);
    if (this.state.phase === 'paused' && !this.state.pauseInfo) {
      this.state.pauseInfo = {
        source: 'unknown', reason: this.state.notice || '暫停原因未記錄',
        since: this.state.updatedAt ?? new Date().toISOString()
      };
    }
    if (this.state.currentRound && this.state.phase !== 'round_results' && this.state.phase !== 'final_results') {
      const interruptedRound = this.state.currentRound;
      const sessionExpired = Boolean(this.state.sessionExpired) ||
        Number(this.state.sessionElapsedMs ?? 0) >= this.rules.common.sessionDurationSeconds * 1000;
      this.state.currentRound = null;
      this.state.readyIds = [];
      for (const participant of Object.values(this.state.participants ?? {})) participant.ready = false;
      if (sessionExpired) {
        this.state.selectedGame = null;
        this.state.gameRoundIndex = 0;
        this.state.sessionExpired = true;
        this.state.phase = this.state.sessionId ? 'final_results' : 'idle';
        this.state.notice = `程式重新啟動；未完成第 ${interruptedRound.round} 輪已作廢，場次時間已到，已進入總結算。`;
      } else {
        this.state.selectedGame = interruptedRound.gameId ?? this.state.selectedGame;
        this.state.gameRoundIndex = Math.max(0, Number(interruptedRound.round) - 1 || 0);
        this.state.phase = this.state.sessionId ? 'tutorial' : 'idle';
        this.state.resumeTarget = null;
        this.state.notice = `程式重新啟動；未完成第 ${interruptedRound.round} 輪已作廢，將重新開始該輪。`;
      }
      this.save();
    }
    if (this.state.phase === 'paused' && this.state.resumeTarget === 'playing') {
      this.state.phase = 'paused';
    }
  }

  snapshot() {
    const state = structuredClone(this.state);
    state.input = { ready: this.inputsReady, detail: this.inputDetail,
      mouseAvailable: true, phaseRevision: this.phaseRevision };
    state.sharedExitControl = structuredClone(this.zoneConfig.sharedExitControl ?? null);
    const tutorialContacts = this.state.phase === 'tutorial' && !this.state.exitConfirmation ? [...this.contacts.values()].filter((contact) =>
      !contact.cancelled && contact.phaseRevision === this.phaseRevision && contact.holdTarget?.kind === 'complete-tutorial') : [];
    state.tutorialHold = {
      active: tutorialContacts.length > 0,
      heldMs: Math.max(0, ...tutorialContacts.map((contact) => this.clock() - contact.started)),
      requiredMs: this.rules.common.readyHoldSeconds * 1000
    };
    state.remainingSessionMs = Math.max(0, this.rules.common.sessionDurationSeconds * 1000 - state.sessionElapsedMs);
    state.remainingRoundMs = this.state.phase === 'playing' && this.state.currentRound
      ? Math.max(0, this.state.currentRound.limitMs - this.state.currentRound.elapsedMs) : null;
    state.availableGames = this.gameOrder.map((id) => ({ id, name: this.rules.games[id].displayName ?? LABELS[id], rounds: this.rules.games[id].rounds }));
    state.zones = this.zones.map((z) => ({ id: z.id, name: z.name, rotationDegrees: z.rotationDegrees, rect: z.rect }));
    state.menuZones = this.menuZones.map((z) => ({ id: z.id, name: z.name, rotationDegrees: z.rotationDegrees, rect: z.rect }));
    state.menuSlots = this.menuSlots();
    state.questionPanels = this.layout.questionPanels.map((panel) => ({
      id: panel.id, playerId: panel.playerId, name: panel.name,
      rotationDegrees: panel.rotationDegrees, rect: panel.rect
    }));
    state.layout = {
      profileCount: this.layout.profileCount,
      participantCount: this.state.participantIds.length,
      questionDisplayMode: this.layout.questionDisplayMode,
      floorRole: this.layout.floorRole,
      floorRect: this.layout.floorRect?.rect ?? null
    };
    if (state.currentRound?.gameId === 'minesweeper') {
      state.currentRound.question = { cols: state.currentRound.question.cols, rows: state.currentRound.question.rows,
        anchor: state.currentRound.question.anchor, numbers: state.currentRound.question.numbers };
    }
    return state;
  }

  enabledGameIds(rules = this.rules) {
    return Object.keys(rules.games).filter((id) => rules.games[id].enabled !== false);
  }

  applyRules(rules) {
    if (!['idle', 'final_results'].includes(this.state.phase)) {
      throw new Error('只能在場次開始前或結束後套用遊戲設定');
    }
    this.configuredRules = structuredClone(rules);
    this.configureRules(this.configuredRules);
    if (this.state.phase === 'idle') {
      this.state.rulesVersion = this.rules.rulesVersion;
      this.state.rulesSnapshot = structuredClone(this.rules);
    }
    this.state.notice = '遊戲設定已儲存；新場次開始時套用。';
    this.save();
  }

  save() {
    if (this.savedPhase !== this.state.phase) {
      this.state.exitConfirmation = null;
      this.phaseRevision++;
      this.savedPhase = this.state.phase;
    }
    this.state.updatedAt = new Date().toISOString();
    this.onSave(this.state);
    this.changed();
  }

  changed() {
    this.onChange(this.snapshot());
  }

  assertCanStartSession() {
    if (this.state.phase !== 'idle') throw new Error('請先結束目前場次並返回待機');
  }

  startSession({ initialPlayerCount = 4 } = {}) {
    this.assertCanStartSession();
    const maximum = Math.min(this.knownPlayerIds.size, this.configuredRules.common.maxAnswerZones ?? this.knownPlayerIds.size);
    if (!Number.isInteger(initialPlayerCount) || initialPlayerCount < 0 || initialPlayerCount > maximum) {
      throw new Error(`初始玩家數必須介於 0 與 ${maximum} 之間`);
    }
    this.configureRules(this.configuredRules);
    this.state = this.newState();
    this.refreshPlayerLayout();
    this.state.sessionId = crypto.randomUUID();
    this.state.sessionStartedAt = new Date().toISOString();
    this.state.phase = 'lobby';
    for (let i = 1; i <= initialPlayerCount; i++) {
      const id = `P${i}`;
      this.state.participantIds.push(id);
      this.state.participants[id] = { zoneId: id, name: id, joinedAt: this.state.sessionStartedAt, totalHalfPoints: 0, roundsPlayed: 0 };
    }
    this.refreshPlayerLayout();
    this.state.notice = `場次開始；已加入 ${initialPlayerCount} 位玩家，可直接選擇遊戲，或由工作人員繼續加入玩家。`;
    this.save();
  }

  pause(reason = '工作人員暫停', source = 'staff') {
    if (['idle', 'final_results', 'paused'].includes(this.state.phase)) return;
    if (this.state.phase === 'resume_countdown') this.state.countdownMs = null;
    else this.state.resumeTarget = this.state.phase;
    this.state.phase = 'paused';
    this.state.notice = source === 'staff' ? reason : `【系統異常】${reason}`;
    this.state.pauseInfo = { source, reason, since: new Date().toISOString() };
    this.contacts.clear();
    this.save();
  }

  resume() {
    if (this.state.phase !== 'paused') throw new Error('目前沒有暫停中的場次');
    this.state.resumeTarget = this.state.resumeTarget ?? 'lobby';
    this.state.phase = 'resume_countdown';
    this.state.countdownMs = this.rules.common.resumeCountdownSeconds * 1000;
    this.state.notice = '準備繼續';
    this.contacts.clear();
    this.save();
  }

  cancelRound() {
    if (!this.state.selectedGame || !this.state.currentRound) throw new Error('目前沒有進行中的輪次');
    this.state.currentRound = null;
    this.state.selectedGame = null;
    this.state.gameRoundIndex = 0;
    this.state.phase = 'lobby';
    this.state.readyIds = [];
    this.state.notice = '本輪已作廢，返回大廳。已結算分數保留。';
    this.save();
  }

  returnToLobby() {
    if (!['game_preview', 'tutorial', 'countdown', 'playing', 'round_results', 'paused', 'resume_countdown'].includes(this.state.phase)) {
      throw new Error('只能在進行中的場次回到大廳');
    }
    if (this.state.sessionExpired || this.state.sessionElapsedMs >= this.rules.common.sessionDurationSeconds * 1000) {
      throw new Error('場次時間已到，請完成總結算');
    }
    const unfinishedRound = this.state.currentRound &&
      !this.state.results.some((result) => result.roundId === this.state.currentRound.id);
    this.state.exitConfirmation = null;
    this.state.currentRound = null;
    this.state.selectedGame = null;
    this.state.gameRoundIndex = 0;
    this.state.resumeTarget = null;
    this.state.countdownMs = null;
    this.state.resultRemainingMs = null;
    this.state.pauseInfo = null;
    this.state.readyIds = [];
    for (const id of this.state.participantIds) {
      if (this.state.participants[id]) this.state.participants[id].ready = false;
    }
    this.state.phase = 'lobby';
    this.state.notice = `已回到大廳；玩家名單、已結算名次與累積分數保留。${unfinishedRound ? '未結算的本輪已取消。' : ''}`;
    this.contacts.clear();
    this.pendingRoundCheck = false;
    this.save();
  }

  requestPlayerExit() {
    if (this.state.exitConfirmation || !canPlayerExit(this.state, this.rules.common.sessionDurationSeconds * 1000)) return;
    const phase = this.state.phase;
    this.tick();
    if (phase !== this.state.phase || !canPlayerExit(this.state, this.rules.common.sessionDurationSeconds * 1000)) return;
    this.state.exitConfirmation = { phase, roundId: this.state.currentRound?.id ?? null, notice: this.state.notice };
    this.state.notice = '遊戲已暫停；請確認是否全體退出並回到大廳。';
    this.phaseRevision++;
    this.contacts.clear();
    this.recordPlayerInput(null, { type: 'request-exit-game' });
    this.save();
  }

  cancelPlayerExit() {
    if (!this.state.exitConfirmation) return;
    this.state.notice = this.state.exitConfirmation.notice;
    this.state.exitConfirmation = null;
    this.lastTick = this.clock();
    this.phaseRevision++;
    this.contacts.clear();
    this.recordPlayerInput(null, { type: 'cancel-exit-game' });
    this.save();
  }

  restartRound() {
    if (!['countdown', 'playing'].includes(this.state.phase) || !this.state.currentRound) {
      throw new Error('只能在倒數或遊戲進行中重新開始本輪');
    }
    const retryIndex = this.state.gameRoundIndex;
    this.state.currentRound = null;
    this.state.gameRoundIndex = retryIndex - 1;
    this.state.notice = '原輪已作廢，正在以同一難度重開。';
    this.prepareRound();
  }

  endSession() {
    if (this.state.phase === 'idle') return;
    this.state.phase = 'final_results';
    this.state.currentRound = null;
    this.state.pauseInfo = null;
    this.state.notice = '工作人員已結束場次。';
    this.contacts.clear();
    this.save();
  }

  returnToStandby() {
    if (this.state.phase !== 'final_results') throw new Error('只有總結算時可以返回待機');
    this.configureRules(this.configuredRules);
    this.state = this.newState();
    this.refreshPlayerLayout();
    this.state.notice = '場次紀錄已保存；已返回待機。';
    this.contacts.clear();
    this.save();
  }

  setInputStatus(ready, detail) {
    const wasReady = this.inputsReady;
    const changed = ready !== wasReady || detail !== this.inputDetail;
    this.inputsReady = ready;
    this.inputDetail = detail;
    if (changed && this.state.sessionId && !['idle', 'final_results', 'paused'].includes(this.state.phase)) {
      if (!ready && wasReady) this.pause(`觸控服務中斷：${detail}`, 'touch-service');
      else if (ready) this.state.notice = '觸控服務已連線；請由工作人員確認後繼續。';
    }
    if (changed) this.changed();
  }

  join(zoneId) {
    if (this.state.phase !== 'lobby') throw new Error('只能在大廳加入');
    if (!this.knownPlayerIds.has(zoneId)) throw new Error('未知玩家區');
    if (this.state.participants[zoneId]) return;
    const nextZoneId = `P${this.state.participantIds.length + 1}`;
    const maximum = Math.min(this.knownPlayerIds.size, this.rules.common.maxAnswerZones ?? this.knownPlayerIds.size);
    if (this.state.participantIds.length >= maximum) throw new Error(`本場最多配置 ${maximum} 位玩家`);
    if (zoneId !== nextZoneId) throw new Error(`依加入順序，下一位玩家區為 ${nextZoneId}`);
    this.state.participants[zoneId] = { zoneId, name: zoneId, joinedAt: new Date().toISOString(), totalHalfPoints: 0, roundsPlayed: 0 };
    this.state.participantIds.push(zoneId);
    this.refreshPlayerLayout();
    this.state.notice = `${zoneId} 已加入並依加入順序配置；請前往新場域版型的 ${zoneId} 答題區。`;
    this.save();
  }

  joinFromZone(sourceZoneId) {
    if (this.state.phase !== 'lobby') throw new Error('只能在大廳加入');
    if (!this.zoneById.has(sourceZoneId)) throw new Error('未知玩家區');
    const zoneId = `P${this.state.participantIds.length + 1}`;
    this.join(zoneId);
    return zoneId;
  }

  selectGame(gameId, { randomized = false } = {}) {
    if (this.state.phase !== 'lobby') throw new Error('目前不能選擇遊戲');
    if (!this.gameOrder.includes(gameId)) throw new Error('未知遊戲');
    if (!this.state.participantIds.length) throw new Error('請先讓玩家在大廳加入');
    this.state.selectedGame = gameId;
    this.state.gameRoundIndex = 0;
    this.state.participantIds.forEach((id) => {
      if (this.state.participants[id]) this.state.participants[id].ready = false;
    });
    this.state.selectionWasRandom = Boolean(randomized);
    this.state.phase = 'game_preview';
    this.state.notice = randomized
      ? `隨機抽中「${this.gameNames[gameId]}」；請確認進入教學，或取消返回選單。`
      : `已選擇「${this.gameNames[gameId]}」；請確認進入教學，或取消返回選單。`;
    this.save();
  }

  confirmGameSelection() {
    if (this.state.phase !== 'game_preview' || !this.state.selectedGame) throw new Error('目前沒有待確認的遊戲');
    this.state.phase = 'tutorial';
    this.state.readyIds = [];
    this.state.participantIds.forEach((id) => { if (this.state.participants[id]) this.state.participants[id].ready = false; });
    this.state.notice = `請閱讀「${this.gameNames[this.state.selectedGame]}」教學；長按「完成」後倒數 3 秒開始。`;
    this.save();
  }

  selectRandomGame() {
    if (this.state.phase !== 'lobby') throw new Error('目前不能選擇遊戲');
    if (!this.state.participantIds.length) throw new Error('請先讓玩家在大廳加入');
    const gameId = this.gameOrder[crypto.randomInt(this.gameOrder.length)];
    this.selectGame(gameId, { randomized: true });
    return gameId;
  }

  prepareRound() {
    this.state.exitConfirmation = null;
    const gameId = this.state.selectedGame;
    if (!gameId) throw new Error('尚未選擇遊戲');
    if (!this.state.participantIds.length) throw new Error('沒有已加入玩家');
    const round = this.state.gameRoundIndex + 1;
    const seed = this.seedFactory();
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('題目種子必須是 32 位元無號整數');
    const randomInt = seededRandom(seed);
    const question = generateQuestion(gameId, round, this.rules, randomInt);
    const participantIds = [...this.state.participantIds];
    const sequenceVariantOrder = gameId === 'memory_sequence'
      ? shuffle(question.variantPositions.map((_, index) => index), randomInt) : null;
    const questionId = questionIdFor(gameId, round, seed, this.rules);
    this.state.currentRound = {
      id: crypto.randomUUID(), questionId, seed, rngAlgorithm: RNG_ALGORITHM,
      generatorVersion: QUESTION_GENERATOR_VERSION, rulesVersion: this.rules.rulesVersion,
      gameId, round, participantIds,
      question, limitMs: currentRoundLimit(gameId, question, this.rules), elapsedMs: 0,
      countdownMs: this.rules.common.countdownSeconds * 1000,
      players: Object.fromEntries(participantIds.map((id, index) => {
        const variantIndex = sequenceVariantOrder
          ? sequenceVariantOrder[index % sequenceVariantOrder.length] : null;
        return [id, initialPlayerRound(gameId, question, this.rules, randomInt, variantIndex)];
      })),
      generatedAt: new Date().toISOString()
    };
    this.state.gameRoundIndex = round;
    this.state.readyIds = [];
    this.state.phase = 'countdown';
    this.state.notice = `第 ${round} 輪準備開始。`;
    this.save();
  }

  setReady(zoneId) {
    if (this.state.phase !== 'tutorial') throw new Error('目前不在教學準備階段');
    if (!this.state.participantIds.includes(zoneId)) throw new Error('此區域尚未加入');
    this.state.readyIds = [zoneId];
    this.state.notice = `${zoneId} 長按完成教學；即將倒數 3 秒。`;
    this.prepareRound();
  }

  completeSharedTutorial() {
    if (this.state.phase !== 'tutorial') throw new Error('目前不在教學準備階段');
    if (!this.state.participantIds.length) throw new Error('尚無玩家加入，無法開始遊戲');
    this.contacts.clear();
    this.state.readyIds = [...this.state.participantIds];
    this.state.notice = '全體共用地板按鈕已完成教學；即將倒數 3 秒。';
    this.prepareRound();
  }

  startAfterTutorial() {
    if (this.state.phase !== 'tutorial') throw new Error('目前不在教學準備階段');
    this.prepareRound();
  }

  currentPlayer(zoneId) {
    const round = this.state.currentRound;
    if (!round || !round.players[zoneId]) return null;
    return round.players[zoneId];
  }

  recordPlayerInput(zoneId, action, { phase = this.state.phase, elapsedMs = null, gameId = null, roundId = null, round = null, relatedZones = null } = {}) {
    const loggedAction = {};
    for (const key of ['type', 'key', 'index', 'id', 'gameId']) {
      const value = action?.[key];
      if (['string', 'number', 'boolean'].includes(typeof value)) loggedAction[key] = value;
    }
    try {
      this.onInput({
        sessionId: this.state.sessionId,
        phase,
        roundId: roundId ?? this.state.currentRound?.id ?? null,
        gameId: gameId ?? this.state.currentRound?.gameId ?? this.state.selectedGame ?? null,
        round: round ?? this.state.currentRound?.round ?? null,
        zoneId,
        relatedZones: relatedZones ? [...relatedZones] : undefined,
        elapsedMs,
        action: loggedAction,
        completed: Boolean(this.currentPlayer(zoneId)?.doneAtMs != null),
        eliminated: Boolean(this.currentPlayer(zoneId)?.eliminatedAtMs != null),
        hasFeedback: Boolean(this.currentPlayer(zoneId)?.lastError)
      });
    } catch { /* Operational logging must not interrupt a game action. */ }
  }

  act(zoneId, action, eventElapsedMs = null) {
    if (this.state.exitConfirmation) return;
    if (action.type === 'join') return this.join(zoneId);
    if (action.type === 'ready') return this.setReady(zoneId);
    if (this.state.phase !== 'playing') throw new Error('現在不是作答時間');
    const round = this.state.currentRound;
    const player = this.currentPlayer(zoneId);
    if (!player || player.doneAtMs !== null || player.eliminatedAtMs != null) return;
    const actionAtMs = eventElapsedMs == null ? round.elapsedMs : Math.max(0, eventElapsedMs);
    if (actionAtMs >= round.limitMs) return;
    const gameId = round.gameId;
    if (gameId === 'zero_sum_grid' || gameId === 'cube_count') this.numericAction(player, action, gameId, actionAtMs);
    else if (gameId === 'minesweeper') this.mineAction(player, action, actionAtMs);
    else if (gameId === 'solid_puzzle' || gameId === 'map_view') this.choiceAction(player, action, gameId, actionAtMs);
    else if (gameId === 'memory_poker') this.pokerAction(player, action, actionAtMs);
    else if (gameId === 'memory_sequence') this.sequenceAction(player, action, round.question, actionAtMs);
    else if (gameId === 'slitherlink') this.slitherlinkAction(player, action, round.question, actionAtMs);
    this.recordPlayerInput(zoneId, action, {
      phase: 'playing', roundId: round.id, gameId, round: round.round, elapsedMs: actionAtMs
    });
    if (this.batchDepth) this.pendingRoundCheck = true;
    else this.checkRoundCompletion();
    this.changed();
  }

  numericAction(player, action, gameId, actionAtMs) {
    if (player.doneAtMs !== null || actionAtMs < player.wrongUntilMs) return;
    const config = this.rules.games[gameId];
    const raw = String(action.key ?? '');
    if (raw === 'clear') { player.entry = ''; return; }
    if (raw === 'backspace') { player.entry = player.entry.slice(0, -1); return; }
    if (raw === 'confirm') {
      if (!player.entry || !/^\d+$/.test(player.entry)) return;
      const answer = Number(player.entry);
      if (answer < config.numericInputMinimum || answer > config.numericInputMaximum) {
        player.lastError = `答案需介於 ${config.numericInputMinimum}–${config.numericInputMaximum}`;
        return;
      }
      player.submissions++;
      const correct = gameId === 'zero_sum_grid' ? answer === this.state.currentRound.question.answers.length
        : answer === this.state.currentRound.question.total;
      if (correct) player.doneAtMs = actionAtMs;
      else {
        player.entry = '';
        player.wrongUntilMs = actionAtMs + config.wrongAnswerLockSeconds * 1000;
        player.lastError = `答案錯誤，鎖答 ${config.wrongAnswerLockSeconds} 秒`;
      }
      return;
    }
    if (!/^\d$/.test(raw) || player.entry.length >= String(config.numericInputMaximum).length) return;
    const next = player.entry + raw;
    if (Number(next) <= config.numericInputMaximum) player.entry = next;
  }

  mineAction(player, action, actionAtMs) {
    const board = this.state.currentRound.question;
    if (action.type === 'toggle_mode') {
      if (!player.revealed.length) return;
      player.mode = player.mode === 'reveal' ? 'flag' : 'reveal';
      return;
    }
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index >= board.cols * board.rows) return;
    if (!player.revealed.length && (player.mode !== 'reveal' || index !== board.anchor)) return;
    if (player.mode === 'flag') {
      if (player.revealed.includes(index)) return;
      const at = player.flags.indexOf(index);
      if (at >= 0) player.flags.splice(at, 1);
      else if (player.flags.length < board.mines.length) player.flags.push(index);
      return;
    }
    if (player.revealed.includes(index) || player.flags.includes(index)) return;
    if (board.mines.includes(index)) {
      player.revealed.push(index);
      player.hits.push(index);
      player.penaltyMs += this.rules.games.minesweeper.penaltySecondsPerDistinctMine * 1000;
      return;
    }
    revealSafe(board, player, index);
    if (player.safeProgress === board.cols * board.rows - board.mines.length) player.doneAtMs = actionAtMs;
  }

  choiceAction(player, action, gameId, actionAtMs) {
    if (player.doneAtMs !== null || actionAtMs < player.wrongUntilMs) return;
    const question = this.state.currentRound.question;
    if (action.type === 'select') {
      const id = String(action.id);
      const choices = gameId === 'solid_puzzle' ? question.choices : question.choices;
      if (!choices.some((item) => item.id === id)) return;
      player.selection = id;
      return;
    }
    if (action.type === 'confirm') {
      if (!player.selection) return;
      player.submissions++;
      if (player.selection === question.correctId) player.doneAtMs = actionAtMs;
      else {
        player.selection = null;
        player.wrongUntilMs = actionAtMs + this.rules.games[gameId].wrongAnswerLockSeconds * 1000;
        player.lastError = `選擇錯誤，鎖答 ${this.rules.games[gameId].wrongAnswerLockSeconds} 秒`;
      }
    }
  }

  pokerAction(player, action, actionAtMs) {
    const t = actionAtMs;
    const config = this.rules.games.memory_poker;
    const selectStart = pokerTiming(config).memoryEnd;
    const selectEnd = selectStart + config.selectionSeconds * 1000;
    if (t < selectStart || t >= selectEnd || player.locked) return;
    if (action.type === 'toggle_card') {
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= 16) return;
      const at = player.selected.indexOf(index);
      if (at >= 0) player.selected.splice(at, 1);
      else if (player.selected.length < config.selectedCardsRequired) player.selected.push(index);
      return;
    }
    if (action.type === 'confirm' && player.selected.length === this.rules.games.memory_poker.selectedCardsRequired) player.locked = true;
  }

  sequenceAction(player, action, question, actionAtMs) {
    const config = this.rules.games.memory_sequence;
    const t = actionAtMs - question.memorySeconds * 1000;
    if (t < 0 || t >= config.answerSeconds * 1000 || player.doneAtMs !== null || player.eliminatedAtMs !== null) return;
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index >= question.cols * question.rows) return;
    if (player.values[index] === 0) return;
    player.presses++;
    if (player.values[index] === player.progress + 1) {
      player.progress++;
      if (player.firstReached[player.progress] === undefined) player.firstReached[player.progress] = t;
      player.bestProgress = Math.max(player.bestProgress, player.progress);
      player.lastError = null;
      if (player.progress === question.count) player.doneAtMs = t;
    } else {
      player.hearts--;
      player.progress = 0;
      player.wrongCount = (player.wrongCount ?? 0) + 1;
      player.lastError = '答錯，請從 1 重新開始';
      if (player.hearts <= 0) player.eliminatedAtMs = t;
    }
  }

  slitherlinkAction(player, action, question, actionAtMs) {
    if (action.type === 'undo') {
      const previous = player.history?.pop();
      if (previous) { player.edges[previous.index] = previous.state; player.moves++; }
      return;
    }
    if (action.type !== 'cycle_edge') return;
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index >= player.edges.length) return;
    (player.history ??= []).push({ index, state: player.edges[index] });
    player.edges[index] = nextEdgeState(player.edges[index]);
    player.moves++;
    if (linesMatchSolution(player.edges, question.solution)) player.doneAtMs = actionAtMs;
  }

  coordinateAction(zoneId, u, v, heldMs = 0, eventElapsedMs = null) {
    const layout = this.rules.common.layout;
    const width = layout.localDesignWidth;
    const height = layout.localDesignHeight;
    const x = u * width, y = v * height;
    const inside = (rect) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
    const phase = this.state.phase;
    if (zoneId === EXIT_CONTROL_ZONE) {
      if (!canPlayerExit(this.state, this.rules.common.sessionDurationSeconds * 1000)) return;
      const confirming = Boolean(this.state.exitConfirmation);
      const action = exitActionAt(u, v, confirming);
      if (action === 'request') {
        this.requestPlayerExit();
      } else if (action === 'cancel') {
        this.cancelPlayerExit();
      } else if (action === 'confirm') {
        this.recordPlayerInput(null, { type: 'confirm-exit-game' });
        this.returnToLobby();
      }
      return;
    }
    if (this.state.exitConfirmation) return;
    if (zoneId === 'FLOOR') {
      if (phase === 'tutorial' &&
          this.pointInsideHoldTarget(tutorialHoldTarget(this.layout.floorRect.rect), { u, v }) &&
          heldMs >= this.rules.common.readyHoldSeconds * 1000) {
        this.recordPlayerInput(null, { type: 'complete-tutorial' }, { phase: 'tutorial', relatedZones: [...this.state.participantIds] });
        this.completeSharedTutorial();
      }
      return;
    }
    if (phase === 'game_preview') {
      const action = this.gamePreviewActionAt(zoneId, u, v);
      if (action === 'confirm') {
        this.recordPlayerInput(zoneId, { type: 'confirm-game-selection', gameId: this.state.selectedGame }, { phase: 'game_preview' });
        this.confirmGameSelection();
      } else if (action === 'cancel') {
        this.recordPlayerInput(zoneId, { type: 'cancel-game-selection', gameId: this.state.selectedGame }, { phase: 'game_preview' });
        this.returnToLobby();
      }
      return;
    }
    const joined = Boolean(this.state.participants[zoneId]);
    const player = this.currentPlayer(zoneId);
    if (!joined) return;
    if (phase === 'tutorial') {
      return;
    }
    if (phase === 'lobby') {
      const item = this.lobbyGameAt(zoneId, u, v);
      if (item === RANDOM_GAME_ID) this.selectRandomGame();
      else if (item) this.selectGame(item);
      return;
    }
    if (phase !== 'playing' || !player) return;
    const gameId = this.state.currentRound.gameId;
    const roundElapsedMs = eventElapsedMs == null ? this.state.currentRound.elapsedMs : eventElapsedMs;
    if (gameId === 'minesweeper') {
      const config = this.rules.games.minesweeper;
      const board = config.boardRect, toolbar = config.toolbarRect;
      if (inside(toolbar)) { this.act(zoneId, { type: 'toggle_mode' }, eventElapsedMs); return; }
      if (!inside(board)) return;
      const col = Math.floor((x - board.x) / board.width * config.boardColumns);
      const row = Math.floor((y - board.y) / board.height * config.boardRows);
      this.act(zoneId, { type: 'reveal', index: col + row * config.boardColumns }, eventElapsedMs); return;
    }
    if (gameId === 'zero_sum_grid' || gameId === 'cube_count') {
      if (layout.numericConfirmRect && inside(layout.numericConfirmRect)) {
        this.act(zoneId, { key: 'confirm' }, eventElapsedMs); return;
      }
      const rect = layout.numericKeypadRect ?? layout.interactiveRect;
      if (!inside(rect)) return;
      const columns = layout.numericKeypadColumns, rows = layout.numericKeypadRows;
      const col = Math.floor((x - rect.x) / rect.width * columns);
      const row = Math.floor((y - rect.y) / rect.height * rows);
      const key = layout.numericKeypadKeys[row * columns + col];
      if (key && key !== 'spacer') this.act(zoneId, { key }, eventElapsedMs);
      return;
    }
    if (gameId === 'slitherlink') {
      const config = this.rules.games.slitherlink;
      const undo = config.undoRect;
      if (undo && ((x - undo.x - undo.width / 2) / (undo.width / 2)) ** 2 +
          ((y - undo.y - undo.height / 2) / (undo.height / 2)) ** 2 <= 1) {
        this.act(zoneId, { type: 'undo' }, eventElapsedMs); return;
      }
      const index = slitherlinkEdgeAt(x, y, config.boardRect, config.boardColumns, config.boardRows);
      if (index != null) this.act(zoneId, { type: 'cycle_edge', index }, eventElapsedMs);
      return;
    }
    if (gameId === 'memory_sequence') {
      const config = this.rules.games.memory_sequence;
      const rect = layout.interactiveRect;
      if (!inside(rect)) return;
      const col = Math.floor((x - rect.x) / rect.width * config.boardColumns);
      const row = Math.floor((y - rect.y) / rect.height * config.boardRows);
      this.act(zoneId, { index: row * config.boardColumns + col }, eventElapsedMs); return;
    }
    if (gameId === 'memory_poker') {
      const poker = this.rules.games.memory_poker;
      if (roundElapsedMs < pokerTiming(poker).memoryEnd ||
          roundElapsedMs >= pokerTiming(poker).selectionEnd) return;
      if (inside(poker.cardGridRect)) {
        const col = Math.floor((x - poker.cardGridRect.x) / poker.cardGridRect.width * poker.memoryGridColumns);
        const row = Math.floor((y - poker.cardGridRect.y) / poker.cardGridRect.height * poker.memoryGridRows);
        this.act(zoneId, { type: 'toggle_card', index: row * poker.memoryGridColumns + col }, eventElapsedMs);
      } else if (inside(poker.confirmRect)) this.act(zoneId, { type: 'confirm' }, eventElapsedMs);
      return;
    }
    if (gameId === 'solid_puzzle' || gameId === 'map_view') {
      const config = this.rules.games[gameId], rect = config.choiceGridRect;
      if (inside(config.confirmRect)) { this.act(zoneId, { type: 'confirm' }, eventElapsedMs); return; }
      if (!inside(rect)) return;
      const columns = config.choiceGridColumns ?? 2;
      const rows = config.choiceGridRows ?? 3;
      const col = Math.floor((x - rect.x) / rect.width * columns);
      const row = Math.floor((y - rect.y) / rect.height * rows);
      const index = row * columns + col;
      const choices = this.state.currentRound.question.choices;
      const choiceId = gameId === 'solid_puzzle' ? player.choiceOrder[index] : choices[index]?.id;
      if (choiceId) this.act(zoneId, { type: 'select', id: choiceId }, eventElapsedMs);
    }
  }

  activeElapsedAt(timestamp = this.clock()) {
    const round = this.state.currentRound;
    if (this.state.phase !== 'playing' || !round) return null;
    return Math.min(round.limitMs, round.elapsedMs + (this.state.exitConfirmation ? 0 : Math.max(0, timestamp - this.lastTick)));
  }

  touchHoldTarget(zoneId, position) {
    const rect = tutorialHoldTarget(this.layout.floorRect.rect);
    if (this.state.phase === 'tutorial' && zoneId === 'FLOOR' && this.pointInsideHoldTarget(rect, position)) {
      return { phase: 'tutorial', kind: 'complete-tutorial', rect };
    }
    return null;
  }

  completeHeldTutorial(now = this.clock()) {
    if (this.state.phase !== 'tutorial' || this.state.exitConfirmation) return false;
    const contact = [...this.contacts.values()].find((item) => !item.cancelled &&
      item.phaseRevision === this.phaseRevision && item.holdTarget?.kind === 'complete-tutorial' &&
      now - item.started >= this.rules.common.readyHoldSeconds * 1000);
    if (!contact) return false;
    this.recordPlayerInput(null, { type: 'complete-tutorial' }, { phase: 'tutorial', relatedZones: [...this.state.participantIds] });
    this.completeSharedTutorial();
    return true;
  }

  pointInsideHoldTarget(rect, position) {
    if (rect.shape === 'circle') {
      const dx = (position.u - rect.x - rect.width / 2) / (rect.width / 2);
      const dy = (position.v - rect.y - rect.height / 2) / (rect.height / 2);
      return dx * dx + dy * dy <= 1;
    }
    return position.u >= rect.x && position.v >= rect.y &&
      position.u < rect.x + rect.width && position.v < rect.y + rect.height;
  }

  holdTargetStillValid(contact, position) {
    return Boolean(contact.holdTarget && contact.phaseRevision === this.phaseRevision &&
      this.state.phase === contact.holdTarget.phase &&
      position?.zoneId === contact.zoneId && this.pointInsideHoldTarget(contact.holdTarget.rect, position));
  }

  clearTouchContacts(source = 'touch') {
    let removed = false;
    for (const [id, contact] of this.contacts) {
      if ((contact.source ?? 'touch') === source) { this.contacts.delete(id); removed = true; }
    }
    if (removed && this.state.phase === 'tutorial') this.changed();
  }

  handleTouchFrame(frame, { source = 'touch' } = {}) {
    if (!frame || frame.v !== 1 || frame.venue !== '704' || !Array.isArray(frame.events) || !Array.isArray(frame.alive)) return;
    const effects = [];
    const receivedAt = this.clock();
    for (const event of frame.events) {
      if (event.phase === 'down') {
        const position = this.canvasPosition(event.face, event.px);
        if (!position) continue;
        const key = String(event.id);
        if (!this.contacts.has(key)) {
          const holdTarget = this.touchHoldTarget(position.zoneId, position);
          const contact = {
            ...position, source, started: receivedAt, eventElapsedMs: this.activeElapsedAt(receivedAt),
            releaseDelayMs: this.touchReleaseTimeoutMs,
            holdTarget, phaseRevision: this.phaseRevision,
            requiresHold: Boolean(holdTarget), cancelled: false
          };
          this.contacts.set(key, contact);
          if (!contact.requiresHold) effects.push({ ...contact, heldMs: 0 });
        }
      } else if (event.phase === 'move') {
        const contact = this.contacts.get(String(event.id));
        if (!contact?.requiresHold || contact.cancelled) continue;
        const position = this.canvasPosition(event.face, event.px);
        if (!this.holdTargetStillValid(contact, position)) contact.cancelled = true;
      } else if (event.phase === 'up') {
        const key = String(event.id), contact = this.contacts.get(key);
        if (!contact) continue;
        this.contacts.delete(key);
        const duration = Math.max(0, receivedAt - contact.started - (contact.releaseDelayMs ?? this.touchReleaseTimeoutMs));
        const up = this.canvasPosition(event.face, event.px);
        if (contact.requiresHold && !contact.cancelled && this.holdTargetStillValid(contact, up) && duration >= 0) {
          effects.push({ ...contact, heldMs: duration });
        }
      }
    }
    const alive = new Set(frame.alive.map(String));
    for (const [id, contact] of this.contacts) {
      if ((contact.source ?? 'touch') === source && !alive.has(id)) this.contacts.delete(id);
    }
    if (this.completeHeldTutorial(receivedAt)) return;
    if (this.state.phase === 'tutorial') this.changed();
    this.batchDepth++;
    try {
      const zoneTouches = new Map();
      for (const touch of effects) zoneTouches.set(touch.zoneId, [...(zoneTouches.get(touch.zoneId) ?? []), touch]);
      const singleTouches = [];
      for (const [zoneId, touches] of zoneTouches) {
        if (touches.length > 1) {
          if (this.state.phase === 'lobby') {
            const choices = [...new Set(touches.map((touch) => this.lobbyGameAt(zoneId, touch.u, touch.v)).filter(Boolean))];
            if (choices.length === 1) {
              singleTouches.push(touches[0]);
              continue;
            }
            if (choices.length === 0) continue;
          }
          this.state.notice = `${zoneId} 同時觸碰多個按鍵；本批操作未計入。`;
          this.changed();
          continue;
        }
        singleTouches.push(touches[0]);
      }
      if (this.state.phase === 'lobby') {
        const selections = singleTouches.map((touch) => ({
          touch, gameId: this.lobbyGameAt(touch.zoneId, touch.u, touch.v)
        })).filter((item) => item.gameId);
        const choices = [...new Set(selections.map((item) => item.gameId))];
        if (choices.length > 1) {
          this.state.notice = '同時選了不同遊戲；請共同選擇一款。';
          this.changed();
          return;
        }
        if (choices.length === 1) {
          const [choice] = choices;
          const choiceZones = selections.filter((item) => item.gameId === choice).map((item) => item.touch.zoneId);
          if (choice === RANDOM_GAME_ID) this.selectRandomGame();
          else this.selectGame(choice);
          this.recordPlayerInput(null, {
            type: choice === RANDOM_GAME_ID ? 'select-random-game' : 'select-game',
            gameId: this.state.selectedGame
          }, { phase: 'lobby', relatedZones: choiceZones });
          return;
        }
      }
      if (this.state.phase === 'game_preview') {
        const previews = singleTouches.map((touch) => ({ touch, action: this.gamePreviewActionAt(touch.zoneId, touch.u, touch.v) }))
          .filter((item) => item.action);
        const actions = [...new Set(previews.map((item) => item.action))];
        if (actions.length > 1) {
          this.state.notice = '同時觸碰「確定」與「取消」；請再選一次。';
          this.changed();
          return;
        }
        if (actions.length === 1) {
          const [action] = actions;
          const zones = previews.filter((item) => item.action === action).map((item) => item.touch.zoneId);
          this.recordPlayerInput(zones[0], {
            type: action === 'confirm' ? 'confirm-game-selection' : 'cancel-game-selection',
            gameId: this.state.selectedGame
          }, { phase: 'game_preview', relatedZones: zones });
          if (action === 'confirm') this.confirmGameSelection();
          else this.returnToLobby();
          return;
        }
      }
      for (const touch of singleTouches) {
        try {
          if (touch.phaseRevision === this.phaseRevision) this.coordinateAction(touch.zoneId, touch.u, touch.v, touch.heldMs, touch.eventElapsedMs);
        }
        catch { /* Stale and out-of-phase touches are ignored safely. */ }
      }
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingRoundCheck) {
        this.pendingRoundCheck = false;
        this.checkRoundCompletion();
      }
    }
  }

  touchCadPoint(px) {
    if (!Array.isArray(px) || px.length !== 2 || !px.every(Number.isFinite)) return null;
    const [rawX, rawY] = px;
    // Convert the merged service canvas into the CAD canvas: clockwise quarter turn,
    // then crop the 512 px blank strip in the service canvas.
    return { x: TOUCH_CANVAS_HEIGHT - TOUCH_CANVAS_CROP_PX - rawY, y: rawX };
  }

  canvasPosition(faceIndex, px) {
    if (!Number.isInteger(faceIndex)) return null;
    const cadPoint = this.touchCadPoint(px);
    if (!cadPoint) return null;
    const { x: cadX, y: cadY } = cadPoint;
    const exitControl = this.zoneConfig.sharedExitControl;
    if (exitControl && canPlayerExit(this.state, this.rules.common.sessionDurationSeconds * 1000) &&
        faceIndex === exitControl.face && cadX >= exitControl.rect.x && cadY >= exitControl.rect.y &&
        cadX < exitControl.rect.x + exitControl.rect.width && cadY < exitControl.rect.y + exitControl.rect.height) {
      const u = (cadX - exitControl.rect.x) / exitControl.rect.width;
      const v = (cadY - exitControl.rect.y) / exitControl.rect.height;
      return { zoneId: EXIT_CONTROL_ZONE,
        u: exitControl.rotationDegrees === 180 ? 1 - u : u,
        v: exitControl.rotationDegrees === 180 ? 1 - v : v };
    }
    if (this.state.exitConfirmation) return null;
    const floor = this.layout.floorRect;
    if (this.state.phase === 'tutorial' && floor && faceIndex === floor.face &&
        cadX >= floor.rect.x && cadY >= floor.rect.y &&
        cadX < floor.rect.x + floor.rect.width && cadY < floor.rect.y + floor.rect.height) {
      return {
        zoneId: 'FLOOR',
        u: (cadX - floor.rect.x) / floor.rect.width,
        v: (cadY - floor.rect.y) / floor.rect.height
      };
    }
    const zones = ['lobby', 'game_preview'].includes(this.state.phase) ? this.menuZones : this.zones;
    for (const zone of zones) {
      for (const source of zone.sources) {
        if (source.face !== faceIndex || cadX < source.x || cadY < source.y ||
            cadX >= source.x + source.width || cadY >= source.y + source.height) continue;
        const sourceU = (cadX - source.x) / source.width;
        let u = source.uStart == null ? sourceU : source.uStart + sourceU * (source.uEnd - source.uStart);
        let v = (cadY - source.y) / source.height;
        const screenU = clamp(u, 0, 1), screenV = clamp(v, 0, 1);
        if (zone.rotationDegrees === 90) { u = screenV; v = 1 - screenU; }
        else if (zone.rotationDegrees === 180) { u = 1 - screenU; v = 1 - screenV; }
        else if (zone.rotationDegrees === 270) { u = 1 - screenV; v = screenU; }
        const sideways = zone.rotationDegrees === 90 || zone.rotationDegrees === 270;
        const orientedWidth = sideways ? zone.rect.height : zone.rect.width;
        const orientedHeight = sideways ? zone.rect.width : zone.rect.height;
        const designWidth = this.rules.common.layout.localDesignWidth;
        const designHeight = this.rules.common.layout.localDesignHeight;
        const left = (orientedWidth - designWidth) / 2;
        const top = (orientedHeight - designHeight) / 2;
        const designX = u * orientedWidth, designY = v * orientedHeight;
        if (designX < left || designY < top || designX >= left + designWidth || designY >= top + designHeight) return null;
        u = (designX - left) / designWidth;
        v = (designY - top) / designHeight;
        return { zoneId: zone.id, u, v };
      }
    }
    return null;
  }

  /**
   * Shared lobby menu: one option per wall menu zone. When there are more options than walls
   * (eight games plus random), the last wall is split left-to-right among the remaining options.
   */
  menuSlots() {
    const options = [...this.gameOrder, RANDOM_GAME_ID];
    const lastIndex = this.menuZones.length - 1;
    return this.menuZones.map((zone, index) => ({
      zoneId: zone.id,
      optionIds: options.length > this.menuZones.length && index === lastIndex
        ? options.slice(index) : options.slice(index, index + 1)
    })).filter((slot) => slot.optionIds.length);
  }

  gamePreviewActionAt(zoneId, u, v) {
    const slot = this.menuSlots().find((item) => item.zoneId === zoneId);
    if (!slot?.optionIds.includes(this.state.selectedGame)) return null;
    const buttons = [
      { action: 'confirm', x: 0.25 },
      { action: 'cancel', x: 0.75 }
    ];
    for (const button of buttons) {
      if (Math.hypot(u - button.x, v - 0.6) <= 0.175) return button.action;
    }
    return null;
  }

  lobbyGameAt(zoneId, u, v) {
    if (this.state.phase !== 'lobby' || !this.state.participantIds.length) return null;
    const slot = this.menuSlots().find((item) => item.zoneId === zoneId);
    if (!slot) return null;
    const layout = this.rules.common.layout;
    const x = u * layout.localDesignWidth, y = v * layout.localDesignHeight;
    const rect = layout.interactiveRect;
    if (x < 0 || y < rect.y || x >= layout.localDesignWidth || y >= rect.y + rect.height) return null;
    return slot.optionIds[Math.min(slot.optionIds.length - 1, Math.floor(u * slot.optionIds.length))];
  }

  tick(deltaMs = null) {
    const tickAt = this.clock();
    try {
    if (this.state.exitConfirmation) return;
    if (this.state.phase === 'idle' || this.state.phase === 'final_results' || this.state.phase === 'paused') return;
    const d = deltaMs == null
      ? Math.max(0, tickAt - this.lastTick)
      : Math.max(0, deltaMs);
    if (this.state.phase !== 'resume_countdown') this.state.sessionElapsedMs += d;
    const sessionLimit = this.rules.common.sessionDurationSeconds * 1000;
    if (this.state.phase !== 'resume_countdown' && this.state.sessionElapsedMs >= sessionLimit) {
      this.state.sessionExpired = true;
      if (['lobby', 'game_preview', 'tutorial', 'countdown'].includes(this.state.phase)) {
        this.state.phase = 'final_results';
        this.state.currentRound = null;
        this.state.selectedGame = null;
        this.state.notice = '45 分鐘場次時間到。';
        this.save();
        return;
      }
    }
    if (this.state.phase === 'resume_countdown') {
      this.state.countdownMs -= d;
      if (this.state.countdownMs <= 0) {
        this.state.phase = this.state.resumeTarget ?? 'lobby';
        this.state.resumeTarget = null;
        this.state.countdownMs = null;
        this.state.pauseInfo = null;
        this.state.notice = '遊戲繼續。';
        this.contacts.clear();
        this.save();
        return;
      }
    } else if (this.state.phase === 'tutorial' && this.contacts.size) {
      if (this.completeHeldTutorial(tickAt)) return;
      this.changed();
    } else if (this.state.phase === 'countdown') {
      this.state.currentRound.countdownMs -= d;
      if (this.state.currentRound.countdownMs <= 0) {
        this.state.currentRound.countdownMs = 0;
        this.state.phase = 'playing';
        this.state.currentRound.elapsedMs = 0;
        this.state.notice = `第 ${this.state.currentRound.round} 輪開始。`;
        this.save();
        return;
      }
    } else if (this.state.phase === 'playing') {
      const round = this.state.currentRound;
      round.elapsedMs = Math.min(round.limitMs, round.elapsedMs + d);
      const poker = this.rules.games.memory_poker;
      if (round.gameId === 'memory_poker' && round.elapsedMs >= pokerTiming(poker).selectionEnd) {
        for (const player of Object.values(round.players)) if (player.selected.length === this.rules.games.memory_poker.selectedCardsRequired) player.locked = true;
      }
      if (round.elapsedMs >= round.limitMs) this.finishRound('deadline');
      else this.changed();
    } else if (this.state.phase === 'round_results') {
      this.state.resultRemainingMs = Math.max(0, this.state.resultRemainingMs - d);
      if (this.state.resultRemainingMs === 0) {
        if (this.state.sessionExpired || this.state.sessionElapsedMs >= this.rules.common.sessionDurationSeconds * 1000) {
          this.state.phase = 'final_results';
          this.state.notice = '45 分鐘場次時間到。';
        } else if (this.state.gameRoundIndex >= this.rules.games[this.state.selectedGame].rounds) {
          this.state.phase = 'lobby';
          this.state.selectedGame = null;
          this.state.currentRound = null;
          this.state.readyIds = [];
          this.state.participantIds.forEach((id) => { if (this.state.participants[id]) this.state.participants[id].ready = false; });
          this.state.notice = '小遊戲完成，玩家可選擇下一款。';
        } else this.prepareRound();
        this.save();
        return;
      }
      this.changed();
    }
    if (this.state.sessionElapsedMs >= sessionLimit) {
      this.state.sessionExpired = true;
      if (['lobby', 'game_preview', 'tutorial', 'countdown'].includes(this.state.phase)) {
        this.state.phase = 'final_results';
        this.state.currentRound = null;
        this.state.selectedGame = null;
        this.state.notice = '45 分鐘場次時間到。';
        this.save();
        return;
      }
    }
    if (this.state.sessionElapsedMs % 1000 < d) this.changed();
    } finally {
      this.lastTick = tickAt;
    }
  }

  checkRoundCompletion() {
    const round = this.state.currentRound;
    if (!round || this.state.phase !== 'playing') return;
    const players = Object.values(round.players);
    const n = players.length;
    let done = 0;
    if (round.gameId === 'minesweeper') done = players.filter((p) => p.doneAtMs !== null).length;
    else if (round.gameId === 'memory_sequence') done = players.filter((p) => p.doneAtMs !== null || p.eliminatedAtMs !== null).length;
    else if (round.gameId !== 'memory_poker') done = players.filter((p) => p.doneAtMs !== null).length;
    if (n === 1 && done === 1 && !['minesweeper', 'memory_poker'].includes(round.gameId)) this.finishRound('single_player_complete');
    else if (round.gameId === 'minesweeper' && done === n) this.finishRound('all_finished');
    else if (round.gameId === 'memory_sequence' && done === n) this.finishRound('all_finished_or_eliminated');
    else if (!['minesweeper', 'memory_sequence', 'memory_poker'].includes(round.gameId) && n >= 2 && done >= n - 1) this.finishRound('n_minus_one_correct');
  }

  finishRound(reason) {
    if (this.state.phase !== 'playing') return;
    const round = this.state.currentRound, n = round.participantIds.length;
    const entries = round.participantIds.map((id) => ({ id, player: round.players[id] }));
    const gameId = round.gameId;
    for (const { player } of entries) {
      if (gameId === 'memory_poker' && player.selected.length === this.rules.games.memory_poker.selectedCardsRequired) {
        const cards = [...player.selected.map((i) => round.question.cards[i]), ...round.question.community];
        const evaluated = evaluateBestPokerHand(cards);
        player.hand = { labels: evaluated.cards.map((c) => c.label), name: evaluated.name };
        player.rankKey = evaluated.key;
      }
    }
    const ranked = entries.filter(({ player }) => {
      if (gameId === 'memory_poker') return player.selected.length === this.rules.games.memory_poker.selectedCardsRequired;
      if (gameId === 'minesweeper') return player.doneAtMs !== null || player.safeProgress > 0;
      if (gameId === 'memory_sequence') return player.doneAtMs !== null || player.bestProgress > 0;
      return player.doneAtMs !== null;
    });
    const metric = ({ id, player }) => {
      if (gameId === 'minesweeper') return player.doneAtMs !== null ? [0, player.doneAtMs + player.penaltyMs] : [1, -player.safeProgress];
      if (gameId === 'memory_sequence') return player.doneAtMs !== null ? [0, player.doneAtMs]
        : [1, -player.bestProgress, player.firstReached[player.bestProgress] ?? Infinity];
      if (gameId === 'memory_poker') return [...player.rankKey.map((x) => -x)];
      return [player.doneAtMs ?? Infinity];
    };
    ranked.sort((a, b) => {
      const ka = metric(a), kb = metric(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
        if (diff) return diff;
      }
      return 0;
    });
    const awards = Object.fromEntries(entries.map(({ id }) => [id, 0]));
    const unitsPerPoint = this.rules.common.scoring.storageUnitsPerPoint;
    let cursor = 0;
    while (cursor < ranked.length) {
      let end = cursor + 1;
      while (end < ranked.length && compareMetric(metric(ranked[cursor]), metric(ranked[end])) === 0) end++;
      const pointSum = unitsPerPoint * Array.from({ length: end - cursor }, (_, j) => n - (cursor + j + 1)).reduce((a, b) => a + b, 0);
      const units = Math.round(pointSum / (end - cursor));
      for (let i = cursor; i < end; i++) awards[ranked[i].id] = units;
      for (let i = cursor; i < end; i++) ranked[i].player.rank = cursor + 1;
      cursor = end;
    }
    for (const { id, player } of entries) {
      const person = this.state.participants[id];
      if (person) { person.totalHalfPoints += awards[id]; person.roundsPlayed++; }
    }
    const result = {
      roundId: round.id, gameId, gameName: this.gameNames[gameId], round: round.round, reason,
      questionId: round.questionId, questionSeed: round.seed, rngAlgorithm: round.rngAlgorithm,
      generatorVersion: round.generatorVersion, rulesVersion: round.rulesVersion,
      elapsedMs: round.elapsedMs, participantCount: n,
      rows: entries.map(({ id, player }) => ({
        zoneId: id, rank: player.rank ?? null, pointsHalf: awards[id],
        score: awards[id] / unitsPerPoint, completed: gameId === 'memory_poker' ? player.selected.length === this.rules.games.memory_poker.selectedCardsRequired : player.doneAtMs !== null,
        elapsedMs: player.doneAtMs,
        mineHits: player.hits?.length ?? 0,
        sequenceProgress: player.bestProgress ?? null,
        pokerHand: player.hand ?? null,
        slitherlinkLines: player.edges ? player.edges.filter((state) => state === EDGE_LINE).length : null
      })),
      answer: answerForRound(round)
    };
    this.state.results.unshift(result);
    this.state.results = this.state.results.slice(0, 200);
    this.state.phase = 'round_results';
    this.state.resultRemainingMs = this.rules.common.roundResultsSeconds * 1000;
    this.state.notice = `${this.gameNames[gameId]} 第 ${round.round} 輪結算。`;
    this.save();
  }

  finalRankings() {
    const players = Object.values(this.state.participants ?? {});
    players.sort((a, b) => b.totalHalfPoints - a.totalHalfPoints);
    let rank = 1;
    return players.map((p, i) => {
      if (i && p.totalHalfPoints !== players[i - 1].totalHalfPoints) rank = i + 1;
      return { zoneId: p.zoneId, rank, score: p.totalHalfPoints / 2, roundsPlayed: p.roundsPlayed };
    });
  }
}

function compareMetric(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function answerForRound(round) {
  const q = round.question, id = round.gameId;
  if (id === 'minesweeper') return { mineCount: q.mines.length, anchor: q.anchor };
  if (id === 'zero_sum_grid') return { count: q.answers.length, blocks: q.answers };
  if (id === 'cube_count') return { total: q.total, heights: q.heights, size: q.size };
  if (id === 'solid_puzzle') return { correctId: q.correctId, missing: q.missing };
  if (id === 'memory_poker') return { community: q.community.map((c) => c.label) };
  if (id === 'map_view') return { correctId: q.correctId, correct: q.correct, landmarks: q.landmarks };
    if (id === 'memory_sequence') return { count: q.count };
  if (id === 'slitherlink') return { cols: q.cols, rows: q.rows, clues: q.clues, solution: q.solution };
  return null;
}

export const GAME_IDS = GAME_ORDER;
export const GAME_NAMES = LABELS;
export const evaluateFiveCardHand = evaluatePoker;
