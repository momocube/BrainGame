import assert from 'node:assert/strict';
import test from 'node:test';
import { compareStageStateFreshness, scoreboardColumnCount, stageStructureKey } from '../public/stage-rendering.mjs';

test('stage structure key ignores timer-only updates but detects player and question changes', () => {
  const initial = {
    phase: 'playing', sessionElapsedMs: 1_000, updatedAt: 'first',
    currentRound: { gameId: 'zero_sum_grid', elapsedMs: 1_000, countdownMs: null, question: { cells: [1, -1] } },
    playerViews: { P1: { entry: '', score: 0, lockRemainingMs: 0 } }
  };
  const timerUpdate = structuredClone(initial);
  timerUpdate.sessionElapsedMs = 2_000;
  timerUpdate.updatedAt = 'second';
  timerUpdate.currentRound.elapsedMs = 2_000;
  timerUpdate.playerViews.P1.lockRemainingMs = 500;
  timerUpdate.tutorialHold = { active: true, heldMs: 500, requiredMs: 1000 };

  assert.equal(stageStructureKey(initial), stageStructureKey(timerUpdate));

  const playerUpdate = structuredClone(timerUpdate);
  playerUpdate.playerViews.P1.entry = '42';
  assert.notEqual(stageStructureKey(initial), stageStructureKey(playerUpdate));

  const questionUpdate = structuredClone(timerUpdate);
  questionUpdate.currentRound.question.cells[0] = 9;
  assert.notEqual(stageStructureKey(initial), stageStructureKey(questionUpdate));
});

test('stage structure key changes for each memory-sequence mistake so the error flash replays', () => {
  const firstMistake = {
    phase: 'playing', currentRound: { gameId: 'memory_sequence', elapsedMs: 5_000 },
    playerViews: { P1: { sequence: { wrongCount: 1 } } }
  };
  const nextMistake = structuredClone(firstMistake);
  nextMistake.currentRound.elapsedMs = 6_000;
  nextMistake.playerViews.P1.sequence.wrongCount = 2;
  assert.notEqual(stageStructureKey(firstMistake), stageStructureKey(nextMistake));
});

test('stage snapshot freshness rejects a late HTTP state after a newer server state', () => {
  const older = { phase: 'paused', updatedAt: '2026-11-24T05:00:00.000Z' };
  const newer = { phase: 'playing', updatedAt: '2026-11-24T05:00:02.000Z' };
  assert.equal(compareStageStateFreshness(newer, older), 1);
  assert.equal(compareStageStateFreshness(older, newer), -1);
  assert.equal(compareStageStateFreshness(newer, { updatedAt: newer.updatedAt }), 0);
});

test('enlarged scoreboards choose enough columns to keep score entries readable', () => {
  assert.equal(scoreboardColumnCount(0), 1);
  assert.equal(scoreboardColumnCount(1), 1);
  assert.equal(scoreboardColumnCount(4), 2);
  assert.equal(scoreboardColumnCount(8), 3);
});


import { orthographicViews, orthographicSignature, orthographicSvg, orthographicLayout, remainingSolidCells } from '../public/solid-views.mjs';
test('orthographic views project front, right side and top with correct axes', () => {
  const cells = [[0,0,0],[1,0,0],[1,0,1],[1,1,1]];
  const views = orthographicViews(cells);
  assert.deepEqual(views.map(v => [v.label,v.cols,v.rows]), [['前',2,2],['側',2,2],['上',2,2]]);
  assert.deepEqual(views[0].cells, [[1,0],[0,1],[1,1]]);
  assert.deepEqual(views[1].cells, [[0,0],[1,0],[0,1]]);
  assert.deepEqual(views[2].cells, [[1,0],[0,1],[1,1]]);
  assert.equal(orthographicSignature(cells), orthographicSignature(cells.map(c => c.map(n => n+4))));
  const svg = orthographicSvg(cells, { bounds: [3,3,3], target: true });
  assert.equal((svg.match(/aria-label="[前側上]視圖"/g) ?? []).length, 3);
  assert.ok(!svg.includes('<polygon'));
});

test('remaining solid subtracts the hole without translating target coordinates', () => {
  const target = [3,2,2], missing = [[0,0,0],[0,0,1],[0,1,0],[0,1,1]];
  const before = structuredClone({target,missing});
  const cells = remainingSolidCells(target,missing);
  assert.equal(cells.length,8);
  assert.ok(cells.every(cell => cell[0] > 0));
  assert.deepEqual({target,missing},before);
  assert.equal(orthographicViews(cells,target)[0].cols,3);
  assert.notEqual(orthographicSignature(cells,target),orthographicSignature(cells));
  assert.equal(remainingSolidCells(target,[]).length,12);
  assert.deepEqual(remainingSolidCells(target,remainingSolidCells(target,[])),[]);
});

test('orthographic silhouettes merge filled cells into outlines without grid or internal edges', () => {
  const cells = remainingSolidCells([3,2,2],[]);
  const svg = orthographicSvg(cells,{bounds:[3,2,2]});
  assert.equal((svg.match(/<path /g) ?? []).length,3);
  assert.ok(!/<rect|<line|<polygon|<pattern/.test(svg));
  const paths = [...svg.matchAll(/<path d="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(paths,['M0,0L3,0L3,2L0,2Z','M0,0L2,0L2,2L0,2Z','M0,0L3,0L3,2L0,2Z']);
});

test('silhouette outlines preserve holes, concavity and diagonal components', () => {
  const ring = remainingSolidCells([3,3,1],[[1,1,0]]);
  const svg = orthographicSvg(ring);
  const top = [...svg.matchAll(/<path d="([^"]*)"/g)][2][1];
  assert.equal((top.match(/M/g) ?? []).length,2,'inner void needs its own contour');
  assert.match(svg,/fill-rule="evenodd"/);
  const diagonal = orthographicSvg([[0,0,0],[1,1,0]]);
  assert.equal(([...diagonal.matchAll(/<path d="([^"]*)"/g)][2][1].match(/M/g) ?? []).length,2);
  const concave = orthographicSvg([[0,0,0],[1,0,0],[0,1,0]]);
  assert.equal(([...concave.matchAll(/<path d="([^"]*)"/g)][2][1].match(/L/g) ?? []).length,5);
});

test('L-shaped orthographic silhouettes align front/top columns and front/right rows at a common scale', () => {
  const views = orthographicViews([[0,0,0],[2,1,3]], [3,2,4]);
  const [front,right,top] = orthographicLayout(views);
  assert.equal(front.x, top.x);
  assert.equal(front.y, right.y);
  assert.equal(front.size, top.size);
  assert.equal(front.size, right.size);
  assert.ok(top.y + views[2].rows * top.size < front.y);
  assert.ok(front.x + views[0].cols * front.size < right.x);
});
