import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPerspectiveSceneSvg } from '../public/map-scene.mjs';

test('map perspective scene contains a bounded corridor and projects visible clues by side and depth', () => {
  const svg = renderPerspectiveSceneSvg([
    { label: '◆', side: 'left', depth: 'near' },
    { label: '▲', side: 'right', depth: 'far' }
  ]);

  assert.match(svg, /viewBox="0 0 1000 600"/);
  assert.match(svg, /aria-label="第一人稱走廊場景與可辨識地標"/);
  assert.equal((svg.match(/<polygon /g) ?? []).length, 5, 'ceiling, walls, end opening, and floor are rendered');
  assert.ok((svg.match(/<line /g) ?? []).length >= 15, 'floor and wall perspective grids are present');
  assert.match(svg, /<circle cx="255" cy="380"/);
  assert.match(svg, /<text x="255" y="390\.2"[^>]*>◆<\/text>/);
  assert.match(svg, /<circle cx="625" cy="286"/);
  assert.match(svg, /<text x="625" y="292\.8"[^>]*>▲<\/text>/);
});

test('map perspective scene escapes clue labels before writing SVG markup', () => {
  const svg = renderPerspectiveSceneSvg([{ label: '<img src=x&y>', side: 'center', depth: 'near' }]);
  assert.match(svg, /&lt;img src=x&amp;y&gt;/);
  assert.doesNotMatch(svg, /<img/);
});
