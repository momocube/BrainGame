import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getGameTutorial } from "../public/tutorial-content.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = JSON.parse(fs.readFileSync(path.join(root, "config/game-rules.v1.json"), "utf8"));

test("each configured game has player-facing instructions and timing based on its rules", () => {
  for (const [gameId, config] of Object.entries(rules.games)) {
    const guide = getGameTutorial(gameId, config);
    assert.ok(guide.goal.length > 0, `${gameId} has a clear objective`);
    assert.equal(guide.steps.length, 3, `${gameId} explains three actionable steps`);
    assert.ok(guide.steps.every((step) => step.length > 0), `${gameId} has no blank instructions`);
    assert.ok(guide.schedule.length > 0, `${gameId} explains its timing`);
    assert.match(guide.schedule, new RegExp(String(config.rounds)), `${gameId} timing reflects configured rounds`);
  }
});

test("numeric and choice-game tutorials reflect editable penalties and round lengths", () => {
  const zero = getGameTutorial("zero_sum_grid", { ...rules.games.zero_sum_grid, wrongAnswerLockSeconds: 21, playSeconds: 75 });
  assert.match(zero.steps[0], /5×5/);
  assert.match(zero.steps[2], /21 秒/);
  assert.match(zero.schedule, /75 秒/);

  const puzzle = getGameTutorial("solid_puzzle", { ...rules.games.solid_puzzle, wrongAnswerLockSeconds: 12 });
  assert.match(puzzle.steps[2], /12 秒/);
  assert.match(puzzle.steps[1], /現有物件，不是缺口/);
  const legacy = { ...rules.games.solid_puzzle }; delete legacy.questionMode;
  assert.match(getGameTutorial('solid_puzzle', legacy).steps[1], /黃色表示缺口/);

  const mines = getGameTutorial("minesweeper", { ...rules.games.minesweeper, penaltySecondsPerDistinctMine: 19 });
  assert.match(mines.steps[2], /19 秒/);
});

test("special-game tutorials preserve poker phases and memory-sequence reset rules", () => {
  const poker = getGameTutorial("memory_poker", rules.games.memory_poker);
  assert.match(poker.steps[0], /記憶 16 張牌 20 秒/);
  assert.match(poker.schedule, /選牌 10 秒/);
  assert.match(poker.schedule, /揭曉 3 秒/);

  const sequence = getGameTutorial("memory_sequence", rules.games.memory_sequence);
  assert.match(sequence.steps[0], /2–6 秒/);
  assert.match(sequence.steps[1], /從 1 重來；不鎖答/);
  assert.match(sequence.steps[1], /黑色空格不扣心/);
  assert.match(sequence.steps[2], /3 顆心/);
  assert.match(sequence.schedule, /共 10 輪・每輪記憶 2–6 秒／作答 18 秒/);
});

test("unknown games cannot silently fall back to a generic tutorial", () => {
  assert.throws(() => getGameTutorial("unknown_game"), /沒有設定遊戲教學/);
});

import { sharedTutorialWalls, illustratedTutorial } from '../public/tutorial-presentation.mjs';

test('shared tutorials group eight player areas and the random menu into four safe walls', () => {
  const zones = JSON.parse(fs.readFileSync(path.join(root, 'config/player-zones.704.json'), 'utf8'));
  const walls = sharedTutorialWalls([...zones.players, ...zones.menuExtraZones]);
  assert.equal(walls.length, 4);
  assert.deepEqual(walls.map(w=>w.rotationDegrees).sort((a,b)=>a-b), [0,90,180,270]);
  const overlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  for (const wall of walls) {
    const sideways = wall.rotationDegrees % 180 !== 0;
    assert.ok((sideways ? wall.rect.height : wall.rect.width) >= 1280);
    assert.equal(sideways ? wall.rect.width : wall.rect.height, 640);
    for (const reserved of [...zones.reservedRects, zones.sharedExitControl]) assert.equal(overlap(wall.rect,reserved.rect),false);
  }
  for(const zone of [...zones.players,...zones.menuExtraZones]) {
    assert.equal(walls.filter(w => w.rotationDegrees===zone.rotationDegrees && overlap(w.rect,zone.rect)).length,1);
  }
});

test('all eight games have three concise illustrated tutorial steps', () => {
  for(const id of Object.keys(rules.games)) {
    const story=illustratedTutorial(id);
    assert.equal(story.frames.length,3);
    assert.ok(story.steps.every(s=>s.length<=16));
    if(!['cube_count','solid_puzzle'].includes(id)) assert.ok(story.frames.every(f=>f.svg.includes('<svg') && f.svg.includes('</svg>')));
  }
  assert.throws(()=>illustratedTutorial('unknown_game'), /沒有圖解教學/);
});

test('new object-view tutorial explains L layout and solid choices instead of map coordinates', () => {
  const config=rules.games.map_view;
  const guide=getGameTutorial('map_view',config);
  assert.match(guide.goal,/六個立體物件/);
  assert.match(guide.steps.join(' '),/L 型/);
  assert.match(guide.steps.join(' '),/上方確定/);
  const story=illustratedTutorial('map_view',config);
  assert.ok(story.frames.every(f=>f.svg.includes('<svg')));
  assert.match(story.steps[0],/三視圖/);
  const old=structuredClone(config);delete old.questionMode;
  assert.match(getGameTutorial('map_view',old).goal,/拍攝者/);
});
