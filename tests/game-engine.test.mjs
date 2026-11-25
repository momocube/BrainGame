import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GameEngine, GAME_IDS, evaluateFiveCardHand, preflightGameQuestions } from '../src/game-engine.mjs';
import { cubeColumnsAreReadable } from '../src/cube-visibility.mjs';
import { createStageSnapshot } from '../src/stage-view.mjs';
import { handleMouseInput } from '../src/mouse-input.mjs';
import { EXIT_BUTTONS, EXIT_CONTROL_ZONE } from '../public/exit-control.mjs';
import { edgeEndpoints } from '../src/slitherlink.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8'));
const zones = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-zones.704.json'), 'utf8')),
  profilePlan: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-layouts.704.json'), 'utf8'))
};
const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));

function startReadySession(engine) {
  engine.setInputStatus(true, '測試 TouchService 已就緒');
  engine.startSession();
}

function createEngine(gameId, { participants = ['P1'], round = 1, seed } = {}) {
  const engine = new GameEngine({ rules, zones, onSave() {}, ...(seed === undefined ? {} : { seedFactory: () => seed }) });
  startReadySession(engine);
  for (const id of participants) engine.join(id);
  engine.selectGame(gameId);
  engine.confirmGameSelection();
  engine.state.gameRoundIndex = round - 1;
  engine.startAfterTutorial();
  advance(engine, 3_000);
  assert.equal(engine.state.phase, 'playing');
  return engine;
}

function advance(engine, milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0) {
    const step = Math.min(1_000, remaining);
    engine.tick(step);
    remaining -= step;
  }
}

test('a session cannot start until TouchService reports ready', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  assert.equal(engine.snapshot().input.ready, false);
  assert.throws(() => engine.startSession(), /TouchService 尚未就緒.*等待 TouchService/);
  assert.equal(engine.state.phase, 'idle');

  engine.setInputStatus(true, 'TouchService v1 / venue 704');
  engine.startSession();
  assert.equal(engine.state.phase, 'lobby');
});

function submitNumber(engine, zoneId, value) {
  for (const digit of String(value)) engine.act(zoneId, { key: digit });
  engine.act(zoneId, { key: 'confirm' });
}

function completeRoundWithCorrectAnswer(engine) {
  const round = engine.state.currentRound;
  const gameId = round.gameId;
  const player = round.players.P1;

  if (gameId === 'minesweeper') {
    engine.act('P1', { type: 'reveal', index: round.question.anchor });
    for (let index = 0; index < round.question.numbers.length; index++) {
      if (engine.state.phase === 'playing' && index !== round.question.anchor && round.question.numbers[index] >= 0) {
        engine.act('P1', { type: 'reveal', index });
      }
    }
  } else if (gameId === 'zero_sum_grid') {
    submitNumber(engine, 'P1', round.question.answers.length);
  } else if (gameId === 'cube_count') {
    submitNumber(engine, 'P1', round.question.total);
  } else if (gameId === 'solid_puzzle' || gameId === 'map_view') {
    engine.act('P1', { type: 'select', id: round.question.correctId });
    engine.act('P1', { type: 'confirm' });
  } else if (gameId === 'memory_poker') {
    advance(engine, (rules.games.memory_poker.communityRevealSeconds + rules.games.memory_poker.memorySeconds) * 1_000);
    engine.act('P1', { type: 'toggle_card', index: 0 });
    engine.act('P1', { type: 'toggle_card', index: 1 });
    advance(engine, (rules.games.memory_poker.selectionSeconds + rules.games.memory_poker.revealCountdownSeconds) * 1_000);
  } else if (gameId === 'memory_sequence') {
    advance(engine, round.question.memorySeconds * 1_000);
    for (let number = 1; number <= round.question.count; number++) {
      engine.act('P1', { index: player.values.indexOf(number) });
    }
  } else if (gameId === 'slitherlink') {
    for (const index of round.question.solution) engine.act('P1', { type: 'cycle_edge', index });
  }
}

function p1TouchEvent(id, phase, u, v, zoneId = 'P1', engine = null) {
  const zone = engine?.zoneById.get(zoneId) ?? zones.players.find((item) => item.id === zoneId);
  return zoneTouchEvent(id, phase, u, v, zone, zoneId);
}

function menuTouchEvent(id, phase, u, v, zoneId, engine) {
  const zone = engine.menuZones.find((item) => item.id === zoneId);
  return zoneTouchEvent(id, phase, u, v, zone, zoneId);
}

function zoneTouchEvent(id, phase, u, v, zone, zoneId) {
  assert.ok(zone, `${zoneId} has a configured touch area`);
  const sideways = zone.rotationDegrees === 90 || zone.rotationDegrees === 270;
  const width = sideways ? zone.rect.height : zone.rect.width;
  const height = sideways ? zone.rect.width : zone.rect.height;
  const screenUDesign = (u * 640 + (width - 640) / 2) / width;
  const screenVDesign = (v * 640 + (height - 640) / 2) / height;
  let screenU = screenUDesign, screenV = screenVDesign;
  if (zone.rotationDegrees === 90) { screenU = 1 - screenVDesign; screenV = screenUDesign; }
  else if (zone.rotationDegrees === 180) { screenU = 1 - screenUDesign; screenV = 1 - screenVDesign; }
  else if (zone.rotationDegrees === 270) { screenU = screenVDesign; screenV = 1 - screenUDesign; }
  const source = zone.sources.find((item) => {
    const start = item.uStart ?? 0, end = item.uEnd ?? 1;
    return screenU >= start && (screenU < end || (screenU === 1 && end === 1));
  });
  assert.ok(source, `${zoneId} has no source segment for screen position ${screenU}`);
  const sourceU = source.uStart == null ? screenU : (screenU - source.uStart) / (source.uEnd - source.uStart);
  const cadX = source.x + sourceU * source.width;
  const cadY = source.y + screenV * source.height;
  return { id, phase, face: source.face, px: [cadY, 3_328 - cadX] };
}

function floorTouchEvent(id, phase, u, v) {
  const { face, rect } = zones.profilePlan.floorRect;
  const cadX = rect.x + u * rect.width;
  const cadY = rect.y + v * rect.height;
  return { id, phase, face, px: [cadY, 3_328 - cadX] };
}

function touchFrame(events, alive) {
  return { v: 1, venue: '704', events, alive: alive.map(String) };
}

test('all seven game IDs are backed by the configured first round', () => {
  assert.deepEqual([...GAME_IDS].sort(), Object.keys(rules.games).sort());
  for (const gameId of GAME_IDS) {
    const engine = createEngine(gameId);
    assert.equal(engine.state.currentRound.gameId, gameId);
    assert.equal(engine.state.currentRound.round, 1);
    assert.ok(engine.state.currentRound.limitMs > 0);
  }
});

test('a round seed reproduces every game question and per-player variant', () => {
  const seed = 0x12345678;
  for (const gameId of GAME_IDS) {
    const options = { participants: ['P1', 'P2', 'P3'], seed };
    const first = createEngine(gameId, options).state.currentRound;
    const replay = createEngine(gameId, options).state.currentRound;

    assert.equal(first.seed, seed, `${gameId} records its seed`);
    assert.equal(first.rngAlgorithm, 'mulberry32-v1');
    assert.equal(first.generatorVersion, '1.0.2');
    assert.equal(first.rulesVersion, rules.rulesVersion);
    assert.equal(first.questionId, replay.questionId);
    assert.deepEqual(first.question, replay.question, `${gameId} question regenerates from its seed`);
    assert.deepEqual(first.players, replay.players, `${gameId} player-specific content regenerates from its seed`);

    const differentSeed = createEngine(gameId, { ...options, seed: seed + 1 }).state.currentRound;
    assert.notEqual(first.questionId, differentSeed.questionId, `${gameId} question IDs change with the seed`);
  }
});

test('memory sequence balances four mirror variants in join order without adjacent duplicates', () => {
  const participants = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
  const engine = createEngine('memory_sequence', { participants, seed: 0x2468ace0 });
  const { question, players } = engine.state.currentRound;
  const assigned = participants.map((id) => {
    const positions = players[id].values.map((value, index) => value ? [value, index] : null)
      .filter(Boolean).sort((a, b) => a[0] - b[0]).map(([, index]) => index);
    return question.variantPositions.findIndex((variant) => variant.join(',') === positions.join(','));
  });

  assert.ok(assigned.every((index) => index >= 0));
  assert.deepEqual(assigned.slice().sort(), [0, 0, 1, 1, 2, 2, 3, 3]);
  for (let index = 1; index < assigned.length; index++) {
    assert.notEqual(assigned[index], assigned[index - 1], `P${index} and P${index + 1} should use different variants`);
  }
});

test('solid puzzle uses a seeded per-player option order for both display and touch mapping', () => {
  const participants = ['P1', 'P2', 'P3', 'P4'];
  const engine = createEngine('solid_puzzle', { participants, seed: 0x13579bdf });
  const round = engine.state.currentRound;
  const choiceIds = round.question.choices.map(({ id }) => id);
  for (const id of participants) {
    const order = round.players[id].choiceOrder;
    assert.equal(order.length, rules.games.solid_puzzle.optionCount);
    assert.deepEqual(order.slice().sort(), choiceIds.slice().sort());
  }

  const player = round.players.P1;
  player.choiceOrder = [...choiceIds].reverse();
  const view = createStageSnapshot(engine, rules, zones);
  assert.deepEqual(view.playerViews.P1.choiceOrder, player.choiceOrder);

  const rect = rules.games.solid_puzzle.choiceGridRect;
  engine.coordinateAction('P1', (rect.x + rect.width / 4) / 640, (rect.y + rect.height / 6) / 640);
  assert.equal(player.selection, player.choiceOrder[0], 'the first visible option maps to its player-specific choice ID');
});

test('difficulty boundaries generate valid questions for every round band', () => {
  const samples = {
    minesweeper: [1, 2, 3, 4, 5],
    zero_sum_grid: Array.from({ length: 10 }, (_, index) => index + 1),
    cube_count: [1, 4, 8],
    solid_puzzle: [1, 7, 15],
    memory_poker: [1, 3, 5],
    map_view: [1, 7, 15],
    memory_sequence: Array.from({ length: 10 }, (_, index) => index + 1)
  };

  for (const [gameId, rounds] of Object.entries(samples)) {
    for (const round of rounds) {
      const engine = createEngine(gameId, { round });
      const question = engine.state.currentRound.question;
      assert.equal(engine.state.currentRound.round, round, `${gameId} round ${round}`);

      if (gameId === 'minesweeper') {
        assert.equal(question.mines.length, rules.games.minesweeper.minesByRound[round - 1]);
        assert.equal(question.numbers[question.anchor], 0);
        assert.equal(question.cols * question.rows, 48);
      } else if (gameId === 'zero_sum_grid') {
        assert.equal(question.cols, 5);
        assert.equal(question.rows, 5);
        assert.equal(question.cells.length, 25);
        const publicQuestion = createStageSnapshot(engine, rules, zones).currentRound.question;
        assert.equal(publicQuestion.cols, 5);
        assert.equal(publicQuestion.rows, 5);
        assert.ok(question.answers.length >= rules.games.zero_sum_grid.difficultyBands.find((band) => round >= band.firstRound && round <= band.lastRound).answerMin);
        assert.ok(question.answers.length <= rules.games.zero_sum_grid.difficultyBands.find((band) => round >= band.firstRound && round <= band.lastRound).answerMax);
        for (const [x, y] of question.answers) {
          const start = x + y * question.cols;
          assert.equal(question.cells[start] + question.cells[start + 1] + question.cells[start + question.cols] + question.cells[start + question.cols + 1], 0);
        }
      } else if (gameId === 'cube_count') {
        assert.equal(question.total, question.heights.reduce((sum, height) => sum + height, 0));
        assert.ok(question.total >= 1 && question.total <= rules.games.cube_count.numericInputMaximum);
        assert.equal(cubeColumnsAreReadable(
          question.heights, question.cols, question.rows,
          rules.games.cube_count.cameraAzimuthDegrees, rules.games.cube_count.cameraElevationDegrees
        ), true, `cube_count round ${round} keeps every occupied column readable`);
      } else if (gameId === 'solid_puzzle') {
        assert.equal(question.choices.length, rules.games.solid_puzzle.optionCount);
        assert.equal(new Set(question.choices.map((choice) => choice.cells.length)).size, 1);
        assert.equal(question.choices.filter((choice) => choice.correct).length, 1);
        assert.equal(question.choices.find((choice) => choice.id === question.correctId).correct, true);
      } else if (gameId === 'memory_poker') {
        const cards = [...question.cards, ...question.community];
        assert.equal(question.cards.length, 16);
        assert.equal(question.community.length, 3);
        assert.equal(new Set(cards.map((card) => card.label)).size, 19);
      } else if (gameId === 'map_view') {
        assert.equal(question.choices.length, rules.games.map_view.optionCount);
        assert.equal(question.choices.filter((choice) => choice.correct).length, 1);
        assert.equal(new Set(question.choices.map((choice) => choice.signature)).size, question.choices.length);
        assert.ok(question.firstPersonView.length >= rules.games.map_view.minimumDistinctVisibleClues);
      } else if (gameId === 'memory_sequence') {
        assert.equal(question.count, rules.games.memory_sequence.numberCountByRound[round - 1]);
        assert.equal(question.memorySeconds, rules.games.memory_sequence.memorySecondsByRound[round - 1]);
        assert.equal(question.variantPositions.length, 4);
        for (const variant of question.variantPositions) assert.equal(new Set(variant).size, question.count);
      }
    }
  }
});

test('3D cube generation rejects a short column hidden by taller surrounding columns', () => {
  const heights = Array.from({ length: 25 }, () => 6);
  heights[12] = 1;
  assert.equal(cubeColumnsAreReadable(heights, 5, 5, [45, 165, 285], 35), false);
  assert.equal(cubeColumnsAreReadable([1, 0, 0, 0], 2, 2, [45, 165, 285], 35), true);
});

