import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateObjectQuestion, objectOrthographicSvg, objectPerspectiveSvg,
  objectProjectionSignature, objectQuestionBank, objectMesh,
  objectOrthographicViews, objectVisibleEdges, objectViewSignature
} from '../public/object-views.mjs';

const solid = (profile, depth = 2) => ({ type: 'profile-extrusion', profile, depth });
const box = solid([[0, 0], [4, 0], [4, 3], [0, 3]]);
const seedRandom = seed => max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 0.0001, `${message} ${a} != ${b}`);
const signedArea = points => points.reduce((n, a, i) => { const b = points[(i + 1) % points.length]; return n + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const sub = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const renderBank = () => [...objectQuestionBank(), ...Array.from({ length: 24 }, (_, i) => generateObjectQuestion(i + 1, seedRandom(i)).choices.map(c => c.object)).flat()];

test('24 distinct serializable profiles cover arcs, bevels, concavity and proportions', () => {
  const bank = objectQuestionBank();
  assert.ok(bank.length >= 20);
  assert.equal(new Set(bank.map(objectProjectionSignature)).size, bank.length);
  assert.ok(bank.filter(o => o.profile.length >= 40).length >= 5, 'curved profiles use at least 40 segments');
  assert.deepEqual(JSON.parse(JSON.stringify(bank)), bank);
  const first = bank[0].profile[0][0];
  bank[0].profile[0][0] = 123;
  assert.equal(objectQuestionBank()[0].profile[0][0], first);
});

test('twenty rounds have distinct correct targets, six distinguishable options and one match', () => {
  for (let seed = 0; seed < 20; seed++) {
    const randomInt = seedRandom(seed), targets = new Set();
    for (let round = 1; round <= 20; round++) {
      const q = generateObjectQuestion(round, randomInt);
      assert.equal(q.kind, 'object_views');
      assert.equal(q.choices.length, 6);
      assert.deepEqual(q.choices.map(c => c.id), ['A', 'B', 'C', 'D', 'E', 'F']);
      assert.equal(q.choices.filter(c => c.correct).length, 1);
      const target = objectProjectionSignature(q.object);
      targets.add(target);
      const signatures = q.choices.map(c => objectProjectionSignature(c.object));
      assert.equal(new Set(signatures).size, 6);
      assert.equal(signatures.filter(s => s === target).length, 1);
      assert.equal(q.choices.find(c => c.correct).id, q.correctId);
      assert.deepEqual(q.choices.find(c => c.id === q.correctId).object, q.object);
      assert.deepEqual(JSON.parse(JSON.stringify(q)), q);
    }
    assert.equal(targets.size, 20);
  }
});

test('all 24 questions require top AND right: front alone never identifies an option', () => {
  for (let round = 1; round <= 24; round++) {
    const q = generateObjectQuestion(round, seedRandom(round));
    const signatures = q.choices.map(c => ['front', 'top', 'right'].map(view => objectViewSignature(c.object, view)));
    const target = signatures[q.choices.findIndex(c => c.correct)];
    assert.equal(new Set(signatures.map(s => s[0])).size, 1, `round ${round}: identical front linework`);
    assert.equal(new Set(signatures.map(s => s[1])).size, 3);
    assert.equal(new Set(signatures.map(s => s[2])).size, 2);
    assert.equal(new Set(signatures.map(s => JSON.stringify(s))).size, 6);
    assert.ok(signatures.some(s => s[0] === target[0] && s[1] === target[1] && s[2] !== target[2]), 'right is necessary');
    assert.ok(signatures.some(s => s[0] === target[0] && s[2] === target[2] && s[1] !== target[1]), 'top is necessary');
    assert.equal(new Set(q.choices.map(c => c.object.depth)).size, 1, 'not just thickness distractors');
    assert.equal(new Set(q.choices.map(c => objectPerspectiveSvg(c.object))).size, 6);
    for (let i = 0; i < q.choices.length; i++) {
      assert.equal(objectProjectionSignature(q.choices[i].object), signatures[i].join('|'), 'signature contains actual projected linework');
    }
  }
});

test('injected randomness is reproducible, shuffles answer position, and cannot hang', () => {
  assert.deepEqual(generateObjectQuestion(7, seedRandom(14)), generateObjectQuestion(7, seedRandom(14)));
  const positions = new Set(Array.from({ length: 30 }, (_, i) => generateObjectQuestion(1, seedRandom(i)).correctId));
  assert.ok(positions.size >= 4);
  assert.equal(generateObjectQuestion(1, () => 0).choices.length, 6);
  assert.equal(generateObjectQuestion(1, n => n - 1).choices.length, 6);
  assert.equal(generateObjectQuestion(25, () => 0).object.profile.length, objectQuestionBank()[0].profile.length);
  for (const count of [2, 8, 24]) assert.equal(generateObjectQuestion(3, () => 0, count).choices.length, count);
  for (const count of [0, 1, 25, 2.5]) assert.throws(() => generateObjectQuestion(1, () => 0, count), RangeError);
  for (const round of [0, -1, 1.5, NaN]) assert.throws(() => generateObjectQuestion(round, () => 0), RangeError);
  assert.throws(() => generateObjectQuestion(1, n => n), RangeError);
  assert.throws(() => generateObjectQuestion(1, () => -1), RangeError);
});

test('signature ignores translations, cycle start, winding and proportional scaling', () => {
  for (const original of objectQuestionBank()) {
    const shifted = solid(original.profile.map(([x, z]) => [x * 3 + 10, z * 3 - 5]), original.depth * 3);
    assert.equal(objectProjectionSignature(original), objectProjectionSignature(shifted));
    shifted.profile.reverse();
    shifted.profile.push(shifted.profile.shift());
    assert.equal(objectProjectionSignature(original), objectProjectionSignature(shifted));
  }
  assert.notEqual(objectProjectionSignature(box), objectProjectionSignature({ ...box, depth: 4 }));
  const redundant = solid([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]);
  assert.equal(objectProjectionSignature(box), objectProjectionSignature(redundant));
});

test('all surfaces form closed outward-facing meshes with actual extrusion volume', () => {
  for (const object of objectQuestionBank()) {
    const mesh = objectMesh(object), edges = new Map();
    let volume = 0;
    for (const face of mesh.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = JSON.stringify(face[i]), b = JSON.stringify(face[(i + 1) % face.length]);
        const key = [a, b].sort().join('|');
        const counts = edges.get(key) ?? [0, 0];
        counts[a < b ? 0 : 1]++;
        edges.set(key, counts);
      }
      for (let i = 1; i < face.length - 1; i++) volume += dot(face[0], cross(face[i], face[i + 1])) / 6;
    }
    for (const counts of edges.values()) assert.deepEqual(counts, [1, 1], 'every shared edge has opposite winding');
    near(volume, signedArea(mesh.profile) * object.depth, 'closed mesh volume');
    assert.ok(volume > 0);
  }
});

test('orthographic projection axes and dimensions share world coordinates', () => {
  const views = objectOrthographicViews(box);
  assert.deepEqual([views.width, views.height, views.depth], [4, 3, 2]);
  assert.deepEqual(views.front.outline, [[0, -0], [4, -0], [4, -3], [0, -3]]);
  assert.deepEqual(views.top.outline, [[0, 0], [4, 0], [4, -2], [0, -2]]);
  assert.deepEqual(views.right.outline, [[0, 0], [2, 0], [2, -3], [0, -3]]);
  for (const object of objectQuestionBank()) {
    const mesh = objectMesh(object), v = objectOrthographicViews(object);
    assert.deepEqual(v.front.outline, mesh.profile.map(([x, z]) => [x, -z]));
    for (const [key, axes] of [['front', [0, 2]], ['top', [0, 1]], ['right', [1, 2]]]) {
      const vertices = [...mesh.front, ...mesh.back];
      const projected = vertices.map(p => [p[axes[0]], -p[axes[1]]]);
      for (const axis of [0, 1]) {
        near(Math.min(...projected.map(p => p[axis])), Math.min(...v[key].outline.map(p => p[axis])));
        near(Math.max(...projected.map(p => p[axis])), Math.max(...v[key].outline.map(p => p[axis])));
      }
    }
  }
});

test('L diagram aligns front/top x, front/right z and uses one scale', () => {
  const svg = objectOrthographicSvg(box);
  const groups = Object.fromEntries([...svg.matchAll(/<g data-view="(\w+)"[^>]*>(.*?)<\/g>/g)].map(m => [m[1], m[2]]));
  const outline = name => [...groups[name].match(/<path d="([^"]+)"/)[1].matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const bounds = points => [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1]))];
  const f = bounds(outline('front')), t = bounds(outline('top')), r = bounds(outline('right'));
  near(f[0], t[0]); near(f[1], t[1]); near(f[2], r[2]); near(f[3], r[3]);
  assert.ok(t[3] < f[2]); assert.ok(r[0] > f[1]);
  near((f[1] - f[0]) / 4, (f[3] - f[2]) / 3);
  near((f[1] - f[0]) / 4, (t[3] - t[2]) / 2);
  near((f[1] - f[0]) / 4, (r[1] - r[0]) / 2);
  for (const text of ['正視圖', '上視圖', '右側視圖']) assert.ok(svg.includes(text));
});

test('visible perspective edges never run behind a surface (independent ray test)', () => {
  const u = [0.8, 0.6, 0], v = [0.3, -0.4, -1], eye = [0.6, -0.8, 0.5];
  const project = p => [dot(p, u), dot(p, v), dot(p, eye)];
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const object of renderBank()) {
    const triangles = objectMesh(object).faces.flatMap(face => Array.from({ length: face.length - 2 }, (_, i) => [face[0], face[i + 1], face[i + 2]].map(project)));
    for (const [a, b] of objectVisibleEdges(object)) for (const t of [0.2, 0.5, 0.8]) {
      const p = a.map((n, i) => n + (b[i] - n) * t);
      for (const tri of triangles) {
        const area = turn(...tri);
        if (Math.abs(area) < 1e-8) continue;
        const weights = [turn(tri[1], tri[2], p), turn(tri[2], tri[0], p), turn(tri[0], tri[1], p)].map(w => w / area);
        if (weights.some(w => w < -1e-7)) continue;
        const surfaceDepth = weights.reduce((n, w, i) => n + w * tri[i][2], 0);
        assert.ok(surfaceDepth <= p[2] + 1e-5, 'line sample must not be occluded');
      }
    }
  }
});

