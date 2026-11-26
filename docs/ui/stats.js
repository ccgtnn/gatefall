export const FACTION_STATS_KEY = 'gatefall.faction-stats';

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function createFactionStats(factions, storage) {
  const totals = new Map(factions.map((id) => [id, { win: 0, loss: 0 }]));
  try {
    const saved = JSON.parse(storage.getItem(FACTION_STATS_KEY));
    for (const [id, tally] of totals) {
      tally.win = safeCount(saved?.[id]?.win);
      tally.loss = safeCount(saved?.[id]?.loss);
    }
  } catch {}

  return {
    get(id) { return { ...totals.get(id) }; },
    record(id, outcome) {
      const tally = totals.get(id);
      if (!tally || (outcome !== 'win' && outcome !== 'loss')) return;
      tally[outcome] += 1;
      try { storage.setItem(FACTION_STATS_KEY, JSON.stringify(Object.fromEntries(totals))); } catch {}
    },
  };
}
