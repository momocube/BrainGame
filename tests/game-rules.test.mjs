import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyEditableRuleSettings, getEditableRuleSettings, validateGameRules } from '../src/game-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-rules.v1.json'), 'utf8'));

function changedRules(change) {
  const rules = structuredClone(defaults);
  change(rules);
  return rules;
}

test('default game rules validate and round-trip through the editable settings view', () => {
  assert.deepEqual(validateGameRules(structuredClone(defaults)), defaults);
  const settings = getEditableRuleSettings(defaults);
  const restored = applyEditableRuleSettings(defaults, settings);
  assert.deepEqual(getEditableRuleSettings(restored), settings);
  assert.equal(Object.keys(settings.games).length, 8);
});

test('older saved rules without numeric field rectangles remain valid for recovery', () => {
  const legacy = structuredClone(defaults);
  delete legacy.common.layout.numericEntryRect;
  delete legacy.common.layout.numericKeypadRect;
  delete legacy.common.layout.numericConfirmRect;
  assert.equal(validateGameRules(legacy).rulesVersion, defaults.rulesVersion);
});

test('memory sequence distinguishes empty cells and wrong-order repeats while accepting legacy snapshots', () => {
  assert.equal(defaults.games.memory_sequence.emptyCellCountsAsError, false);
  assert.equal(defaults.games.memory_sequence.previouslyCompletedCellCountsAsError, true);
  const legacy = structuredClone(defaults);
  delete legacy.games.memory_sequence.emptyCellCountsAsError;
  delete legacy.games.memory_sequence.previouslyCompletedCellCountsAsError;
  legacy.games.memory_sequence.emptyOrPreviouslyCompletedCellCountsAsError = true;
  assert.deepEqual(validateGameRules(legacy), legacy);
  const malformed = structuredClone(defaults);
  malformed.games.memory_sequence.emptyCellCountsAsError = 'false';
  assert.throws(() => validateGameRules(malformed), /emptyCellCountsAsError/);
});

test('map view wall layout places the six answer keys beneath the map and above confirmation', () => {
  const map = defaults.games.map_view;
  assert.deepEqual(map.mapPanelRect, { x: 0, y: 128, width: 640, height: 256 });
  assert.deepEqual(map.choiceGridRect, { x: 0, y: 384, width: 640, height: 192 });
  assert.equal(map.choiceGridColumns * map.choiceGridRows, map.optionCount);
  assert.equal(map.choiceGridRect.y, map.mapPanelRect.y + map.mapPanelRect.height);
  assert.equal(map.confirmRect.y, map.choiceGridRect.y + map.choiceGridRect.height);
});

test('editable settings change only supported fields and default every game to enabled', () => {
  const settings = getEditableRuleSettings(defaults);
  assert.equal(settings.games.memory_sequence.enabled, true);
  settings.games.minesweeper.penaltySecondsPerDistinctMine = 18;
  settings.games.memory_sequence.enabled = false;
  const updated = applyEditableRuleSettings(defaults, settings);
  assert.equal(updated.games.minesweeper.penaltySecondsPerDistinctMine, 18);
  assert.equal(updated.games.memory_sequence.enabled, false);
  assert.equal(updated.games.memory_sequence.rounds, defaults.games.memory_sequence.rounds);
});

test('fixed six-choice layouts cannot be changed through staff settings or the rules file', () => {
  for (const gameId of ['solid_puzzle', 'map_view']) {
    const settings = getEditableRuleSettings(defaults);
    assert.equal(Object.hasOwn(settings.games[gameId], 'optionCount'), false,
      `${gameId} keeps its six-control layout out of editable settings`);

    const attemptedEdit = structuredClone(settings);
    attemptedEdit.games[gameId].optionCount = 5;
    assert.throws(() => applyEditableRuleSettings(defaults, attemptedEdit), /不允許從後台修改/);

    for (const optionCount of [5, 7]) {
      const invalidRules = structuredClone(defaults);
      invalidRules.games[gameId].optionCount = optionCount;
      assert.throws(() => validateGameRules(invalidRules), /optionCount 必須固定為 6/);
    }
  }
});

