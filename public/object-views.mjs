/**
 * Legacy profile-extrusion: one simple x/z polygon extruded along +y.
 * stepped-profile: that profile from y=0..frontDepth, with an inset rectangular
 * rear extension from frontDepth..depth. rear=[x0,z0,x1,z1] is relative to the
 * normalized front profile and must lie strictly inside it. The two solids meet
 * only at their end caps; this is not a general overlapping-parts/CSG format.
 * Coordinates are serializable numbers; arcs are sampled polygons, not decals.
 * No holes, arbitrary rotations, view-dependent geometry, or external packages.
 */
const EPS = 1e-8;
const INK = '#17354b';
const COLOR = '#70dcca';
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = p => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const fmt = n => String(Number(n.toFixed(4)));
const path = points => `M${points.map(p => p.map(fmt).join(',')).join('L')}Z`;
const clone = value => JSON.parse(JSON.stringify(value));

function geometry(object) {
  if (object?.type !== 'profile-extrusion' || !Number.isFinite(object.depth) || object.depth <= 0 || !Array.isArray(object.profile) || object.profile.length < 3 || object.profile.length > 256) {
    throw new TypeError('Expected a profile-extrusion with positive depth and 3–256 profile vertices');
  }
  let profile = object.profile.map(p => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new TypeError('Profile coordinates must be finite [x,z] pairs');
    return [...p];
  });
  const onSegment = (a, b, p) => Math.abs(turn(a, b, p)) < EPS && p.every((v, i) => v >= Math.min(a[i], b[i]) - EPS && v <= Math.max(a[i], b[i]) + EPS);
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    if (Math.hypot(...sub(a, b)) < EPS) throw new TypeError('Profile has a zero-length edge');
    for (let j = i + 2; j < profile.length; j++) {
      if (i === 0 && j === profile.length - 1) continue;
      const c = profile[j], d = profile[(j + 1) % profile.length];
      if ((turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) throw new TypeError('Profile must be simple (no intersections or touching edges)');
    }
  }
  if (Math.abs(area(profile)) < EPS) throw new TypeError('Profile must enclose an area');
  if (area(profile) < 0) profile.reverse();
  const minX = Math.min(...profile.map(p => p[0])), minZ = Math.min(...profile.map(p => p[1]));
  profile = profile.map(([x, z]) => [x - minX, z - minZ]);
  return { type: 'profile-extrusion', profile, depth: object.depth };
}

function triangulate(profile) {
  const remaining = profile.map((_, i) => i), triangles = [];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (turn(profile[a], profile[b], profile[c]) <= EPS) continue;
      const inside = remaining.some(j => j !== a && j !== b && j !== c && turn(profile[a], profile[b], profile[j]) >= -EPS && turn(profile[b], profile[c], profile[j]) >= -EPS && turn(profile[c], profile[a], profile[j]) >= -EPS);
      if (inside) continue;
      triangles.push([a, b, c]); remaining.splice(i, 1); found = true; break;
    }
    if (!found) throw new TypeError('Profile could not be triangulated');
  }
  triangles.push(remaining);
  return triangles;
}