test('cylinder tessellation has no dense longitudinal wireframe seams', () => {
  const cylinder = objectQuestionBank()[8];
  const edges = objectVisibleEdges(cylinder);
  // Each ring has 64 sampled edges, but only the two silhouette generators survive.
  const depthAxis = [0.6, -0.4, -0.8];
  const generators = edges.filter(([a, b]) => {
    const delta = sub(b, a);
    return Math.hypot(...cross(delta, depthAxis)) < 1e-7;
  });
  assert.equal(generators.length, 2);
});

test('SVGs are deterministic, finite, shaded and fit their viewBox', () => {
  const renders = new Set();
  for (const object of renderBank()) {
    const before = JSON.stringify(object), svg = objectPerspectiveSvg(object);
    renders.add(svg);
    assert.equal(svg, objectPerspectiveSvg(JSON.parse(before)));
    assert.equal(before, JSON.stringify(object));
    assert.ok(new Set([...svg.matchAll(/fill="(rgb\([^)]+\))"/g)].map(m => m[1])).size >= 2, 'not a flat silhouette');
    for (const render of [svg, objectOrthographicSvg(object)]) {
      assert.ok(!/NaN|Infinity|undefined/.test(render));
      assert.ok(!/<script|<image|href=|https?:\/\/(?!www.w3.org)/.test(render));
      const [, width, height] = render.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
      for (const d of render.matchAll(/ d="([^"]+)"/g)) for (const p of d[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
        assert.ok(Number(p[1]) >= 2 && Number(p[1]) <= width - 2, `x in viewBox: ${p[1]}`);
        assert.ok(Number(p[2]) >= 2 && Number(p[2]) <= height - 2, `y in viewBox: ${p[2]}`);
      }
    }
  }
  assert.equal(renders.size, renderBank().length);
});

