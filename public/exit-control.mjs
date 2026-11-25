export const EXIT_CONTROL_ZONE = 'SHARED_EXIT';
export const EXIT_BUTTONS = Object.freeze({
  request: { x: 0, y: 224 / 640, width: 1, height: 192 / 640 },
  confirm: { x: 0, y: 272 / 640, width: 1, height: 128 / 640 },
  cancel: { x: 0, y: 464 / 640, width: 1, height: 128 / 640 }
});

export function canPlayerExit(state, sessionLimitMs) {
  return ['game_preview', 'tutorial', 'countdown', 'playing', 'round_results', 'paused', 'resume_countdown'].includes(state.phase) &&
    !state.sessionExpired && state.sessionElapsedMs < sessionLimitMs;
}

export function exitActionAt(u, v, confirming) {
  return (confirming ? ['confirm', 'cancel'] : ['request']).find((action) => {
    const r = EXIT_BUTTONS[action];
    return u >= r.x && u < r.x + r.width && v >= r.y && v < r.y + r.height;
  }) ?? null;
}