function rectangleInside(profile, rectangle) {
  const inside = ([x, z]) => {
    let result = false;
    for (let i = 0, j = profile.length - 1; i < profile.length; j = i++) {
      const a = profile[i], b = profile[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  if (!rectangle.every(inside)) return false;
  // Also exclude notches crossing an edge or contained inside the rectangle.
  const [lo, , hi] = rectangle;
  if (profile.some(p => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1])) return false;
  for (let i = 0; i < profile.length; i++) for (let j = 0; j < 4; j++) {
    const a = profile[i], b = profile[(i + 1) % profile.length], c = rectangle[j], d = rectangle[(j + 1) % 4];
    if (turn(a, b, c) * turn(a, b, d) <= 0 && turn(c, d, a) * turn(c, d, b) <= 0) return false;
  }
  return true;
}

/** Test/debug API: closed component surfaces used by both renderers. */
export function objectMesh(object) {
  if (object?.type === 'stepped-profile') {
    const plate = objectMesh({ type: 'profile-extrusion', profile: object.profile, depth: object.frontDepth });
    const { rear, depth } = object;
    if (!Array.isArray(rear) || rear.length !== 4 || !rear.every(Number.isFinite) || rear[2] <= rear[0] || rear[3] <= rear[1] || !Number.isFinite(depth) || depth <= object.frontDepth) throw new TypeError('Invalid stepped-profile rectangle or depth');
    const [x0, z0, x1, z1] = rear;
    const rectangle = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    if (!rectangleInside(plate.profile, rectangle)) throw new TypeError('Rear rectangle must be strictly inside front profile');
    const extension = objectMesh({ type: 'profile-extrusion', profile: rectangle, depth: depth - object.frontDepth });
    const translate = p => [p[0] + x0, p[1] + object.frontDepth, p[2] + z0];
    extension.front = extension.front.map(translate);
    extension.back = extension.back.map(translate);
    extension.faces = extension.faces.map(face => face.map(translate));
    return { ...plate, type: 'stepped-profile', depth, components: [plate, extension], front: [...plate.front, ...extension.front], back: [...plate.back, ...extension.back], faces: [...plate.faces, ...extension.faces] };
  }
  const solid = geometry(object), { profile, depth } = solid;
  const front = profile.map(([x, z]) => [x, 0, z]), back = profile.map(([x, z]) => [x, depth, z]);
  const faces = [];
  for (const indices of triangulate(profile)) {
    faces.push(indices.map(i => front[i]));
    faces.push([...indices].reverse().map(i => back[i]));
  }
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    faces.push([front[i], back[i], back[j], front[j]]);
  }
  return { ...solid, front, back, faces };
}

const CAMERAS = {
  front: { u: [1, 0, 0], v: [0, 0, -1], eye: [0, -1, 0] },
  top: { u: [1, 0, 0], v: [0, -1, 0], eye: [0, 0, 1] },
  right: { u: [0, 1, 0], v: [0, 0, -1], eye: [1, 0, 0] },
  perspective: { u: [0.8, 0.6, 0], v: [0.3, -0.4, -1], eye: [0.6, -0.8, 0.5] }
};
const project = (p, camera) => [dot(p, camera.u), dot(p, camera.v), dot(p, camera.eye)];
const normal = points => cross(sub(points[1], points[0]), sub(points[2], points[0]));

function projectedTriangles(mesh, camera) {
  return mesh.faces.flatMap(face => {
    if (dot(normal(face), camera.eye) <= EPS) return [];
    const points = face.map(p => project(p, camera));
    return Array.from({ length: face.length - 2 }, (_, i) => [points[0], points[i + 1], points[i + 2]]);
  });
}

// Intersect [lo,hi] with f(t)>=0. All projected depth/edge functions are linear.
function clipInterval(interval, f0, f1) {
  if (!interval) return null;
  const slope = f1 - f0;
  if (Math.abs(slope) < EPS) return f0 >= 0 ? interval : null;
  const t = -f0 / slope;
  const [lo, hi] = interval;
  const result = slope > 0 ? [Math.max(lo, t), hi] : [lo, Math.min(hi, t)];
  return result[1] - result[0] > EPS ? result : null;
}

function visibleSegment(a, b, triangles) {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < EPS) return [];
  const hidden = [];
  for (const tri of triangles) {
    const signedArea = turn(...tri), sign = Math.sign(signedArea);
    if (Math.abs(signedArea) < EPS) continue;
    let interval = [0, 1];
    for (let i = 0; i < 3 && interval; i++) interval = clipInterval(interval, sign * turn(tri[i], tri[(i + 1) % 3], a), sign * turn(tri[i], tri[(i + 1) % 3], b));
    if (!interval) continue;
    const depthAt = p => (turn(tri[1], tri[2], p) * tri[0][2] + turn(tri[2], tri[0], p) * tri[1][2] + turn(tri[0], tri[1], p) * tri[2][2]) / signedArea;
    interval = clipInterval(interval, depthAt(a) - a[2] - EPS * 10, depthAt(b) - b[2] - EPS * 10);
    if (interval) hidden.push(interval);
  }
  hidden.sort((a, b) => a[0] - b[0]);
  let start = 0;
  const visible = [];
  for (const [lo, hi] of hidden) {
    if (lo > start + EPS) visible.push([mix(a, b, start), mix(a, b, lo)]);
    start = Math.max(start, hi);
  }
  if (start < 1 - EPS) visible.push([mix(a, b, start), b]);
  // Depth epsilon can leave sub-pixel slivers beside an occluder's boundary.
  return visible.filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6);
}

