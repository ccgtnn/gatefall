import { availableRows, captureDestination, cardType, cleansableStatuses, findInPiles, findUnit, isUnit, neighbors, opponent, placementSide, statusCount, units } from './board.js?v=world-gates-premium-1-nc1';
import { ROWS } from './cards.js?v=world-gates-premium-1-nc1';
import { cardAbilities, deathwishDefinitions } from './events.js?v=ulmarin-1';

export function reference(match, job, key = 'source') {
  if (key === 'source' && job.piles) return findInPiles(match, job.side, job.sourceId, job.piles);
  return findUnit(match, key === 'source' ? job.sourceId : job.refs?.[key]);
}

export function targets(match, job, query, choosing = false) {
  const maxPower = query.powerAtMost === undefined ? Infinity : valueOf(match, job, query.powerAtMost);
  const excluded = (query.excludeRefs ?? []).map((ref) => job.refs?.[ref]);
  const origin = reference(match, job, query.of);
  const row = query.row === 'source' ? reference(match, job)?.row : query.rowRef ? job.refs?.[query.rowRef] : query.row;
  if (query.row && !row) return [];
  let candidates;
  switch (query.scope) {
    case 'source': candidates = [reference(match, job)].filter(Boolean); break;
    case 'ref-set': candidates = (job.refs?.[query.ref] ?? []).map((id) => findUnit(match, id)).filter(Boolean); break;
    case 'ref': candidates = [reference(match, job, query.ref)].filter(Boolean); break;
    case 'neighbors':
      candidates = neighbors(match, origin).filter(({ position }) => !query.direction ||
        (query.direction === 'right' ? position > origin.position : position < origin.position));
      break;
    case 'ally': candidates = units(match, job.side); break;
    case 'field': candidates = [...units(match, job.side), ...units(match, opponent(job.side))]; break;
    case 'enemy': candidates = units(match, opponent(job.side)); break;
    default: throw new Error(`Unknown target scope: ${query.scope}`);
  }
  const eligible = candidates.filter((unit) =>
    (!choosing || !statusCount(unit.card, 'immune')) &&
    (!query.rarity || unit.card.definition.rarity === query.rarity) &&
    (!query.deathwish || deathwishDefinitions(unit.card).length > 0) &&
    (!row || unit.row === row) &&
    (!query.type || cardType(unit.card) === query.type) &&
    (!query.unitOrOrder || isUnit(unit.card) || cardAbilities(unit.card).order) &&
    (!query.cleansable || cleansableStatuses(unit.card).length > 0 || unit.card.inheritedDeathwishes?.length > 0) &&
    (!query.token || unit.card.definition.token) &&
    (!query.category || unit.card.definition.categories?.includes(query.category)) &&
    (!query.anyCategory || query.anyCategory.some((category) => unit.card.definition.categories?.includes(category))) &&
    (!query.capture || captureDestination(match, job.side, unit)) &&
    !excluded.includes(unit.card.id) && (unit.card.power ?? 0) <= maxPower &&
    (query.infected === undefined || Boolean(statusCount(unit.card, 'infection')) === query.infected) &&
    (query.marked === undefined || Boolean(statusCount(unit.card, 'target')) === query.marked) &&
    (!query.definitionId || unit.card.definition.id === query.definitionId) &&
    (!query.exclude || unit.card.id !== reference(match, job, query.exclude)?.card.id) &&
    (query.armorAtLeast === undefined || (unit.card.armor ?? 0) >= query.armorAtLeast) &&
    (query.powerAtLeast === undefined || (unit.card.power ?? 0) >= query.powerAtLeast));
  if (!query.strongest && !query.weakest) return eligible;
  const extreme = (query.strongest ? Math.max : Math.min)(...eligible.map(({ card }) => card.power));
  return eligible.filter(({ card }) => card.power === extreme);
}

export function viableChoices(match, job, index) {
  const selection = job.ability.select ?? [];
  const pick = selection[index];
  if (!pick) return [];
  const candidates = targets(match, job, pick.targets, pick.mode !== 'random');
  if (index === selection.length - 1) return candidates;
  return candidates.filter(({ card }) => viableChoices(match, {
    ...job, refs: { ...job.refs, [pick.ref]: card.id },
  }, index + 1).length);
}

