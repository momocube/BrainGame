import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GameEngine } from '../src/game-engine.mjs';
import { validateGameRules } from '../src/game-rules.mjs';
import { createStageSnapshot } from '../src/stage-view.mjs';
import {
  EDGE_BLANK, EDGE_CROSS, EDGE_LINE, cellEdges, clueCountsForLoop, countSolutions, edgeCount, edgeEndpoints,
  generateSlitherlinkPuzzle, horizontalEdge, isSingleLoop, linesMatchSolution, nextEdgeState,
  regionIsValid, slitherlinkEdgeAt, solveByDeduction, verticalEdge
} from '../src/slitherlink.mjs';
import { slitherlinkBoardSvg, slitherlinkEdgeEndpoints } from '../public/slitherlink-board.mjs';
import { getGameTutorial } from '../public/tutorial-content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8'));
const zones = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-zones.704.json'), 'utf8')),
  profilePlan: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-layouts.704.json'), 'utf8'))
};
const config = rules.games.slitherlink;
const _ = null;
// 企劃書「數迴」範例題（5×5、10 個提示）。
const PLAN_EXAMPLE = [
  3, _, _, _, _,
  _, _, _, 3, _,
  3, _, _, 2, _,
  1, _, 0, 2, _,
  _, 3, 3, 3, _
];

