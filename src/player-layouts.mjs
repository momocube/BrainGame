const MAX_PLAYERS = 8;
const MIN_PROFILE = 4;

export function playerProfileCount(participantCount = 0) {
  const count = Number.isFinite(participantCount) ? Math.trunc(participantCount) : 0;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PROFILE, count));
}

/** Resolve the approved head-count profile into logical P1…Pn player zones. */
export function resolvePlayerLayout(zoneConfig, participantCount = 0) {
  const profileCount = playerProfileCount(participantCount);
  const plan = zoneConfig.profilePlan;
  const profile = plan?.profiles?.[String(profileCount)];
  if (!profile) {
    if (plan) throw new Error(`缺少 ${profileCount} 人的場域版型設定`);
    return {
      profileCount: zoneConfig.players.length,
      participantCount,
      questionDisplayMode: 'floor',
      floorRole: 'question',
      players: structuredClone(zoneConfig.players),
      questionPanels: [],
      floorRect: null
    };
  }

  const baseZones = new Map(zoneConfig.players.map((zone) => [zone.id, zone]));
  const players = profile.playerSlots.map((slotId, index) => {
    const source = baseZones.get(slotId) ?? plan.customPlayerSlots?.[slotId];
    if (!source) throw new Error(`場域版型 ${profileCount} 找不到玩家位置 ${slotId}`);
    return { ...structuredClone(source), id: `P${index + 1}` };
  });
  const questionPanels = profile.questionPanelSlots.map((slotId, index) => {
    const source = plan.questionPanelSlots?.[slotId];
    if (!source) throw new Error(`場域版型 ${profileCount} 找不到題目位置 ${slotId}`);
    return {
      ...structuredClone(source),
      id: `Q${index + 1}`,
      playerId: players[index]?.id ?? null
    };
  });

  return {
    profileCount,
    participantCount,
    questionDisplayMode: profile.questionDisplayMode,
    floorRole: profile.floorRole,
    players,
    questionPanels,
    floorRect: structuredClone(plan.floorRect ?? null)
  };
}