test('game rules reject disabling every game and unsupported structural edits', () => {
  const allDisabled = getEditableRuleSettings(defaults);
  for (const game of Object.values(allDisabled.games)) game.enabled = false;
  assert.throws(() => applyEditableRuleSettings(defaults, allDisabled), /至少要啟用一款/);

  const structuralEdit = getEditableRuleSettings(defaults);
  structuralEdit.games.minesweeper.boardColumns = 12;
  assert.throws(() => applyEditableRuleSettings(defaults, structuralEdit), /不允許從後台修改/);

  const missingGame = structuredClone(defaults);
  delete missingGame.games.memory_sequence;
  assert.throws(() => validateGameRules(missingGame), /缺少必要遊戲：memory_sequence/);

  const unsupportedRanking = structuredClone(defaults);
  unsupportedRanking.games.zero_sum_grid.ranking = 'first_touch_wins';
  assert.throws(() => validateGameRules(unsupportedRanking), /zero_sum_grid.ranking 設定不支援/);

  const missingCompletionRule = structuredClone(defaults);
  delete missingCompletionRule.games.minesweeper.endCondition;
  assert.throws(() => validateGameRules(missingCompletionRule), /minesweeper 缺少 endCondition/);

  const wrongBoardDirection = structuredClone(defaults);
  wrongBoardDirection.games.minesweeper.boardRowNumbering = 'bottom_to_top';
  assert.throws(() => validateGameRules(wrongBoardDirection), /minesweeper.boardRowNumbering 設定不支援/);
});

test('round counts stay aligned with per-round arrays and difficulty bands', () => {
  const missingRound = getEditableRuleSettings(defaults);
  missingRound.games.minesweeper.rounds = 6;
  assert.throws(() => applyEditableRuleSettings(defaults, missingRound), /必須恰好包含 6 輪設定/);

  const gap = getEditableRuleSettings(defaults);
  gap.games.zero_sum_grid.difficultyBands[1].firstRound = 5;
  assert.throws(() => applyEditableRuleSettings(defaults, gap), /必須連續/);
});

test('game rules enforce playable bounds for map and mine settings', () => {
  const noClues = getEditableRuleSettings(defaults);
  noClues.games.map_view.minimumDistinctVisibleClues = 4;
  assert.throws(() => applyEditableRuleSettings(defaults, noClues), /地圖地標數不可少於/);

  const tooManyMines = getEditableRuleSettings(defaults);
  tooManyMines.games.minesweeper.minesByRound[0] = 80;
  assert.throws(() => applyEditableRuleSettings(defaults, tooManyMines), /保留安全起點周圍空格/);
});

test('common timing, scoring, and input geometry reject malformed runtime settings', () => {
  const cases = [
    [rules => { rules.common.sessionDurationSeconds = 0; }, /common.sessionDurationSeconds/],
    [rules => { rules.common.scoring.storageUnitsPerPoint = 0; }, /common.scoring.storageUnitsPerPoint/],
    [rules => { rules.common.scoring.storageUnitsPerPoint = 1; }, /common.scoring.storageUnitsPerPoint/],
    [rules => { rules.common.scoring.storageUnitsPerPoint = 3; }, /必須是偶數/],
    [rules => { rules.common.scoring.gameSetBonusPoints = 1.5; }, /common.scoring.gameSetBonusPoints/],
    [rules => { rules.common.freezeAllClocksWhilePausedAndResuming = 'yes'; }, /必須是布林值/],
    [rules => { rules.common.layout.interactiveRect.y = 600; }, /超出玩家介面範圍/],
    [rules => { rules.common.layout.numericKeypadRect.y = 270; }, /必須連續填滿可操作區/],
    [rules => { delete rules.common.layout.numericKeypadRect; }, /必須一起設定/],
    [rules => { rules.common.layout.numericKeypadKeys[0] = '0'; }, /numericKeypadKeys 必須恰好包含/],
    [rules => { delete rules.common.sessionDurationSeconds; }, /common 缺少 sessionDurationSeconds/],
    [rules => { delete rules.rulesVersion; }, /rulesVersion 必須是非空文字/]
  ];
  for (const [change, error] of cases) assert.throws(() => validateGameRules(changedRules(change)), error);
});

