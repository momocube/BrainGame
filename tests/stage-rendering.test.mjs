import assert from 'node:assert/strict';
import test from 'node:test';
import { compareStageStateFreshness, stageStructureKey } from '../public/stage-rendering.mjs';

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

  assert.equal(stageStructureKey(initial), stageStructureKey(timerUpdate));

  const playerUpdate = structuredClone(timerUpdate);
  playerUpdate.playerViews.P1.entry = '42';
  assert.notEqual(stageStructureKey(initial), stageStructureKey(playerUpdate));

  const questionUpdate = structuredClone(timerUpdate);
  questionUpdate.currentRound.question.cells[0] = 9;
  assert.notEqual(stageStructureKey(initial), stageStructureKey(questionUpdate));
});

test('stage snapshot freshness rejects a late HTTP state after a newer server state', () => {
  const older = { phase: 'paused', updatedAt: '2026-11-24T05:00:00.000Z' };
  const newer = { phase: 'playing', updatedAt: '2026-11-24T05:00:02.000Z' };
  assert.equal(compareStageStateFreshness(newer, older), 1);
  assert.equal(compareStageStateFreshness(older, newer), -1);
  assert.equal(compareStageStateFreshness(newer, { updatedAt: newer.updatedAt }), 0);
});