test('3D cube generation finds readable models across difficulty bands and deterministic seeds', () => {
  for (const round of [1, 4, 8]) {
    for (let seed = 0; seed < 12; seed++) {
      const question = createEngine('cube_count', { round, seed }).state.currentRound.question;
      assert.equal(cubeColumnsAreReadable(
        question.heights, question.cols, question.rows,
        rules.games.cube_count.cameraAzimuthDegrees, rules.games.cube_count.cameraElevationDegrees
      ), true, `cube_count round ${round}, seed ${seed}`);
    }
  }
});

test('question preflight verifies every configured round without returning answer data', () => {
  let seed = 0x31415926;
  const report = preflightGameQuestions(rules, { seedFactory: () => seed++ >>> 0 });
  const failures = report.games.flatMap((game) => game.failures.map((failure) => ({ gameId: game.gameId, ...failure })));
  assert.equal(report.passed, true, JSON.stringify(failures));
  assert.equal(report.gameCount, 8);
  assert.equal(report.totalRounds, 83);
  assert.equal(report.checkedRounds, 83);
  assert.equal(report.failedRounds, 0);
  assert.deepEqual(report.games.map((game) => game.checkedRounds), [5, 10, 10, 20, 5, 20, 10, 3]);

  const privateKeys = new Set(['question', 'answer', 'seed', 'correctId', 'solution']);
  const foundPrivateKeys = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (privateKeys.has(key)) foundPrivateKeys.push(key);
      visit(child);
    }
  };
  visit(report);
  assert.deepEqual(foundPrivateKeys, []);
});

test('a player zone can join only in the lobby and is recorded once', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.join('P1');
  engine.join('P1');
  assert.deepEqual(engine.state.participantIds, ['P1']);
  engine.selectGame('zero_sum_grid');
  assert.throws(() => engine.join('P2'), /只能在大廳加入/);
});

test('player layouts follow the participant count while join-order IDs and scores stay stable', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  assert.equal(engine.layout.profileCount, 4, 'one to four players use the four-player template');
  assert.equal(engine.zones.length, 4);
  assert.equal(engine.layout.questionPanels.length, 4);

  for (let count = 1; count <= 8; count++) {
    const zoneId = `P${count}`;
    engine.join(zoneId);
    if (count === 2) engine.state.participants.P1.totalHalfPoints = 13;
    assert.deepEqual(engine.state.participantIds, Array.from({ length: count }, (_, index) => `P${index + 1}`));
    assert.equal(engine.layout.profileCount, Math.max(4, count));
    assert.equal(engine.zones.length, Math.max(4, count));
    assert.equal(engine.layout.questionPanels.length, count <= 4 ? 4 : 0);
    if (count === 5) assert.equal(engine.state.participants.P1.totalHalfPoints, 13, 'changing the template keeps existing scores');
  }
  assert.equal(engine.layout.questionDisplayMode, 'floor');
  assert.equal(engine.snapshot().layout.profileCount, 8);
});

test('joining from any active lobby zone assigns the next player ID by arrival order', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  assert.equal(engine.joinFromZone('P3'), 'P1');
  engine.join('P2');
  assert.equal(engine.joinFromZone('P4'), 'P3');
  assert.deepEqual(engine.state.participantIds, ['P1', 'P2', 'P3']);
});

test('staff closes final results to standby before starting the next session', () => {
  const savedStates = [];
  const engine = new GameEngine({ rules, zones, onSave: (state) => savedStates.push(structuredClone(state)) });
  startReadySession(engine);
  const endedSessionId = engine.state.sessionId;
  engine.join('P1');
  engine.endSession();

  assert.equal(engine.state.phase, 'final_results');
  assert.equal(engine.state.sessionId, endedSessionId);
  assert.throws(() => engine.startSession(), /返回待機/);

  engine.returnToStandby();
  assert.equal(engine.state.phase, 'idle');
  assert.equal(engine.state.sessionId, null);
  assert.deepEqual(engine.state.participantIds, []);
  assert.equal(savedStates.at(-2).phase, 'final_results');
  assert.equal(savedStates.at(-1).sessionId, null);

  startReadySession(engine);
  assert.equal(engine.state.phase, 'lobby');
  assert.notEqual(engine.state.sessionId, endedSessionId);
});

test('restart keeps the last settled round and replays only the interrupted round', () => {
  let nextSeed = 1;
  let persistedState = null;
  const save = (state) => { persistedState = structuredClone(state); };
  const firstProcess = new GameEngine({ rules, zones, seedFactory: () => nextSeed++, onSave: save });
  startReadySession(firstProcess);
  firstProcess.join('P1');
  firstProcess.selectGame('zero_sum_grid');
  firstProcess.confirmGameSelection();
  firstProcess.startAfterTutorial();
  advance(firstProcess, rules.common.countdownSeconds * 1_000);
  completeRoundWithCorrectAnswer(firstProcess);

  assert.equal(firstProcess.state.phase, 'round_results');
  assert.equal(firstProcess.state.results.length, 1);
  const sessionId = firstProcess.state.sessionId;
  const settledResult = structuredClone(firstProcess.state.results[0]);
  const scoreAfterSettledRound = firstProcess.state.participants.P1.totalHalfPoints;

  const restartedForResults = new GameEngine({ rules, zones, initialState: persistedState, onSave: save });
  assert.equal(restartedForResults.state.phase, 'round_results', 'a crash during results keeps the completed result visible');
  assert.deepEqual(restartedForResults.state.results[0], settledResult);
  advance(restartedForResults, rules.common.roundResultsSeconds * 1_000);
  assert.equal(restartedForResults.state.phase, 'countdown');
  assert.equal(restartedForResults.state.currentRound.round, 2);
  const interruptedQuestionId = restartedForResults.state.currentRound.questionId;

  const changedRules = structuredClone(rules);
  changedRules.games.zero_sum_grid.playSeconds = 90;
  const recovered = new GameEngine({
    rules: changedRules, zones, initialState: persistedState,
    seedFactory: () => 0xabcdef01, onSave() {}
  });
  assert.equal(recovered.state.sessionId, sessionId);
  assert.equal(recovered.state.phase, 'tutorial');
  assert.equal(recovered.state.selectedGame, 'zero_sum_grid');
  assert.equal(recovered.state.gameRoundIndex, 1, 'the unfinished second round is retried rather than skipped or restarting the set');
  assert.equal(recovered.state.currentRound, null);
  assert.deepEqual(recovered.state.results, [settledResult]);
  assert.equal(recovered.state.participants.P1.totalHalfPoints, scoreAfterSettledRound);
  assert.equal(recovered.state.participants.P1.roundsPlayed, 1);
  assert.equal(recovered.state.notice, '程式重新啟動；未完成第 2 輪已作廢，將重新開始該輪。');

  recovered.startAfterTutorial();
  advance(recovered, rules.common.countdownSeconds * 1_000);
  assert.equal(recovered.state.phase, 'playing');
  assert.equal(recovered.state.currentRound.round, 2);
  assert.equal(recovered.rules.games.zero_sum_grid.playSeconds, rules.games.zero_sum_grid.playSeconds,
    'an active session resumes with the rules snapshot saved when it started');
  assert.equal(recovered.state.currentRound.limitMs, rules.games.zero_sum_grid.playSeconds * 1_000);
  assert.notEqual(recovered.state.currentRound.questionId, interruptedQuestionId, 'the discarded attempt receives a fresh question');

  recovered.endSession();
  recovered.returnToStandby();
  assert.equal(recovered.rules.games.zero_sum_grid.playSeconds, 90,
    'the next session uses the latest configured rules after returning to standby');
  assert.equal(recovered.state.rulesSnapshot.games.zero_sum_grid.playSeconds, 90);
});

test('restart moves an active session to final results when its saved rules are invalid', () => {
  const active = createEngine('zero_sum_grid');
  active.state.participants.P1.totalHalfPoints = 8;
  const invalidState = structuredClone(active.state);
  delete invalidState.rulesSnapshot.games.memory_sequence;

  const recovered = new GameEngine({ rules, zones, initialState: invalidState, onSave() {} });
  assert.equal(recovered.state.phase, 'final_results');
  assert.equal(recovered.state.currentRound, null);
  assert.equal(recovered.state.participants.P1.totalHalfPoints, 8);
  assert.match(recovered.state.notice, /保存的場次規則無法通過目前版本驗證/);
});

test('restart after session expiry ends the session instead of replaying an unfinished round', () => {
  const engine = createEngine('zero_sum_grid');
  const expiredState = structuredClone(engine.state);
  expiredState.sessionExpired = true;
  expiredState.sessionElapsedMs = rules.common.sessionDurationSeconds * 1_000;

  const recovered = new GameEngine({ rules, zones, initialState: expiredState, onSave() {} });
  assert.equal(recovered.state.phase, 'final_results');
  assert.equal(recovered.state.sessionExpired, true);
  assert.equal(recovered.state.selectedGame, null);
  assert.equal(recovered.state.gameRoundIndex, 0);
  assert.equal(recovered.state.currentRound, null);
  assert.match(recovered.state.notice, /場次時間已到/);
});

test('minesweeper requires the safe anchor and charges each revealed mine once', () => {
  const engine = createEngine('minesweeper');
  const player = engine.state.currentRound.players.P1;
  const question = engine.state.currentRound.question;
  const safeNonAnchor = question.numbers.findIndex((value, index) => value >= 0 && index !== question.anchor);

  engine.act('P1', { type: 'toggle_mode' });
  assert.equal(player.mode, 'reveal', 'the opening must remain in reveal mode until the safe anchor is opened');
  engine.act('P1', { type: 'reveal', index: safeNonAnchor });
  assert.equal(player.safeProgress, 0);
  assert.deepEqual(player.flags, []);
  engine.act('P1', { type: 'reveal', index: question.anchor });
  assert.ok(player.safeProgress > 0);

  player.mode = 'reveal';
  const mineIndex = question.mines[0];
  engine.act('P1', { type: 'reveal', index: mineIndex });
  engine.act('P1', { type: 'reveal', index: mineIndex });
  assert.deepEqual(player.hits, [mineIndex]);
  assert.equal(player.penaltyMs, rules.games.minesweeper.penaltySecondsPerDistinctMine * 1_000);
});

test('numeric answers reject out-of-range values without counting a wrong submission', () => {
  const engine = createEngine('cube_count');
  const player = engine.state.currentRound.players.P1;
  engine.act('P1', { key: '0' });
  engine.act('P1', { key: 'confirm' });

  assert.equal(player.submissions, 0);
  assert.equal(player.wrongUntilMs, 0);
  assert.equal(player.lastError, '答案需介於 1–150');
});

test('round deadline accepts an answer one millisecond before expiry but rejects it at expiry', () => {
  const before = createEngine('zero_sum_grid');
  const beforePlayer = before.state.currentRound.players.P1;
  const answer = String(before.state.currentRound.question.answers.length);
  const deadline = before.state.currentRound.limitMs;
  for (const key of answer) before.act('P1', { key }, deadline - 1);
  before.act('P1', { key: 'confirm' }, deadline - 1);
  assert.equal(beforePlayer.doneAtMs, deadline - 1);

  const at = createEngine('zero_sum_grid');
  const atPlayer = at.state.currentRound.players.P1;
  const atAnswer = String(at.state.currentRound.question.answers.length);
  for (const key of atAnswer) at.act('P1', { key }, at.state.currentRound.limitMs);
  at.act('P1', { key: 'confirm' }, at.state.currentRound.limitMs);
  assert.equal(atPlayer.doneAtMs, null);
  assert.equal(atPlayer.submissions, 0);
  assert.equal(atPlayer.entry, '');
});

test('engine clock preserves real delays longer than one second', () => {
  const engine = createEngine('zero_sum_grid');
  engine.tick(1_500);
  assert.equal(engine.state.currentRound.elapsedMs, 1_500);
});

test('wrong numeric answers clear input and apply only the configured player lock', () => {
  const engine = createEngine('zero_sum_grid', { participants: ['P1', 'P2'] });
  const player = engine.state.currentRound.players.P1;
  const correct = engine.state.currentRound.question.answers.length;
  const wrong = (correct + 1) % 64;
  submitNumber(engine, 'P1', wrong);
  assert.equal(player.entry, '');
  assert.equal(player.submissions, 1);
  assert.equal(player.wrongUntilMs, 15_000);

  engine.act('P1', { key: '1' });
  assert.equal(player.entry, '');
  assert.equal(engine.state.currentRound.players.P2.wrongUntilMs, 0);
});

test('round points average occupied ranks and leave unranked players at zero', () => {
  for (const count of [4, 5, 6, 7, 8]) {
    const participants = zones.players.slice(0, count).map((zone) => zone.id);
    const engine = createEngine('zero_sum_grid', { participants });
    const players = engine.state.currentRound.players;
    players.P1.doneAtMs = 1_000;
    players.P2.doneAtMs = 2_000;
    players.P3.doneAtMs = 2_000;
    for (let index = 3; index < count - 1; index++) {
      players[participants[index]].doneAtMs = 3_000 + index;
    }
    engine.finishRound('test');
    const rows = Object.fromEntries(engine.state.results[0].rows.map((row) => [row.zoneId, row]));

    assert.equal(rows.P1.rank, 1, `${count} players: first rank`);
    assert.equal(rows.P1.score, count - 1, `${count} players: N−r score`);
    assert.equal(rows.P2.rank, 2, `${count} players: first tied rank`);
    assert.equal(rows.P3.rank, 2, `${count} players: second tied rank`);
    assert.equal(rows.P2.score, count - 2.5, `${count} players: mean of occupied ranks`);
    assert.equal(rows.P3.score, count - 2.5, `${count} players: mean of occupied ranks`);
    for (let index = 3; index < count - 1; index++) {
      const row = rows[participants[index]];
      assert.equal(row.rank, index + 1, `${count} players: rank after tie`);
      assert.equal(row.score, count - index - 1, `${count} players: rank after tie score`);
    }
    const incomplete = rows[participants[count - 1]];
    assert.equal(incomplete.rank, null, `${count} players: incomplete rank`);
    assert.equal(incomplete.score, 0, `${count} players: incomplete score`);
  }
});