test('numeric game inputs validate bounds and game-specific answer limits', () => {
  const cases = [
    [rules => { rules.games.zero_sum_grid.numericInputMinimum = -1; }, /zero_sum_grid.numericInputMinimum/],
    [rules => { rules.games.zero_sum_grid.numericInputMaximum = 64; }, /必須包含 0 且不可超過 63/],
    [rules => { rules.games.zero_sum_grid.numericInputMaximum = 2; rules.games.zero_sum_grid.numericInputMinimum = 3; }, /numericInputMaximum/],
    [rules => { rules.games.cube_count.numericInputMinimum = 0; }, /必須是 1 到 150 之內/],
    [rules => { rules.games.cube_count.numericInputMaximum = 151; }, /必須是 1 到 150 之內/],
    [rules => { rules.games.cube_count.numericInputMaximum = '150'; }, /numericInputMaximum/]
  ];
  for (const [change, error] of cases) assert.throws(() => validateGameRules(changedRules(change)), error);
});

test('numeric keypad layout puts confirm, correction, and restart in the approved positions', () => {
  const layout = defaults.common.layout;
  assert.deepEqual(layout.numericEntryRect, { x: 0, y: 128, width: 640, height: 144 });
  assert.deepEqual(layout.numericKeypadRect, { x: 0, y: 272, width: 640, height: 368 });
  assert.equal(layout.numericKeypadKeys[3], 'confirm');
  assert.equal(layout.numericKeypadKeys[11], 'backspace');
  assert.equal(layout.numericKeypadKeys[15], 'clear');
  assert.deepEqual(layout.numericConfirmRect, { x: 480, y: 272, width: 160, height: 176 });
  assert.ok(layout.numericConfirmRect.y >= 256 && layout.numericConfirmRect.y + layout.numericConfirmRect.height <= 448,
    'confirmation stays within physical rows 4 through 6');
  assert.throws(() => validateGameRules(changedRules(r => { r.common.layout.numericConfirmRect.x = 320; })), /不可覆蓋/);
});

test('board dimensions, mine start safety, sequence capacity, and answer grid stay compatible', () => {
  const cases = [
    [rules => { rules.games.minesweeper.mandatoryStartCellOneBased.column = 11; }, /mandatoryStartCellOneBased.column/],
    [rules => { rules.games.minesweeper.startSafeRadiusCells = 5; }, /startSafeRadiusCells/],
    [rules => { rules.games.minesweeper.minesByRound[0] = 72; }, /保留安全起點周圍空格/],
    [rules => { delete rules.games.minesweeper.boardRect; }, /minesweeper 缺少 boardRect/],
    [rules => { rules.games.minesweeper.enabled = null; }, /minesweeper.enabled 必須是布林值/],
    [rules => { rules.games.minesweeper.boardRows = 9; }, /必須是 8 欄×6 排/],
    [rules => { rules.games.memory_sequence.numberCountByRound[0] = 81; }, /不可填滿操作盤/],
    [rules => { rules.games.memory_sequence.memorySecondsByRound[0] = 601; }, /記憶時間不可超過 600 秒/],
    [rules => { rules.games.memory_sequence.heartDisplayRowsOneBased = [8, 9]; }, /必須顯示在第 9、10 排/],
    [rules => { rules.games.map_view.choiceGridRows = 1; }, /固定六選項/],
    [rules => { rules.games.memory_poker.memoryGridColumns = 3; }, /牌數與牌面格數設定不相容/]
  ];
  for (const [change, error] of cases) assert.throws(() => validateGameRules(changedRules(change)), error);
});


test('new mine board is 8 by 6 while old 10-by-8 saved session rules still validate', () => {
  assert.equal(defaults.games.minesweeper.boardColumns, 8);
  assert.equal(defaults.games.minesweeper.boardRows, 6);
  const legacy = changedRules(r => {
    Object.assign(r.games.minesweeper, { boardColumns: 10, boardRows: 8,
      mandatoryStartCellOneBased: { column: 5, row: 4 },
      boardRect: { x: 0, y: 128, width: 640, height: 448 },
      toolbarRect: { x: 0, y: 576, width: 640, height: 64 } });
  });
  assert.equal(validateGameRules(legacy).games.minesweeper.boardColumns, 10);
});
