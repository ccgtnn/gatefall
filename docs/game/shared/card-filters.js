export function matchesPileFilter(definition, filter) {
  return (filter.anyType || (definition.type ?? 'unit') === 'unit') &&
    (!filter.rarity || definition.rarity === filter.rarity) &&
    (!filter.category || definition.categories?.includes(filter.category)) &&
    (!filter.definitionId || definition.id === filter.definitionId) &&
    (!filter.faction || definition.faction === filter.faction) &&
    (filter.provision === undefined || definition.provision === filter.provision) &&
    (filter.maxProvision === undefined || definition.provision <= filter.maxProvision || definition.id === filter.provisionException) &&
    (filter.maxPower === undefined || definition.power <= filter.maxPower);
}

export function creationCandidates(definitions, sourceId, step, faction) {
  return definitions.filter((definition) => !definition.token &&
    definition.id !== sourceId && definition.rarity === step.rarity &&
    (!faction || definition.faction === faction) && (!step.type || definition.type === step.type));
}