function visibleEdges(mesh, camera, occluders = mesh) {
  if (mesh.components) return mesh.components.flatMap(component => visibleEdges(component, camera, mesh));
  const { front, back, profile } = mesh, segments = [], triangles = projectedTriangles(occluders, camera);
  const sideNormals = profile.map((p, i) => { const q = profile[(i + 1) % profile.length]; return [q[1] - p[1], 0, p[0] - q[0]]; });
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    segments.push([front[i], front[j]], [back[i], back[j]]);
    const n1 = sideNormals[(i + profile.length - 1) % profile.length], n2 = sideNormals[i];
    const cosine = dot(n1, n2) / (Math.hypot(...n1) * Math.hypot(...n2));
    // Suppress tessellation seams on arcs; preserve real corners and tangencies.
    if (cosine < Math.cos(0.2) || dot(n1, camera.eye) * dot(n2, camera.eye) <= 0) segments.push([front[i], back[i]]);
  }
  return segments.flatMap(([a, b]) => visibleSegment(project(a, camera), project(b, camera), triangles));
}

/** Test/debug API: depth-clipped visible edges in the requested camera plane. */
export function objectVisibleEdges(object, view = 'perspective') {
  if (!Object.hasOwn(CAMERAS, view)) throw new RangeError('Unknown object view');
  return visibleEdges(objectMesh(object), CAMERAS[view]);
}

/** Projected outlines and visible feature lines, all in the same world units. */
export function objectOrthographicViews(object) {
  const mesh = objectMesh(object);
  const width = Math.max(...mesh.profile.map(p => p[0])), height = Math.max(...mesh.profile.map(p => p[1]));
  const rectangle = (w, h) => [[0, 0], [w, 0], [w, -h], [0, -h]];
  const views = {
    width, height, depth: mesh.depth,
    front: { outline: mesh.profile.map(([x, z]) => [x, -z]), edges: visibleEdges(mesh, CAMERAS.front) },
    top: { outline: rectangle(width, mesh.depth), edges: visibleEdges(mesh, CAMERAS.top) },
    right: { outline: rectangle(mesh.depth, height), edges: visibleEdges(mesh, CAMERAS.right) }
  };
  for (const name of ['front', 'top', 'right']) {
    views[name].surfaces = projectedTriangles(mesh, CAMERAS[name]).map(tri => tri.map(p => p.slice(0, 2)));
    if (mesh.components) {
      const [x0, z0, x1, z1] = object.rear, d = object.frontDepth, end = object.depth;
      if (name === 'top') views[name].outline = [[0, 0], [width, 0], [width, -d], [x1, -d], [x1, -end], [x0, -end], [x0, -d], [0, -d]];
      if (name === 'right') views[name].outline = [[0, 0], [d, 0], [d, -z0], [end, -z0], [end, -z1], [d, -z1], [d, -height], [0, -height]];
    }
  }
  return views;
}

/** Actual rendered 2D linework, merged independently of mesh triangulation/depth. */
export function objectViewSignature(object, view) {
  if (!['front', 'top', 'right'].includes(view)) throw new RangeError('Unknown orthographic view');
  const mesh = objectMesh(object);
  const scale = Math.max(mesh.depth, ...mesh.profile.flat());
  const groups = new Map();
  for (const [a, b] of visibleEdges(mesh, CAMERAS[view])) {
    const p = a.slice(0, 2).map(n => n / scale), q = b.slice(0, 2).map(n => n / scale);
    let delta = sub(q, p), length = Math.hypot(...delta);
    if (length < 1e-6) continue;
    delta = delta.map(n => n / length);
    if (delta[0] < -1e-7 || (Math.abs(delta[0]) < 1e-7 && delta[1] < 0)) delta = delta.map(n => -n);
    const offset = delta[0] * p[1] - delta[1] * p[0];
    const key = [delta[0], delta[1], offset].map(n => Number(n.toFixed(5))).join(',');
    const interval = [dot(p, delta), dot(q, delta)].sort((a, b) => a - b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(interval);
  }
  return JSON.stringify([...groups].map(([key, intervals]) => {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1] + 1e-5) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    return [key, merged.map(pair => pair.map(n => Number(n.toFixed(5))))];
  }).sort((a, b) => a[0].localeCompare(b[0])));
}

