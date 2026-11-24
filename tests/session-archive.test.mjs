import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOperationalLog } from '../src/operational-log.mjs';
import { createSessionArchiveStore } from '../src/session-archive.mjs';

const SESSION_A = '123e4567-e89b-42d3-a456-426614174000';
const SESSION_B = '123e4567-e89b-42d3-a456-426614174001';
const zones = [{ id: 'P1', name: '上方玩家' }, { id: 'P2', name: '左側玩家 A' }];

function state(sessionId, startedAt, phase = 'lobby') {
  return {
    sessionId, sessionStartedAt: startedAt, updatedAt: startedAt, phase,
    sessionElapsedMs: 125_000, sessionExpired: phase === 'final_results',
    participantIds: ['P1', 'P2'],
    participants: {
      P1: { zoneId: 'P1', joinedAt: startedAt, totalHalfPoints: 4, roundsPlayed: 1 },
      P2: { zoneId: 'P2', joinedAt: startedAt, totalHalfPoints: 2, roundsPlayed: 1 }
    },
    results: [{
      roundId: 'round-1', gameId: 'zero_sum_grid', gameName: '數字方格', round: 1,
      reason: 'n_minus_one_correct', elapsedMs: 12_500, participantCount: 2,
      rows: [
        { zoneId: 'P1', rank: 1, pointsHalf: 4, score: 2, completed: true, elapsedMs: 12_000, mineHits: 0 },
        { zoneId: 'P2', rank: 2, pointsHalf: 2, score: 1, completed: true, elapsedMs: 12_500, mineHits: 0 }
      ],
      answer: { count: 7, blocks: [[0, 0]] }
    }]
  };
}

test('session archives preserve completed sessions and provide a spreadsheet-friendly CSV', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '704-session-archive-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createSessionArchiveStore({ dataDir, zones });

  const first = state(SESSION_A, '2026-11-18T08:00:00.000Z', 'round_results');
  first.rulesVersion = '1.0.0';
  Object.assign(first.results[0], {
    questionId: 'question-sha256-id', questionSeed: 305419896,
    rngAlgorithm: 'mulberry32-v1', generatorVersion: '1.0.0', rulesVersion: '1.0.0'
  });
  first.currentRound = {
    id: 'round-1', gameId: 'zero_sum_grid', round: 1,
    questionId: 'question-sha256-id', seed: 305419896,
    rngAlgorithm: 'mulberry32-v1', generatorVersion: '1.0.0', rulesVersion: '1.0.0',
    generatedAt: '2026-11-18T08:00:02.000Z', question: { cells: [1, -1], answers: [[0, 0]] }
  };
  store.save(first);
  first.phase = 'final_results';
  first.currentRound = null;
  first.updatedAt = '2026-11-18T08:10:00.000Z';
  store.save(first);
  store.save(state(SESSION_B, '2026-11-18T09:00:00.000Z'));

  const sessions = store.list();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, SESSION_B, 'newest sessions appear first');
  assert.equal(sessions[1].roundCount, 1);
  assert.equal(store.get(SESSION_A).participants[0].name, '上方玩家');
  assert.equal(store.get(SESSION_A).finalRankings[0].score, 2);
  assert.equal(store.get(SESSION_A).rulesVersion, '1.0.0');
  assert.deepEqual(store.get(SESSION_A).roundSnapshots[0].question, { cells: [1, -1], answers: [[0, 0]] });
  assert.equal(store.get(SESSION_A).roundSnapshots[0].questionId, 'question-sha256-id');
  assert.equal(store.get(SESSION_A).roundSnapshots[0].questionSeed, 305419896);
  assert.equal(store.get(SESSION_A).roundSnapshots[0].rngAlgorithm, 'mulberry32-v1');

  const csv = store.csv(SESSION_A);
  assert.ok(csv.startsWith('\uFEFFsession_id,started_at'));
  assert.match(csv, /數字方格/);
  assert.match(csv, /P1,上方玩家,1,2,1/);
  assert.match(csv, /P2,左側玩家 A,2,1,1/);
  assert.match(csv, /question-sha256-id,305419896,mulberry32-v1,1\.0\.0,1\.0\.0/);
});

test('session archive rejects path-like identifiers and reports missing sessions', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '704-session-archive-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createSessionArchiveStore({ dataDir });
  assert.equal(store.get('../session-state'), null);
  assert.equal(store.csv('../session-state'), null);
  assert.equal(store.list().length, 0);
});

test('operational log appends bounded JSONL records with a stable UTC date', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '704-operational-log-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const log = createOperationalLog({ dataDir, now: () => new Date('2026-11-18T08:30:00.000Z') });

  log.write({ type: 'player-input', action: 'confirm', sessionId: SESSION_A, details: { zoneId: 'P1', completed: true } });
  log.write({ level: 'error', type: 'touch-service', action: 'message-rejected', details: { message: 'invalid frame' } });

  const file = path.join(dataDir, 'logs', 'operations-2026-11-18.jsonl');
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.equal(records[0].sessionId, SESSION_A);
  assert.equal(records[1].level, 'error');
});