test('painted faces agree with nearest surfaces, including concave profiles', () => {
  const camera = { u: [0.8, 0.6, 0], v: [0.3, -0.4, -1], eye: [0.6, -0.8, 0.5] };
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const weights = (tri, p) => {
    const area = turn(...tri);
    if (Math.abs(area) < 1e-8) return null;
    const w = [turn(tri[1], tri[2], p), turn(tri[2], tri[0], p), turn(tri[0], tri[1], p)].map(n => n / area);
    return w.every(n => n > 0.00001) ? w : null;
  };
  for (const object of renderBank()) {
    const mesh = objectMesh(object);
    const projected = [...mesh.front, ...mesh.back].map(p => [dot(p, camera.u), dot(p, camera.v)]);
    const minX = Math.min(...projected.map(p => p[0])), maxX = Math.max(...projected.map(p => p[0]));
    const minY = Math.min(...projected.map(p => p[1])), maxY = Math.max(...projected.map(p => p[1]));
    const scale = Math.min(250 / (maxX - minX), 192 / (maxY - minY));
    const project = p => [150 + (dot(p, camera.u) - (minX + maxX) / 2) * scale, 114 + (dot(p, camera.v) - (minY + maxY) / 2) * scale, dot(p, camera.eye)];
    const surfaces = mesh.faces.flatMap(face => {
      const n = cross(sub(face[1], face[0]), sub(face[2], face[0]));
      if (dot(n, camera.eye) <= 1e-8) return [];
      const light = 0.72 + 0.28 * Math.max(0, dot(n.map(v => v / Math.hypot(...n)), [0.25, -0.45, 0.85]));
      const color = `rgb(${[112, 220, 202].map(c => Math.round(c * light)).join(',')})`;
      return Array.from({ length: face.length - 2 }, (_, i) => ({ triangle: [face[0], face[i + 1], face[i + 2]].map(project), color }));
    });
    const painted = [...objectPerspectiveSvg(object).matchAll(/<path d="([^"]+)" fill="(rgb\([^)]+\))"/g)].map(m => ({
      points: [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]), color: m[2]
    }));
    for (let x = 30.123; x < 275; x += 13) for (let y = 20.321; y < 210; y += 13) {
      const p = [x, y];
      let nearest = null, lastColor = null;
      for (const { triangle, color } of surfaces) {
        const w = weights(triangle, p);
        if (!w) continue;
        const depth = w.reduce((sum, n, i) => sum + n * triangle[i][2], 0);
        if (!nearest || depth > nearest.depth + 1e-7) nearest = { depth, color };
      }
      for (const { points, color } of painted) {
        for (let i = 1; i < points.length - 1; i++) if (weights([points[0], points[i], points[i + 1]], p)) lastColor = color;
      }
      if (nearest && lastColor) assert.equal(lastColor, nearest.color, 'BSP paints the nearest surface last');
    }
  }
});

