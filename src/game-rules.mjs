const EDITABLE_GAME_FIELDS = new Set([
  'rounds', 'playSeconds', 'wrongAnswerLockSeconds', 'penaltySecondsPerDistinctMine',
  'memorySeconds', 'selectionSeconds', 'revealCountdownSeconds', 'answerSeconds',
  'heartsPerRound', 'minimumDistinctVisibleClues', 'minesByRound',
  'numberCountByRound', 'memorySecondsByRound', 'difficultyBands'
]);

const FIXED_OPTION_COUNTS = new Map([['solid_puzzle', 6], ['map_view', 6]]);
const SUPPORTED_GAME_IDS = new Set([
  'minesweeper', 'zero_sum_grid', 'cube_count', 'solid_puzzle',
  'memory_poker', 'map_view', 'memory_sequence', 'slitherlink'
]);
const GAME_ENUM_FIELDS = {
  minesweeper: {
    boardRowNumbering: ['top_to_bottom'], maxFlags: ['mine_count'],
    completion: ['all_safe_cells_revealed'], endCondition: ['all_finished_or_deadline'],
    ranking: ['finished_adjusted_time_then_incomplete_safe_reveal_count']
  },
  zero_sum_grid: {
    endCondition: ['n_minus_one_correct_or_deadline_single_player_requires_completion'],
    ranking: ['correct_completion_time']
  },
  cube_count: {
    endCondition: ['n_minus_one_correct_or_deadline_single_player_requires_completion'],
    ranking: ['correct_completion_time']
  },
  solid_puzzle: {
    optionOrder: ['seeded_per_player_fixed_for_round'],
    endCondition: ['n_minus_one_correct_or_deadline_single_player_requires_completion'],
    ranking: ['correct_completion_time']
  },
  memory_poker: {
    endCondition: ['fixed_phase_schedule'], ranking: ['standard_five_card_high_hand_with_kickers']
  },
  map_view: {
    endCondition: ['n_minus_one_correct_or_deadline_single_player_requires_completion'],
    ranking: ['correct_completion_time']
  },
  memory_sequence: {
    variantStrategy: ['identity_horizontal_vertical_both_mirrors'],
    endCondition: ['all_finished_or_eliminated_or_deadline'],
    ranking: ['finished_time_then_best_prefix_desc_then_first_reached_time']
  },
  slitherlink: {
    tapCycle: ['line_cross_blank'], completion: ['lines_match_unique_solution'],
    endCondition: ['n_minus_one_correct_or_deadline_single_player_requires_completion'],
    ranking: ['correct_completion_time']
  }
};

const NUMBER_BOUNDS = {
  rounds: [1, 100], playSeconds: [1, 3600], wrongAnswerLockSeconds: [0, 3600],
  penaltySecondsPerDistinctMine: [0, 3600], memorySeconds: [1, 600],
  selectionSeconds: [1, 600], revealCountdownSeconds: [0, 60], answerSeconds: [1, 3600],
  heartsPerRound: [1, 20], optionCount: [2, 26], minimumDistinctVisibleClues: [1, 20]
};

const ADDITIONAL_NUMBER_BOUNDS = {
  boardColumns: [1, 100], boardRows: [1, 100], startSafeRadiusCells: [0, 4],
  targetSum: [-1000, 1000], subgridColumns: [1, 100], subgridRows: [1, 100],
  cameraElevationDegrees: [0, 90], deckSize: [1, 52], jokers: [0, 2], memoryCards: [1, 52],
  memoryGridColumns: [1, 13], memoryGridRows: [1, 13], communityCards: [0, 5],
  selectedCardsRequired: [1, 7], choiceGridColumns: [1, 6], choiceGridRows: [1, 6],
  wrongAnswerPenaltySeconds: [0, 3600]
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必須是 ${min} 到 ${max} 之間的整數`);
  }
}

function assertRequiredFields(record, fields, name) {
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) throw new Error(`${name} 缺少 ${field}`);
  }
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} 必須是布林值`);
}

