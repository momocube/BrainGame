import { CAD_SCENE } from './projection-layout.mjs';

/** Decorative only: the same cross-shaped floor/wall footprint as the 704 projection. */
export function createIdleParticles(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const width = CAD_SCENE.width, height = CAD_SCENE.height;
  canvas.width = width / 2;
  canvas.height = height / 2;
  let seed = 704;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const particles = Array.from({ length: 210 }, () => ({
    x: random() * width, y: random() * height, radius: 2 + random() * 4,
    vx: (random() - .5) * 14, vy: -8 - random() * 18,
    phase: random() * Math.PI * 2, gold: random() < .25
  }));
  let active = false, frameId = null, previousPaint = -Infinity;
  const wrap = (value, size) => ((value % size) + size) % size;
  function paint(time) {
    if (!ctx) return;
    ctx.setTransform(.5, 0, 0, .5, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(640, 0, 2048, height);
    ctx.rect(0, 640, width, 1408);
    ctx.clip();
    ctx.fillStyle = '#02050c';
    ctx.fillRect(0, 0, width, height);
    const seconds = time / 1000;
    for (const p of particles) {
      const x = wrap(p.x + p.vx * seconds + Math.sin(seconds * .16 + p.phase) * 26, width);
      const y = wrap(p.y + p.vy * seconds, height);
      const color = p.gold ? '255,210,86' : '69,227,218';
      const opacity = .35 + .2 * Math.sin(seconds * .8 + p.phase);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, p.radius * 6);
      glow.addColorStop(0, `rgba(${color},${opacity})`);
      glow.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - p.radius * 6, y - p.radius * 6, p.radius * 12, p.radius * 12);
      ctx.beginPath(); ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},${opacity + .2})`; ctx.fill();
    }
    ctx.restore();
  }
  function animate(time) {
    frameId = null;
    if (!active || document.hidden || reducedMotion.matches) return;
    if (time - previousPaint >= 1000 / 30) { paint(time); previousPaint = time; }
    frameId = requestAnimationFrame(animate);
  }
  function refresh() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    if (!active) return;
    paint(reducedMotion.matches ? 0 : performance.now());
    if (!document.hidden && !reducedMotion.matches) frameId = requestAnimationFrame(animate);
  }
  reducedMotion.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      canvas.hidden = !active;
      refresh();
    }
  };
}
