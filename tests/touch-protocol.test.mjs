import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TouchFrameGuard, validateTouchServiceHello } from '../src/touch-protocol.mjs';
import { TouchDiagnostics } from '../src/touch-diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));

function hello() {
  return {
    type: 'hello', v: 1, venue: profile.venue,
    canvas: { w: profile.canvas.width, h: profile.canvas.height },
    releaseTimeoutMs: 170,
    faces: profile.faces.map((face, index) => {
      const vertical = face.orientation === 'vertical';
      const cellW = vertical ? 32 : 16, cellH = vertical ? 16 : 32;
      return {
        index, name: face.name, originX: face.originX, originY: face.originY,
        width: face.colCount * cellW, height: face.rowCount * cellH,
        cols: face.colCount, rows: face.rowCount, cellW, cellH
      };
    })
  };
}

function frame(seq, { events = [], alive = [] } = {}) {
  return {
    v: 1, seq, t: 1_765_432_100_123, venue: profile.venue,
    canvas: { w: profile.canvas.width, h: profile.canvas.height }, events, alive
  };
}

test('TouchService hello must match the 704 canvas and every face geometry', () => {
  assert.equal(validateTouchServiceHello(hello(), profile), true);

  const wrongCanvas = hello();
  wrongCanvas.canvas.w++;
  assert.throws(() => validateTouchServiceHello(wrongCanvas, profile), /畫布尺寸/);

  const wrongFace = hello();
  wrongFace.faces[3].originY++;
  assert.throws(() => validateTouchServiceHello(wrongFace, profile), /face 3 的 originY/);

  for (const releaseTimeoutMs of [undefined, 0, 10_001, 170.5, '170']) {
    const invalidTimeout = hello();
    if (releaseTimeoutMs === undefined) delete invalidTimeout.releaseTimeoutMs;
    else invalidTimeout.releaseTimeoutMs = releaseTimeoutMs;
    assert.throws(() => validateTouchServiceHello(invalidTimeout, profile), /releaseTimeoutMs/);
  }
});

test('Touch frame guard rejects duplicate or backward sequence numbers but accepts gaps', () => {
  const guard = new TouchFrameGuard(profile);
  assert.equal(guard.accept(frame(20)), true);
  assert.equal(guard.accept(frame(20)), false);
  assert.equal(guard.accept(frame(19)), false);
  assert.equal(guard.accept(frame(23)), true);
});

test('Touch frame guard checks canvas, face, coordinates, and full alive IDs', () => {
  const guard = new TouchFrameGuard(profile);
  assert.throws(() => guard.accept({ ...frame(1), canvas: { w: 640, h: 480 } }), /frame 畫布尺寸/);
  assert.throws(() => guard.accept(frame(1, { alive: [4, 4] })), /alive/);
  assert.throws(() => guard.accept(frame(1, { events: [{ id: 1, phase: 'down', face: 7, px: [1, 1] }] })), /face/);
  assert.throws(() => guard.accept(frame(1, { events: [{ id: 1, phase: 'down', face: 0, px: [2689, 1] }] })), /px/);
});

test('Touch frame guard catches reused IDs and can reset after a service restart', () => {
  const guard = new TouchFrameGuard(profile);
  const down = { id: 7, phase: 'down', face: 0, px: [100, 100] };
  const up = { id: 7, phase: 'up', face: 0, px: [100, 100] };
  assert.equal(guard.accept(frame(1, { events: [down], alive: [7] })), true);
  assert.equal(guard.accept(frame(2, { events: [up], alive: [] })), true);
  assert.throws(() => guard.accept(frame(3, { events: [down], alive: [7] })), /Touch ID/);

  guard.reset();
  assert.equal(guard.accept(frame(1, { events: [{ ...down, id: 1 }], alive: [1] })), true);
});

test('touch diagnostics maps live points to player views without exposing game state', () => {
  let now = 1_000;
  const diagnostics = new TouchDiagnostics({
    canvas: { width: 3328, height: 2688 },
    zones: [{ id: 'P1', name: '玩家 1', rotationDegrees: 0, rect: { x: 704, y: 0, width: 640, height: 640 }, sources: [{ face: 0 }] }],
    reservedRects: [{ id: 'entrance', name: '入口', rect: { x: 896, y: 2048, width: 512, height: 640 } }],
    faces: profile.faces,
    clock: () => now,
    mapTouch: (event) => ({
      cadPoint: { x: 3328 - event.px[1], y: event.px[0] },
      position: event.face === 0 ? { zoneId: 'P1', u: .25, v: .5 } : null
    }),
    recentLimit: 2
  });
  diagnostics.accept(frame(1, {
    events: [{ id: 10, phase: 'down', face: 0, px: [320, 2624] }], alive: [10]
  }));
  let snapshot = diagnostics.snapshot({ ready: true, detail: '704 verified', releaseTimeoutMs: 170 });
  assert.equal(snapshot.input.ready, true);
  assert.equal(snapshot.input.releaseTimeoutMs, 170);
  assert.equal(snapshot.active[0].position.zoneId, 'P1');
  assert.deepEqual(snapshot.active[0].cadPoint, { x: 704, y: 320 });
  assert.equal(snapshot.zones[0].id, 'P1');
  assert.equal(Object.hasOwn(snapshot, 'currentRound'), false);

  now += 25;
  diagnostics.accept(frame(2, {
    events: [{ id: 10, phase: 'up', face: 0, px: [320, 2624] }], alive: []
  }));
  snapshot = diagnostics.snapshot();
  assert.equal(snapshot.active.length, 0);
  assert.equal(snapshot.recent.at(-1).phase, 'up');

  diagnostics.clear();
  assert.equal(diagnostics.snapshot().active.length, 0);
  assert.equal(diagnostics.snapshot().lastFrameAt, null);
  diagnostics.reset();
  assert.equal(diagnostics.snapshot().recent.length, 0);
  assert.equal(diagnostics.snapshot().frameSeq, null);
  assert.equal(diagnostics.snapshot().input.releaseTimeoutMs, null);
});
