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

export function summarizePlagueEvents(matches) {
  const totals = {};
  for (const { plagueEvents = [] } of matches) {
    for (const event of plagueEvents) {
      const id = event.sourceDefinitionId ?? (event.type === 'scenario-chapter' ? 'spore-season'
        : event.type === 'play' ? event.id : undefined);
      if (!id) continue;
      const counter = totals[id] ??= { damage: 0, infectionTicks: 0, infectionAdded: 0, boost: 0, chapters: 0, baseGain: 0 };
      if (event.type === 'damage') counter.damage += event.lost ?? 0;
      if (event.type === 'status' && event.status === 'infection') {
        if (event.tick) counter.infectionTicks++;
        else counter.infectionAdded += Math.max(0, event.amount);
      }
      if (event.type === 'boost') counter.boost += event.amount;
      if (event.type === 'scenario-chapter') counter.chapters++;
      if (event.type === 'play') counter.baseGain += event.baseGain;
    }
  }
  return totals;
}

export function summarizeNewNeutrals(matches) {
  const totals = {};
  for (const { faction, played, neutralEvents } of matches) {
    for (const side of ['human', 'bot']) {
      const owner = side === 'human' ? faction : faction === 'protectorate' ? 'growth' : 'protectorate';
      const record = totals[owner] ??= { gates: { plays: 0, points: 0, pulls: {} },
        falura: { plays: 0, viaGates: 0, shadows: 0, leaderUses: 0, damage: 0, armorRemoved: 0 } };
      let gates = false;
      for (const event of neutralEvents) {
        if (event.type === 'play') {
          const id = event.card.definition.id;
          if (event.side === side && id === 'falura') {
            record.falura.plays++;
            if (gates && event.from === 'deck') record.falura.viaGates++;
          }
          if (gates && event.side === side && event.from === 'deck') {
            record.gates.pulls[id] = (record.gates.pulls[id] ?? 0) + 1;
          }
          gates = event.side === side && id === 'world-gates';
        }
        if (event.type === 'spawn' && event.side === side) record.falura.shadows += event.count;
        if (event.type === 'leader' && event.side === side) record.falura.leaderUses++;
        if (event.side !== side && event.type === 'damage') record.falura.damage += event.lost;
        if (event.side !== side && event.type === 'armor') record.falura.armorRemoved -= event.amount;
      }
      for (const play of played) {
        if (play.side !== side || play.id !== 'world-gates') continue;
        record.gates.plays++;
        record.gates.points += play.points;
      }
    }
  }
  return totals;
}