function seeded(seed) {
  let state = seed >>> 0;
  return (minOrMax, maybeMax) => {
    const min = maybeMax === undefined ? 0 : minOrMax;
    const max = maybeMax === undefined ? minOrMax : maybeMax;
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return min + Math.floor((((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000) * (max - min));
  };
}

function advance(engine, milliseconds) {
  for (let remaining = milliseconds; remaining > 0; remaining -= 1_000) engine.tick(Math.min(1_000, remaining));
}

function slitherEngine({ participants = ['P1'], round = 1, seed = 1234 } = {}) {
  const engine = new GameEngine({ rules, zones, onSave() {}, seedFactory: () => seed });
  engine.setInputStatus(true, '測試 TouchService 已就緒');
  engine.startSession();
  for (const id of participants) engine.join(id);
  engine.selectGame('slitherlink');
  engine.confirmGameSelection();
  engine.state.gameRoundIndex = round - 1;
  engine.startAfterTutorial();
  advance(engine, rules.common.countdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'playing');
  return engine;
}

/** Send a real TouchService frame for a player-facing point (u, v) on a shared lobby wall. */
function tapMenuWall(engine, zoneId, u, v, id) {
  const zone = engine.menuZones.find((item) => item.id === zoneId);
  const sideways = zone.rotationDegrees === 90 || zone.rotationDegrees === 270;
  const width = sideways ? zone.rect.height : zone.rect.width;
  const height = sideways ? zone.rect.width : zone.rect.height;
  const designU = (u * 640 + (width - 640) / 2) / width, designV = (v * 640 + (height - 640) / 2) / height;
  let screenU = designU, screenV = designV;
  if (zone.rotationDegrees === 90) { screenU = 1 - designV; screenV = designU; }
  else if (zone.rotationDegrees === 180) { screenU = 1 - designU; screenV = 1 - designV; }
  else if (zone.rotationDegrees === 270) { screenU = designV; screenV = 1 - designU; }
  const source = zone.sources[0];
  const cadX = source.x + screenU * source.width, cadY = source.y + screenV * source.height;
  const event = { id, phase: 'down', face: source.face, px: [cadY, 3_328 - cadX] };
  engine.handleTouchFrame({ v: 1, venue: '704', events: [event], alive: [String(id)] });
  engine.handleTouchFrame({ v: 1, venue: '704', events: [{ ...event, phase: 'up' }], alive: [] });
}

function edgeMidpoint(edge, rect = config.boardRect, cols = 5, rows = 5) {
  const [[x1, y1], [x2, y2]] = edgeEndpoints(edge, cols, rows);
  return { x: rect.x + (x1 + x2) / 2 * rect.width / cols, y: rect.y + (y1 + y2) / 2 * rect.height / rows };
}

test('5×5 edge numbering covers every dot-to-dot segment exactly once', () => {
  assert.equal(edgeCount(5, 5), 60);
  const seen = new Set();
  for (let edge = 0; edge < 60; edge++) {
    const [[x1, y1], [x2, y2]] = edgeEndpoints(edge, 5, 5);
    assert.equal(Math.abs(x2 - x1) + Math.abs(y2 - y1), 1, `edge ${edge} joins neighbouring dots`);
    seen.add(`${x1},${y1}-${x2},${y2}`);
    assert.deepEqual(slitherlinkEdgeEndpoints(edge, 5, 5), edgeEndpoints(edge, 5, 5), 'stage and engine agree on geometry');
  }
  assert.equal(seen.size, 60);
  assert.equal(horizontalEdge(5, 4, 5), 29);
  assert.equal(verticalEdge(0, 0, 5, 5), 30);
  assert.deepEqual(cellEdges(0, 5, 5), [0, 5, 30, 31]);
});

test('the plan example puzzle has one solution that deduction finds', () => {
  assert.equal(countSolutions(5, 5, PLAN_EXAMPLE, 5), 1);
  const solved = solveByDeduction(5, 5, PLAN_EXAMPLE);
  assert.equal(solved.status, 'solved', 'the plan example only needs simple local deductions');
  const lines = solved.edges.flatMap((state, edge) => state === EDGE_LINE ? [edge] : []);
  assert.equal(isSingleLoop(lines, 5, 5), true);
  const counts = clueCountsForLoop(lines, 5, 5);
  PLAN_EXAMPLE.forEach((clue, cell) => { if (clue != null) assert.equal(counts[cell], clue, `cell ${cell}`); });
});

test('loop checks reject branches, crossings and two separate loops', () => {
  const square = (r, c) => cellEdges(r * 5 + c, 5, 5);
  assert.equal(isSingleLoop(square(0, 0), 5, 5), true);
  assert.equal(isSingleLoop([...square(0, 0), ...square(3, 3)], 5, 5), false, 'two loops');
  assert.equal(isSingleLoop([...square(0, 0), horizontalEdge(1, 1, 5)], 5, 5), false, 'branch');
  assert.equal(regionIsValid(Array(25).fill(false).map((_, i) => i === 0 || i === 6), 5, 5), false,
    'cells touching only at a corner would make the loop cross itself');
  const ring = Array(25).fill(false).map((_, i) => [6, 7, 8, 11, 13, 16, 17, 18].includes(i));
  assert.equal(regionIsValid(ring, 5, 5), false, 'a region with a hole has two boundaries');
});

test('generated puzzles respect every difficulty band, are unique and reproducible', () => {
  for (const band of config.difficultyBands) {
    const settings = {
      cols: 5, rows: 5, cluesMin: band.cluesMin, cluesMax: band.cluesMax,
      regionCellsMin: band.regionCellsMin, regionCellsMax: band.regionCellsMax, trialDepth: band.deductionTrialDepth
    };
    for (let seed = 1; seed <= 25; seed++) {
      const puzzle = generateSlitherlinkPuzzle(settings, seeded(seed));
      const shown = puzzle.clues.filter((clue) => clue != null).length;
      assert.ok(shown >= band.cluesMin && shown <= band.cluesMax, `round ${band.firstRound} seed ${seed}: ${shown} clues`);
      assert.equal(isSingleLoop(puzzle.solution, 5, 5), true);
      assert.equal(countSolutions(5, 5, puzzle.clues, 2), 1, `round ${band.firstRound} seed ${seed} is unique`);
      assert.equal(solveByDeduction(5, 5, puzzle.clues, { trialDepth: band.deductionTrialDepth }).status, 'solved');
      assert.deepEqual(generateSlitherlinkPuzzle(settings, seeded(seed)), puzzle, 'same seed, same puzzle');
    }
  }
});

test('taps map to the nearest edge and ignore clue centres, dots and far-away touches', () => {
  const rect = config.boardRect;
  for (let edge = 0; edge < 60; edge++) {
    const { x, y } = edgeMidpoint(edge);
    assert.equal(slitherlinkEdgeAt(x, y, rect, 5, 5), edge, `midpoint of edge ${edge}`);
    assert.equal(slitherlinkEdgeAt(x + 9, y + 9, rect, 5, 5), edge, `slightly off midpoint of edge ${edge}`);
  }
  const cell = rect.width / 5;
  assert.equal(slitherlinkEdgeAt(rect.x + cell * 2.5, rect.y + cell * 2.5, rect, 5, 5), null, 'cell centre (clue) is ignored');
  assert.equal(slitherlinkEdgeAt(rect.x + cell * 2, rect.y + cell * 2, rect, 5, 5), null, 'a dot is ambiguous');
  assert.equal(slitherlinkEdgeAt(rect.x - 20, rect.y + cell * 1.5, rect, 5, 5), verticalEdge(1, 0, 5, 5), 'just outside the left border');
  assert.equal(slitherlinkEdgeAt(rect.x + cell * 2.5, 20, rect, 5, 5), null, 'status rows never hit the board');
  assert.equal(slitherlinkEdgeAt(5, 5, rect, 5, 5), null);
});

test('each tap cycles line → cross → blank and crosses never block completion', () => {
  assert.equal(nextEdgeState(EDGE_BLANK), EDGE_LINE);
  assert.equal(nextEdgeState(EDGE_LINE), EDGE_CROSS);
  assert.equal(nextEdgeState(EDGE_CROSS), EDGE_BLANK);

  const engine = slitherEngine({ participants: ['P1', 'P2'] });
  const round = engine.state.currentRound;
  const { solution } = round.question;
  const wrongEdge = [...Array(60).keys()].find((edge) => !solution.includes(edge));
  engine.act('P1', { type: 'cycle_edge', index: wrongEdge });
  assert.equal(round.players.P1.edges[wrongEdge], EDGE_LINE);
  engine.act('P1', { type: 'cycle_edge', index: wrongEdge });
  assert.equal(round.players.P1.edges[wrongEdge], EDGE_CROSS, 'second tap places an X');
  for (const edge of solution.slice(0, -1)) engine.act('P1', { type: 'cycle_edge', index: edge });
  assert.equal(round.players.P1.doneAtMs, null, 'an unfinished loop is not complete');
  assert.equal(round.players.P2.edges.every((state) => state === EDGE_BLANK), true, 'players have separate boards');
  engine.act('P1', { type: 'cycle_edge', index: solution.at(-1) });
  assert.equal(engine.state.phase, 'round_results', 'N−1 rule: one of two players finishing ends the round');
  const result = engine.state.results[0];
  assert.equal(result.rows.find((row) => row.zoneId === 'P1').score, 1);
  assert.equal(result.rows.find((row) => row.zoneId === 'P2').score, 0);
  assert.deepEqual(result.answer.solution, solution);
});

test('an extra wrong line keeps the loop incomplete; turning it into an X completes it', () => {
  const engine = slitherEngine({ participants: ['P1', 'P2', 'P3'] });
  const round = engine.state.currentRound;
  const { solution } = round.question;
  const extra = [...Array(60).keys()].find((edge) => !solution.includes(edge));
  engine.act('P1', { type: 'cycle_edge', index: extra });
  for (const edge of solution) engine.act('P1', { type: 'cycle_edge', index: edge });
  assert.equal(round.players.P1.doneAtMs, null, 'all loop edges drawn plus one wrong line is not complete');
  assert.equal(linesMatchSolution(round.players.P1.edges, solution), false);
  advance(engine, 2_000);
  engine.act('P1', { type: 'cycle_edge', index: extra });
  assert.equal(round.players.P1.edges[extra], EDGE_CROSS);
  assert.ok(round.players.P1.doneAtMs >= 2_000, 'the X is only a note, so the loop is now complete');
  assert.equal(engine.state.phase, 'playing', 'with three players the round waits for a second finisher (N−1)');
});

test('every player wall toggles the same logical edge from its own local coordinates', () => {
  const engine = slitherEngine({ participants: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] });
  const edge = engine.state.currentRound.question.solution[0];
  const { x, y } = edgeMidpoint(edge);
  for (const zoneId of ['P1', 'P4', 'P6', 'P8']) {
    engine.coordinateAction(zoneId, x / 640, y / 640);
    assert.equal(engine.state.currentRound.players[zoneId].edges[edge], EDGE_LINE, zoneId);
  }
  engine.coordinateAction('P2', (config.boardRect.x + config.boardRect.width / 10) / 640,
    (config.boardRect.y + config.boardRect.height / 10) / 640);
  assert.equal(engine.state.currentRound.players.P2.moves, 0, 'tapping a clue centre does nothing');
});

test('the projection gets clues and each player board, but the loop only after the round', () => {
  const engine = slitherEngine({ participants: ['P1', 'P2'] });
  const round = engine.state.currentRound;
  engine.act('P1', { type: 'cycle_edge', index: round.question.solution[0] });
  const playing = createStageSnapshot(engine, rules, zones);
  assert.deepEqual(Object.keys(playing.currentRound.question).sort(), ['clues', 'cols', 'rows']);
  assert.equal(playing.playerViews.P1.slither.edges[round.question.solution[0]], EDGE_LINE);
  assert.equal(JSON.stringify(playing).includes('"solution"'), false, 'no solution reaches the stage while playing');

  advance(engine, config.playSeconds * 1_000);
  assert.equal(engine.state.phase, 'round_results');
  const results = createStageSnapshot(engine, rules, zones);
  assert.deepEqual(results.currentRound.question.solution, round.question.solution);
  assert.equal(results.results[0].rows.every((row) => row.score === 0), true, 'nobody finished: everyone scores 0');
});

test('the shared lobby gives 數迴 and random separate full-size walls', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  engine.setInputStatus(true, '測試 TouchService 已就緒');
  engine.startSession();
  engine.join('P1');
  const slots = engine.snapshot().menuSlots;
  assert.equal(slots.length, 9);
  assert.deepEqual(slots.slice(0, 7).map((slot) => slot.optionIds.length), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(slots[7].optionIds, ['slitherlink']);
  assert.deepEqual(slots[8].optionIds, ['random']);
  const lastWall = slots[7].zoneId;
  assert.equal(engine.lobbyGameAt(lastWall, 0.25, 0.6), 'slitherlink');
  assert.equal(engine.lobbyGameAt(lastWall, 0.75, 0.6), 'slitherlink');
  assert.equal(engine.lobbyGameAt(lastWall, 0.25, 0.1), null, 'status rows are not a menu button');

  tapMenuWall(engine, lastWall, 0.25, 0.6, 501);
  assert.equal(engine.state.phase, 'game_preview', 'touching the full eighth wall picks 數迴');
  assert.equal(engine.state.selectedGame, 'slitherlink');
  assert.equal(engine.gamePreviewActionAt(slots[0].zoneId, 0.25, 0.6), null, 'other walls do not confirm');
  tapMenuWall(engine, lastWall, 0.25, 0.6, 502);
  assert.equal(engine.state.phase, 'tutorial');

  const random = new GameEngine({ rules, zones, onSave() {} });
  random.setInputStatus(true, '測試 TouchService 已就緒');
  random.startSession();
  random.join('P1');
  tapMenuWall(random, slots[8].zoneId, 0.5, 0.6, 503);
  assert.equal(random.state.phase, 'game_preview', 'the independent right wall offers random selection');
  assert.match(random.state.notice, /隨機抽中/);

  const withoutSlitherlink = structuredClone(rules);
  withoutSlitherlink.games.slitherlink.enabled = false;
  const sevenGames = new GameEngine({ rules: withoutSlitherlink, zones, onSave() {} });
  assert.deepEqual(sevenGames.menuSlots().map((slot) => slot.optionIds.length), [1, 1, 1, 1, 1, 1, 1, 1],
    'disabling 數迴 restores one option per wall');
});

test('rule validation guards the 數迴 board, bands and completion semantics', () => {
  assert.equal(validateGameRules(structuredClone(rules)).games.slitherlink.rounds, 3);
  const cases = [
    [(r) => { r.games.slitherlink.boardRect.height = 400; }, /正方形/],
    [(r) => { r.games.slitherlink.boardRect.y = 100; }, /第 9、10 排/],
    [(r) => { r.games.slitherlink.crossMarksAffectCompletion = true; }, /叉叉只作記號/],
    [(r) => { r.games.slitherlink.boardColumns = 9; }, /boardColumns/],
    [(r) => { r.games.slitherlink.difficultyBands[0].cluesMax = 30; }, /cluesMax/],
    [(r) => { r.games.slitherlink.difficultyBands[2].deductionTrialDepth = 2; }, /deductionTrialDepth/],
    [(r) => { r.games.slitherlink.rounds = 4; }, /難度級距必須完整覆蓋/],
    [(r) => { delete r.games.slitherlink; }, /缺少必要遊戲：數迴|缺少必要遊戲：slitherlink/]
  ];
  for (const [mutate, message] of cases) {
    const broken = structuredClone(rules);
    mutate(broken);
    assert.throws(() => validateGameRules(broken), message);
  }
});

test('board SVG draws lines, crosses, clues and marks wrong lines against the solution', () => {
  const edges = Array(60).fill(EDGE_BLANK);
  edges[0] = EDGE_LINE; edges[1] = EDGE_LINE; edges[2] = EDGE_CROSS;
  const svg = slitherlinkBoardSvg({ cols: 5, rows: 5, clues: PLAN_EXAMPLE, edges, rect: config.boardRect, viewBox: '0 128 640 512' });
  assert.equal((svg.match(/class="slither-line"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="slither-cross"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="slither-clue"/g) ?? []).length, 10);
  assert.equal((svg.match(/<circle /g) ?? []).length, 36);
  assert.match(svg, /viewBox="0 128 640 512"/);
  const results = slitherlinkBoardSvg({ cols: 5, rows: 5, clues: PLAN_EXAMPLE, edges, solution: [0, 5, 30, 31] });
  assert.equal((results.match(/class="slither-solution"/g) ?? []).length, 4);
  assert.equal((results.match(/slither-wrong/g) ?? []).length, 1, 'edge 1 is not in the solution');
});

test('the 數迴 tutorial explains the three-tap cycle and uses the configured timing', () => {
  const guide = getGameTutorial('slitherlink', config);
  assert.match(guide.steps[0], /第一下畫線.*第二下打叉.*第三下清除/);
  assert.equal(guide.schedule, '每輪 180 秒・共 3 輪');
});

test('the smaller player board preserves its centre and rejects touches on the old perimeter', () => {
  assert.equal(config.boardRect.width / 480, 0.7);
  assert.equal(config.boardRect.height / 480, 0.7);
  assert.equal(config.boardRect.x + config.boardRect.width / 2, 320);
  assert.equal(config.boardRect.y + config.boardRect.height / 2, 384);
  for(const [x,y] of [[128,144],[80,192],[560,192],[128,624]]) {
    assert.equal(slitherlinkEdgeAt(x,y,config.boardRect,5,5),null);
  }
});
