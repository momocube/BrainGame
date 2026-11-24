const SAMPLE_OFFSETS = [0.2, 0.5, 0.8];
const RAY_EPSILON = 1e-7;

function rayIntersectsBox(origin, direction, min, max) {
  let enter = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;

  for (let axis = 0; axis < 3; axis++) {
    const ray = direction[axis];
    if (Math.abs(ray) < RAY_EPSILON) {
      if (origin[axis] <= min[axis] || origin[axis] >= max[axis]) return false;
      continue;
    }

    const first = (min[axis] - origin[axis]) / ray;
    const second = (max[axis] - origin[axis]) / ray;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (exit - enter <= RAY_EPSILON) return false;
  }

  return exit > RAY_EPSILON && exit - Math.max(enter, RAY_EPSILON) > RAY_EPSILON;
}

function topSampleIsVisible(heights, cols, rows, targetIndex, sample, direction) {
  const x = targetIndex % cols;
  const y = Math.floor(targetIndex / cols);
  const origin = [x + sample[0], y + sample[1], heights[targetIndex]];

  for (let index = 0; index < heights.length; index++) {
    const height = heights[index];
    if (index === targetIndex || height <= 0) continue;
    const otherX = index % cols;
    const otherY = Math.floor(index / cols);
    if (rayIntersectsBox(origin, direction, [otherX, otherY, 0], [otherX + 1, otherY + 1, height])) return false;
  }

  return true;
}

/**
 * Require each occupied column's top to have a readable patch in at least one
 * fixed view. Three of nine interior samples must be unobstructed in that view.
 */
export function cubeColumnsAreReadable(heights, cols, rows, azimuthDegrees, elevationDegrees) {
  if (!Array.isArray(heights) || heights.length !== cols * rows || !Array.isArray(azimuthDegrees) || !azimuthDegrees.length) return false;
  const occupied = heights.flatMap((height, index) => height > 0 ? [index] : []);
  if (!occupied.length) return false;

  const elevation = elevationDegrees * Math.PI / 180;
  const views = azimuthDegrees.map((angle) => {
    const azimuth = angle * Math.PI / 180;
    return [
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation)
    ];
  });
  const samples = SAMPLE_OFFSETS.flatMap((x) => SAMPLE_OFFSETS.map((y) => [x, y]));
  const minimumVisibleSamples = Math.ceil(samples.length / 3);

  return occupied.every((index) => views.some((direction) => {
    let visibleSamples = 0;
    for (const sample of samples) {
      if (topSampleIsVisible(heights, cols, rows, index, sample, direction)) visibleSamples++;
      if (visibleSamples >= minimumVisibleSamples) return true;
    }
    return false;
  }));
}