test('re-settling a completed round cannot duplicate results or award points twice', () => {
  const engine = createEngine('zero_sum_grid', { participants: ['P1', 'P2'] });
  submitNumber(engine, 'P1', engine.state.currentRound.question.answers.length);
  assert.equal(engine.state.phase, 'round_results');

  const resultBefore = structuredClone(engine.state.results[0]);
  const participantBefore = structuredClone(engine.state.participants.P1);
  const resultCountBefore = engine.state.results.length;
  engine.finishRound('duplicate_delivery');
  engine.checkRoundCompletion();

  assert.equal(engine.state.results.length, resultCountBefore);
  assert.deepEqual(engine.state.results[0], resultBefore);
  assert.equal(engine.state.participants.P1.totalHalfPoints, participantBefore.totalHalfPoints);
  assert.equal(engine.state.participants.P1.roundsPlayed, participantBefore.roundsPlayed);
});

test('eight same-frame correct submissions are all accepted before the round settles', () => {
  const participants = zones.players.map((zone) => zone.id);
  const engine = createEngine('zero_sum_grid', { participants });
  const answer = String(engine.state.currentRound.question.answers.length);
  const keypad = rules.common.layout;
  const keys = keypad.numericKeypadKeys;
  let id = 100;

  const tapForEveryone = (key) => {
    const index = keys.indexOf(key);
    const rect = keypad.numericKeypadRect ?? keypad.interactiveRect;
    const col = index % keypad.numericKeypadColumns, row = Math.floor(index / keypad.numericKeypadColumns);
    const u = (rect.x + (col + 0.5) * rect.width / keypad.numericKeypadColumns) / 640;
    const v = (rect.y + (row + 0.5) * rect.height / keypad.numericKeypadRows) / 640;
    const contacts = participants.map((zoneId) => p1TouchEvent(id++, 'down', u, v, zoneId, engine));
    engine.handleTouchFrame(touchFrame(contacts, contacts.map((event) => event.id)));
    engine.handleTouchFrame(touchFrame(contacts.map((event) => ({ ...event, phase: 'up' })), []));
  };

  for (const digit of answer) tapForEveryone(digit);
  tapForEveryone('confirm');

  assert.equal(engine.state.phase, 'round_results', JSON.stringify({ answer, players: Object.fromEntries(Object.entries(engine.state.currentRound.players).map(([zoneId, player]) => [zoneId, { entry: player.entry, submissions: player.submissions, doneAtMs: player.doneAtMs }])) }));
  const result = engine.state.results[0];
  assert.equal(result.rows.length, 8);
  assert.ok(result.rows.every((row) => row.completed));
  assert.ok(result.rows.every((row) => row.rank === 1));
  assert.ok(result.rows.every((row) => row.score === 3.5));
});

test('memory poker keeps memory and selection phases separate and locks two-card choices', () => {
  const engine = createEngine('memory_poker', { participants: ['P1', 'P2'] });
  const player = engine.state.currentRound.players.P1;
  engine.act('P1', { type: 'toggle_card', index: 0 });
  assert.deepEqual(player.selected, []);

  advance(engine, (rules.games.memory_poker.communityRevealSeconds + rules.games.memory_poker.memorySeconds) * 1_000);
  engine.act('P1', { type: 'toggle_card', index: 0 });
  engine.act('P1', { type: 'toggle_card', index: 1 });
  engine.act('P1', { type: 'toggle_card', index: 2 });
  assert.deepEqual(player.selected, [0, 1]);
  engine.act('P1', { type: 'confirm' });
  engine.act('P1', { type: 'toggle_card', index: 0 });
  assert.equal(player.locked, true);
  assert.deepEqual(player.selected, [0, 1]);

  advance(engine, rules.games.memory_poker.selectionSeconds * 1_000 + rules.games.memory_poker.revealCountdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'round_results');
  assert.equal(player.hand.labels.length, 5);
});

test('memory poker settles equivalent hands as ties and gives incomplete selections zero points', () => {
  const participants = ['P1', 'P2', 'P3', 'P4'];
  const engine = createEngine('memory_poker', { participants });
  const question = engine.state.currentRound.question;
  const card = (rank, suit) => ({ rank, suit, label: `${rank}${suit}` });
  const community = [card(2, 'clubs'), card(3, 'diamonds'), card(4, 'hearts')];
  const selectedCards = [
    card(14, 'spades'), card(5, 'clubs'),
    card(8, 'spades'), card(8, 'diamonds'),
    card(14, 'diamonds'), card(5, 'hearts'),
    card(7, 'clubs')
  ];
  const usedLabels = new Set([...community, ...selectedCards].map(({ label }) => label));
  const fillers = Array.from({ length: 52 }, (_, index) => card(Math.floor(index / 4) + 2, ['clubs', 'diamonds', 'hearts', 'spades'][index % 4]))
    .filter(({ label }) => !usedLabels.has(label));
  question.cards = [...selectedCards, ...fillers].slice(0, rules.games.memory_poker.memoryCards);
  question.community = community;

  advance(engine, (rules.games.memory_poker.communityRevealSeconds + rules.games.memory_poker.memorySeconds) * 1_000);
  for (const index of [0, 1]) engine.act('P1', { type: 'toggle_card', index });
  for (const index of [2, 3]) engine.act('P2', { type: 'toggle_card', index });
  for (const index of [4, 5]) engine.act('P3', { type: 'toggle_card', index });
  engine.act('P4', { type: 'toggle_card', index: 6 });
  for (const id of ['P1', 'P2', 'P3']) engine.act(id, { type: 'confirm' });

  advance(engine, (rules.games.memory_poker.selectionSeconds + rules.games.memory_poker.revealCountdownSeconds) * 1_000);
  const rows = Object.fromEntries(engine.state.results[0].rows.map((row) => [row.zoneId, row]));

  assert.equal(engine.state.phase, 'round_results');
  assert.equal(rows.P1.pokerHand.name, '順子');
  assert.equal(rows.P3.pokerHand.name, '順子');
  assert.equal(rows.P1.rank, 1);
  assert.equal(rows.P3.rank, 1);
  assert.equal(rows.P1.score, 2.5);
  assert.equal(rows.P3.score, 2.5);
  assert.equal(rows.P2.pokerHand.name, '一對');
  assert.equal(rows.P2.rank, 3);
  assert.equal(rows.P2.score, 1);
  assert.equal(rows.P4.completed, false);
  assert.equal(rows.P4.rank, null);
  assert.equal(rows.P4.score, 0);
});

test('all seven game sets run every configured round and return to the lobby', () => {
  for (const gameId of GAME_IDS) {
    const engine = new GameEngine({ rules, zones, onSave() {} });
    startReadySession(engine);
    engine.join('P1');
    engine.selectGame(gameId);
    engine.confirmGameSelection();
    engine.startAfterTutorial();

    for (let roundNumber = 1; roundNumber <= rules.games[gameId].rounds; roundNumber++) {
      advance(engine, rules.common.countdownSeconds * 1_000);
      const round = engine.state.currentRound;
      assert.equal(engine.state.phase, 'playing', `${gameId} round ${roundNumber} begins after countdown`);
      assert.equal(round.round, roundNumber, `${gameId} round order is sequential`);
      completeRoundWithCorrectAnswer(engine);

      assert.equal(engine.state.phase, 'round_results', `${gameId} round ${roundNumber} settles after a correct round`);
      const result = engine.state.results[0];
      assert.equal(result.round, roundNumber, `${gameId} round ${roundNumber} records the right result`);
      assert.equal(result.roundId, round.id, `${gameId} round ${roundNumber} records the same round ID`);
      assert.equal(result.questionId, round.questionId, `${gameId} round ${roundNumber} preserves the question ID`);
      assert.equal(result.questionSeed, round.seed, `${gameId} round ${roundNumber} preserves the seed`);
      assert.equal(result.rngAlgorithm, round.rngAlgorithm, `${gameId} round ${roundNumber} preserves the RNG version`);
      assert.equal(result.generatorVersion, round.generatorVersion, `${gameId} round ${roundNumber} preserves the generator version`);
      assert.equal(result.rows[0].completed, true, `${gameId} round ${roundNumber} marks the answer complete`);
      assert.equal(result.rows[0].score, 0, `${gameId} round ${roundNumber} uses the single-player score rule`);
      advance(engine, rules.common.roundResultsSeconds * 1_000);
    }
    assert.equal(engine.state.phase, 'lobby', `${gameId} returns to lobby after its last round`);
    assert.equal(engine.state.results.length, rules.games[gameId].rounds, `${gameId} records every configured round exactly once`);
    assert.equal(engine.state.participants.P1.roundsPlayed, rules.games[gameId].rounds);
  }
});

test('all seven games accept correct inputs from every TouchService player zone', () => {
  const zoneIds = zones.players.map((zone) => zone.id);
  let nextTouchId = 10_000;
  const pointAt = (rect, col, row, columns, rows) => ({
    u: (rect.x + (col + 0.5) * rect.width / columns) / 640,
    v: (rect.y + (row + 0.5) * rect.height / rows) / 640
  });
  const tapBatch = (engine, pointsByZone) => {
    const events = pointsByZone.map(({ zoneId, u, v }) => p1TouchEvent(nextTouchId++, 'down', u, v, zoneId, engine));
    engine.handleTouchFrame(touchFrame(events, events.map((event) => event.id)));
    const releases = events.map((event) => ({ ...event, phase: 'up' }));
    engine.handleTouchFrame(touchFrame(releases, []));
  };
  const tapSharedPoint = (engine, rect, col, row, columns, rows) => {
    const point = pointAt(rect, col, row, columns, rows);
    tapBatch(engine, zoneIds.map((zoneId) => ({ zoneId, ...point })));
  };
  const tapNumericKey = (engine, key) => {
    const layout = rules.common.layout;
    const index = layout.numericKeypadKeys.indexOf(key);
    assert.notEqual(index, -1, `numeric keypad includes ${key}`);
    tapSharedPoint(engine, layout.numericKeypadRect ?? layout.interactiveRect, index % layout.numericKeypadColumns,
      Math.floor(index / layout.numericKeypadColumns), layout.numericKeypadColumns, layout.numericKeypadRows);
  };

  for (const gameId of GAME_IDS) {
    const engine = createEngine(gameId, { participants: zoneIds });
    const round = engine.state.currentRound;
    if (gameId === 'minesweeper') {
      const board = rules.games.minesweeper.boardRect;
      const col = round.question.anchor % round.question.cols;
      const row = Math.floor(round.question.anchor / round.question.cols);
      tapSharedPoint(engine, board, col, row, round.question.cols, round.question.rows);
      for (const zoneId of zoneIds) assert.ok(round.players[zoneId].revealed.includes(round.question.anchor), zoneId);
      continue;
    }
    if (gameId === 'zero_sum_grid' || gameId === 'cube_count') {
      const answer = gameId === 'zero_sum_grid' ? round.question.answers.length : round.question.total;
      for (const digit of String(answer)) tapNumericKey(engine, digit);
      tapNumericKey(engine, 'confirm');
    } else if (gameId === 'solid_puzzle' || gameId === 'map_view') {
      const config = rules.games[gameId];
      const columns = config.choiceGridColumns ?? 2, rows = config.choiceGridRows ?? 3;
      tapBatch(engine, zoneIds.map((zoneId) => {
        const order = gameId === 'solid_puzzle' ? round.players[zoneId].choiceOrder
          : round.question.choices.map(({ id }) => id);
        const choiceIndex = order.indexOf(round.question.correctId);
        const point = pointAt(config.choiceGridRect, choiceIndex % columns,
          Math.floor(choiceIndex / columns), columns, rows);
        return { zoneId, ...point };
      }));
      tapSharedPoint(engine, rules.games[gameId].confirmRect, 0, 0, 1, 1);
    } else if (gameId === 'memory_poker') {
      const config = rules.games.memory_poker;
      advance(engine, (config.communityRevealSeconds + config.memorySeconds) * 1_000);
      for (const cardIndex of [0, 1]) tapSharedPoint(engine, config.cardGridRect,
        cardIndex % config.memoryGridColumns, Math.floor(cardIndex / config.memoryGridColumns),
        config.memoryGridColumns, config.memoryGridRows);
      tapSharedPoint(engine, config.confirmRect, 0, 0, 1, 1);
      advance(engine, (config.selectionSeconds + config.revealCountdownSeconds) * 1_000);
    } else if (gameId === 'memory_sequence') {
      advance(engine, round.question.memorySeconds * 1_000);
      for (const number of Array.from({ length: round.question.count }, (_, index) => index + 1)) {
        const points = zoneIds.map((zoneId) => {
          const player = round.players[zoneId];
          const index = player.values.indexOf(number);
          return { zoneId, ...pointAt(rules.common.layout.interactiveRect,
            index % round.question.cols, Math.floor(index / round.question.cols),
            round.question.cols, round.question.rows) };
        });
        tapBatch(engine, points);
      }
    } else if (gameId === 'slitherlink') {
      const { boardRect: rect, boardColumns: cols, boardRows: rows } = rules.games.slitherlink;
      for (const edge of round.question.solution) {
        const [[x1, y1], [x2, y2]] = edgeEndpoints(edge, cols, rows);
        const u = (rect.x + (x1 + x2) / 2 * rect.width / cols) / 640;
        const v = (rect.y + (y1 + y2) / 2 * rect.height / rows) / 640;
        tapBatch(engine, zoneIds.map((zoneId) => ({ zoneId, u, v })));
      }
    }

    assert.equal(engine.state.phase, 'round_results', `${gameId} settles after all eight zones answer`);
    assert.ok(engine.state.results[0].rows.every((row) => row.completed), `${gameId} records every zone as complete`);
  }
});

test('game engine reports normalized player inputs to the audit hook without raw coordinates', () => {
  const inputs = [];
  const engine = new GameEngine({ rules, zones, onSave() {}, onInput: (input) => inputs.push(input) });
  startReadySession(engine);
  engine.join('P1');
  engine.selectGame('zero_sum_grid');
  engine.confirmGameSelection();
  engine.startAfterTutorial();
  advance(engine, 3_000);
  engine.act('P1', { key: '4' });

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].sessionId, engine.state.sessionId);
  assert.equal(inputs[0].zoneId, 'P1');
  assert.equal(inputs[0].gameId, 'zero_sum_grid');
  assert.deepEqual(inputs[0].action, { key: '4' });
  assert.equal(Object.hasOwn(inputs[0], 'px'), false);
});

