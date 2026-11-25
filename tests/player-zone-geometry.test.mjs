import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolvePlayerLayout } from '../src/player-layouts.mjs';
import { validatePlayerZoneConfig } from '../src/player-zone-geometry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layout = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-zones.704.json'), 'utf8')),
  profilePlan: JSON.parse(fs.readFileSync(path.join(ROOT, 'config/player-layouts.704.json'), 'utf8'))
};
const touchProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/venue-704.json'), 'utf8'));

test('704 player-zone configuration stays within real TouchService faces and clear of the entrance', () => {
  assert.equal(validatePlayerZoneConfig(layout, touchProfile), true);
});

test('CAD player zones rotate back onto the matching native TouchService faces and upright directions', () => {
  const cadToServiceRect = (rect) => ({
    x: rect.y,
    y: 3328 - rect.x - rect.width,
    width: rect.height,
    height: rect.width
  });
  const mapped = [
    { id: 'P1', face: 0, rect: { x: 0, y: 1984, width: 640, height: 640 }, rotation: 270, side: 'left' },
    { id: 'P2', face: 0, rect: { x: 0, y: 1344, width: 640, height: 640 }, rotation: 270, side: 'left' },
    { id: 'P3', face: 0, rect: { x: 0, y: 704, width: 640, height: 640 }, rotation: 270, side: 'left' },
    { id: 'P4', face: 1, rect: { x: 704, y: 2688, width: 640, height: 640 }, rotation: 180, side: 'bottom' },
    { id: 'P5', face: 1, rect: { x: 1344, y: 2688, width: 640, height: 640 }, rotation: 180, side: 'bottom' },
    { id: 'P6', face: 3, rect: { x: 704, y: 0, width: 640, height: 640 }, rotation: 0, side: 'top' },
    { id: 'P7', face: 3, rect: { x: 1344, y: 0, width: 640, height: 640 }, rotation: 0, side: 'top' },
    { id: 'P8', face: 4, rect: { x: 2048, y: 640, width: 640, height: 640 }, rotation: 90, side: 'right' }
  ];
  const reservedSideRotation = { top: 0, right: 90, bottom: 180, left: 270 };
  for (const item of mapped) {
    const zone = layout.players.find((player) => player.id === item.id);
    assert.deepEqual(cadToServiceRect(zone.rect), item.rect, `${item.id} lands on the expected service face coordinates`);
    assert.equal(zone.sources[0].face, item.face, `${item.id} receives input from its matching TouchService face`);
    assert.equal((zone.rotationDegrees + 270) % 360, item.rotation, `${item.id} rotates with the CAD-to-service transform`);
    assert.equal(item.rotation, reservedSideRotation[item.side], `${item.id} text direction matches the physical wall side`);
  }
  const entrance = layout.reservedRects.find((item) => item.id === 'entrance-clearance').rect;
  const p8 = mapped.find((item) => item.id === 'P8').rect;
  const entranceServiceRect = cadToServiceRect(entrance);
  assert.deepEqual(entranceServiceRect, { x: 2048, y: 1920, width: 640, height: 512 },
    'the blocked entrance face maps to its native TouchService rectangle');
  assert.equal(p8.y + p8.height, entranceServiceRect.y - 640,
    'P8 remains on the same entrance-side wall, 640 px beyond the doorway clearance');
  const css = fs.readFileSync(path.join(ROOT, 'public/stage.css'), 'utf8');
  assert.match(css, /#projection-canvas\{[^}]*width:100vw;height:100vh/);
  assert.match(css, /#venue\{[^}]*width:3328px;height:2688px;[^}]*rotate\(-90deg\) scale\(var\(--venue-scale,1\)\)/);
  const stageJs = fs.readFileSync(path.join(ROOT, 'public/stage.js'), 'utf8');
  assert.match(stageJs, /rotate\(\$\{zone\.rotationDegrees\}deg\)/,
    'each player-facing UI applies its local wall orientation before projection');
});

test('P8 uses the outer entrance-side wall segment and leaves 640 px to the exit clearance', () => {
  const p8 = layout.players.find((player) => player.id === 'P8');
  const entrance = layout.reservedRects.find((item) => item.id === 'entrance-clearance').rect;
  assert.equal(p8.rect.x, 2048);
  assert.equal(p8.sources[0].x, p8.rect.x);
  assert.equal(p8.rect.x - (entrance.x + entrance.width), 640);
});

test('player display and touch regions cannot cover the entrance clearance', () => {
  const invalid = structuredClone(layout);
  invalid.players[7].rect = structuredClone(invalid.reservedRects[0].rect);
  assert.throws(() => validatePlayerZoneConfig(invalid, touchProfile), /覆蓋入口保留區/);

  const badSource = structuredClone(layout);
  badSource.players[7].sources[0] = { face: 5, x: 896, y: 2048, width: 640, height: 640 };
  assert.throws(() => validatePlayerZoneConfig(badSource, touchProfile), /入口保留區|有效牆面|忽略或裝飾用 face/);
});

test('player areas cannot overlap one another or share a TouchService hit region', () => {
  const overlappingView = structuredClone(layout);
  overlappingView.players[1].rect = structuredClone(overlappingView.players[0].rect);
  assert.throws(() => validatePlayerZoneConfig(overlappingView, touchProfile), /顯示區重疊/);

  const misalignedSource = structuredClone(layout);
  misalignedSource.players[0].sources[0].x += 64;
  assert.throws(() => validatePlayerZoneConfig(misalignedSource, touchProfile), /沒有一對一對齊/);

  const overlappingSource = structuredClone(layout);
  overlappingSource.players[1].sources[0] = structuredClone(overlappingSource.players[0].sources[0]);
  assert.throws(() => validatePlayerZoneConfig(overlappingSource, touchProfile), /觸控來源與/);
});

test('ignored floor and decorative faces cannot become player input sources', () => {
  for (const face of [2, 6]) {
    const invalid = structuredClone(layout);
    invalid.players[0].sources[0].face = face;
    assert.throws(() => validatePlayerZoneConfig(invalid, touchProfile), /不可使用忽略或裝飾用 face/);
  }
});

test('4–8 player counts resolve to the approved CAVE profiles and ordered player IDs', () => {
  const expected = {
    4: ['對面長牆玩家 A', '左側玩家 A', '右側玩家 A', '入口側外側玩家'],
    5: ['對面長牆玩家 A', '對面長牆玩家 B', '左側玩家 A', '右側玩家 A', '入口側外側玩家'],
    6: ['對面長牆玩家 A', '對面長牆玩家 B', '左側玩家 A', '左側玩家 B', '右側玩家 A', '右側玩家 B'],
    7: ['對面長牆玩家 A', '對面長牆玩家 B', '左側玩家 A', '左側玩家 B', '右側玩家 A', '右側玩家 B', '入口側外側玩家'],
    8: layout.players.map((player) => player.name)
  };
  for (const count of [4, 5, 6, 7, 8]) {
    const resolved = resolvePlayerLayout(layout, count);
    assert.equal(resolved.players.length, count);
    assert.deepEqual(resolved.players.map((player) => player.id), Array.from({ length: count }, (_, index) => `P${index + 1}`));
    assert.deepEqual(resolved.players.map((player) => player.name), expected[count]);
    assert.equal(validatePlayerZoneConfig(layout, touchProfile), true);
  }
});

test('4-player question panels are output-only and stay clear of touch zones and entrance', () => {
  const resolved = resolvePlayerLayout(layout, 4);
  assert.equal(resolved.questionDisplayMode, 'player-panels');
  assert.equal(resolved.questionPanels.length, 4);
  assert.ok(resolved.questionPanels.every((panel, index) => panel.playerId === `P${index + 1}`));
  assert.ok(resolved.questionPanels.every((panel) => !Object.hasOwn(panel, 'sources')));
  const stageJs = fs.readFileSync(path.join(ROOT, 'public/stage.js'), 'utf8');
  const panelRenderer = stageJs.match(/function renderQuestionPanel\(panel, data\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(panelRenderer, '4-player question panels have a dedicated renderer');
  assert.match(panelRenderer, /content\.style\.transform = `rotate\(\$\{panel\.rotationDegrees\}deg\)`;/,
    'question content only applies its wall orientation; venue fitting scales the whole scene once');
  assert.doesNotMatch(panelRenderer, /\bscale\(/,
    'question panels must not apply the venue fit scale a second time');
  const invalid = structuredClone(layout);
  invalid.profilePlan.questionPanelSlots['top-question'].face = 5;
  invalid.profilePlan.questionPanelSlots['top-question'].rect = structuredClone(layout.reservedRects[0].rect);
  assert.throws(() => validatePlayerZoneConfig(invalid, touchProfile), /題目區覆蓋入口保留區/);
});

test('shared exit strip occupies a fixed real wall gap for every player layout', () => {
  const control = layout.sharedExitControl;
  assert.deepEqual(control.rect, { x: 640, y: 2048, width: 256, height: 640 });
  assert.equal(control.face, 6);
  assert.equal(touchProfile.faces[control.face].name, 'Wall Right little');
  assert.equal(control.rotationDegrees, 180);
  assert.deepEqual({ x: control.rect.y, y: 3328 - control.rect.x - control.rect.width,
    width: control.rect.height, height: control.rect.width },
  { x: 2048, y: 2432, width: 640, height: 256 }, 'maps onto the native east small wall');
  assert.equal((control.rotationDegrees + 270) % 360, 90, 'east wall text faces the same direction as P8');
  assert.equal(validatePlayerZoneConfig(layout, touchProfile), true);
  const overlap = structuredClone(layout);
  overlap.sharedExitControl.face = 0;
  overlap.sharedExitControl.rect = { x: 704, y: 0, width: 64, height: 640 };
  assert.throws(() => validatePlayerZoneConfig(overlap, touchProfile), /退出按鈕.*重疊/);
  const wrongFace = structuredClone(layout);
  wrongFace.sharedExitControl.face = 5;
  assert.throws(() => validatePlayerZoneConfig(wrongFace, touchProfile), /退出按鈕.*牆面/);
});
