// The journal is also the ordered event stream consumed by playback.
export function emit(match, event, { source, neighbors = [], death, journal = true, side = event.side } = {}) {
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
  return jobs;
}