test('Texas-style five-card evaluation handles ace-low straights and ignores suits in ties', () => {
  const card = (rank, suit = '♣') => ({ rank, suit, label: `${rank}${suit}` });
  const wheel = [card(14, '♣'), card(2, '♦'), card(3, '♥'), card(4, '♠'), card(5, '♣')];
  const sixHigh = [card(2, '♦'), card(3, '♥'), card(4, '♠'), card(5, '♦'), card(6, '♥')];
  assert.deepEqual(evaluateFiveCardHand(wheel).key, [4, 5]);
  assert.ok(evaluateFiveCardHand(sixHigh).key[1] > evaluateFiveCardHand(wheel).key[1]);

  const samePairA = [card(14, '♣'), card(14, '♦'), card(13, '♣'), card(12, '♥'), card(2, '♣')];
  const samePairB = [card(14, '♥'), card(14, '♠'), card(13, '♠'), card(12, '♦'), card(2, '♥')];
  assert.deepEqual(evaluateFiveCardHand(samePairA).key, evaluateFiveCardHand(samePairB).key);
});

test('Texas five-card evaluator matches the exact category frequencies of all 52-card hands', () => {
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const deck = Array.from({ length: 52 }, (_, index) => ({
    rank: Math.floor(index / suits.length) + 2,
    suit: suits[index % suits.length]
  }));
  const categoryCounts = Array(9).fill(0);

  for (let a = 0; a < 48; a++) {
    for (let b = a + 1; b < 49; b++) {
      for (let c = b + 1; c < 50; c++) {
        for (let d = c + 1; d < 51; d++) {
          for (let e = d + 1; e < 52; e++) {
            const hand = [deck[a], deck[b], deck[c], deck[d], deck[e]];
            categoryCounts[evaluateFiveCardHand(hand).category]++;
          }
        }
      }
    }
  }

  assert.deepEqual(categoryCounts, [
    1_302_540, // high card
    1_098_240, // one pair
    123_552,   // two pair
    54_912,    // three of a kind
    10_200,    // straight, excluding straight flush
    5_108,     // flush, excluding straight flush
    3_744,     // full house
    624,       // four of a kind
    40         // straight flush, including royal flushes
  ]);
});

test('Texas hand comparison keys use kickers for trips and two pair', () => {
  const hand = (ranks) => ranks.map((rank, index) => ({
    rank,
    suit: ['clubs', 'diamonds', 'hearts', 'spades', 'clubs'][index]
  }));

  assert.deepEqual(evaluateFiveCardHand(hand([13, 13, 13, 14, 10])).key, [3, 13, 14, 10]);
  assert.deepEqual(evaluateFiveCardHand(hand([13, 13, 13, 14, 9])).key, [3, 13, 14, 9]);
  assert.deepEqual(evaluateFiveCardHand(hand([10, 10, 8, 8, 14])).key, [2, 10, 8, 14]);
  assert.deepEqual(evaluateFiveCardHand(hand([10, 10, 8, 8, 12])).key, [2, 10, 8, 12]);
});

test('memory sequence ignores every black empty cell without changing hearts or progress', () => {
  const engine = createEngine('memory_sequence', { participants: ['P1', 'P2'] });
  const round = engine.state.currentRound;
  advance(engine, round.question.memorySeconds * 1_000);
  for (const id of ['P1', 'P2']) {
    const player = round.players[id];
    const first = player.values.indexOf(1);
    for (const progress of [0, 1]) {
      if (progress) engine.act(id, { index: first });
      const before = structuredClone(player);
      for (let repeat = 0; repeat < 4; repeat++) player.values.forEach((value, index) => {
        if (value === 0) engine.act(id, { index });
      });
      assert.deepEqual(player, before, 'black cells must not consume hearts, reset progress, or trigger feedback');
    }
    engine.act(id, { index: player.values.indexOf(3) });
    assert.equal(player.hearts, rules.games.memory_sequence.heartsPerRound - 1);
    assert.equal(player.progress, 0);
    assert.equal(player.bestProgress, 1);
    assert.equal(player.wrongCount, 1);
    for (let value = 1; value <= round.question.count; value++) engine.act(id, { index: player.values.indexOf(value) });
    assert.notEqual(player.doneAtMs, null);
  }
});

test('memory sequence resets immediately on error but retains best progress', () => {
  const engine = createEngine('memory_sequence');
  const player = engine.state.currentRound.players.P1;
  const values = player.values;
  const first = values.indexOf(1), second = values.indexOf(2), wrong = values.indexOf(1);
  advance(engine, engine.state.currentRound.question.memorySeconds * 1_000);

  engine.act('P1', { index: first });
  engine.act('P1', { index: second });
  assert.equal(player.progress, 2);
  engine.act('P1', { index: wrong });
  assert.equal(player.hearts, 2);
  assert.equal(player.progress, 0);
  assert.equal(player.bestProgress, 2);

  engine.act('P1', { index: first });
  assert.equal(player.progress, 1);
  assert.equal(player.hearts, 2);
});

test('memory sequence exposes a changing wrong-press count for immediate visual feedback', () => {
  const engine = createEngine('memory_sequence');
  const player = engine.state.currentRound.players.P1;
  const wrong = player.values.indexOf(2);
  advance(engine, engine.state.currentRound.question.memorySeconds * 1_000);

  assert.equal(createStageSnapshot(engine, rules, zones).playerViews.P1.sequence.wrongCount, 0);
  engine.act('P1', { index: wrong });
  assert.equal(createStageSnapshot(engine, rules, zones).playerViews.P1.sequence.wrongCount, 1);
  engine.act('P1', { index: wrong });
  assert.equal(createStageSnapshot(engine, rules, zones).playerViews.P1.sequence.wrongCount, 2,
    'consecutive mistakes each change the stage structure so the red flash can replay');
});

test('pausing freezes the session and round clocks through the resume countdown', () => {
  const engine = createEngine('zero_sum_grid');
  advance(engine, 4_000);
  const sessionBefore = engine.state.sessionElapsedMs;
  const roundBefore = engine.state.currentRound.elapsedMs;
  engine.pause();
  assert.equal(engine.state.pauseInfo?.source, 'staff');
  assert.equal(engine.state.pauseInfo?.reason, '工作人員暫停');
  assert.equal(engine.state.notice, '工作人員暫停');
  advance(engine, 30_000);
  assert.equal(engine.state.sessionElapsedMs, sessionBefore);
  assert.equal(engine.state.currentRound.elapsedMs, roundBefore);

  engine.resume();
  advance(engine, rules.common.resumeCountdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'playing');
  assert.equal(engine.state.sessionElapsedMs, sessionBefore);
  assert.equal(engine.state.currentRound.elapsedMs, roundBefore);
});

test('pausing during the resume countdown preserves the original resume target', () => {
  const engine = createEngine('zero_sum_grid');
  engine.pause();
  assert.equal(engine.state.resumeTarget, 'playing');
  engine.resume();
  advance(engine, 1_000);
  const sessionBefore = engine.state.sessionElapsedMs;
  const roundBefore = engine.state.currentRound.elapsedMs;

  engine.pause('遊戲畫面中斷');
  assert.equal(engine.state.pauseInfo?.source, 'staff');
  assert.equal(engine.state.pauseInfo?.reason, '遊戲畫面中斷');
  assert.equal(engine.state.phase, 'paused');
  assert.equal(engine.state.resumeTarget, 'playing');
  assert.equal(engine.state.countdownMs, null);
  advance(engine, 30_000);
  assert.equal(engine.state.sessionElapsedMs, sessionBefore);
  assert.equal(engine.state.currentRound.elapsedMs, roundBefore);

  engine.resume();
  advance(engine, rules.common.resumeCountdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'playing');
  assert.equal(engine.state.sessionElapsedMs, sessionBefore);
  assert.equal(engine.state.currentRound.elapsedMs, roundBefore);
});

test('an accelerated 45-minute session survives a long pause and finishes its active round before final results', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.join('P1');

  let nextGameIndex = 0;
  const startNextGame = () => {
    const gameId = GAME_IDS[nextGameIndex++ % GAME_IDS.length];
    engine.selectGame(gameId);
    engine.confirmGameSelection();
    engine.startAfterTutorial();
  };

  startNextGame();
  advance(engine, rules.common.countdownSeconds * 1_000);
  advance(engine, 5_000);
  const elapsedBeforePause = engine.state.sessionElapsedMs;
  const roundBeforePause = engine.state.currentRound.elapsedMs;
  engine.pause();
  advance(engine, 10 * 60 * 1_000);
  assert.equal(engine.state.sessionElapsedMs, elapsedBeforePause);
  assert.equal(engine.state.currentRound.elapsedMs, roundBeforePause);

  engine.resume();
  advance(engine, rules.common.resumeCountdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'playing');
  assert.equal(engine.state.sessionElapsedMs, elapsedBeforePause);
  assert.equal(engine.state.currentRound.elapsedMs, roundBeforePause);

  const sessionLimitMs = rules.common.sessionDurationSeconds * 1_000;
  let expiryObservedDuringPlay = false;
  let phaseSteps = 0;
  while (engine.state.phase !== 'final_results') {
    assert.ok(++phaseSteps < 1_000, 'the accelerated session must reach final results');
    if (engine.state.phase === 'lobby') {
      startNextGame();
    } else if (engine.state.phase === 'countdown') {
      advance(engine, engine.state.currentRound.countdownMs);
    } else if (engine.state.phase === 'playing') {
      const round = engine.state.currentRound;
      const remainingRoundMs = round.limitMs - round.elapsedMs;
      const remainingSessionMs = sessionLimitMs - engine.state.sessionElapsedMs;
      if (!engine.state.sessionExpired && remainingSessionMs > 0 && remainingSessionMs < remainingRoundMs) {
        advance(engine, remainingSessionMs);
        expiryObservedDuringPlay = engine.state.sessionExpired && engine.state.phase === 'playing';
      } else {
        advance(engine, remainingRoundMs);
      }
    } else if (engine.state.phase === 'round_results') {
      advance(engine, engine.state.resultRemainingMs);
    } else {
      assert.fail(`unexpected phase before final results: ${engine.state.phase}`);
    }
  }

  assert.equal(expiryObservedDuringPlay, true, 'the 45-minute limit is reached during an active game round');
  assert.equal(engine.state.sessionExpired, true);
  assert.ok(engine.state.sessionElapsedMs >= sessionLimitMs);
  assert.ok(engine.state.results.length > 0);
  assert.ok(new Set(engine.state.results.map((result) => result.gameId)).size >= 4,
    'the simulated session must run across multiple game sets before its 45-minute limit');
  assert.ok(engine.state.currentRound, 'the final view retains the last round snapshot');
  assert.equal(engine.state.currentRound.elapsedMs, engine.state.currentRound.limitMs);
  assert.equal(engine.state.results[0].roundId, engine.state.currentRound.id, 'the last round result is settled before final results');
  const finalStage = createStageSnapshot(engine, rules, zones);
  assert.equal(finalStage.currentRound.question, null, 'the public projection hides the retained question snapshot at final results');
});

test('session expiry during a game finishes that round and its results before final results', () => {
  const engine = createEngine('zero_sum_grid', { participants: ['P1', 'P2'] });
  const sessionLimit = rules.common.sessionDurationSeconds * 1_000;
  engine.state.sessionElapsedMs = sessionLimit - 1_000;
  engine.tick(1_000);

  assert.equal(engine.state.sessionExpired, true);
  assert.equal(engine.state.phase, 'playing');
  submitNumber(engine, 'P1', engine.state.currentRound.question.answers.length);
  assert.equal(engine.state.phase, 'round_results');
  advance(engine, rules.common.roundResultsSeconds * 1_000);
  assert.equal(engine.state.phase, 'final_results');
});

test('session expiry during the round countdown ends without starting the question', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.join('P1');
  engine.selectGame('zero_sum_grid');
  engine.confirmGameSelection();
  engine.startAfterTutorial();
  const sessionLimit = rules.common.sessionDurationSeconds * 1_000;
  engine.state.sessionElapsedMs = sessionLimit - 500;
  engine.tick(500);

  assert.equal(engine.state.phase, 'final_results');
  assert.equal(engine.state.currentRound, null);
  assert.equal(engine.state.results.length, 0);
});