/** Translation/uniform-scale invariant: visually identical fitted solids collide. */
export function objectProjectionSignature(object) {
  if (object?.type === 'stepped-profile') return ['front', 'top', 'right'].map(view => objectViewSignature(object, view)).join('|');
  const { profile, depth } = geometry(object);
  const scale = Math.max(depth, ...profile.flat());
  // Remove redundant collinear samples and canonicalize the cyclic start vertex.
  const corners = profile.filter((p, i) => Math.abs(turn(profile[(i + profile.length - 1) % profile.length], p, profile[(i + 1) % profile.length])) > EPS);
  const normalized = corners.map(p => p.map(n => Number((n / scale).toFixed(6))));
  const rotations = normalized.map((_, i) => JSON.stringify([...normalized.slice(i), ...normalized.slice(0, i)]));
  return `${Number((depth / scale).toFixed(6))}:${rotations.sort()[0]}`;
}

function lineMarkup(edges, transform) {
  return `<path d="${edges.map(([a, b]) => `M${transform(a).map(fmt).join(',')}L${transform(b).map(fmt).join(',')}`).join('')}" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Third-angle L layout: top above front, right at front's right. */
export function objectOrthographicSvg(object) {
  const views = objectOrthographicViews(object), { width, height, depth } = views;
  const scale = Math.min(210 / width, 155 / depth, 180 / height);
  const left = 35, topBase = 52 + depth * scale, frontBase = topBase + 82 + height * scale;
  const rightLeft = left + width * scale + 74;
  const svgWidth = Math.max(380, rightLeft + depth * scale + 35), svgHeight = frontBase + 25;
  const panel = (key, label, x, y, labelY, w) => {
    const transform = p => [x + p[0] * scale, y + p[1] * scale];
    return `<g data-view="${key}" aria-label="${label}"><text x="${fmt(x + w * scale / 2)}" y="${fmt(labelY)}" text-anchor="middle" fill="#f5f8ff" font-family="sans-serif" font-size="26" font-weight="800">${label}</text><path d="${path(views[key].outline.map(transform))}" fill="${COLOR}" stroke="${INK}" stroke-width="2.3" stroke-linejoin="round"/>${lineMarkup(views[key].edges, transform)}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(svgWidth)} ${fmt(svgHeight)}" role="img" aria-label="物件三視圖：上視圖在正視圖上方，右側視圖在正視圖右方">${panel('top', '上視圖', left, topBase, 32, width)}${panel('front', '正視圖', left, frontBase, topBase + 62, width)}${panel('right', '右側視圖', rightLeft, frontBase, topBase + 62, depth)}</svg>`;
}

// BSP painter order handles concave stairs/notches, rather than centroid sorting.
function paintOrder(faces, eye) {
  if (!faces.length) return [];
  const pivot = faces[0], n = normal(pivot.points), length = Math.hypot(...n);
  const unit = n.map(v => v / length), offset = dot(unit, pivot.points[0]);
  const front = [], back = [], coplanar = [pivot];
  for (const face of faces.slice(1)) {
    const distances = face.points.map(p => dot(unit, p) - offset);
    const positive = distances.some(d => d > EPS), negative = distances.some(d => d < -EPS);
    if (!positive && !negative) { coplanar.push(face); continue; }
    if (!negative) { front.push(face); continue; }
    if (!positive) { back.push(face); continue; }
    const f = [], b = [];
    face.points.forEach((p, i) => {
      const j = (i + 1) % face.points.length, d = distances[i], next = distances[j];
      if (d >= -EPS) f.push(p);
      if (d <= EPS) b.push(p);
      if ((d > EPS && next < -EPS) || (d < -EPS && next > EPS)) { const intersection = mix(p, face.points[j], d / (d - next)); f.push(intersection); b.push(intersection); }
    });
    if (f.length >= 3) front.push({ ...face, points: f });
    if (b.length >= 3) back.push({ ...face, points: b });
  }
  const near = dot(unit, eye) >= 0 ? front : back, far = near === front ? back : front;
  return [...paintOrder(far, eye), ...coplanar, ...paintOrder(near, eye)];
}

