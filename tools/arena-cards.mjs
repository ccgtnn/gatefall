const keyOf = ({ faction, id }) => faction + '/' + id;

export function summarizeCards(matches) {
  const totals = new Map();
  for (const { faction, result, played } of matches) {
    const factions = { human: faction, bot: faction === 'growth' ? 'protectorate' : 'growth' };
    const seen = new Set();
    for (const play of played) {
      const key = keyOf({ faction: factions[play.side], id: play.id });
      if (!totals.has(key)) {
        totals.set(key, { faction: factions[play.side], name: play.name, plays: 0, games: 0, wins: 0, points: 0, lead: 0 });
      }
      const record = totals.get(key);
      record.plays++;
      record.points += play.points;
      record.lead += play.lead;
      if (seen.has(key)) continue;
      seen.add(key);
      record.games++;
      if (result === (play.side === 'human' ? 'win' : 'loss')) record.wins++;
    }
  }
  const rounded = (value) => Number(value.toFixed(2));
  return [...totals.values()].map(({ points, lead, ...record }) => ({
    ...record, playedPct: rounded(100 * record.games / matches.length),
    winPct: rounded(100 * record.wins / record.games), pointsPerPlay: rounded(points / record.plays),
    leadBefore: rounded(lead / record.plays),
  })).sort((a, b) => a.faction.localeCompare(b.faction) || b.pointsPerPlay - a.pointsPerPlay);
}

export function summarizeOverload(matches) {
  const categories = new Map();
  for (const { faction, result, played } of matches) {
    const side = faction === 'protectorate' ? 'human' : 'bot';
    const protectorate = played.filter((play) => play.side === side);
    const colonels = protectorate.filter(({ id }) => id === 'colonel');
    const overloads = protectorate.filter(({ id }) => id === 'shield-overload');
    const paired = ({ round, row, at }) => colonels.some((colonel) => colonel.round === round && colonel.row === row && colonel.at < at);
    const category = overloads.some(paired) ? 'colonel-before-overload-same-row'
      : overloads.length ? 'overload-without-same-row-colonel' : colonels.length ? 'colonel-only' : 'neither';
    const entry = categories.get(category) ?? { category, games: 0, wins: 0, overloads: 0, points: 0, lead: 0, damage: 0 };
    categories.set(category, entry);
    entry.games++;
    entry.wins += Number(result === (side === 'human' ? 'win' : 'loss'));
    for (const { points, lead, damage } of overloads) {
      entry.overloads++;
      entry.points += points;
      entry.lead += lead;
      entry.damage += damage;
    }
  }
  return [...categories.values()];
}
