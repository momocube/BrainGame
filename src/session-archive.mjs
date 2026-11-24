import fs from 'node:fs';
import path from 'node:path';

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function atomicWrite(file, contents) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents, 'utf8');
  fs.renameSync(temp, file);
}

function rankingsFor(state) {
  const ids = Array.isArray(state.participantIds) ? state.participantIds : [];
  const ordered = ids.map((zoneId, order) => ({
    zoneId,
    order,
    totalHalfPoints: Number(state.participants?.[zoneId]?.totalHalfPoints ?? 0),
    roundsPlayed: Number(state.participants?.[zoneId]?.roundsPlayed ?? 0)
  })).sort((a, b) => b.totalHalfPoints - a.totalHalfPoints || a.order - b.order);
  let rank = 1;
  return ordered.map((player, index) => {
    if (index && player.totalHalfPoints !== ordered[index - 1].totalHalfPoints) rank = index + 1;
    return {
      zoneId: player.zoneId,
      rank,
      score: player.totalHalfPoints / 2,
      roundsPlayed: player.roundsPlayed
    };
  });
}

function archiveFromState(state, zoneNames, rulesSnapshot, previous) {
  const appliedRules = state.rulesSnapshot ?? previous?.rulesSnapshot ?? rulesSnapshot;
  const participantIds = Array.isArray(state.participantIds) ? state.participantIds : [];
  const participants = participantIds.map((zoneId) => {
    const participant = state.participants?.[zoneId] ?? {};
    const totalHalfPoints = Number(participant.totalHalfPoints ?? 0);
    return {
      zoneId,
      name: participant.name ?? zoneNames.get(zoneId) ?? zoneId,
      joinedAt: participant.joinedAt ?? null,
      totalHalfPoints,
      score: totalHalfPoints / 2,
      roundsPlayed: Number(participant.roundsPlayed ?? 0)
    };
  });
  const questionSnapshots = new Map((previous?.roundSnapshots ?? []).map((item) => [item.roundId, item]));
  if (state.phase === 'round_results' && state.currentRound && state.currentRound.id) {
    questionSnapshots.set(state.currentRound.id, {
      roundId: state.currentRound.id,
      questionId: state.currentRound.questionId ?? null,
      questionSeed: state.currentRound.seed ?? null,
      rngAlgorithm: state.currentRound.rngAlgorithm ?? null,
      generatorVersion: state.currentRound.generatorVersion ?? null,
      rulesVersion: state.currentRound.rulesVersion ?? state.rulesVersion ?? null,
      gameId: state.currentRound.gameId,
      round: state.currentRound.round,
      generatedAt: state.currentRound.generatedAt ?? null,
      question: structuredClone(state.currentRound.question)
    });
  }
  return {
    schemaVersion: 1,
    sessionId: state.sessionId,
    rulesVersion: state.rulesVersion ?? appliedRules?.rulesVersion ?? null,
    rulesSnapshot: structuredClone(appliedRules ?? {}),
    startedAt: state.sessionStartedAt ?? null,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
    endedAt: state.phase === 'final_results' ? (state.updatedAt ?? new Date().toISOString()) : null,
    phase: state.phase ?? 'unknown',
    elapsedMs: Number(state.sessionElapsedMs ?? 0),
    sessionExpired: Boolean(state.sessionExpired),
    participants,
    finalRankings: rankingsFor(state),
    roundSnapshots: [...questionSnapshots.values()],
    results: structuredClone(Array.isArray(state.results) ? state.results : [])
  };
}

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_COLUMNS = [
  'session_id', 'started_at', 'ended_at', 'session_phase', 'session_elapsed_ms',
  'player_zone', 'player_name', 'final_rank', 'final_score', 'rounds_played',
  'round_id', 'game_id', 'game_name', 'game_round', 'round_reason', 'round_elapsed_ms',
  'participant_count', 'round_rank', 'round_points', 'completed', 'player_elapsed_ms',
  'mine_hits', 'sequence_progress', 'poker_hand', 'answer',
  'question_id', 'question_seed', 'rng_algorithm', 'generator_version', 'rules_version'
];

function rowFor(session, player, result = null, roundRow = null) {
  return [
    session.sessionId, session.startedAt, session.endedAt, session.phase, session.elapsedMs,
    player?.zoneId ?? roundRow?.zoneId ?? '', player?.name ?? roundRow?.zoneId ?? '',
    session.finalRankings.find((item) => item.zoneId === (player?.zoneId ?? roundRow?.zoneId))?.rank ?? '',
    player?.score ?? '', player?.roundsPlayed ?? '', result?.roundId ?? '', result?.gameId ?? '',
    result?.gameName ?? '', result?.round ?? '', result?.reason ?? '', result?.elapsedMs ?? '',
    result?.participantCount ?? '', roundRow?.rank ?? '', roundRow?.score ?? '',
    roundRow?.completed ?? '', roundRow?.elapsedMs ?? '', roundRow?.mineHits ?? '',
    roundRow?.sequenceProgress ?? '', roundRow?.pokerHand ? JSON.stringify(roundRow.pokerHand) : '',
    result?.answer ? JSON.stringify(result.answer) : '',
    result?.questionId ?? '', result?.questionSeed ?? '', result?.rngAlgorithm ?? '',
    result?.generatorVersion ?? '', result?.rulesVersion ?? session.rulesVersion ?? ''
  ].map(csvCell).join(',');
}

export function sessionToCsv(session) {
  const lines = [CSV_COLUMNS.join(',')];
  const playersById = new Map((session.participants ?? []).map((player) => [player.zoneId, player]));
  const results = [...(session.results ?? [])].reverse();
  if (!results.length) {
    for (const player of session.participants ?? []) lines.push(rowFor(session, player));
  } else {
    for (const result of results) {
      for (const roundRow of result.rows ?? []) {
        lines.push(rowFor(session, playersById.get(roundRow.zoneId), result, roundRow));
      }
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function createSessionArchiveStore({ dataDir, zones = [], rules = {} }) {
  const directory = path.resolve(dataDir, 'sessions');
  const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
  fs.mkdirSync(directory, { recursive: true });

  function fileFor(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return null;
    return path.join(directory, `${sessionId.toLowerCase()}.json`);
  }

  function get(sessionId) {
    const file = fileFor(sessionId);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value.schemaVersion === 1 && value.sessionId.toLowerCase() === sessionId.toLowerCase() ? value : null;
    } catch {
      return null;
    }
  }

  return {
    save(state) {
      const file = fileFor(state?.sessionId);
      if (!file) return null;
      const previous = get(state.sessionId);
      const archive = archiveFromState(state, zoneNames, rules, previous);
      atomicWrite(file, JSON.stringify(archive, null, 2));
      return archive;
    },
    get,
    list() {
      return fs.readdirSync(directory)
        .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
        .map((name) => get(name.slice(0, -5)))
        .filter(Boolean)
        .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
        .map((session) => ({
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          endedAt: session.endedAt,
          phase: session.phase,
          elapsedMs: session.elapsedMs,
          participantCount: session.participants.length,
          roundCount: session.results.length
        }));
    },
    csv(sessionId) {
      const session = get(sessionId);
      return session ? sessionToCsv(session) : null;
    }
  };
}