test('704 player views face their users and keep the entrance clear', () => {
  const expectedRotation = {
    P1: 0, P2: 0, P3: 0, P4: 270, P5: 270, P6: 90, P7: 90, P8: 180
  };
  const expectedRects = {
    P1: { x: 704, y: 0, width: 640, height: 640 },
    P2: { x: 1344, y: 0, width: 640, height: 640 },
    P3: { x: 1984, y: 0, width: 640, height: 640 },
    P4: { x: 0, y: 704, width: 640, height: 640 },
    P5: { x: 0, y: 1344, width: 640, height: 640 },
    P6: { x: 2688, y: 704, width: 640, height: 640 },
    P7: { x: 2688, y: 1344, width: 640, height: 640 },
    P8: { x: 2048, y: 2048, width: 640, height: 640 }
  };
  const expectedFace = { P1: 0, P2: 0, P3: 0, P4: 1, P5: 1, P6: 3, P7: 3, P8: 4 };
  const reserved = zones.reservedRects.find((item) => item.id === 'entrance-clearance')?.rect;
  assert.ok(reserved, '704 entrance clearance is explicitly configured');
  const entranceFace = venue.faces.find((face) => face.name === 'Entrance');
  const cellSize = entranceFace.orientation === 'vertical' ? { width: 32, height: 16 } : { width: 16, height: 32 };
  const serviceRect = {
    x: entranceFace.originX,
    y: entranceFace.originY,
    width: entranceFace.colCount * cellSize.width,
    height: entranceFace.rowCount * cellSize.height
  };
  assert.deepEqual(reserved, {
    x: zones.canvas.width - serviceRect.y - serviceRect.height,
    y: serviceRect.x,
    width: serviceRect.height,
    height: serviceRect.width
  }, 'the reserved exit area is derived from the TouchService Entrance face');

  for (const zone of zones.players) {
    assert.equal(zone.rotationDegrees, expectedRotation[zone.id], `${zone.id} faces outward toward its player`);
    assert.deepEqual(zone.rect, expectedRects[zone.id], `${zone.id} matches the 180-degree-mapped 8-player plan`);
    assert.equal(zone.rect.width, 640, `${zone.id} is exactly 10 venue tiles wide`);
    assert.equal(zone.rect.height, 640, `${zone.id} is exactly 10 venue tiles high`);
    const overlapsEntrance = zone.rect.x < reserved.x + reserved.width &&
      zone.rect.x + zone.rect.width > reserved.x &&
      zone.rect.y < reserved.y + reserved.height &&
      zone.rect.y + zone.rect.height > reserved.y;
    assert.equal(overlapsEntrance, false, `${zone.id} stays outside the entrance clearance`);
    assert.ok(zone.rect.x % 32 === 0 && zone.rect.y % 32 === 0,
      `${zone.id} aligns to the 704 sensor-cell grid`);
    for (const source of zone.sources) {
      assert.notEqual(source.face, 5, `${zone.id} does not map controls onto the Entrance face`);
      assert.equal(source.face, expectedFace[zone.id], `${zone.id} uses its corresponding TouchService wall face`);
    }
    assert.equal(zone.sources.reduce((sum, source) => sum + source.width, 0), zone.rect.width,
      `${zone.id} input source widths cover its display region`);
    let nextX = zone.rect.x;
    for (const source of zone.sources) {
      assert.equal(source.x, nextX, `${zone.id} input slices stay contiguous with its display region`);
      assert.equal(source.y, zone.rect.y, `${zone.id} input slice top matches its display region`);
      assert.equal(source.height, zone.rect.height, `${zone.id} input slice height matches its display region`);
      nextX += source.width;
    }
  }

  for (let left = 0; left < zones.players.length; left++) {
    for (let right = left + 1; right < zones.players.length; right++) {
      const a = zones.players[left].rect, b = zones.players[right].rect;
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlaps, false, `${zones.players[left].id} and ${zones.players[right].id} do not overlap`);
    }
  }

  const zonesByWall = {
    oppositeLongWall: zones.players.filter((zone) => zone.rect.y === 0),
    leftWall: zones.players.filter((zone) => zone.rect.x === 0),
    rightWall: zones.players.filter((zone) => zone.rect.x === 2688),
    entranceSideAvailableWall: zones.players.filter((zone) => zone.rect.y === 2048)
  };
  assert.deepEqual(Object.fromEntries(Object.entries(zonesByWall).map(([wall, items]) => [wall, items.length])), {
    oppositeLongWall: 3, leftWall: 2, rightWall: 2, entranceSideAvailableWall: 1
  }, 'the eight player areas follow the plan after the agreed 180-degree mapping');

  const p8 = zones.players.find((zone) => zone.id === 'P8');
  assert.equal(p8.rect.x, reserved.x + reserved.width + 640,
    'P8 occupies the outer wall segment away from the entrance clearance');
  assert.equal(p8.rect.y, reserved.y, 'P8 shares the lower wall but stays outside the entrance face');
  assert.equal(p8.rect.x % 64, 0, 'P8 is aligned to the venue tile grid');
  const p1 = zones.players.find((zone) => zone.id === 'P1');
  const p3 = zones.players.find((zone) => zone.id === 'P3');
  const oppositeLongWall = { left: 640, right: 2688 };
  assert.equal(p1.rect.x, oppositeLongWall.left + 64,
    'the three-player group starts with an even 64 px wall margin');
  assert.equal(p3.rect.x + p3.rect.width, oppositeLongWall.right - 64,
    'the three-player group ends with an even 64 px wall margin');
  assert.equal(p8.rect.x - (reserved.x + reserved.width), 640,
    'the entrance-side player zone leaves a 640 px buffer after the entrance clearance');
});

test('all player-zone source segments map to the center of the correct facing view', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  for (const zone of zones.players) engine.join(zone.id);
  assert.deepEqual(engine.touchCadPoint([320, 2_624]), { x: 704, y: 320 },
    'the diagnostic CAVE coordinate uses the same service-canvas rotation as hit testing');
  assert.equal(engine.touchCadPoint([Number.NaN, 2_624]), null);
  for (const zone of zones.players) {
    for (const source of zone.sources) {
      const cadX = source.x + source.width / 2;
      const cadY = source.y + source.height / 2;
      const result = engine.canvasPosition(source.face, [cadY, 3_328 - cadX]);
      const sourceU = source.uStart == null ? 0.5 : source.uStart + 0.5 * (source.uEnd - source.uStart);
      let expected = [sourceU, 0.5];
      if (zone.rotationDegrees === 90) expected = [0.5, 1 - sourceU];
      else if (zone.rotationDegrees === 180) expected = [1 - sourceU, 0.5];
      else if (zone.rotationDegrees === 270) expected = [0.5, sourceU];
      const sideways = zone.rotationDegrees === 90 || zone.rotationDegrees === 270;
      const orientedWidth = sideways ? zone.rect.height : zone.rect.width;
      const orientedHeight = sideways ? zone.rect.width : zone.rect.height;
      expected = [
        (expected[0] * orientedWidth - (orientedWidth - 640) / 2) / 640,
        (expected[1] * orientedHeight - (orientedHeight - 640) / 2) / 640
      ];

      assert.equal(result.zoneId, zone.id, `${zone.id} source face ${source.face}`);
      assert.ok(Math.abs(result.u - expected[0]) < 1e-9, `${zone.id} horizontal orientation`);
      assert.ok(Math.abs(result.v - expected[1]) < 1e-9, `${zone.id} vertical orientation`);
    }
  }
  const p1 = zones.players.find((zone) => zone.id === 'P1');
  assert.equal(engine.canvasPosition(0, [320, zones.canvas.width - (p1.rect.x - 2)]), null,
    'touches just outside the P1 area are ignored');
  assert.equal(engine.canvasPosition(5, [2_368, zones.canvas.width - 1_152]), null,
    'touches on the TouchService Entrance face are never assigned to a player');
});

test('CAVE player view corners and TouchService hits share the same orientation', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  for (const zone of zones.players) engine.join(zone.id);
  const designSize = rules.common.layout.localDesignWidth;
  assert.equal(designSize, 640, 'the CAVE calibration uses the 640 px square player view');

  for (const zone of zones.players) {
    const { width, height } = zone.rect;
    const padX = (width - designSize) / 2;
    const padY = (height - designSize) / 2;
    for (const [u, v] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
      let x, y;
      if (zone.rotationDegrees === 0) {
        x = padX + u * designSize;
        y = padY + v * designSize;
      } else if (zone.rotationDegrees === 90) {
        x = (width + height) / 2 - padY - v * designSize;
        y = (height - width) / 2 + padX + u * designSize;
      } else if (zone.rotationDegrees === 180) {
        x = width - padX - u * designSize;
        y = height - padY - v * designSize;
      } else if (zone.rotationDegrees === 270) {
        x = (width - height) / 2 + padY + v * designSize;
        y = (height + width) / 2 - padX - u * designSize;
      } else {
        assert.fail(`${zone.id} has an unsupported CAVE orientation`);
      }

      const cadX = zone.rect.x + x;
      const cadY = zone.rect.y + y;
      const source = zone.sources.find((item) => item.x <= cadX && cadX < item.x + item.width &&
        item.y <= cadY && cadY < item.y + item.height);
      assert.ok(source, `${zone.id} view corner has a TouchService source`);
      const result = engine.canvasPosition(source.face, [cadY, zones.canvas.width - cadX]);
      assert.equal(result?.zoneId, zone.id, `${zone.id} corner maps back to itself`);
      assert.ok(Math.abs(result.u - u) < 1e-9, `${zone.id} corner horizontal hit alignment`);
      assert.ok(Math.abs(result.v - v) < 1e-9, `${zone.id} corner vertical hit alignment`);
    }
  }
});

test('every active head-count profile routes each TouchService source to its ordered player ID', () => {
  for (let count = 0; count <= 8; count++) {
    const engine = new GameEngine({ rules, zones, onSave() {} });
    startReadySession(engine);
    for (let player = 1; player <= count; player++) engine.join(`P${player}`);
    if (count > 0) {
      engine.selectGame('minesweeper');
      engine.confirmGameSelection();
    }
    if (count > 0) for (const zone of engine.zones) for (const source of zone.sources) {
      const cadX = source.x + source.width / 2;
      const cadY = source.y + source.height / 2;
      const result = engine.canvasPosition(source.face, [cadY, zones.canvas.width - cadX]);
      assert.equal(result?.zoneId, zone.id, `profile ${engine.layout.profileCount} maps ${zone.id}`);
      assert.ok(Math.abs(result.u - 0.5) < 1e-9);
      assert.ok(Math.abs(result.v - 0.5) < 1e-9);
    }
    assert.equal(engine.canvasPosition(5, [2_368, zones.canvas.width - 1_152]), null,
      'the entrance face remains outside every active input layout');
  }
});

test('stage projections keep active players active and withhold answer keys', () => {
  for (const gameId of GAME_IDS) {
    const engine = createEngine(gameId);
    const view = createStageSnapshot(engine, rules, zones);
    const player = view.playerViews.P1;

    assert.equal(player.done, false, `${gameId} starts unfinished`);
    assert.equal(player.eliminated, false, `${gameId} starts active`);
    assert.equal(view.currentRound.question?.correctId, undefined, `${gameId} hides the answer ID`);
    assert.equal(view.currentRound.question?.answers, undefined, `${gameId} hides computed answers`);
    assert.equal(Object.hasOwn(view.currentRound, 'seed'), false, `${gameId} never exposes the seed on the public stage`);
    assert.equal(Object.hasOwn(view.currentRound, 'questionId'), false, `${gameId} never exposes internal question metadata on the public stage`);
    if (gameId === 'minesweeper') assert.equal(view.currentRound.question.mines, undefined);
    if (gameId === 'memory_poker') {
      assert.equal(view.currentRound.question.community.length, 3);
      assert.equal(view.currentRound.question.cards, null);
      assert.equal(player.hand, undefined);
    }
    if (gameId === 'memory_sequence') {
      assert.equal(view.currentRound.question.variantPositions, undefined);
      assert.equal(player.sequence.values.filter((value) => value > 0).length, rules.games.memory_sequence.numberCountByRound[0]);
      advance(engine, engine.state.currentRound.question.memorySeconds * 1_000);
      const covered = createStageSnapshot(engine, rules, zones);
      assert.equal(covered.playerViews.P1.sequence.values.every((value) => value === 0), true);
    }
  }
});

test('stage snapshot exposes the active player template and output-only 4-player question panels', () => {
  const four = createEngine('zero_sum_grid', { participants: ['P1', 'P2', 'P3', 'P4'] });
  const fourView = createStageSnapshot(four, rules, zones);
  assert.equal(fourView.layout.profileCount, 4);
  assert.equal(fourView.layout.questionDisplayMode, 'player-panels');
  assert.equal(fourView.zones.length, 4);
  assert.equal(fourView.questionPanels.length, 4);
  assert.ok(fourView.questionPanels.every((panel, index) => panel.playerId === `P${index + 1}`));
  assert.ok(fourView.questionPanels.every((panel) => !Object.hasOwn(panel, 'sources')));

  const five = createEngine('zero_sum_grid', { participants: ['P1', 'P2', 'P3', 'P4', 'P5'] });
  const fiveView = createStageSnapshot(five, rules, zones);
  assert.equal(fiveView.layout.profileCount, 5);
  assert.equal(fiveView.layout.questionDisplayMode, 'floor');
  assert.equal(fiveView.zones.length, 5);
  assert.equal(fiveView.questionPanels.length, 0);
});

test('touch hit regions match the board, keypad, card and choice layouts', () => {
  const pointAt = (rect, col, row, columns, rows) => ({
    u: (rect.x + (col + 0.5) * rect.width / columns) / 640,
    v: (rect.y + (row + 0.5) * rect.height / rows) / 640
  });

  const mine = createEngine('minesweeper');
  const mineBoard = rules.games.minesweeper.boardRect;
  const anchor = mine.state.currentRound.question.anchor;
  const { cols, rows } = mine.state.currentRound.question;
  const minePoint = pointAt(mineBoard, anchor % cols, Math.floor(anchor / cols), cols, rows);
  mine.coordinateAction('P1', minePoint.u, minePoint.v);
  assert.ok(mine.state.currentRound.players.P1.revealed.includes(anchor));
  const toolbar = rules.games.minesweeper.toolbarRect;
  const toolbarPoint = { u: 0.5, v: (toolbar.y + toolbar.height / 2) / 640 };
  mine.coordinateAction('P1', toolbarPoint.u, toolbarPoint.v);
  assert.equal(mine.state.currentRound.players.P1.mode, 'flag');

  const numeric = createEngine('zero_sum_grid');
  const correct = numeric.state.currentRound.question.answers.length;
  const wrong = (correct + 1) % 64;
  const keypad = rules.common.layout;
  const entryRect = keypad.numericEntryRect;
  numeric.coordinateAction('P1', (entryRect.x + entryRect.width / 2) / 640,
    (entryRect.y + entryRect.height / 2) / 640);
  assert.equal(numeric.state.currentRound.players.P1.entry, '', 'touches on the enlarged answer display do not become keypad input');
  const press = (key) => {
    const index = keypad.numericKeypadKeys.indexOf(key);
    assert.ok(index >= 0, `key ${key} is configured`);
    const point = pointAt(keypad.numericKeypadRect ?? keypad.interactiveRect, index % keypad.numericKeypadColumns,
      Math.floor(index / keypad.numericKeypadColumns), keypad.numericKeypadColumns, keypad.numericKeypadRows);
    numeric.coordinateAction('P1', point.u, point.v);
  };
  press('1'); press('2'); press('backspace');
  assert.equal(numeric.state.currentRound.players.P1.entry, '1');
  press('clear');
  assert.equal(numeric.state.currentRound.players.P1.entry, '');
  for (const digit of String(wrong)) press(digit);
  press('confirm');
  assert.equal(numeric.state.currentRound.players.P1.submissions, 1);

  const puzzle = createEngine('solid_puzzle');
  const choicePoint = pointAt(rules.games.solid_puzzle.choiceGridRect, 0, 0, 2, 3);
  puzzle.coordinateAction('P1', choicePoint.u, choicePoint.v);
  assert.equal(puzzle.state.currentRound.players.P1.selection, puzzle.state.currentRound.players.P1.choiceOrder[0]);

  const mapConfig = rules.games.map_view;
  for (let index = 0; index < mapConfig.optionCount; index++) {
    const map = createEngine('map_view');
    const point = pointAt(mapConfig.choiceGridRect,
      index % mapConfig.choiceGridColumns, Math.floor(index / mapConfig.choiceGridColumns),
      mapConfig.choiceGridColumns, mapConfig.choiceGridRows);
    map.coordinateAction('P1', point.u, point.v);
    assert.equal(map.state.currentRound.players.P1.selection, map.state.currentRound.question.choices[index].id,
      `map answer key ${index} selects its displayed choice`);
  }

  const poker = createEngine('memory_poker');
  advance(poker, (rules.games.memory_poker.communityRevealSeconds + rules.games.memory_poker.memorySeconds) * 1_000);
  const cardPoint = pointAt(rules.games.memory_poker.cardGridRect, 0, 0, 4, 4);
  poker.coordinateAction('P1', cardPoint.u, cardPoint.v);
  assert.deepEqual(poker.state.currentRound.players.P1.selected, [0]);
  const pokerConfirm = pointAt(rules.games.memory_poker.confirmRect, 0, 0, 1, 1);
  poker.coordinateAction('P1', pokerConfirm.u, pokerConfirm.v);
  assert.equal(poker.state.currentRound.players.P1.locked, false, 'one card cannot be confirmed');
});

