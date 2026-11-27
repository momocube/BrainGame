const volatileStageFields = new Set([
  'updatedAt', 'sessionElapsedMs', 'remainingSessionMs', 'countdownMs',
  'elapsedMs', 'resultRemainingMs', 'lockRemainingMs', 'tutorialHold'
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

/** Keep enlarged score entries readable by giving each one enough grid width. */
export function scoreboardColumnCount(itemCount) {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/** Floor scores stay beside the owning wall, oriented for that player's view. */
export function floorPlayerScoreLayout(zones, floorRect, participantIds) {
  if (!floorRect) return [];
  const width = 336, height = 184, inset = 24 + height / 2;
  const active = new Set(participantIds);
  return zones.filter(zone => active.has(zone.id)).map(zone => {
    const rotation = ((zone.rotationDegrees ?? 0) % 360 + 360) % 360;
    let x = zone.rect.x + zone.rect.width / 2 - floorRect.x;
    let y = zone.rect.y + zone.rect.height / 2 - floorRect.y;
    if (rotation === 0 || rotation === 180) {
      x = Math.max(width / 2 + 24, Math.min(floorRect.width - width / 2 - 24, x));
      y = rotation === 0 ? inset : floorRect.height - inset;
    } else {
      x = rotation === 270 ? inset : floorRect.width - inset;
      y = Math.max(width / 2 + 24, Math.min(floorRect.height - width / 2 - 24, y));
    }
    return { zoneId: zone.id, x, y, width, height, rotation };
  });
}
