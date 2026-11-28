const sides = ['human', 'bot'];
const noAbilities = Object.freeze({});

export const isLocked = (card) => Boolean(card?.statuses?.lock);
export const cardAbilities = (card) => !card || isLocked(card) ? noAbilities : card.definition;

function watches(match, event, played, firstLegendary) {
  if (!['play', 'death', 'first-infection', 'target-marked', 'appearance', 'discard'].includes(event.type)) return [];
  const jobs = [];
  for (const side of sides) {
    const player = match.players[side];
    for (const line of Object.values(player.board)) {
      for (const card of line) {
        const abilities = cardAbilities(card);
        const rule = abilities.fieldEvents?.[event.type];
        if (rule && (!rule.enemy || event.side !== side) && (!rule.friendly || event.side === side) &&
            (!rule.category || played?.definition.categories?.includes(rule.category)) &&
            (!rule.shipClasses || rule.shipClasses.some((shipClass) =>
              played?.definition.shipClass === shipClass || played?.definition.categories?.includes(shipClass))) &&
            (!rule.infected || event.infection > 0)) {
          jobs.push({ ability: rule.ability, side, sourceId: card.id,
            sourceDefinitionId: card.definition.id, requiredSource: true, cardAbility: true });
        }
        const scenario = abilities.scenario;
        if (!scenario) continue;
        const { category, trigger = 'play', countPlayedEffects } = scenario;
        if (event.type === trigger && side === event.side && card.id !== played?.id &&
            played?.definition.categories?.includes(category) && (card.chapter ?? 0) < scenario.chapters.length) {
          jobs.push({ side, sourceId: card.id, scenarioChapter: true,
            playedEffects: player.effectCategoryPlays?.[countPlayedEffects] ?? 0 });
        }
      }
    }
    for (const pile of ['hand', 'deck']) {
      for (const card of player[pile]) {
        const rule = cardAbilities(card).pileEvents?.[event.type];
        if (rule && (!rule.enemy || event.side !== side) && (!rule.friendly || event.side === side) &&
            (!rule.pile || rule.pile === pile) && (!rule.firstLegendary || firstLegendary)) {
          jobs.push({ ability: rule.ability, side, sourceId: card.id, sourceDefinitionId: card.definition.id,
            piles: rule.pile ? [rule.pile] : ['hand', 'deck'], requiredSource: true, cardAbility: true });
        }
      }
    }
  }
  return jobs;
}

export function deathwishDefinitions(card) {
  if (isLocked(card)) return [];
  return [
    ...(card.definition.deathwish ? [card.definition] : []),
    ...(card.inheritedDeathwishes ?? []),
  ];
}

export function inheritableDeathwishes(player) {
  const wishes = new Map();
  for (const card of player.discard) {
    if (card.definition.rarity !== 'bronze') continue;
    for (const definition of deathwishDefinitions(card)) {
      if (definition.grantedBy) continue;
      const signature = JSON.stringify(definition.deathwish);
      if (!wishes.has(signature)) wishes.set(signature, definition);
    }
  }
  return [...wishes.values()];
}

export function deathwishJobs(card, context) {
  return deathwishDefinitions(card).filter((definition) => !definition.grantedBy || context.deathSide).map((definition) => ({
    ...context, ...(definition.grantedBy && { side: definition.grantedBy, sourceDefinitionId: definition.id }), sourceGrowth: card.growth, ability: definition.deathwish, deathwish: card.definition.name, cardAbility: true,
  }));
}

/** @typedef {import('../../../types/contracts').EmitOptions} EmitOptions */

// The journal is also the ordered event stream consumed by playback.
/**
 * @param {import('../../../types/contracts').MatchState} match
 * @param {import('../../../types/contracts').MatchEvent} event
 * @param {EmitOptions} [options]
 */
export function emit(match, event, { source, neighbors = [], death, journal = true, side = event.side, played, firstLegendary } = {}) {
  if (journal) match.log.push(event);
  const jobs = [];
  if (death) jobs.push(...deathwishJobs(source, { side: event.side, deathSide: event.side, ...death }));
  const abilities = cardAbilities(source);
  const self = abilities.events?.[event.type] ?? (event.type === 'turn-end' ? abilities.endTurn : undefined);
  if (self && (!self.friendlySource || (event.attacker && event.attacker === side))) jobs.push({ ability: self, side, sourceId: source.id, sourceDefinitionId: source.definition.id, causeDefinitionId: event.sourceDefinitionId, requiredSource: true, cardAbility: true });
  for (const { card, side } of neighbors) {
    const ability = cardAbilities(card).neighborEvents?.[event.type];
    if (ability) jobs.push({ ability, sourceId: card.id, side, requiredSource: true, cardAbility: true });
  }
  jobs.push(...watches(match, event, played, firstLegendary));
  return jobs;
}