function assertText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必須是非空文字`);
}

function assertRect(rect, name, width, height) {
  if (!isRecord(rect)) throw new Error(`${name} 必須是矩形設定`);
  for (const field of ['x', 'y', 'width', 'height']) {
    assertInteger(rect[field], `${name}.${field}`, field === 'width' || field === 'height' ? 1 : 0,
      field === 'x' || field === 'width' ? width : height);
  }
  if (rect.x + rect.width > width || rect.y + rect.height > height) {
    throw new Error(`${name} 超出玩家介面範圍`);
  }
}

function validateCommon(common) {
  assertRequiredFields(common, [
    'sessionDurationSeconds', 'countdownSeconds', 'roundResultsSeconds', 'resumeCountdownSeconds',
    'readyHoldSeconds', 'joinAllowedState', 'maxAnswerZones',
    'minimumParticipantsToPlay', 'tutorialTimeoutSeconds', 'sessionClockIncludesLobbyTutorialAndResults',
    'freezeAllClocksWhilePausedAndResuming', 'hideQuestionWhilePaused', 'sessionExpiryDuringRound',
    'sessionExpiryBeforeRound', 'sessionExpiryDuringRoundResults', 'participantRoster', 'timedHintsEnabled',
    'floorInputEnabled', 'inputTrigger', 'sameZoneMultiControlBatch', 'deadlineComparison',
    'timingPrecisionMilliseconds', 'earlyFinishEvaluation', 'scoring', 'layout'
  ], 'common');

  assertInteger(common.sessionDurationSeconds, 'common.sessionDurationSeconds', 60, 86400);
  assertInteger(common.countdownSeconds, 'common.countdownSeconds', 0, 60);
  assertInteger(common.roundResultsSeconds, 'common.roundResultsSeconds', 0, 300);
  assertInteger(common.resumeCountdownSeconds, 'common.resumeCountdownSeconds', 0, 60);
  assertInteger(common.readyHoldSeconds, 'common.readyHoldSeconds', 0, 30);
  assertInteger(common.maxAnswerZones, 'common.maxAnswerZones', 1, 8);
  assertInteger(common.minimumParticipantsToPlay, 'common.minimumParticipantsToPlay', 1, common.maxAnswerZones);
  if (common.tutorialTimeoutSeconds !== null) {
    assertInteger(common.tutorialTimeoutSeconds, 'common.tutorialTimeoutSeconds', 1, 3600);
  }
  assertInteger(common.timingPrecisionMilliseconds, 'common.timingPrecisionMilliseconds', 1, 1000);

  for (const field of [
    'sessionClockIncludesLobbyTutorialAndResults', 'freezeAllClocksWhilePausedAndResuming',
    'hideQuestionWhilePaused', 'timedHintsEnabled', 'floorInputEnabled'
  ]) assertBoolean(common[field], `common.${field}`);

  const enums = {
    joinAllowedState: ['lobby'],
    sessionExpiryDuringRound: ['finish_current_round_and_results'],
    sessionExpiryBeforeRound: ['final_results'],
    sessionExpiryDuringRoundResults: ['finish_results_then_final'],
    participantRoster: ['freeze_for_game_set'],
    inputTrigger: ['down_once_then_release'],
    sameZoneMultiControlBatch: ['reject_without_penalty'],
    deadlineComparison: ['received_active_time_strictly_less_than_deadline'],
    earlyFinishEvaluation: ['after_processing_entire_input_batch']
  };
  for (const [field, choices] of Object.entries(enums)) {
    if (!choices.includes(common[field])) throw new Error(`common.${field} 設定不支援`);
  }

  const scoring = common.scoring;
  if (!isRecord(scoring)) throw new Error('common.scoring 格式錯誤');
  assertRequiredFields(scoring, [
    'formula', 'ties', 'storageUnitsPerPoint', 'normalizeAcrossGameTypes',
    'gameSetBonusPoints', 'unrankedIncompletePoints', 'sessionScoreTies'
  ], 'common.scoring');
  if (scoring.formula !== 'participant_count_minus_rank' || scoring.ties !== 'average_occupied_rank_points' ||
      scoring.sessionScoreTies !== 'shared_rank') throw new Error('common.scoring 使用不支援的計分方式');
  assertInteger(scoring.storageUnitsPerPoint, 'common.scoring.storageUnitsPerPoint', 2, 1000);
  if (scoring.storageUnitsPerPoint % 2 !== 0) {
    throw new Error('common.scoring.storageUnitsPerPoint 必須是偶數，才能精確儲存半分並列積分');
  }
  assertInteger(scoring.gameSetBonusPoints, 'common.scoring.gameSetBonusPoints', 0, 10000);
  assertInteger(scoring.unrankedIncompletePoints, 'common.scoring.unrankedIncompletePoints', 0, 10000);
  assertBoolean(scoring.normalizeAcrossGameTypes, 'common.scoring.normalizeAcrossGameTypes');

  const layout = common.layout;
  if (!isRecord(layout)) throw new Error('common.layout 格式錯誤');
  assertRequiredFields(layout, [
    'localDesignWidth', 'localDesignHeight', 'interactiveRowsOneBased', 'statusRowsOneBased',
    'physicalRowNumbering', 'localCoordinateOrigin', 'interactiveRect', 'statusRect',
    'numericKeypadColumns', 'numericKeypadRows', 'numericKeypadKeys', 'orientation', 'geometrySource'
  ], 'common.layout');
  assertInteger(layout.localDesignWidth, 'common.layout.localDesignWidth', 1, 4096);
  assertInteger(layout.localDesignHeight, 'common.layout.localDesignHeight', 1, 4096);
  const { localDesignWidth: width, localDesignHeight: height } = layout;
  for (const [field, rows] of [['interactiveRowsOneBased', layout.interactiveRowsOneBased], ['statusRowsOneBased', layout.statusRowsOneBased]]) {
    if (!Array.isArray(rows) || rows.length !== 2) throw new Error(`common.layout.${field} 必須是起訖列陣列`);
    assertInteger(rows[0], `common.layout.${field}[0]`, 1, 10);
    assertInteger(rows[1], `common.layout.${field}[1]`, rows[0], 10);
  }
  const interactiveRows = layout.interactiveRowsOneBased;
  const statusRows = layout.statusRowsOneBased;
  if (interactiveRows[0] !== 1 || interactiveRows[1] + 1 !== statusRows[0] || statusRows[1] !== 10) {
    throw new Error('common.layout 可操作列與狀態列必須連續涵蓋 10 排');
  }
  if (!['top_to_bottom', 'bottom_to_top'].includes(layout.physicalRowNumbering) ||
      layout.localCoordinateOrigin !== 'top_left_y_down' || layout.orientation !== 'per_zone_player_facing_view') {
    throw new Error('common.layout 方向設定不支援');
  }
  assertText(layout.geometrySource, 'common.layout.geometrySource');
  assertRect(layout.interactiveRect, 'common.layout.interactiveRect', width, height);
  assertRect(layout.statusRect, 'common.layout.statusRect', width, height);
  if (Object.hasOwn(layout, 'numericEntryRect') || Object.hasOwn(layout, 'numericKeypadRect')) {
    if (!Object.hasOwn(layout, 'numericEntryRect') || !Object.hasOwn(layout, 'numericKeypadRect')) {
      throw new Error('common.layout 數字輸入顯示區與按鍵區必須一起設定');
    }
    assertRect(layout.numericEntryRect, 'common.layout.numericEntryRect', width, height);
    assertRect(layout.numericKeypadRect, 'common.layout.numericKeypadRect', width, height);
    const { numericEntryRect: entry, numericKeypadRect: keypad, interactiveRect: interactive } = layout;
    if (entry.x !== interactive.x || keypad.x !== interactive.x ||
        entry.width !== interactive.width || keypad.width !== interactive.width ||
        entry.y !== interactive.y || entry.y + entry.height !== keypad.y ||
        keypad.y + keypad.height !== interactive.y + interactive.height) {
      throw new Error('common.layout 數字輸入顯示區與按鍵區必須連續填滿可操作區');
    }
  }
  if (layout.interactiveRect.x !== 0 || layout.interactiveRect.width !== width ||
      layout.statusRect.x !== 0 || layout.statusRect.width !== width || layout.statusRect.y !== 0 ||
      layout.statusRect.y + layout.statusRect.height !== layout.interactiveRect.y ||
      layout.interactiveRect.y + layout.interactiveRect.height !== height) {
    throw new Error('common.layout 可操作區與狀態區必須完整接合並涵蓋畫布');
  }
  assertInteger(layout.numericKeypadColumns, 'common.layout.numericKeypadColumns', 1, 10);
  assertInteger(layout.numericKeypadRows, 'common.layout.numericKeypadRows', 1, 10);
  if (!Array.isArray(layout.numericKeypadKeys) || layout.numericKeypadKeys.length !== layout.numericKeypadColumns * layout.numericKeypadRows) {
    throw new Error('common.layout.numericKeypadKeys 數量必須符合鍵盤列欄');
  }
  const keyCounts = new Map();
  for (const key of layout.numericKeypadKeys) {
    if (typeof key !== 'string' || !['0','1','2','3','4','5','6','7','8','9','backspace','clear','confirm','spacer'].includes(key)) {
      throw new Error('common.layout.numericKeypadKeys 含不支援的按鍵');
    }
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  for (const key of ['0','1','2','3','4','5','6','7','8','9','backspace','clear','confirm']) {
    if (keyCounts.get(key) !== 1) throw new Error(`common.layout.numericKeypadKeys 必須恰好包含 ${key}`);
  }
  if (layout.numericConfirmRect) {
    const confirm = layout.numericConfirmRect, keypad = layout.numericKeypadRect ?? layout.interactiveRect;
    assertRect(confirm, 'common.layout.numericConfirmRect', width, height);
    if (confirm.x < keypad.x || confirm.y < keypad.y || confirm.x + confirm.width > keypad.x + keypad.width ||
        confirm.y + confirm.height > keypad.y + keypad.height) throw new Error('確認按鈕必須位於數字鍵盤內');
    const cellWidth = keypad.width / layout.numericKeypadColumns, cellHeight = keypad.height / layout.numericKeypadRows;
    for (const [index, key] of layout.numericKeypadKeys.entries()) {
      if (key === 'spacer' || key === 'confirm') continue;
      const x = keypad.x + index % layout.numericKeypadColumns * cellWidth;
      const y = keypad.y + Math.floor(index / layout.numericKeypadColumns) * cellHeight;
      if (confirm.x < x + cellWidth && confirm.x + confirm.width > x && confirm.y < y + cellHeight && confirm.y + confirm.height > y) {
        throw new Error(`確認按鈕不可覆蓋數字鍵盤按鍵 ${key}`);
      }
    }
  }
}

function validateGameStructure(gameId, config) {
  assertRequiredFields(config, ['displayName', 'rounds'], gameId);
  assertText(config.displayName, `${gameId}.displayName`);
  if (Object.hasOwn(config, 'enabled')) assertBoolean(config.enabled, `${gameId}.enabled`);
  const enumFields = GAME_ENUM_FIELDS[gameId];
  assertRequiredFields(config, Object.keys(enumFields), gameId);
  for (const [field, supportedValues] of Object.entries(enumFields)) {
    if (!supportedValues.includes(config[field])) throw new Error(`${gameId}.${field} 設定不支援`);
  }

  const numericBounds = {
    minesweeper: ['boardColumns', 'boardRows', 'playSeconds', 'startSafeRadiusCells', 'penaltySecondsPerDistinctMine', 'wrongAnswerLockSeconds'],
    zero_sum_grid: ['boardColumns', 'boardRows', 'playSeconds', 'wrongAnswerLockSeconds', 'numericInputMinimum', 'numericInputMaximum', 'targetSum', 'subgridColumns', 'subgridRows'],
    cube_count: ['playSeconds', 'wrongAnswerLockSeconds', 'numericInputMinimum', 'numericInputMaximum', 'cameraElevationDegrees'],
    solid_puzzle: ['playSeconds', 'optionCount', 'wrongAnswerLockSeconds'],
    memory_poker: ['deckSize', 'jokers', 'memoryCards', 'memoryGridColumns', 'memoryGridRows', 'memorySeconds', 'selectionSeconds', 'revealCountdownSeconds', 'communityCards', 'selectedCardsRequired'],
    map_view: ['playSeconds', 'optionCount', 'choiceGridColumns', 'choiceGridRows', 'wrongAnswerLockSeconds', 'minimumDistinctVisibleClues'],
    memory_sequence: ['boardColumns', 'boardRows', 'answerSeconds', 'heartsPerRound', 'wrongAnswerLockSeconds', 'wrongAnswerPenaltySeconds'],
    slitherlink: ['boardColumns', 'boardRows', 'playSeconds']
  }[gameId];
  const booleans = {
    minesweeper: ['sameBoardForAllPlayers', 'zeroFloodReveal', 'flagBlocksReveal', 'chordRevealEnabled'],
    zero_sum_grid: ['clearInputOnWrongAnswer', 'overlappingSubgridsCount'],
    cube_count: ['clearInputOnWrongAnswer', 'solidColumnsOnly', 'playerControlledCamera', 'fixedViewsVisibleFromStart'],
    solid_puzzle: ['confirmationRequired', 'removeWrongOptions', 'clearSelectionOnWrongAnswer', 'allOptionsSameCubeCount', 'allowRigidRotation', 'allowReflection', 'validateInsertionMotionPath'],
    memory_poker: ['communityCardsVisibleDuringMemory', 'uniqueCardsAcrossMemoryAndCommunity', 'sameCardMayBeSelectedByDifferentPlayers', 'samePositionTwiceForOnePlayer', 'confirmationLocksSelection', 'autoSubmitCompleteSelectionAtDeadline', 'replaceSelectionOnThirdCardTap', 'selectedCardsRemainHiddenUntilResults', 'suitsBreakTies', 'selectionSpeedBreaksTies', 'aceLowStraightAllowed', 'wrapAroundStraightAllowed'],
    map_view: ['confirmationRequired', 'clearSelectionOnWrongAnswer', 'removeWrongOptions', 'answerIncludesPositionAndHeading', 'playerControlledCamera', 'sameLabelsForAllPlayers'],
    memory_sequence: ['resetToFirstNumberOnError', 'reshuffleOnError', 'revealMemoryAgainOnError', 'reconcealCompletedCellsOnError', 'emptyOrPreviouslyCompletedCellCountsAsError', 'retainBestPrefixOnError', 'remainingHeartsBreakTies'],
    slitherlink: ['sameBoardForAllPlayers', 'crossMarksAffectCompletion']
  }[gameId];
  const commonRequired = ['rounds', ...(['memory_poker', 'memory_sequence'].includes(gameId) ? [] : ['playSeconds'])];
  const gameRequired = {
    minesweeper: ['boardColumns', 'boardRows', 'minesByRound', 'mandatoryStartCellOneBased', 'startSafeRadiusCells', 'penaltySecondsPerDistinctMine', 'boardRect', 'toolbarRect'],
    zero_sum_grid: ['boardColumns', 'boardRows', 'numericInputMinimum', 'numericInputMaximum', 'subgridColumns', 'subgridRows', 'difficultyBands'],
    cube_count: ['numericInputMinimum', 'numericInputMaximum', 'cameraAzimuthDegrees', 'difficultyBands'],
    solid_puzzle: ['optionCount', 'choiceGridRect', 'confirmRect', 'difficultyBands'],
    memory_poker: ['deckSize', 'jokers', 'memoryCards', 'memoryGridColumns', 'memoryGridRows', 'memorySeconds', 'selectionSeconds', 'revealCountdownSeconds', 'communityCards', 'selectedCardsRequired', 'cardGridRect', 'selectionInfoRect', 'confirmRect'],
    map_view: ['optionCount', 'choiceGridColumns', 'choiceGridRows', 'minimumDistinctVisibleClues', 'headings', 'mapPanelRect', 'choiceGridRect', 'confirmRect', 'difficultyBands'],
    memory_sequence: ['boardColumns', 'boardRows', 'numberCountByRound', 'memorySecondsByRound', 'heartDisplayRowsOneBased', 'answerSeconds', 'heartsPerRound'],
    slitherlink: ['boardColumns', 'boardRows', 'boardRect', 'incompletePoints', 'difficultyBands']
  }[gameId];
  assertRequiredFields(config, [...commonRequired, ...gameRequired], gameId);
  for (const field of numericBounds) {
    if (!Object.hasOwn(config, field)) throw new Error(`${gameId} 缺少 ${field}`);
    const [min, max] = NUMBER_BOUNDS[field] ?? ADDITIONAL_NUMBER_BOUNDS[field] ?? [0, 10000];
    assertInteger(config[field], `${gameId}.${field}`, min, max);
  }
  for (const field of booleans) {
    if (!Object.hasOwn(config, field)) throw new Error(`${gameId} 缺少 ${field}`);
    assertBoolean(config[field], `${gameId}.${field}`);
  }
  for (const field of ['minesByRound', 'numberCountByRound', 'memorySecondsByRound']) {
    if (!Object.hasOwn(config, field)) continue;
    if (!Array.isArray(config[field]) || config[field].length !== config.rounds) {
      throw new Error(`${gameId}.${field} 必須恰好包含 ${config.rounds} 輪設定`);
    }
    config[field].forEach((value, index) => assertInteger(value, `${gameId}.${field}[${index}]`, 1, 1000));
  }
  for (const [field, rect] of Object.entries(config)) {
    if (field.endsWith('Rect')) assertRect(rect, `${gameId}.${field}`, 640, 640);
  }

  if (['zero_sum_grid', 'cube_count'].includes(gameId)) {
    assertInteger(config.numericInputMinimum, `${gameId}.numericInputMinimum`, 0, 9999);
    assertInteger(config.numericInputMaximum, `${gameId}.numericInputMaximum`, config.numericInputMinimum, 9999);
    if (gameId === 'zero_sum_grid' && (config.numericInputMinimum !== 0 || config.numericInputMaximum > 63)) {
      throw new Error('數字方格數字輸入範圍必須包含 0 且不可超過 63');
    }
    if (gameId === 'cube_count' && (config.numericInputMinimum < 1 || config.numericInputMaximum > 150)) {
      throw new Error('3D 數方塊數字輸入範圍必須是 1 到 150 之內');
    }
  }
  if (gameId === 'minesweeper') {
    assertInteger(config.boardColumns, `${gameId}.boardColumns`, 1, 100);
    assertInteger(config.boardRows, `${gameId}.boardRows`, 1, 100);
    if (![[8, 6], [10, 8]].some(([cols, rows]) => config.boardColumns === cols && config.boardRows === rows)) {
      throw new Error('踩地雷棋盤必須是 8 欄×6 排（亦支援舊場次 10 欄×8 排）');
    }
    if (!isRecord(config.mandatoryStartCellOneBased)) throw new Error('踩地雷 mandatoryStartCellOneBased 格式錯誤');
    assertInteger(config.mandatoryStartCellOneBased.column, 'minesweeper.mandatoryStartCellOneBased.column', 1, config.boardColumns);
    assertInteger(config.mandatoryStartCellOneBased.row, 'minesweeper.mandatoryStartCellOneBased.row', 1, config.boardRows);
    assertInteger(config.startSafeRadiusCells, 'minesweeper.startSafeRadiusCells', 0, 4);
    const safeCells = Math.min(config.boardRows - 1, config.mandatoryStartCellOneBased.row - 1 + config.startSafeRadiusCells) -
      Math.max(0, config.mandatoryStartCellOneBased.row - 1 - config.startSafeRadiusCells) + 1;
    const safeColumns = Math.min(config.boardColumns - 1, config.mandatoryStartCellOneBased.column - 1 + config.startSafeRadiusCells) -
      Math.max(0, config.mandatoryStartCellOneBased.column - 1 - config.startSafeRadiusCells) + 1;
    const availableMineCells = config.boardColumns * config.boardRows - safeCells * safeColumns;
    if (config.minesByRound.some((count) => count > availableMineCells)) {
      throw new Error('踩地雷的地雷數必須保留安全起點周圍空格');
    }
  }
  if (gameId === 'memory_sequence') {
    assertInteger(config.boardColumns, `${gameId}.boardColumns`, 1, 100);
    assertInteger(config.boardRows, `${gameId}.boardRows`, 1, 100);
    if (config.boardColumns !== 10 || config.boardRows !== 8) throw new Error('數字速記操作盤必須是 10 欄×8 排');
    if (config.numberCountByRound.some((count) => count >= config.boardColumns * config.boardRows)) {
      throw new Error('數字速記數量不可填滿操作盤');
    }
    if (config.memorySecondsByRound.some((seconds) => seconds > 600)) {
      throw new Error('數字速記記憶時間不可超過 600 秒');
    }
    if (!Array.isArray(config.heartDisplayRowsOneBased) || config.heartDisplayRowsOneBased.length !== 2 ||
        config.heartDisplayRowsOneBased[0] !== 9 || config.heartDisplayRowsOneBased[1] !== 10) {
      throw new Error('數字速記心數必須顯示在第 9、10 排');
    }
  }
  if (gameId === 'slitherlink') {
    assertInteger(config.boardColumns, `${gameId}.boardColumns`, 3, 7);
    assertInteger(config.boardRows, `${gameId}.boardRows`, 3, 7);
    assertInteger(config.incompletePoints, 'slitherlink.incompletePoints', 0, 10000);
    if (config.sameBoardForAllPlayers !== true || config.crossMarksAffectCompletion !== false) {
      throw new Error('數迴需全員共用同一題，且叉叉只作記號、不影響完成判定');
    }
    const rect = config.boardRect;
    if (rect.width * config.boardRows !== rect.height * config.boardColumns) {
      throw new Error('數迴棋盤格必須是正方形');
    }
    if (rect.y < 128) throw new Error('數迴棋盤不可進入第 9、10 排狀態區');
  }
  if (gameId === 'memory_poker') {
    if (config.communityRevealSeconds !== undefined) assertInteger(config.communityRevealSeconds, 'memory_poker.communityRevealSeconds', 0, 60);
    if (config.deckSize !== 52 || config.jokers !== 0 || config.selectedCardsRequired !== 2) {
      throw new Error('記憶撲克需使用 52 張標準牌、無鬼牌並選取兩張');
    }
    assertInteger(config.incompletePoints, 'memory_poker.incompletePoints', 0, 10000);
    if (config.memoryCards + config.communityCards > config.deckSize ||
        config.memoryGridColumns * config.memoryGridRows !== config.memoryCards) {
      throw new Error('記憶撲克牌數與牌面格數設定不相容');
    }
  }
  if (gameId === 'zero_sum_grid' &&
      (config.subgridColumns > config.boardColumns || config.subgridRows > config.boardRows)) {
    throw new Error('數字方格子方格尺寸不可超過主盤面');
  }
  if (gameId === 'cube_count') {
    if (!Array.isArray(config.cameraAzimuthDegrees) || !config.cameraAzimuthDegrees.length) {
      throw new Error('3D 數方塊至少需要一個固定視角');
    }
    config.cameraAzimuthDegrees.forEach((angle, index) => assertInteger(angle, `cube_count.cameraAzimuthDegrees[${index}]`, 0, 359));
  }
  if (gameId === 'map_view') {
    if (config.choiceGridColumns * config.choiceGridRows !== FIXED_OPTION_COUNTS.get('map_view')) {
      throw new Error('地圖定位答題列欄數必須符合固定六選項');
    }
    if (!Array.isArray(config.headings) || config.headings.length !== 4 ||
        new Set(config.headings).size !== 4 || !['north', 'east', 'south', 'west'].every((heading) => config.headings.includes(heading))) {
      throw new Error('地圖定位方向必須包含四個不同方位');
    }
  }
}

function assertBands(gameId, config) {
  const bands = config.difficultyBands;
  if (!Array.isArray(bands) || !bands.length) throw new Error(`${gameId} 缺少難度級距`);
  let nextRound = 1;
  for (const [index, band] of bands.entries()) {
    if (!isRecord(band)) throw new Error(`${gameId} 第 ${index + 1} 個難度級距格式錯誤`);
    assertInteger(band.firstRound, `${gameId}.difficultyBands.firstRound`, 1, config.rounds);
    assertInteger(band.lastRound, `${gameId}.difficultyBands.lastRound`, band.firstRound, config.rounds);
    if (band.firstRound !== nextRound) throw new Error(`${gameId} 難度級距必須連續且從第 1 輪開始`);
    nextRound = band.lastRound + 1;

    if (gameId === 'zero_sum_grid') {
      for (const field of ['valueMin', 'valueMax', 'answerMin', 'answerMax']) {
        assertInteger(band[field], `${gameId}.difficultyBands.${field}`, -1000, 1000);
      }
      if (band.valueMin > band.valueMax || band.answerMin < 0 || band.answerMin > band.answerMax || band.answerMax > 63) {
        throw new Error('數字方格難度範圍不合理');
      }
    } else if (gameId === 'cube_count') {
      assertInteger(band.baseColumns, `${gameId}.difficultyBands.baseColumns`, 1, 10);
      assertInteger(band.baseRows, `${gameId}.difficultyBands.baseRows`, 1, 10);
      assertInteger(band.heightMin, `${gameId}.difficultyBands.heightMin`, 0, 20);
      assertInteger(band.heightMax, `${gameId}.difficultyBands.heightMax`, band.heightMin, 20);
      if (band.baseColumns * band.baseRows * band.heightMax > config.numericInputMaximum) {
        throw new Error('3D 數方塊難度可能超過數字輸入上限');
      }
    } else if (gameId === 'solid_puzzle') {
      if (!Array.isArray(band.targetDimensions) || band.targetDimensions.length !== 3) {
        throw new Error('立體拼圖目標尺寸必須有三個整數');
      }
      band.targetDimensions.forEach((value, dimension) => assertInteger(value, `solid_puzzle.targetDimensions[${dimension}]`, 1, 10));
      assertInteger(band.missingCubesMin, 'solid_puzzle.missingCubesMin', 1, 100);
      assertInteger(band.missingCubesMax, 'solid_puzzle.missingCubesMax', band.missingCubesMin, 100);
      if (band.missingCubesMax > band.targetDimensions.reduce((total, value) => total * value, 1)) {
        throw new Error('立體拼圖缺口不能大於目標方塊總數');
      }
    } else if (gameId === 'map_view') {
      assertInteger(band.mapColumns, 'map_view.mapColumns', 3, 31);
      assertInteger(band.mapRows, 'map_view.mapRows', 3, 31);
      assertInteger(band.landmarkTypes, 'map_view.landmarkTypes', 1, 5);
      if (band.landmarkTypes < config.minimumDistinctVisibleClues) {
        throw new Error('地圖地標數不可少於要求的可見線索數');
      }
    } else if (gameId === 'slitherlink') {
      const cells = config.boardColumns * config.boardRows;
      assertInteger(band.cluesMin, 'slitherlink.cluesMin', 0, cells);
      assertInteger(band.cluesMax, 'slitherlink.cluesMax', band.cluesMin, cells);
      assertInteger(band.regionCellsMin, 'slitherlink.regionCellsMin', 2, cells - 1);
      assertInteger(band.regionCellsMax, 'slitherlink.regionCellsMax', band.regionCellsMin, cells - 1);
      assertInteger(band.deductionTrialDepth, 'slitherlink.deductionTrialDepth', 0, 1);
    }
  }
  if (nextRound !== config.rounds + 1) throw new Error(`${gameId} 難度級距必須完整覆蓋 ${config.rounds} 輪`);
}

export function validateGameRules(rules) {
  if (!isRecord(rules) || !isRecord(rules.games) || !isRecord(rules.common)) throw new Error('遊戲規則檔格式錯誤');
  assertText(rules.rulesVersion, 'rulesVersion');
  validateCommon(rules.common);
  const gameIds = Object.keys(rules.games);
  if (!gameIds.length) throw new Error('至少要啟用一款遊戲');
  const missingGameIds = [...SUPPORTED_GAME_IDS].filter((gameId) => !Object.hasOwn(rules.games, gameId));
  if (missingGameIds.length) throw new Error(`遊戲規則檔缺少必要遊戲：${missingGameIds.join('、')}`);

  for (const [gameId, config] of Object.entries(rules.games)) {
    if (!SUPPORTED_GAME_IDS.has(gameId)) throw new Error(`不支援的遊戲設定：${gameId}`);
    if (!isRecord(config)) throw new Error(`${gameId} 遊戲設定格式錯誤`);
    validateGameStructure(gameId, config);
    assertInteger(config.rounds, `${gameId}.rounds`, 1, 100);
    for (const [field, [min, max]] of Object.entries(NUMBER_BOUNDS)) {
      if (Object.hasOwn(config, field)) assertInteger(config[field], `${gameId}.${field}`, min, max);
    }
    if (Object.hasOwn(config, 'difficultyBands')) assertBands(gameId, config);
    if (Object.hasOwn(config, 'optionCount')) {
      const choiceCount = config.optionCount;
      if (choiceCount > 26) throw new Error(`${gameId} 選項數不可超過 26`);
    }
    const fixedOptionCount = FIXED_OPTION_COUNTS.get(gameId);
    if (fixedOptionCount != null && config.optionCount !== fixedOptionCount) {
      throw new Error(`${gameId}.optionCount 必須固定為 ${fixedOptionCount}，符合題目與觸控版面`);
    }
  }
  if (!gameIds.some((id) => rules.games[id].enabled !== false)) throw new Error('至少要啟用一款遊戲');
  return rules;
}

export function getEditableRuleSettings(rules) {
  const games = {};
  for (const [gameId, config] of Object.entries(rules.games)) {
    const settings = { enabled: config.enabled !== false };
    for (const field of EDITABLE_GAME_FIELDS) {
      if (Object.hasOwn(config, field)) settings[field] = structuredClone(config[field]);
    }
    games[gameId] = settings;
  }
  return { rulesVersion: rules.rulesVersion, games };
}

export function applyEditableRuleSettings(rules, settings) {
  if (!isRecord(settings) || !isRecord(settings.games)) throw new Error('遊戲設定內容格式錯誤');
  if (settings.rulesVersion !== rules.rulesVersion) throw new Error('遊戲規則版本已更新，請重新載入設定');
  const knownGameIds = new Set(Object.keys(rules.games));
  for (const gameId of Object.keys(settings.games)) {
    if (!knownGameIds.has(gameId)) throw new Error(`未知遊戲：${gameId}`);
  }

  const updated = structuredClone(rules);
  for (const [gameId, values] of Object.entries(settings.games)) {
    if (!isRecord(values)) throw new Error(`${gameId} 設定格式錯誤`);
    const config = updated.games[gameId];
    for (const [field, value] of Object.entries(values)) {
      if (field === 'enabled') {
        if (typeof value !== 'boolean') throw new Error(`${gameId}.enabled 必須是布林值`);
        config.enabled = value;
        continue;
      }
      if (!EDITABLE_GAME_FIELDS.has(field) || !Object.hasOwn(config, field)) {
        throw new Error(`${gameId}.${field} 不允許從後台修改`);
      }
      if (field === 'difficultyBands') {
        if (!Array.isArray(value)) throw new Error(`${gameId}.difficultyBands 必須是陣列`);
      } else if (['minesByRound', 'numberCountByRound', 'memorySecondsByRound'].includes(field)) {
        if (!Array.isArray(value)) throw new Error(`${gameId}.${field} 必須是陣列`);
      } else {
        const [min, max] = NUMBER_BOUNDS[field];
        assertInteger(value, `${gameId}.${field}`, min, max);
      }
      config[field] = structuredClone(value);
    }
  }
  return validateGameRules(updated);
}
