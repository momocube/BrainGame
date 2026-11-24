const volatileStageFields = new Set([
  'updatedAt', 'sessionElapsedMs', 'remainingSessionMs', 'countdownMs',
  'elapsedMs', 'resultRemainingMs', 'lockRemainingMs'
]);

/** Keep stable stage content rendered while timers and lock countdowns advance. */
export function stageStructureKey(snapshot) {
  return JSON.stringify(snapshot, (key, value) => volatileStageFields.has(key) ? undefined : value);
}

/** Compare server snapshots by their persisted update time to reject late responses. */
export function compareStageStateFreshness(next, current) {
  const nextAt = Date.parse(next?.updatedAt ?? '');
  const currentAt = Date.parse(current?.updatedAt ?? '');
  if (!Number.isFinite(nextAt) || !Number.isFinite(currentAt)) return 0;
  return Math.sign(nextAt - currentAt);
}
