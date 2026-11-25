/** Shared timing keeps card visibility, inputs and projection countdowns in sync. */
export function pokerTiming(config) {
  const communityEnd = (config.communityRevealSeconds ?? 0) * 1000;
  const memoryEnd = communityEnd + config.memorySeconds * 1000;
  const selectionEnd = memoryEnd + config.selectionSeconds * 1000;
  return { communityEnd, memoryEnd, selectionEnd, revealEnd: selectionEnd + config.revealCountdownSeconds * 1000 };
}
export function pokerStage(elapsedMs, config) {
  const timing = pokerTiming(config);
  if (elapsedMs < timing.communityEnd) return 'community';
  if (elapsedMs < timing.memoryEnd) return 'memory';
  if (elapsedMs < timing.selectionEnd) return 'selection';
  return 'reveal';
}