test('a TouchService reconnect can clear held contacts without generating an input', () => {
  const engine = createEngine('zero_sum_grid');
  engine.contacts.set('stale-touch', { zoneId: 'P1', u: 0.5, v: 0.5, started: 1 });
  engine.clearTouchContacts();
  assert.equal(engine.contacts.size, 0);
});

test('TouchService reconnect preserves joined players and settled scores until staff resumes', () => {
  const engine = createEngine('zero_sum_grid', { participants: ['P1', 'P2'] });
  const sessionId = engine.state.sessionId;
  completeRoundWithCorrectAnswer(engine);

  assert.equal(engine.state.phase, 'round_results');
  assert.equal(engine.state.participants.P1.totalHalfPoints, 2);
  assert.equal(engine.state.participants.P1.roundsPlayed, 1);
  assert.equal(engine.state.participants.P2.totalHalfPoints, 0);
  advance(engine, rules.common.roundResultsSeconds * 1_000);
  assert.equal(engine.state.phase, 'countdown');
  engine.cancelRound();
  assert.equal(engine.state.phase, 'lobby');

  const participantIds = [...engine.state.participantIds];
  const participantScores = Object.fromEntries(participantIds.map((id) => [id, {
    totalHalfPoints: engine.state.participants[id].totalHalfPoints,
    roundsPlayed: engine.state.participants[id].roundsPlayed
  }]));
  const sessionElapsedMs = engine.state.sessionElapsedMs;
  engine.contacts.set('held-before-disconnect', { zoneId: 'P1', u: 0.5, v: 0.5, started: 1 });

  engine.clearTouchContacts();
  engine.setInputStatus(false, 'TouchService 已中斷，正在重新連線');
  assert.equal(engine.state.phase, 'paused');
  assert.equal(engine.state.pauseInfo?.source, 'touch-service');
  assert.match(engine.state.notice, /^【系統異常】/);
  assert.equal(engine.state.resumeTarget, 'lobby');
  assert.equal(engine.contacts.size, 0);
  assert.equal(engine.state.sessionId, sessionId);
  assert.deepEqual(engine.state.participantIds, participantIds);
  assert.deepEqual(Object.fromEntries(participantIds.map((id) => [id, {
    totalHalfPoints: engine.state.participants[id].totalHalfPoints,
    roundsPlayed: engine.state.participants[id].roundsPlayed
  }])), participantScores);

  engine.setInputStatus(true, 'TouchService 已重新連線');
  assert.equal(engine.state.phase, 'paused', 'reconnection must not resume the session automatically');
  advance(engine, 10_000);
  assert.equal(engine.state.sessionElapsedMs, sessionElapsedMs, 'session time stays frozen while awaiting staff');
  engine.resume();
  advance(engine, rules.common.resumeCountdownSeconds * 1_000);

  assert.equal(engine.state.phase, 'lobby');
  assert.deepEqual(engine.state.participantIds, participantIds);
  assert.deepEqual(Object.fromEntries(participantIds.map((id) => [id, {
    totalHalfPoints: engine.state.participants[id].totalHalfPoints,
    roundsPlayed: engine.state.participants[id].roundsPlayed
  }])), participantScores);
  engine.join('P3');
  assert.deepEqual(engine.state.participantIds, ['P1', 'P2', 'P3']);
  assert.equal(engine.state.participants.P1.totalHalfPoints, 2);
});

test('TouchService down events submit one tap immediately and up only releases it', () => {
  const engine = createEngine('minesweeper');
  const question = engine.state.currentRound.question;
  const board = rules.games.minesweeper.boardRect;
  const col = question.anchor % question.cols, row = Math.floor(question.anchor / question.cols);
  const u = (board.x + (col + 0.5) * board.width / question.cols) / 640;
  const v = (board.y + (row + 0.5) * board.height / question.rows) / 640;
  const down = p1TouchEvent(41, 'down', u, v);
  engine.handleTouchFrame(touchFrame([down], [41]));
  const player = engine.state.currentRound.players.P1;
  const revealedAfterDown = [...player.revealed];
  assert.ok(revealedAfterDown.includes(question.anchor));

  engine.handleTouchFrame(touchFrame([p1TouchEvent(41, 'up', u, v)], []));
  assert.deepEqual(player.revealed, revealedAfterDown);
});

test('long-pressing an unjoined answer zone cannot add a player', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  const down = p1TouchEvent(51, 'down', 0.5, 0.5);
  engine.handleTouchFrame(touchFrame([down], [51]));
  assert.equal(engine.state.participants.P1, undefined);

  engine.contacts.get('51').started -= 60_000;
  engine.handleTouchFrame(touchFrame([p1TouchEvent(51, 'up', 0.5, 0.5)], []));
  engine.coordinateAction('P1', 0.5, 0.5, 60_000);
  assert.equal(engine.state.participants.P1, undefined);
  assert.deepEqual(engine.state.participantIds, []);
});

test('only the staff join operation can add a player from the lobby', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.handleTouchFrame(touchFrame([p1TouchEvent(57, 'down', 0.5, 0.5)], [57]));
  engine.contacts.get('57').started -= 60_000;
  engine.handleTouchFrame(touchFrame([p1TouchEvent(57, 'up', 0.5, 0.5)], []));
  assert.deepEqual(engine.state.participantIds, []);

  engine.joinFromZone('P1');
  assert.deepEqual(engine.state.participantIds, ['P1']);
});

test('players cannot join by touching a wall, and tutorial holds are limited to the shared floor button', () => {
  const join = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(join);
  join.handleTouchFrame(touchFrame([p1TouchEvent(52, 'down', 0.5, 0.5, 'P1', join)], [52]));
  join.contacts.get('52').started -= 60_000;
  join.handleTouchFrame(touchFrame([p1TouchEvent(52, 'move', 0.5, 0.5, 'P2', join)], [52]));
  join.handleTouchFrame(touchFrame([p1TouchEvent(52, 'move', 0.5, 0.5, 'P1', join)], [52]));
  join.handleTouchFrame(touchFrame([p1TouchEvent(52, 'up', 0.5, 0.5, 'P1', join)], []));
  assert.deepEqual(join.state.participantIds, [], 'touches across unjoined areas never add players');

  const ready = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(ready);
  ready.join('P1');
  ready.selectGame('minesweeper');
  ready.confirmGameSelection();
  ready.handleTouchFrame(touchFrame([p1TouchEvent(53, 'down', 0.5, 0.7)], [53]));
  ready.contacts.get('53').started -= rules.common.readyHoldSeconds * 1_000 + 200;
  ready.handleTouchFrame(touchFrame([p1TouchEvent(53, 'up', 0.5, 0.9)], []));
  assert.equal(ready.state.participants.P1.ready, false, 'releasing outside the ready control cannot ready the player');
  assert.equal(ready.state.phase, 'tutorial');

  ready.handleTouchFrame(touchFrame([floorTouchEvent(54, 'down', 0.1, 0.85)], [54]));
  ready.contacts.get('54').started -= rules.common.readyHoldSeconds * 1_000 + 200;
  ready.handleTouchFrame(touchFrame([floorTouchEvent(54, 'up', 0.1, 0.85)], []));
  assert.equal(ready.state.phase, 'tutorial', 'floor touches outside the single shared button do nothing');
});

test('hold gestures are cancelled by a flow change even if the same phase returns before release', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.join('P1');
  engine.selectGame('minesweeper');
  engine.confirmGameSelection();

  engine.handleTouchFrame(touchFrame([floorTouchEvent(54, 'down', 0.5, 0.5)], [54]));
  engine.contacts.get('54').started -= rules.common.readyHoldSeconds * 1_000 + 200;
  engine.returnToLobby();
  engine.selectGame('minesweeper');
  engine.confirmGameSelection();
  engine.handleTouchFrame(touchFrame([floorTouchEvent(54, 'up', 0.5, 0.5)], []));

  assert.equal(engine.state.phase, 'tutorial');
  assert.equal(engine.state.participants.P1.ready, false,
    'a held contact from an earlier tutorial cannot ready a new tutorial instance');
});

test('staff joins a player, who can choose, prepare, start and answer through TouchService frames', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.joinFromZone('P1');

  engine.handleTouchFrame(touchFrame([menuTouchEvent(82, 'down', 0.5, 0.6, 'P1', engine)], [82]));
  assert.equal(engine.state.phase, 'game_preview');
  assert.equal(engine.state.selectedGame, 'minesweeper');
  const confirmZone = engine.menuZones[engine.gameOrder.indexOf(engine.state.selectedGame)];
  engine.handleTouchFrame(touchFrame([menuTouchEvent(83, 'down', 0.25, 0.6, confirmZone.id, engine)], [83]));
  assert.equal(engine.state.phase, 'tutorial');

  const readyPoint = { u: 0.5, v: 0.5 };
  engine.handleTouchFrame(touchFrame([floorTouchEvent(84, 'down', readyPoint.u, readyPoint.v)], [84]));
  engine.contacts.get('84').started -= rules.common.readyHoldSeconds * 1_000 + 200;
  engine.handleTouchFrame(touchFrame([floorTouchEvent(84, 'up', readyPoint.u, readyPoint.v)], []));
  assert.equal(engine.state.phase, 'countdown');
  advance(engine, rules.common.countdownSeconds * 1_000);
  assert.equal(engine.state.phase, 'playing');

  const board = rules.games.minesweeper.boardRect;
  const question = engine.state.currentRound.question;
  const u = (board.x + (question.anchor % question.cols + 0.5) * board.width / question.cols) / 640;
  const v = (board.y + (Math.floor(question.anchor / question.cols) + 0.5) * board.height / question.rows) / 640;
  engine.handleTouchFrame(touchFrame([p1TouchEvent(85, 'down', u, v)], [85]));
  assert.ok(engine.state.currentRound.players.P1.revealed.includes(question.anchor));
});

test('lobby offers random selection and rejects conflicting choices from the same input batch', () => {
  const createLobby = () => {
    const engine = new GameEngine({ rules, zones, onSave() {} });
    startReadySession(engine);
    engine.join('P1');
    engine.join('P2');
    return engine;
  };
  const optionTouch = (engine, index, id, phase = 'down') =>
    menuTouchEvent(id, phase, 0.5, 0.6, engine.menuZones[index].id, engine);
  const empty = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(empty);
  empty.handleTouchFrame(touchFrame([optionTouch(empty, 0, 70)], [70]));
  assert.equal(empty.state.phase, 'lobby', 'the shared menu waits for at least one staff-added player');
  assert.equal(empty.snapshot().menuZones.length, 9, 'all fixed wall menu surfaces remain available as one room-wide menu');

  const fixedMenu = createLobby();
  for (const [index, zone] of fixedMenu.menuZones.entries()) {
    const touch = menuTouchEvent(700 + index, 'down', 0.5, 0.6, zone.id, fixedMenu);
    assert.equal(fixedMenu.canvasPosition(touch.face, touch.px)?.zoneId, zone.id,
      `shared menu surface ${zone.id} maps to its fixed wall position`);
  }
  assert.equal(fixedMenu.canvasPosition(5, [2_368, zones.canvas.width - 1_152]), null,
    'shared menu input never covers the entrance face');

  const conflict = createLobby();
  conflict.handleTouchFrame(touchFrame([
    optionTouch(conflict, 0, 71),
    optionTouch(conflict, 1, 72)
  ], [71, 72]));
  assert.equal(conflict.state.phase, 'lobby');
  assert.equal(conflict.state.selectedGame, null);
  assert.match(conflict.state.notice, /共同選擇一款/);

  const shared = createLobby();
  shared.handleTouchFrame(touchFrame([
    optionTouch(shared, 0, 73),
    optionTouch(shared, 0, 74)
  ], [73, 74]));
  assert.equal(shared.state.phase, 'game_preview');
  assert.equal(shared.state.selectedGame, 'minesweeper');

  const selectedWall = shared.menuZones[shared.gameOrder.indexOf(shared.state.selectedGame)];
  assert.equal(shared.gamePreviewActionAt(selectedWall.id, 0.25, 0.6), 'confirm');
  assert.equal(shared.gamePreviewActionAt(selectedWall.id, 0.75, 0.6), 'cancel');
  assert.equal(shared.gamePreviewActionAt(shared.menuZones[1].id, 0.25, 0.6), null,
    'preview controls appear only on the selected game wall');
  assert.equal(shared.gamePreviewActionAt(selectedWall.id, 0.5, 0.6), null,
    'the darkened mask outside both circular buttons is not interactive');
  shared.coordinateAction('FLOOR', 0.25, 0.82);
  assert.equal(shared.state.phase, 'game_preview', 'the floor no longer confirms the selected game');
  shared.handleTouchFrame(touchFrame([menuTouchEvent(78, 'down', 0.25, 0.6, selectedWall.id, shared)], [78]));
  assert.equal(shared.state.phase, 'tutorial', 'the selected wall circle confirms the game before the tutorial begins');

  const secondWallGame = createLobby();
  const inactiveMenuIndex = secondWallGame.gameOrder.findIndex((_, index) =>
    !secondWallGame.zones.some((zone) => zone.id === secondWallGame.menuZones[index]?.id));
  assert.ok(inactiveMenuIndex >= 0, 'the active player layout leaves fixed menu surfaces for non-player walls');
  const inactiveMenuZone = secondWallGame.menuZones[inactiveMenuIndex];
  secondWallGame.handleTouchFrame(touchFrame([optionTouch(secondWallGame, inactiveMenuIndex, 79)], [79]));
  assert.equal(secondWallGame.state.selectedGame, secondWallGame.gameOrder[inactiveMenuIndex]);
  assert.equal(secondWallGame.zones.some((zone) => zone.id === inactiveMenuZone.id), false,
    `${inactiveMenuZone.id} is a menu wall outside the active player positions`);
  const secondWallConfirm = menuTouchEvent(80, 'down', 0.25, 0.6, inactiveMenuZone.id, secondWallGame);
  assert.equal(secondWallGame.canvasPosition(secondWallConfirm.face, secondWallConfirm.px)?.zoneId, inactiveMenuZone.id,
    'preview input continues to use all eight fixed menu walls');
  secondWallGame.handleTouchFrame(touchFrame([secondWallConfirm], [80]));
  assert.equal(secondWallGame.state.phase, 'tutorial');

  const noPlayerLobby = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(noPlayerLobby);
  noPlayerLobby.handleTouchFrame(touchFrame([optionTouch(noPlayerLobby, 2, 75)], [75]));
  noPlayerLobby.handleTouchFrame(touchFrame([optionTouch(noPlayerLobby, 2, 75, 'up')], []));
  assert.deepEqual(noPlayerLobby.state.participantIds, []);
  noPlayerLobby.joinFromZone('P1');
  noPlayerLobby.handleTouchFrame(touchFrame([optionTouch(noPlayerLobby, 2, 76)], [76]));
  assert.deepEqual(noPlayerLobby.state.participantIds, ['P1']);
  assert.equal(noPlayerLobby.state.selectedGame, 'cube_count');
  assert.equal(noPlayerLobby.state.phase, 'game_preview');

  const random = createLobby();
  random.handleTouchFrame(touchFrame([optionTouch(random, 8, 77)], [77]));
  assert.equal(random.state.phase, 'game_preview');
  assert.ok(GAME_IDS.includes(random.state.selectedGame));
  assert.match(random.state.notice, /隨機抽中/);
  const randomSelectionWall = random.menuZones[random.gameOrder.indexOf(random.state.selectedGame)];
  random.coordinateAction(randomSelectionWall.id, 0.25, 0.6);
  assert.equal(random.state.phase, 'tutorial', 'the drawn game wall hosts the confirmation control');
});