/** Fixed front/right/top isometric camera; every option uses the identical palette. */
export function objectPerspectiveSvg(object) {
  const mesh = objectMesh(object), camera = CAMERAS.perspective;
  const all = [...mesh.front, ...mesh.back].map(p => project(p, camera));
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(250 / (maxX - minX), 192 / (maxY - minY));
  const transform = p => [150 + (p[0] - (minX + maxX) / 2) * scale, 114 + (p[1] - (minY + maxY) / 2) * scale];
  const faces = mesh.faces.filter(points => dot(normal(points), camera.eye) > EPS).map(points => {
    const n = normal(points), length = Math.hypot(...n);
    const light = 0.72 + 0.28 * Math.max(0, dot(n.map(v => v / length), [0.25, -0.45, 0.85]));
    const color = [112, 220, 202].map(c => Math.round(c * light));
    return { points, color: `rgb(${color.join(',')})` };
  });
  const body = paintOrder(faces, camera.eye).map(face => `<path d="${path(face.points.map(p => transform(project(p, camera))))}" fill="${face.color}" stroke="${face.color}" stroke-width="0.45" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 228" role="img" aria-label="立體物件（固定正面、右側及上方視角）">${body}${lineMarkup(visibleEdges(mesh, camera), transform)}</svg>`;
}

const extrusion = (profile, depth) => ({ type: 'profile-extrusion', profile, depth });
const arc = (cx, cz, rx, rz, start, end, steps = 40) => Array.from({ length: steps + 1 }, (_, i) => { const t = start + (end - start) * i / steps; return [cx + rx * Math.cos(t), cz + rz * Math.sin(t)]; });
const BANK = [
  extrusion([[0, 0], [4, 0], [4, 3]], 2), // rising wedge
  extrusion([[0, 0], [4, 0], [0, 3]], 2.5), // falling wedge
  extrusion([[0, 0], [4, 0], [4, 1], [2, 3.6], [0, 1]], 2.2), // roof
  extrusion([[0, 0], [4, 0], [4, 1.5], [1.1, 3.3], [0, 1.5]], 2.8), // offset roof
  extrusion([[0, 0], [4, 0], [4, 2], [3, 3], [1, 3], [0, 2]], 2), // chamfered block
  extrusion([[0, 0], [4, 0], [4, 3], [2, 3], [2, 1.4], [0, 1.4]], 2), // two stairs
  extrusion([[0, 0], [4.5, 0], [4.5, 3.3], [3, 3.3], [3, 2.2], [1.5, 2.2], [1.5, 1.1], [0, 1.1]], 2.4),
  extrusion([[0, 0], [4.5, 0], [4.5, 1], [3, 1], [3, 2], [1.5, 2], [1.5, 3], [0, 3]], 1.7),
  extrusion(arc(2, 2, 2, 2, 0, Math.PI * 2, 64).slice(0, -1), 2.4), // cylinder
  extrusion(arc(2.6, 1.4, 2.6, 1.4, 0, Math.PI * 2, 64).slice(0, -1), 2), // elliptical cylinder
  extrusion(arc(2, 0, 2, 2, 0, Math.PI), 2.6), // half-cylinder
  extrusion([[0, 0], [4, 0], [4, 1], ...arc(2, 1, 2, 2, 0, Math.PI).slice(1)], 2), // integrated dome/plinth
  extrusion([[0, 0], [3.5, 0], ...arc(0, 0, 3.5, 3.5, 0, Math.PI / 2).slice(1)], 2), // quarter cylinder
  extrusion([[0, 0], [4, 0], [4, 3], [2.7, 3], [2.7, 1.2], [1.3, 1.2], [1.3, 3], [0, 3]], 2), // notch
  extrusion([[0, 0], [4.5, 0], [4.5, 1], [3, 1], [3, 3.5], [1.5, 3.5], [1.5, 1], [0, 1]], 2.3), // tower
  extrusion([[0, 0], [5, 0], [5, 1.2], [3.8, 3.2], [2.5, 1.5], [1.2, 3.2], [0, 1.2]], 2), // twin roof
  extrusion([[0, 0], [4.5, 0], [3.5, 2.8], [1, 2.8]], 2.5), // trapezoid
  extrusion([[0, 0], [2.5, 0], [3.5, 3.3], [0.7, 3.3]], 1.8), // leaning prism
  extrusion([[0, 0], [4.5, 0], [4.5, 1], [3, 1], [3, 2], [2, 3.5], [1, 2], [1, 1], [0, 1]], 2), // roof on pedestal
  extrusion([[0, 0], [4.5, 0], [4.5, 3], [3.3, 3], [3.3, 1], [1.2, 1], [1.2, 2], [0, 2]], 2.4), // unequal fork
  extrusion([[0, 0], [4, 0], [4, 1], [2.7, 1], [2.7, 3], [1.3, 3], [1.3, 2], [0, 2]], 3), // asymmetric ledges
  extrusion([[0, 0], [4, 0], [4, 0.8], [1.4, 3.4], [0, 3.4]], 1.8), // bevel ramp
  extrusion([[0, 0], [4, 0], [4, 3], [3, 3], [2, 1.6], [1, 3], [0, 3]], 2.6), // V notch
  extrusion([[0, 0], [4, 0], [4, 1], [3, 1], [3, 2.5], [1, 2.5], [1, 3.5], [0, 3.5]], 2) // descending unequal steps
];

/** Legacy profile bank remains available for old-save compatibility tests. */
export function objectQuestionBank() { return clone(BANK); }

const REAR_REGIONS = new Map();
function rearRegion(index) {
  if (REAR_REGIONS.has(index)) return REAR_REGIONS.get(index);
  const { profile } = geometry(BANK[index]);
  const width = Math.max(...profile.map(p => p[0])), height = Math.max(...profile.map(p => p[1]));
  let best = null, bestArea = 0;
  for (const cx of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const cz of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const w of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const h of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      if (w * h <= bestArea) continue;
      const x0 = (cx - w / 2) * width, x1 = (cx + w / 2) * width;
      const z0 = (cz - h / 2) * height, z1 = (cz + h / 2) * height;
      if (rectangleInside(profile, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]])) { best = [x0, z0, x1, z1]; bestArea = w * h; }
    }
  }
  if (!best) throw new Error('Question profile has no usable rear region');
  REAR_REGIONS.set(index, best);
  return best;
}

