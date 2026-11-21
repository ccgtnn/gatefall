const sides = ['human', 'bot'];

function watches(match, event, played) {
  if (!['play', 'death', 'first-infection'].includes(event.type)) return [];
  const jobs = [];
  for (const side of sides) {
    const player = match.players[side];
    for (const line of Object.values(player.board)) {
      for (const card of line) {
        const rule = card.definition.fieldEvents?.[event.type];
        if (rule && (!rule.enemy || event.side !== side) && (!rule.infected || event.infection > 0)) {
          jobs.push({ ability: rule.ability, side, sourceId: card.id,
            sourceDefinitionId: card.definition.id, requiredSource: true });
        }
        const scenario = card.definition.scenario;
        if (event.type === 'play' && side === event.side && card.id !== played?.id &&
            scenario && played?.definition.categories?.includes(scenario.category) &&
            (card.chapter ?? 0) < scenario.chapters.length) {
          jobs.push({ side, sourceId: card.id, scenarioChapter: true });
        }
      }
    }
    for (const pile of ['hand', 'deck']) {
      for (const card of player[pile]) {
        const rule = card.definition.pileEvents?.[event.type];
        if (rule && (!rule.enemy || event.side !== side)) {
          jobs.push({ ability: rule.ability, side, sourceId: card.id, sourceDefinitionId: card.definition.id,
            piles: ['hand', 'deck'], requiredSource: true });
        }
      }
    }
  }
  return jobs;
}

// The journal is also the ordered event stream consumed by playback.
export function emit(match, event, { source, neighbors = [], death, journal = true, side = event.side, played } = {}) {
  if (journal) match.log.push(event);
  const jobs = [];
  if (death && source.definition.deathwish) {
    jobs.push({ ability: source.definition.deathwish, side: event.side, ...death,
      deathwish: source.definition.name });
  }
  const self = source?.definition.events?.[event.type] ?? (event.type === 'turn-end' ? source?.definition.endTurn : undefined);
  if (self) jobs.push({ ability: self, side, sourceId: source.id, sourceDefinitionId: source.definition.id, causeDefinitionId: event.sourceDefinitionId, requiredSource: true });
  for (const { card, side } of neighbors) {
    const ability = card.definition.neighborEvents?.[event.type];
    if (ability) jobs.push({ ability, sourceId: card.id, side, requiredSource: true });
  }
  jobs.push(...watches(match, event, played));
  return jobs;
}
