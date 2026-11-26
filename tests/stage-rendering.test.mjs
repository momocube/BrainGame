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


import { orthographicViews, orthographicSignature, orthographicSvg } from '../public/solid-views.mjs';
test('orthographic views project front, right side and top with correct axes', () => {
  const cells = [[0,0,0],[1,0,0],[1,0,1],[1,1,1]];
  const views = orthographicViews(cells);
  assert.deepEqual(views.map(v => [v.label,v.cols,v.rows]), [['前',2,2],['側',2,2],['上',2,2]]);
  assert.deepEqual(views[0].cells, [[1,0],[0,1],[1,1]]);
  assert.deepEqual(views[1].cells, [[0,0],[1,0],[0,1]]);
  assert.deepEqual(views[2].cells, [[0,0],[1,0],[1,1]]);
  assert.equal(orthographicSignature(cells), orthographicSignature(cells.map(c => c.map(n => n+4))));
  const svg = orthographicSvg(cells, { bounds: [3,3,3], target: true });
  assert.equal((svg.match(/aria-label="[前側上]視圖"/g) ?? []).length, 3);
  assert.ok(!svg.includes('<polygon'));
});