function steppedVariants(index) {
  const base = BANK[index], [x0, z0, x1, z1] = rearRegion(index);
  const cx = (x0 + x1) / 2;
  // Six primary choices: independent three-width by two-height combinations.
  const pairs = [0.38, 0.69, 1].flatMap(w => [0.42, 1].map(h => [w, h]));
  for (const w of [0.23, 0.38, 0.54, 0.69, 0.85, 1]) for (const h of [0.42, 0.61, 0.8, 1]) {
    if (!pairs.some(([a, b]) => a === w && b === h)) pairs.push([w, h]);
  }
  return pairs.map(([w, h]) => ({
    type: 'stepped-profile', profile: clone(base.profile), frontDepth: 0.65,
    depth: 3.8 + (index % 3) * 0.35,
    rear: [cx - (x1 - x0) * w / 2, z0, cx + (x1 - x0) * w / 2, z0 + (z1 - z0) * h]
  }));
}

export function generateObjectQuestion(round, randomInt = max => Math.floor(Math.random() * max), optionCount = 6) {
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > BANK.length) throw new RangeError(`optionCount must be between 2 and ${BANK.length}`);
  if (!Number.isInteger(round) || round < 1) throw new RangeError('round must be a positive integer (one-based)');
  if (typeof randomInt !== 'function') throw new TypeError('randomInt must be a function');
  const draw = max => { const value = randomInt(max); if (!Number.isInteger(value) || value < 0 || value >= max) throw new RangeError('randomInt(max) must return an integer in [0,max)'); return value; };
  const shuffle = items => { for (let i = items.length - 1; i > 0; i--) { const j = draw(i + 1); [items[i], items[j]] = [items[j], items[i]]; } return items; };
  const index = (round - 1) % BANK.length, variants = steppedVariants(index);
  const selected = variants.slice(0, optionCount), correctIndex = draw(Math.min(optionCount, 6));
  const object = clone(selected[correctIndex]);
  const choices = shuffle(selected.map((shape, i) => ({ object: clone(shape), correct: i === correctIndex }))).map((choice, i) => ({ id: String.fromCharCode(65 + i), ...choice }));
  return { kind: 'object_views', object, choices, correctId: choices.find(choice => choice.correct).id };
}
