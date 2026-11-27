/** Half-point totals remain exact, including tied rankings. */
export function countedScore(from, to, elapsedMs, durationMs = 1600) {
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  if (progress === 1 || to <= from) return to;
  const eased = 1 - (1 - progress) ** 3;
  return Math.min(to, from + Math.floor((to - from) * 2 * eased) / 2);
}

/** Keep one timestamp across DOM rebuilds; changing rounds drops old effects. */
export function createFeedbackTimeline() {
  let scope = null;
  const starts = new Map();
  return {
    setScope(next) { if (next !== scope) { scope = next; starts.clear(); } },
    start(key, now) { if (!starts.has(key)) starts.set(key, now); return starts.get(key); }
  };
}

export function confettiParticles(count = 36) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI + (index + .5) / count * Math.PI;
    const radius = 140 + (index % 5) * 26;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
      rotation: (index % 2 ? 1 : -1) * (180 + index * 31),
      delay: (index % 6) * 35, color: ['#ffdc67','#70dcca','#ff8fb4','#8dcaff'][index % 4] };
  });
}
