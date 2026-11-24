function boundsOf(display) {
  const bounds = display?.bounds ?? {};
  return {
    x: Number(bounds.x), y: Number(bounds.y),
    width: Number(bounds.width), height: Number(bounds.height)
  };
}

function displaySnapshot(display) {
  return {
    id: String(display.id),
    bounds: boundsOf(display),
    rotation: Number(display.rotation ?? 0),
    scaleFactor: Number(display.scaleFactor ?? 1)
  };
}

function sameSnapshot(expected, display) {
  if (!expected || String(expected.id) !== String(display.id)) return false;
  const current = displaySnapshot(display);
  return current.rotation === Number(expected.rotation) &&
    current.scaleFactor === Number(expected.scaleFactor) &&
    Object.keys(current.bounds).every((key) => current.bounds[key] === Number(expected.bounds?.[key]));
}

export function resolveDisplayPlan(settings, displays, primaryDisplayId = null) {
  const list = Array.isArray(displays) ? displays : [];
  const primary = list.find((display) => String(display.id) === String(primaryDisplayId)) ?? list[0] ?? null;

  if (list.length < 2) {
    return {
      mode: 'preview', staffDisplay: primary, gameDisplay: primary,
      reason: list.length ? 'missing-game-display' : 'no-displays'
    };
  }
  if (!settings || settings.schemaVersion !== 1) return { mode: 'setup', reason: 'unconfigured' };

  const staffDisplay = list.find((display) => String(display.id) === String(settings.staffDisplayId));
  const gameDisplay = list.find((display) => String(display.id) === String(settings.gameDisplayId));
  if (!staffDisplay || !gameDisplay) return { mode: 'setup', reason: 'display-missing' };
  if (String(staffDisplay.id) === String(gameDisplay.id)) return { mode: 'setup', reason: 'same-display' };
  if (!sameSnapshot(settings.snapshots?.staff, staffDisplay) ||
      !sameSnapshot(settings.snapshots?.game, gameDisplay)) {
    return { mode: 'setup', reason: 'display-changed' };
  }
  return { mode: 'venue', staffDisplay, gameDisplay, reason: null };
}

export function createDisplaySettings({ staffDisplayId, gameDisplayId }, displays) {
  const staff = displays.find((display) => String(display.id) === String(staffDisplayId));
  const game = displays.find((display) => String(display.id) === String(gameDisplayId));
  if (!staff || !game) throw new Error('請選擇目前已連接的控制台與遊戲螢幕');
  if (String(staff.id) === String(game.id)) throw new Error('控制台與遊戲畫面必須指定不同螢幕');
  return {
    schemaVersion: 1,
    staffDisplayId: String(staff.id),
    gameDisplayId: String(game.id),
    snapshots: { staff: displaySnapshot(staff), game: displaySnapshot(game) }
  };
}

/** Match the 704 Minesweeper launcher: primary for staff, first non-primary for projection. */
export function createDefaultDisplaySettings(displays, primaryDisplayId = null) {
  const list = Array.isArray(displays) ? displays : [];
  const primary = list.find((display) => String(display.id) === String(primaryDisplayId)) ?? list[0];
  const secondary = list.find((display) => String(display.id) !== String(primary?.id));
  if (!primary || !secondary) return null;
  return createDisplaySettings({ staffDisplayId: primary.id, gameDisplayId: secondary.id }, list);
}

export function describeDisplayPlanReason(reason) {
  const messages = {
    'no-displays': '作業系統尚未提供可用螢幕。',
    'missing-game-display': '目前只有一個螢幕，先以開發預覽並排顯示。正式運作需要第二個遊戲輸出螢幕。',
    unconfigured: '第一次使用，請辨認並指定控制台與遊戲輸出螢幕。',
    'display-missing': '已指定的螢幕目前不存在，請重新指定。',
    'same-display': '控制台與遊戲輸出不能使用同一個實體螢幕。',
    'display-changed': '螢幕位置、尺寸、縮放或方向已改變，請重新確認配置。'
  };
  return messages[reason] ?? '請確認螢幕配置。';
}
