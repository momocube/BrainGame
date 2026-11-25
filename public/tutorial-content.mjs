const number = (config, key, fallback) => Number.isFinite(config?.[key]) ? config[key] : fallback;

const tutorials = {
  minesweeper: (config) => ({
    goal: "翻開所有安全格；數字代表周圍八格的地雷數。",
    steps: [
      "第一步只能翻開標示「起」的安全起點。",
      "藍色為揭露模式，黃色為標記模式；按棋盤上方按鈕切換。插旗格須先拔旗才能揭露。",
      `翻到不同地雷每顆加 ${number(config, "penaltySecondsPerDistinctMine", 15)} 秒成績；揭開所有安全格即完成。`
    ],
    schedule: `每輪 ${number(config, "playSeconds", 120)} 秒・共 ${number(config, "rounds", 5)} 輪`
  }),
  zero_sum_grid: (config) => ({
    goal: "找出總和為 0 的所有相鄰 2×2 方格；重疊的方格也要分別計數。",
    steps: [
      `觀察地板上的 ${number(config, "boardColumns", 5)}×${number(config, "boardRows", 5)} 數字盤，檢查每個相鄰 2×2 區塊。`,
      "在答題區輸入符合條件的區塊總數，再按確認。",
      `答案錯誤會清空輸入並鎖答 ${number(config, "wrongAnswerLockSeconds", 15)} 秒；錯誤期間倒數照常。`
    ],
    schedule: `每輪 ${number(config, "playSeconds", 60)} 秒・共 ${number(config, "rounds", 10)} 輪`
  }),
  cube_count: (config) => ({
    goal: "數出立體模型實際使用的小方塊總數。",
    steps: [
      `地板會同時顯示 ${config?.cameraAzimuthDegrees?.length ?? 3} 個固定視角；全部是同一個模型。`,
      "柱子從地面到頂端都是實心。把各柱高度相加，不要把不同視角重複計數。",
      `在答題區輸入總數並確認；答錯清空輸入並鎖答 ${number(config, "wrongAnswerLockSeconds", 15)} 秒。`
    ],
    schedule: `每輪 ${number(config, "playSeconds", 60)} 秒・共 ${number(config, "rounds", 10)} 輪`
  }),
  solid_puzzle: (config) => ({
    goal: `從 ${number(config, "optionCount", 6)} 個方塊零件中，選出能補滿地板缺口的零件。`,
    steps: [
      "在牆面點選 A–F；按確認前可以改選。",
      "零件可以旋轉，不能鏡像或拆開。",
      `答錯會清除選取並鎖答 ${number(config, "wrongAnswerLockSeconds", 10)} 秒；選項不會移除。`
    ],
    schedule: `每輪 ${number(config, "playSeconds", 30)} 秒・共 ${number(config, "rounds", 20)} 輪`
  }),
  memory_poker: (config) => ({
    goal: `記住 ${number(config, "memoryCards", 16)} 張牌的位置，再與 ${number(config, "communityCards", 3)} 張公共牌組成五張牌型。`,
    steps: [
      `先公開三張公共牌 ${number(config, "communityRevealSeconds", 0)} 秒，再記憶 16 張牌 ${number(config, "memorySeconds", 20)} 秒；蓋牌後選牌，公共牌持續顯示。`,
      `選 ${number(config, "selectedCardsRequired", 2)} 個不同位置後按確認鎖定；不同玩家可以選同一張。`,
      "選滿者到時自動提交；少選者得 0 分。依牌型比大小，不比花色或選牌速度。"
    ],
    schedule: `公共牌 ${number(config, "communityRevealSeconds", 0)} 秒・記憶 ${number(config, "memorySeconds", 20)} 秒・選牌 ${number(config, "selectionSeconds", 10)} 秒・揭曉 ${number(config, "revealCountdownSeconds", 3)} 秒・共 ${number(config, "rounds", 5)} 輪`
  }),
  map_view: (config) => ({
    goal: "對照地板第一人稱景象與牆面平面圖，找出拍攝者的位置和面向。",
    steps: [
      `選擇 ${number(config, "optionCount", 6)} 個候選之一；答案包含位置與方向，兩者都要正確。`,
      "先點選 A–F，再按牆面底部的確認鍵。",
      `答錯會清除選取並鎖答 ${number(config, "wrongAnswerLockSeconds", 10)} 秒；不會刪除選項。`
    ],
    schedule: `每輪 ${number(config, "playSeconds", 30)} 秒・共 ${number(config, "rounds", 20)} 輪`
  }),
  memory_sequence: (config) => {
    const memoryTimes = config?.memorySecondsByRound ?? [6, 6, 5, 5, 4, 4, 3, 3, 2, 2];
    const low = Math.min(...memoryTimes), high = Math.max(...memoryTimes);
    return {
      goal: "記住黑底白字的數字位置；數字蓋成白格後，由 1 開始依序點到最大數字。",
      steps: [
        `記憶時間依輪次為 ${low}–${high} 秒；蓋牌後有 ${number(config, "answerSeconds", 18)} 秒作答。`,
        `黑色空格不扣心。數字順序按錯扣 1 心，數字全部蓋回並從 1 重來；不鎖答。`,
        `${number(config, "heartsPerRound", 3)} 顆心用完即淘汰；依序完成整串即可完成本輪。`
      ],
      schedule: `共 ${number(config, "rounds", 10)} 輪・每輪記憶 ${low}–${high} 秒／作答 ${number(config, "answerSeconds", 18)} 秒`
    };
  },
  slitherlink: (config) => ({
    goal: "在點與點之間畫線，連成一條不交叉、不分岔的封閉迴圈；格子裡的數字代表這一格四邊有幾條線。",
    steps: [
      "點兩點之間的邊：第一下畫線，第二下打叉（確定沒有線），第三下清除。",
      "沒有數字的格子不限制；叉叉只是記號，不影響完成判定。",
      "整條迴圈正確時自動完成；答錯不會鎖答，可以隨時修改。"
    ],
    schedule: `每輪 ${number(config, "playSeconds", 180)} 秒・共 ${number(config, "rounds", 3)} 輪`
  })
};

export function getGameTutorial(gameId, config = {}) {
  const build = tutorials[gameId];
  if (!build) throw new Error(`沒有設定遊戲教學：${gameId}`);
  return build(config);
}
