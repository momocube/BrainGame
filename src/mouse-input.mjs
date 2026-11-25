// Mouse points use the same merged canvas and hit testing as TouchService.
export function handleMouseInput(engine, payload, clientId) {
  if (!engine.mouseTestEnabled) throw new Error('請先在後台開啟滑鼠測試模式');
  if (!['down', 'move', 'up', 'cancel'].includes(payload.phase)) throw new Error('無效的滑鼠操作');
  const id = `mouse:${clientId}`;
  if (payload.phase === 'cancel') { engine.contacts.delete(id); return; }
  if (payload.phaseRevision !== engine.phaseRevision) { engine.contacts.delete(id); return; }
  const px = payload.px;
  if (!Array.isArray(px) || px.length !== 2 || !px.every(Number.isFinite) ||
      px[0] < 0 || px[0] >= 2688 || px[1] < 0 || px[1] >= 3328) {
    engine.contacts.delete(id);
    throw new Error('滑鼠位置不在遊戲畫面內');
  }
  const point = engine.touchCadPoint(px);
  const inside = (rect) => point.x >= rect.x && point.y >= rect.y &&
    point.x < rect.x + rect.width && point.y < rect.y + rect.height;
  const floor = engine.layout.floorRect;
  const exitControl = engine.zoneConfig.sharedExitControl;
  const zones = ['lobby', 'game_preview'].includes(engine.state.phase) ? engine.menuZones : engine.zones;
  const face = exitControl && inside(exitControl.rect) ? exitControl.face
    : engine.state.phase === 'tutorial' && floor && inside(floor.rect)
    ? floor.face : zones.flatMap((zone) => zone.sources).find(inside)?.face;
  // An outside move/release cancels a held tutorial control.
  if (face == null) { engine.contacts.delete(id); return; }
  const releaseDelay = engine.touchReleaseTimeoutMs;
  try {
    engine.touchReleaseTimeoutMs = 0;
    engine.handleTouchFrame({ v: 1, venue: '704',
      events: [{ id, phase: payload.phase, face, px }],
      alive: payload.phase === 'up' ? [] : [id] });
  } finally { engine.touchReleaseTimeoutMs = releaseDelay; }
}