test('game preview can be cancelled, and one player can complete the shared tutorial', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine);
  engine.join('P1');
  engine.join('P2');

  engine.selectGame('memory_poker');
  assert.equal(engine.state.phase, 'game_preview');
  const selectedWall = engine.menuZones[engine.gameOrder.indexOf('memory_poker')];
  engine.coordinateAction(selectedWall.id, 0.75, 0.6);
  assert.equal(engine.state.phase, 'lobby', 'cancel returns to the game menu');
  assert.equal(engine.state.selectedGame, null);

  engine.selectGame('memory_poker');
  engine.coordinateAction(selectedWall.id, 0.25, 0.6);
  assert.equal(engine.state.phase, 'tutorial', 'the circular control on the selected wall opens the fixed tutorial');
  engine.coordinateAction('P1', 0.5, 0.85, 5_000);
  assert.equal(engine.state.phase, 'tutorial', 'player walls no longer expose separate tutorial-complete buttons');
  engine.handleTouchFrame(touchFrame([floorTouchEvent(86, 'down', 0.5, 0.5)], [86]));
  engine.contacts.get('86').started -= rules.common.readyHoldSeconds * 1_000 + 200;
  engine.handleTouchFrame(touchFrame([floorTouchEvent(86, 'up', 0.5, 0.5)], []));
  assert.equal(engine.state.phase, 'countdown', 'one completed tutorial hold starts the three-second countdown');
  assert.equal(engine.state.currentRound.gameId, 'memory_poker');
  assert.deepEqual(engine.state.currentRound.participantIds, ['P1', 'P2'], 'one shared floor hold prepares every player');
});

test('two controls touched in one player zone batch are rejected together', () => {
  const engine = createEngine('minesweeper');
  const question = engine.state.currentRound.question;
  const board = rules.games.minesweeper.boardRect;
  const anchorCol = question.anchor % question.cols, anchorRow = Math.floor(question.anchor / question.cols);
  const anchorU = (board.x + (anchorCol + 0.5) * board.width / question.cols) / 640;
  const anchorV = (board.y + (anchorRow + 0.5) * board.height / question.rows) / 640;
  const otherU = (board.x + 0.5 * board.width / question.cols) / 640;
  const otherV = (board.y + 0.5 * board.height / question.rows) / 640;
  engine.handleTouchFrame(touchFrame([
    p1TouchEvent(61, 'down', anchorU, anchorV),
    p1TouchEvent(62, 'down', otherU, otherV)
  ], [61, 62]));

  assert.deepEqual(engine.state.currentRound.players.P1.revealed, []);
  assert.match(engine.state.notice, /同時觸碰多個按鍵/);
});

for (const phase of ['game_preview', 'tutorial', 'countdown', 'playing', 'round_results', 'paused', 'resume_countdown']) {
  test(`return to lobby from ${phase} preserves standings and starts the next game cleanly`, () => {
    const engine = createEngine('cube_count', { participants: ['P1', 'P2', 'P3'] });
    submitNumber(engine, 'P1', engine.state.currentRound.question.total);
    engine.tick(100);
    submitNumber(engine, 'P2', engine.state.currentRound.question.total);
    engine.finishRound('deadline');
    assert.equal(engine.state.phase, 'round_results');
    const rankings = engine.finalRankings();
    assert.ok(rankings[0].score > 0);
    const results = structuredClone(engine.state.results);
    const sessionId = engine.state.sessionId;
    if (phase !== 'round_results') {
      engine.returnToLobby();
      engine.selectGame('zero_sum_grid');
      if (phase !== 'game_preview') engine.confirmGameSelection();
      if (!['game_preview', 'tutorial'].includes(phase)) engine.startAfterTutorial();
      if (['playing', 'paused', 'resume_countdown'].includes(phase)) advance(engine, 3_000);
      if (['paused', 'resume_countdown'].includes(phase)) engine.pause();
      if (phase === 'resume_countdown') engine.resume();
    }
    assert.equal(engine.state.phase, phase);
    const elapsed = engine.state.sessionElapsedMs;
    engine.returnToLobby();
    assert.equal(engine.state.phase, 'lobby');
    assert.equal(engine.state.sessionId, sessionId);
    assert.equal(engine.state.sessionElapsedMs, elapsed);
    assert.deepEqual(engine.finalRankings(), rankings);
    assert.deepEqual(engine.state.results, results);
    assert.deepEqual(engine.state.participantIds, ['P1', 'P2', 'P3']);
    assert.equal(engine.state.currentRound, null);
    assert.equal(engine.state.resumeTarget, null);
    assert.equal(engine.state.pauseInfo, null);
    assert.equal(engine.contacts.size, 0);
    assert.ok(Object.values(engine.state.participants).every((p) => !p.ready));
    engine.tick(6_000);
    assert.equal(engine.state.phase, 'lobby', 'stale countdowns must not start another round');
    const restored = new GameEngine({ rules, zones, initialState: structuredClone(engine.state), onSave() {} });
    assert.equal(restored.state.phase, 'lobby');
    assert.deepEqual(restored.finalRankings(), rankings);
    engine.selectGame('cube_count');
    engine.confirmGameSelection();
    engine.startAfterTutorial();
    advance(engine, 3_000);
    assert.equal(engine.state.currentRound.round, 1);
    assert.deepEqual(engine.finalRankings(), rankings);
  });
}

test('return to lobby rejects inactive and expired sessions without changing scores', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  assert.throws(() => engine.returnToLobby(), /進行中的場次/);
  startReadySession(engine);
  assert.throws(() => engine.returnToLobby(), /進行中的場次/);
  engine.join('P1');
  engine.selectGame('cube_count');
  engine.state.sessionElapsedMs = rules.common.sessionDurationSeconds * 1000;
  const before = structuredClone(engine.state);
  assert.throws(() => engine.returnToLobby(), /場次時間已到/);
  assert.deepEqual(engine.state, before);
  engine.endSession();
  assert.throws(() => engine.returnToLobby(), /進行中的場次/);
});

test('mouse testing selects any shared wall and handles real-duration holds and cancelled drags', () => {
  let now = 0;
  const engine = new GameEngine({ rules, zones, clock: () => now, onSave() {} });
  startReadySession(engine);
  engine.join('P1');
  const mouse = (event, revision = engine.phaseRevision) => handleMouseInput(engine, { ...event, phaseRevision: revision }, 'test');
  const choice = menuTouchEvent(1, 'down', 0.5, 0.6, 'P3', engine);
  assert.throws(() => mouse(choice), /開啟滑鼠測試/);
  engine.mouseTestEnabled = true;
  mouse(choice);
  assert.equal(engine.state.selectedGame, engine.gameOrder[2], 'unoccupied walls remain usable in the shared menu');
  mouse(menuTouchEvent(1, 'down', 0.25, 0.6, 'P3', engine));
  // Release before another press; one mouse has one active contact.
  mouse({ phase: 'cancel' });
  mouse(menuTouchEvent(1, 'down', 0.25, 0.6, 'P3', engine));
  assert.equal(engine.state.phase, 'tutorial');
  mouse({ phase: 'cancel' });
  const hold = floorTouchEvent(1, 'down', 0.5, 0.5);
  engine.touchReleaseTimeoutMs = 170;
  mouse(hold); now += 500; mouse({ ...hold, phase: 'up' });
  assert.equal(engine.state.phase, 'tutorial', 'short clicks do not complete teaching');
  mouse(hold); now += 1500;
  mouse(floorTouchEvent(1, 'move', 0.1, 0.3));
  mouse({ ...hold, phase: 'up' });
  assert.equal(engine.state.phase, 'tutorial', 'dragging out cancels a hold');
  mouse(hold); now += rules.common.readyHoldSeconds * 1000;
  mouse({ ...hold, phase: 'up' });
  assert.equal(engine.state.phase, 'countdown', 'mouse holds have no physical release-delay subtraction');
  assert.equal(engine.touchReleaseTimeoutMs, 170);
});

test('mouse input hits numeric keys across player layouts and ignores stale phases', () => {
  for (const count of [1, 4, 8]) {
    const engine = createEngine('cube_count', { participants: Array.from({ length: count }, (_, i) => `P${i + 1}`) });
    engine.mouseTestEnabled = true;
    const layout = rules.common.layout, rect = layout.numericKeypadRect;
    for (const zoneId of engine.state.participantIds) {
      const index = layout.numericKeypadKeys.indexOf('7');
      const u = (rect.x + (index % layout.numericKeypadColumns + 0.5) * rect.width / layout.numericKeypadColumns) / 640;
      const v = (rect.y + (Math.floor(index / layout.numericKeypadColumns) + 0.5) * rect.height / layout.numericKeypadRows) / 640;
      const event = p1TouchEvent(1, 'down', u, v, zoneId, engine);
      handleMouseInput(engine, { ...event, phaseRevision: engine.phaseRevision }, 'test');
      handleMouseInput(engine, { ...event, phase: 'up', phaseRevision: engine.phaseRevision }, 'test');
      assert.equal(engine.state.currentRound.players[zoneId].entry, '7', `${count} players / ${zoneId}`);
    }
    const revision = engine.phaseRevision;
    engine.returnToLobby();
    handleMouseInput(engine, { ...menuTouchEvent(1, 'down', 0.5, 0.6, 'P1', engine), phaseRevision: revision }, 'test');
    assert.equal(engine.state.phase, 'lobby');
    assert.throws(() => handleMouseInput(engine, { phase: 'down', px: [NaN, 1], phaseRevision: engine.phaseRevision }, 'test'), /位置/);
  }
});

function exitTouchEvent(id, phase, action, u = 0.5) {
  const r = zones.sharedExitControl.rect;
  const button = EXIT_BUTTONS[action];
  const v = button.y + button.height / 2;
  const rotated = zones.sharedExitControl.rotationDegrees === 180;
  return { id, phase, face: zones.sharedExitControl.face,
    px: [r.y + (rotated ? 1 - v : v) * r.height, 3328 - (r.x + (rotated ? 1 - u : u) * r.width)] };
}

test('east small wall exit rejects the old wall and reverses touch coordinates to match its text', () => {
  const engine = createEngine('cube_count');
  assert.equal(engine.canvasPosition(0, [320, 3328 - 672]), null);
  const point = exitTouchEvent(1, 'down', 'confirm', 0.25);
  const mapped = engine.canvasPosition(6, point.px);
  assert.equal(mapped.zoneId, EXIT_CONTROL_ZONE);
  assert.equal(mapped.u, 0.25);
  assert.equal(mapped.v, EXIT_BUTTONS.confirm.y + EXIT_BUTTONS.confirm.height / 2);
  assert.equal(engine.canvasPosition(5, point.px), null);
});

