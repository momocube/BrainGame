export const EXIT_CONTROL_ZONE = 'SHARED_EXIT';
export const EXIT_CONFIRM_HOLD_MS = 1000;
export const EXIT_BUTTONS = Object.freeze({
  request: { x: 0, y: 224 / 640, width: 1, height: 192 / 640 },
  confirm: { x: 0, y: 272 / 640, width: 1, height: 128 / 640 },
  cancel: { x: 0, y: 464 / 640, width: 1, height: 128 / 640 }
});

export function canPlayerExit(state, sessionLimitMs) {
  return state.phase === 'playing' && Boolean(state.currentRound) &&
    !state.sessionExpired && state.sessionElapsedMs < sessionLimitMs;
}

export function exitActionAt(u, v, confirming) {
  return (confirming ? ['confirm', 'cancel'] : ['request']).find((action) => {
    const r = EXIT_BUTTONS[action];
    return u >= r.x && u < r.x + r.width && v >= r.y && v < r.y + r.height;
  }) ?? null;
}
