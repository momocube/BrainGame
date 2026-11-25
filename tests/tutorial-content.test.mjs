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

  const mines = getGameTutorial("minesweeper", { ...rules.games.minesweeper, penaltySecondsPerDistinctMine: 19 });
  assert.match(mines.steps[2], /19 秒/);
});

test("special-game tutorials preserve poker phases and memory-sequence reset rules", () => {
  const poker = getGameTutorial("memory_poker", rules.games.memory_poker);
  assert.match(poker.steps[0], /記憶 20 秒/);
  assert.match(poker.schedule, /選牌 10 秒/);
  assert.match(poker.schedule, /揭曉 3 秒/);

  const sequence = getGameTutorial("memory_sequence", rules.games.memory_sequence);
  assert.match(sequence.steps[0], /2–6 秒/);
  assert.match(sequence.steps[1], /從 1 重來；不鎖答/);
  assert.match(sequence.steps[2], /3 顆心/);
  assert.match(sequence.schedule, /共 10 輪・每輪記憶 2–6 秒／作答 18 秒/);
});

test("unknown games cannot silently fall back to a generic tutorial", () => {
  assert.throws(() => getGameTutorial("unknown_game"), /沒有設定遊戲教學/);
});
