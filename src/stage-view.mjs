import { pokerTiming, pokerStage } from '../public/poker-timing.mjs';

/**
 * Build the public projection for the shared game display.
 * Keep answer keys and private player state inside the game engine until results.
 */
export function createStageSnapshot(engine, rules, zones) {
  const snapshot = engine.snapshot();
  snapshot.finalRankings = engine.finalRankings();
  snapshot.gameRules = rules;
  snapshot.reservedRects = structuredClone(zones.reservedRects ?? []);
  const sourceRound = engine.state.currentRound;
  // These games contain the question on each player's interactive board.
  // Apply this before the paused/tutorial early return so spare walls stay clear.
  if (['slitherlink', 'minesweeper'].includes(sourceRound?.gameId ?? snapshot.selectedGame)) {
    snapshot.questionPanels = [];
    snapshot.layout.questionDisplayMode = 'player-only';
    snapshot.layout.floorRole = 'standings';
  }
  const playerViews = Object.fromEntries(engine.zones.map((zone) => {
    const participant = engine.state.participants[zone.id];
    return [zone.id, {
      zoneId: zone.id, name: zone.name, joined: Boolean(participant),
      ready: Boolean(participant?.ready), score: (participant?.totalHalfPoints ?? 0) / 2
    }];
  }));
  if (!sourceRound || ['paused', 'resume_countdown'].includes(engine.state.phase)) {
    snapshot.currentRound = null;
    snapshot.playerViews = playerViews;
    return snapshot;
  }

  const { gameId, question, players, elapsedMs, round } = sourceRound;
  const resultPhase = engine.state.phase === 'round_results';
  for (const zoneId of sourceRound.participantIds) {
    const player = players[zoneId];
    if (!player) continue;
    const view = Object.assign(playerViews[zoneId], {
      done: player.doneAtMs !== null,
      eliminated: player.eliminatedAtMs != null,
      error: player.lastError ?? null
    });
    if (gameId === 'minesweeper') {
      view.mine = {
        revealed: [...player.revealed], flags: [...player.flags], hits: [...player.hits],
        numbers: Object.fromEntries(player.revealed.map((index) => [index, question.numbers[index]])),
        safeProgress: player.safeProgress, mode: player.mode, penaltyMs: player.penaltyMs
      };
    } else if (gameId === 'zero_sum_grid' || gameId === 'cube_count') {
      view.entry = player.entry;
      view.lockRemainingMs = Math.max(0, player.wrongUntilMs - elapsedMs);
    } else if (gameId === 'solid_puzzle' || gameId === 'map_view') {
      view.selection = player.selection;
      view.lockRemainingMs = Math.max(0, player.wrongUntilMs - elapsedMs);
      if (gameId === 'solid_puzzle') view.choiceOrder = [...player.choiceOrder];
    } else if (gameId === 'memory_poker') {
      view.selected = [...player.selected];
      view.locked = player.locked;
      if (resultPhase && player.hand) view.hand = player.hand;
    } else if (gameId === 'memory_sequence') {
      const memoryMs = rules.games.memory_sequence.memorySecondsByRound[round - 1] * 1000;
      const memoryPhase = engine.state.phase === 'playing' && elapsedMs < memoryMs;
      const showSolution = resultPhase;
      view.sequence = {
        hearts: player.hearts, progress: player.progress, bestProgress: player.bestProgress,
        wrongCount: player.wrongCount ?? 0,
        covered: player.values.map((value) => !memoryPhase && !showSolution && value > player.progress),
        values: memoryPhase || showSolution ? [...player.values]
          : player.values.map((value) => value > 0 && value <= player.progress ? value : 0)
      };
    } else if (gameId === 'slitherlink') {
      view.slither = { edges: [...player.edges], moves: player.moves,
        canUndo: snapshot.phase === 'playing' && player.doneAtMs === null && Boolean(player.history?.length) };
    }
    playerViews[zoneId] = view;
  }

  let publicQuestion = null;
  const questionVisible = engine.state.phase === 'playing' || resultPhase;
  if (!questionVisible) {
    publicQuestion = null;
  } else if (gameId === 'minesweeper') {
    publicQuestion = resultPhase
      ? { ...question }
      : { cols: question.cols, rows: question.rows, anchor: question.anchor, mineCount: question.mines.length };
  } else if (gameId === 'zero_sum_grid') {
    publicQuestion = { cells: [...question.cells], cols: question.cols, rows: question.rows };
  } else if (gameId === 'cube_count') {
    publicQuestion = { size: question.size, maxHeight: question.maxHeight, heights: [...question.heights] };
  } else if (gameId === 'solid_puzzle') {
    publicQuestion = {
      volume: question.volume, target: [...question.target], missing: question.missing,
      choices: question.choices.map(({ id, cells }) => ({ id, cells }))
    };
  } else if (gameId === 'memory_poker') {
    const config = rules.games.memory_poker;
    const memoryPhase = engine.state.phase === 'playing' && pokerStage(elapsedMs, config) === 'memory';
    publicQuestion = {
      stage: pokerStage(elapsedMs, config),
      cardLocations: question.cardLocations,
      cards: (memoryPhase || resultPhase) ? question.cards.map((card) => card.label) : null,
      community: (config.communityCardsVisibleDuringMemory || elapsedMs >= pokerTiming(config).memoryEnd || resultPhase) ? question.community.map((card) => card.label) : null
    };
  } else if (gameId === 'map_view') {
    publicQuestion = {
      size: question.size, grid: question.grid, landmarks: question.landmarks,
      firstPersonView: question.firstPersonView,
      choices: question.choices.map(({ id, x, y, heading }) => ({ id, x, y, heading }))
    };
  } else if (gameId === 'memory_sequence') {
    publicQuestion = { count: question.count, memorySeconds: question.memorySeconds, cols: question.cols, rows: question.rows };
  } else if (gameId === 'slitherlink') {
    publicQuestion = { cols: question.cols, rows: question.rows, clues: [...question.clues] };
    if (resultPhase) publicQuestion.solution = [...question.solution];
  }

  snapshot.currentRound = {
    id: sourceRound.id, gameId, round, elapsedMs, limitMs: sourceRound.limitMs,
    countdownMs: sourceRound.countdownMs, question: publicQuestion,
    participantIds: [...sourceRound.participantIds]
  };
  snapshot.playerViews = playerViews;
  return snapshot;
}
