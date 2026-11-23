const roundThresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 19, 22, 25, 31, 37, 43, 49, 55, 65, 75, 85, 95, 105];
const steelByRank = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 45, 50, 55, 60, 65, 72, 79, 86, 93, 100];
const energyFromRank10 = [2, 4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 31, 35, 40, 45, 50];
const shardsByRank = { 10: 1, 15: 2, 20: 3, 25: 5 };

export const MONTHLY_RANKS = Object.freeze(roundThresholds.map((rounds, rank) => Object.freeze({
  rank, rounds,
  keys: !rank ? 0 : rank % 5 === 0 ? 5 : 1 + Number(rank >= 10) + Number(rank >= 20),
  steel: steelByRank[rank],
  energyCells: energyFromRank10[rank - 10] ?? 0,
  gateShards: shardsByRank[rank] ?? 0,
})));

export function syncRanks(previous, time) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = date.getMonth();
  const period = year * 12 + month;
  if (previous && period <= previous.period) return previous;
  return { period, resetAt: new Date(year, month + 1, 1).getTime(), rounds: 0, matches: previous?.matches ?? [] };
}

export function rankStanding(rounds) {
  return MONTHLY_RANKS.findLast((entry) => entry.rounds <= rounds);
}

export function rankRewards(previous, next) {
  const total = { keys: 0, steel: 0, energyCells: 0, gateShards: 0 };
  for (const entry of MONTHLY_RANKS.slice(rankStanding(previous).rank + 1, rankStanding(next).rank + 1)) {
    for (const resource of Object.keys(total)) total[resource] += entry[resource];
  }
  return total;
}

export function wonRounds(log) {
  return log.filter(({ type, winner }) => type === 'round-end' && winner === 'human').length;
}
