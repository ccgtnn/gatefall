const sides = ['human', 'bot'];

function watches(match, event, played, firstLegendary) {
  if (!['play', 'death', 'first-infection', 'target-marked'].includes(event.type)) return [];
  const jobs = [];
  for (const side of sides) {
    const player = match.players[side];
    for (const line of Object.values(player.board)) {
      for (const card of line) {
        const rule = card.definition.fieldEvents?.[event.type];
        if (rule && (!rule.enemy || event.side !== side) && (!rule.friendly || event.side === side) &&
            (!rule.category || played?.definition.categories?.includes(rule.category)) &&
            (!rule.infected || event.infection > 0)) {
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
        if (rule && (!rule.enemy || event.side !== side) && (!rule.friendly || event.side === side) &&
            (!rule.pile || rule.pile === pile) && (!rule.firstLegendary || firstLegendary)) {
          jobs.push({ ability: rule.ability, side, sourceId: card.id, sourceDefinitionId: card.definition.id,
            piles: rule.pile ? [rule.pile] : ['hand', 'deck'], requiredSource: true });
        }
      }
    }
  }
  return jobs;
}

export function deathwishDefinitions(card) {
  return [
    ...(card.definition.deathwish ? [card.definition] : []),
    ...(card.inheritedDeathwishes ?? []),
  ];
}

export function deathwishJobs(card, context) {
  return deathwishDefinitions(card).map((definition) => ({
    ...context, ability: definition.deathwish, deathwish: card.definition.name,
  }));
}

// The journal is also the ordered event stream consumed by playback.
export function emit(match, event, { source, neighbors = [], death, journal = true, side = event.side, played, firstLegendary } = {}) {
  if (journal) match.log.push(event);
  const jobs = [];
  if (death) jobs.push(...deathwishJobs(source, { side: event.side, ...death }));
  const self = source?.definition.events?.[event.type] ?? (event.type === 'turn-end' ? source?.definition.endTurn : undefined);
  if (self) jobs.push({ ability: self, side, sourceId: source.id, sourceDefinitionId: source.definition.id, causeDefinitionId: event.sourceDefinitionId, requiredSource: true });
  for (const { card, side } of neighbors) {
    const ability = card.definition.neighborEvents?.[event.type];
    if (ability) jobs.push({ ability, sourceId: card.id, side, requiredSource: true });
  }
  jobs.push(...watches(match, event, played, firstLegendary));
  return jobs;
}
