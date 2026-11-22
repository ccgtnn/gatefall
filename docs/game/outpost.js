export const WEEK_MS = 7 * 24 * 3_600_000;
export const BASE_VICTORY_GOLD = 20;

export function victoryGold(outpostLevel = 0) {
  return BASE_VICTORY_GOLD + outpostLevel * (BASE_VICTORY_GOLD / 20);
}

export function weeklyBundle(level) {
  return { gold: 100 * level, steel: 50 * level, energyCells: 50 * level };
}

export function weeklyReward(level, lastClaim, time, latestTime) {
  if (!level) return null;
  const nextClaim = lastClaim === null ? 0 : lastClaim + WEEK_MS;
  const remaining = Math.max(0, nextClaim - time, latestTime - time);
  return { bundle: weeklyBundle(level), remaining };
}