export function rowArmor(player, row) {
  return player.board[row].reduce((sum, card) => sum + (card.armor ?? 0), 0);
}

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

export function pileCandidates(cards, filter) {
  return cards.filter(({ definition }) => matchesPileFilter(definition, filter));
}

export function eligiblePileCards(match, side, pile, step, piles = {}) {
  const cards = piles[pile] ?? match.players[side][pile];
  const candidates = step.fullDeck ? cards : pileCandidates(cards, step.filter);
  return candidates.filter((card) => {
    if (cardType(card) !== 'effect') return availableRows(match.players[placementSide(side, card)], card).length > 0;
    return canCast(match, side, card, { ...piles, [pile]: cards.filter(({ id }) => id !== card.id) }, 'deploy');
  });
}

export function eligibleRows(player, filter) {
  if (filter === 'space') return availableRows(player);
  if (filter === 'any') return ROWS;
  if (filter === 'units') return ROWS.filter((row) => player.board[row].some(isUnit));
  return ROWS.filter((row) => rowArmor(player, row));
}

export const rowSide = (side, step) => step.side === 'enemy' || step.filter === 'units' ? opponent(side) : side;


export function canStart(match, job) {
  const { when, select, steps } = job.ability;
  if (steps.some((step) => (step.action === 'play-from-deck' &&
    !eligiblePileCards(match, job.side, 'deck', step, job.pileChoices).length) ||
    (step.action === 'play-from-discard' && !eligiblePileCards(match, job.side, 'discard', step, job.pileChoices).length))) return false;
  if (steps.some((step) => step.action === 'select-row' && !eligibleRows(match.players[rowSide(job.side, step)], step.filter).length)) return false;
  return (!when || targets(match, job, when.targets, when.selectable).length >= (when.atLeast ?? 1)) &&
    (!select?.length || viableChoices(match, job, 0).length > 0);
}

export function playTiming(match, side, card) {
  return cardAbilities(card).initiative && !match.players[side].roundActed ? 'initiative' : 'deploy';
}

export function canCast(match, side, card, pileChoices, timing = playTiming(match, side, card)) {
  const ability = cardAbilities(card)[timing];
  return Boolean(ability && canStart(match, { ability, side, pileChoices }));
}

export function valueOf(match, job, expression, target) {
  if (typeof expression === 'number') return expression;
  if (expression?.result) {
    return (expression.base ?? 0) + (job.results?.[expression.result] ?? 0) * (expression.scale ?? 1);
  }
  if (expression?.startingCategory) {
    const source = reference(match, job)?.card;
    const player = match.players[source?.owner ?? job.side];
    const groups = Math.floor((player.startingCategories?.[expression.startingCategory] ?? 0) / expression.every);
    if (groups < (expression.minimum ?? 0)) return -1;
    return Math.min(groups, expression.cap ?? Infinity) * (expression.scale ?? 1) + (expression.base ?? 0);
  }
  if (expression?.playedCategory) {
    const plays = job.priorCategoryPlays ?? match.players[job.side].categoryPlays;
    return Math.max(0, expression.base + (plays?.[expression.playedCategory] ?? 0) * expression.scale);
  }
  if (expression?.markedThisMatch) return (match.players[job.side].markedTargets?.length ?? 0) * expression.markedThisMatch;
  if (expression?.count) return targets(match, job, expression.count).length * (expression.scale ?? 1);
  if (expression?.status) return target ? statusCount(target.card, expression.status) * (expression.scale ?? 1) : 0;
  if (expression?.row) return target?.row === expression.row ? expression.then : expression.otherwise;
  if (expression?.stat) {
    const unit = expression.ref ? reference(match, job, expression.ref) : target;
    return (unit?.card[expression.stat] ?? 0) * (expression.scale ?? 1);
  }
  return 0;
}

export const playPiles = { 'play-from-deck': 'deck', 'play-from-discard': 'discard', 'play-from-hand': 'hand', 'create-play': 'created' };