test('tutorial circle reports hold duration and cancels on leaving the circle, release or mouse blur', () => {
  const engine = new GameEngine({ rules, zones, onSave() {} });
  startReadySession(engine); engine.join('P1'); engine.selectGame('minesweeper'); engine.confirmGameSelection();
  let now = 0; engine.clock = () => now; engine.lastTick = now;
  engine.touchReleaseTimeoutMs = 170;
  const send = (phase, u, v) => engine.handleTouchFrame(touchFrame([floorTouchEvent(91, phase, u, v)], phase === 'up' ? [] : [91]));
  send('down', 0.5, 0.5); now = 670;
  assert.deepEqual(engine.snapshot().tutorialHold, { active: true, heldMs: 670, requiredMs: rules.common.readyHoldSeconds * 1000 });
  send('move', 0.37, 0.31); // Inside the circle's bounding box, outside its round boundary.
  assert.equal(engine.snapshot().tutorialHold.active, false);
  send('move', 0.5, 0.5); now = 4000; send('up', 0.5, 0.5);
  assert.equal(engine.state.phase, 'tutorial', 'moving back into the circle cannot restore a cancelled hold');
  send('down', 0.5, 0.85); now += 2000; send('up', 0.5, 0.85);
  assert.equal(engine.state.phase, 'tutorial', 'the previous rectangular button is no longer interactive');
  engine.mouseTestEnabled = true;
  const mouse = (phase) => handleMouseInput(engine, { ...floorTouchEvent(1, phase, 0.5, 0.5), phaseRevision: engine.phaseRevision }, 'progress-test');
  mouse('down'); now += 500;
  assert.equal(engine.snapshot().tutorialHold.heldMs, 500, 'mouse progress has no physical sensor release delay');
  mouse('cancel');
  assert.equal(engine.snapshot().tutorialHold.active, false);
  assert.equal(engine.snapshot().tutorialHold.heldMs, 0);
  mouse('down'); now += 200; mouse('up');
  assert.equal(engine.state.phase, 'tutorial', 'short press resets progress');
  mouse('down'); now += rules.common.readyHoldSeconds * 1000; engine.tick();
  assert.equal(engine.state.phase, 'countdown', 'a held pointer starts the game without release');
  mouse('up');
  assert.equal(engine.state.phase, 'countdown');
  assert.equal(engine.snapshot().tutorialHold.active, false);
});

for (const gameId of GAME_IDS) {
  test(`${gameId}: shared wall exit needs confirmation and keeps settled rankings`, () => {
    const engine = createEngine('cube_count', { participants: ['P1', 'P2', 'P3'] });
    submitNumber(engine, 'P1', engine.state.currentRound.question.total);
    engine.finishRound('deadline');
    const standings = engine.finalRankings(), results = structuredClone(engine.state.results);
    engine.returnToLobby(); engine.selectGame(gameId); engine.confirmGameSelection(); engine.startAfterTutorial(); advance(engine, 3000);
    let now = 0; engine.clock = () => now; engine.lastTick = now; engine.touchReleaseTimeoutMs = 170;
    let id = 100;
    const gesture = (action, duration = 200) => {
      const touchId = id++;
      engine.handleTouchFrame(touchFrame([exitTouchEvent(touchId, 'down', action)], [touchId]));
      now += duration;
      engine.handleTouchFrame(touchFrame([exitTouchEvent(touchId, 'up', action)], []));
    };
    gesture('request');
    assert.equal(engine.state.phase, 'playing');
    assert.equal(engine.state.exitConfirmation.roundId, engine.state.currentRound.id);
    gesture('cancel');
    assert.equal(engine.state.exitConfirmation, null);
    assert.equal(engine.state.phase, 'playing');
    gesture('request');
    gesture('confirm', 30);
    assert.equal(engine.state.phase, 'lobby');
    assert.equal(engine.state.exitConfirmation, null);
    assert.equal(engine.state.currentRound, null);
    assert.deepEqual(engine.finalRankings(), standings);
    assert.deepEqual(engine.state.results, results);
    assert.deepEqual(engine.state.participantIds, ['P1', 'P2', 'P3']);
  });
}

test('exit confirmation freezes all clocks and gameplay; cancellation and phase changes clear it safely', () => {
  const engine = createEngine('cube_count', { participants: ['P1', 'P2'] });
  let now = 0; engine.clock = () => now; engine.lastTick = now;
  const send = (id, phase, action) => engine.handleTouchFrame(touchFrame([exitTouchEvent(id, phase, action)], phase === 'up' ? [] : [id]));
  send(1, 'down', 'request'); send(1, 'up', 'request');
  const session = engine.state.sessionElapsedMs, elapsed = engine.state.currentRound.elapsedMs;
  engine.act('P1', { key: '7' }); now += 15000; engine.tick();
  assert.equal(engine.state.currentRound.players.P1.entry, '', 'confirmation blocks answers');
  assert.equal(engine.state.sessionElapsedMs, session); assert.equal(engine.state.currentRound.elapsedMs, elapsed);
  assert.equal(engine.activeElapsedAt(now), elapsed);
  send(2, 'down', 'cancel'); send(2, 'up', 'cancel');
  assert.equal(engine.state.exitConfirmation, null);
  now += 100; engine.tick();
  assert.equal(engine.state.currentRound.elapsedMs, elapsed + 100, 'cancel resumes without charging paused time');
  send(3, 'down', 'request'); send(3, 'up', 'request');
  engine.pause(); assert.equal(engine.state.exitConfirmation, null);
  send(4, 'down', 'request'); send(4, 'up', 'request');
  send(5, 'down', 'cancel'); send(5, 'up', 'cancel');
  assert.equal(engine.state.phase, 'paused', 'cancel preserves a staff or system pause');
  send(6, 'down', 'request'); send(6, 'up', 'request');
  const restored = new GameEngine({ rules, zones, initialState: structuredClone(engine.state), onSave() {} });
  assert.equal(restored.state.exitConfirmation, null);
  engine.returnToLobby();
  send(7, 'down', 'request'); send(7, 'up', 'request');
  assert.equal(engine.state.exitConfirmation, null, 'lobby exit control stays inactive');
});

for (const phase of ['game_preview','tutorial','countdown','playing','round_results','paused','resume_countdown']) {
  test(`exit prompt freezes and cancels cleanly in ${phase}`, () => {
    const engine = createEngine('cube_count');
    if (phase === 'round_results') engine.finishRound('deadline');
    else if (phase === 'paused' || phase === 'resume_countdown') { engine.pause(); if (phase === 'resume_countdown') engine.resume(); }
    else if (phase !== 'playing') { engine.returnToLobby(); engine.selectGame('cube_count'); if(phase !== 'game_preview') engine.confirmGameSelection(); if(phase === 'countdown') engine.startAfterTutorial(); }
    let now = 0; engine.clock = () => now; engine.lastTick = now;
    engine.requestPlayerExit();
    assert.ok(engine.state.exitConfirmation);
    const session = engine.state.sessionElapsedMs, round = structuredClone(engine.state.currentRound), resultTime=engine.state.resultRemainingMs, countdown=engine.state.countdownMs;
    now += 20000; engine.tick();
    assert.equal(engine.state.sessionElapsedMs, session); assert.deepEqual(engine.state.currentRound,round);
    assert.equal(engine.state.resultRemainingMs,resultTime); assert.equal(engine.state.countdownMs,countdown);
    engine.cancelPlayerExit(); assert.equal(engine.state.phase,phase);
    engine.requestPlayerExit();
    engine.coordinateAction(EXIT_CONTROL_ZONE, .5, EXIT_BUTTONS.confirm.y + EXIT_BUTTONS.confirm.height / 2);
    assert.equal(engine.state.phase,'lobby');
  });
}

test('mouse uses the same fixed exit strip and tap confirmation as TouchService', () => {
  const engine = createEngine('cube_count');
  engine.mouseTestEnabled = true;
  let now = 0; engine.clock = () => now; engine.lastTick = now;
  const send = (phase, action, revision = engine.phaseRevision) =>
    handleMouseInput(engine, { ...exitTouchEvent(1, phase, action), phaseRevision: revision }, 'exit-test');
  send('down', 'request'); send('up', 'request');
  assert.ok(engine.state.exitConfirmation);
  send('down', 'confirm'); assert.equal(engine.state.phase, 'lobby'); send('up', 'confirm');
  assert.equal(engine.state.phase, 'lobby');
});


test('sequence covers only unanswered numbered cells, hides their values and resets covers after a mistake', () => {
  const engine = createEngine('memory_sequence');
  const round = engine.state.currentRound, player = round.players.P1;
  const read = () => createStageSnapshot(engine, rules, zones).playerViews.P1.sequence;
  assert.equal(read().covered.some(Boolean), false);
  assert.deepEqual(read().values, player.values);
  advance(engine, round.question.memorySeconds * 1000);
  assert.deepEqual(read().covered, player.values.map(value => value > 0));
  assert.ok(read().values.every(value => value === 0), 'covers must not expose the hidden digits');
  const first = player.values.indexOf(1), empty = player.values.indexOf(0);
  engine.act('P1', { index: first });
  assert.equal(read().values[first], 1);
  assert.equal(read().covered[first], false);
  assert.equal(read().covered.filter(Boolean).length, round.question.count - 1);
  assert.equal(read().covered[empty], false);
  engine.act('P1', { index: empty });
  assert.equal(read().hearts, rules.games.memory_sequence.heartsPerRound);
  assert.equal(read().values[first], 1);
  assert.equal(read().covered[first], false);
  engine.act('P1', { index: first });
  assert.equal(read().hearts, rules.games.memory_sequence.heartsPerRound - 1);
  assert.equal(read().covered[first], true);
  assert.equal(read().covered[empty], false);
  assert.ok(read().values.every(value => value === 0));
  engine.finishRound('deadline');
  assert.deepEqual(read().values, player.values);
  assert.equal(read().covered.some(Boolean), false);
});

test('8-by-6 minesweeper ignores the removed perimeter and toggles only at the upper toolbar', () => {
  const engine = createEngine('minesweeper', { seed: 20261125 });
  const q = engine.state.currentRound.question, player = engine.state.currentRound.players.P1;
  const { boardRect: board, toolbarRect: toolbar } = rules.games.minesweeper;
  assert.equal(q.cols, 8); assert.equal(q.rows, 6); assert.equal(q.numbers.length, 48);
  assert.equal(q.anchor, 3 + 2 * 8);
  assert.ok(toolbar.y + toolbar.height <= board.y);
  engine.coordinateAction('P1', (board.x + (q.anchor % q.cols + .5) * board.width / q.cols) / 640,
    (board.y + (Math.floor(q.anchor / q.cols) + .5) * board.height / q.rows) / 640);
  const before = structuredClone(player);
  for (const [x, y] of [[32, 320], [608, 320], [320, 608]]) engine.coordinateAction('P1', x / 640, y / 640);
  assert.deepEqual(player, before, 'the outside ring and old bottom toolbar must not accept input');
  engine.coordinateAction('P1', (toolbar.x + toolbar.width / 2) / 640, (toolbar.y + toolbar.height / 2) / 640);
  assert.equal(player.mode, 'flag');
  const index = q.numbers.findIndex((_, i) => !player.revealed.includes(i));
  engine.coordinateAction('P1', (board.x + (index % q.cols + .5) * board.width / q.cols) / 640,
    (board.y + (Math.floor(index / q.cols) + .5) * board.height / q.rows) / 640);
  assert.deepEqual(player.flags, [index]);
});


test('poker reveals community before memory, gates selection, and preserves community cards', () => {
  const engine = createEngine('memory_poker');
  const view = () => createStageSnapshot(engine, engine.rules, zones).currentRound.question;
  const config = rules.games.memory_poker;
  const community = view().community;
  assert.equal(view().stage, 'community');
  assert.equal(view().cards, null);
  engine.act('P1', { type: 'toggle_card', index: 0 });
  assert.deepEqual(engine.state.currentRound.players.P1.selected, []);
  advance(engine, config.communityRevealSeconds * 1000);
  assert.equal(view().stage, 'memory');
  assert.equal(view().cards.length, 16);
  assert.deepEqual(view().community, community);
  advance(engine, config.memorySeconds * 1000 - 1);
  engine.act('P1', { type: 'toggle_card', index: 0 });
  assert.deepEqual(engine.state.currentRound.players.P1.selected, []);
  advance(engine, 1);
  assert.equal(view().stage, 'selection');
  assert.equal(view().cards, null);
  assert.deepEqual(view().community, community);
  engine.act('P1', { type: 'toggle_card', index: 0 });
  engine.act('P1', { type: 'toggle_card', index: 1 });
  advance(engine, config.selectionSeconds * 1000);
  assert.equal(view().stage, 'reveal');
  assert.equal(engine.state.currentRound.players.P1.locked, true);
  advance(engine, config.revealCountdownSeconds * 1000);
  assert.equal(engine.state.phase, 'round_results');
  assert.equal(view().cards.length, 16);
});

test('minesweeper and slitherlink use only player boards across all player counts and phases', () => {
  for (const gameId of ['minesweeper', 'slitherlink']) for (let count = 1; count <= 8; count++) {
    const engine = new GameEngine({ rules, zones, onSave() {}, seedFactory: () => 1234 });
    startReadySession(engine);
    for (let i = 1; i <= count; i++) engine.join(`P${i}`);
    engine.selectGame(gameId);
    const check = () => {
      const view = createStageSnapshot(engine, rules, zones);
      assert.deepEqual(view.questionPanels, [], `${gameId}/${count}/${view.phase}`);
      assert.equal(view.layout.questionDisplayMode, 'player-only');
      assert.equal(view.layout.floorRole, 'standings');
      assert.equal(view.zones.length, Math.max(4, count));
      assert.equal(engine.layout.questionPanels.length, count <= 4 ? 4 : 0, 'base geometry is not mutated');
    };
    check();
    engine.confirmGameSelection(); check();
    engine.startAfterTutorial(); check();
    advance(engine, 3000); check();
    engine.pause(); check();
    engine.resume(); check();
    advance(engine, rules.common.resumeCountdownSeconds * 1000); check();
    engine.finishRound('deadline'); check();
    const view = createStageSnapshot(engine, rules, zones);
    assert.ok(view.currentRound.question, 'player result boards keep their question');
    assert.equal(view.results[0].rows.length, count);
  }
});

test('games needing a shared question retain their normal wall or floor display', () => {
  for (const count of [4, 8]) {
    const participants = Array.from({ length: count }, (_, i) => `P${i+1}`);
    const engine = createEngine('zero_sum_grid', { participants });
    const view = createStageSnapshot(engine, rules, zones);
    assert.equal(view.layout.questionDisplayMode, count === 4 ? 'player-panels' : 'floor');
    assert.equal(view.questionPanels.length, count === 4 ? 4 : 0);
  }
});