test('stepped silhouettes equal the mesh projection, not a synthetic signature', () => {
  const inside = (polygon, point) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  for (const object of renderBank().filter(o => o.type === 'stepped-profile')) {
    const views = objectOrthographicViews(object);
    for (const name of ['front', 'top', 'right']) {
      const { outline, surfaces } = views[name];
      for (let x = 0.071; x < 5; x += 0.23) for (let y = -0.043; y > -5; y -= 0.23) {
        assert.equal(inside(outline, [x, y]), surfaces.some(tri => inside(tri, [x, y])), `${name} silhouette equals projected occupied area`);
      }
    }
    const scaled = { ...object, profile: object.profile.map(p => p.map(n => n * 2)), rear: object.rear.map(n => n * 2), frontDepth: object.frontDepth * 2, depth: object.depth * 2 };
    assert.equal(objectProjectionSignature(object), objectProjectionSignature(scaled));
  }
});

test('reject malformed stepped geometry and keep generated objects isolated', () => {
  const q = generateObjectQuestion(9, () => 0), valid = q.object;
  for (const invalid of [{ ...valid, frontDepth: -1 }, { ...valid, depth: valid.frontDepth }, { ...valid, rear: [-10, 0, 1, 1] }, { ...valid, rear: [0, 0, NaN, 1] }, { ...valid, rear: [1, 1, 1, 2] }]) {
    assert.throws(() => objectMesh(invalid), TypeError);
  }
  const before = JSON.stringify(q.choices);
  q.object.profile[0][0] = 123;
  assert.equal(JSON.stringify(q.choices), before);
  assert.notEqual(generateObjectQuestion(9, () => 0).object.profile[0][0], 123);
});

test('reject malformed/unsupported geometry rather than emitting broken SVG', () => {
  const invalid = [null, {}, { ...box, depth: 0 }, { ...box, depth: Infinity }, solid([[0, 0], [1, NaN], [2, 0]]), solid([[0, 0], [1, 1], [2, 2]]), solid([[0, 0], [2, 2], [0, 2], [2, 0]]), solid([[0, 0], [1, 0], [1, 0], [0, 1]])];
  for (const object of invalid) {
    assert.throws(() => objectPerspectiveSvg(object), TypeError);
    assert.throws(() => objectOrthographicSvg(object), TypeError);
    assert.throws(() => objectProjectionSignature(object), TypeError);
  }
});
