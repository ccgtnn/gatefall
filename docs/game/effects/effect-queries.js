import { availableRows, captureDestination, cardType, cleansableStatuses, findInPiles, findUnit, isUnit, neighbors, opponent, placementSide, statusCount, units } from '../engine/board.js';
import { CARD_DEFINITIONS } from '../cards/card-registry.js';
import { ROWS } from '../shared/card-metadata.js';
import { creationCandidates as selectCreationCandidates, matchesPileFilter } from '../shared/card-filters.js';
import { cardAbilities, deathwishDefinitions } from '../engine/events.js';

export { matchesPileFilter } from '../shared/card-filters.js';

export function chooseSubset(cards, count, random) {
  const remaining = [...cards];
  return Array.from({ length: Math.min(count, remaining.length) }, () =>
    remaining.splice(Math.floor(random() * remaining.length), 1)[0].id);
}

export const PAUSED = Symbol('paused effect step');
export const REPEAT = Symbol('repeat effect step');
export const SCHEDULED = Symbol('effect continuation already queued');

export function pauseForChoice(match, job, kind, key, options, prompt, extra) {
  match.pending = { side: job.side, kind, key, options, prompt, job, ...extra };
  return PAUSED;
}

export function pendingEffectSource(match, { cardId, before } = {}) {
  const pending = match.pending;
  if (!pending) return;
  const sourceId = pending.job?.sourceId ?? cardId;
  const card = match.effects.find(({ discard }) => discard?.id === sourceId)?.discard ??
    findInPiles(before ?? match, pending.side, sourceId, ['hand', 'discard', 'deck'])?.card;
  return { sourceId, card };
}

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
    (!query.deathwish || deathwishDefinitions(unit.card).some(({ grantedBy }) => !grantedBy)) &&
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

export function pileCandidates(cards, filter) {
  return cards.filter(({ definition }) => matchesPileFilter(definition, filter));
}

export function eligiblePileCards(match, side, pile, step, piles = {}) {
  const cards = piles[pile] ?? match.players[side][pile];
  const candidates = step.fullDeck ? cards : pileCandidates(cards, step.filter);
  return candidates.filter((card) => {
    if (pile === 'discard' && card.definition.token) return false;
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


export function stepAllowed(match, job, step) {
  const { when, requiresResult, sourceRow } = step;
  if (requiresResult && !job.results?.[requiresResult]) return false;
  if (sourceRow && reference(match, job)?.row !== sourceRow) return false;
  const coins = match.players[job.side].coins ?? 0;
  if (coins < (when?.coinsAtLeast ?? 0) || coins >= (when?.coinsBelow ?? Infinity)) return false;
  if (!when?.targets || targets(match, job, when.targets).length) return true;
  return Boolean(when.orAlliesCategory &&
    units(match, job.side).every(({ card }) => card.definition.categories?.includes(when.orAlliesCategory)));
}

export function creationCandidates(sourceId, step, faction) {
  return selectCreationCandidates(CARD_DEFINITIONS, sourceId, step, faction);
}

export function playableOffer(match, job, step, firstOnly = false) {
  const { side } = job;
  const faction = step.faction === 'enemy' ? match.players[opponent(side)].factionId : step.faction;
  if ((step.faction === 'enemy' && !faction) || !(valueOf(match, job, step.amount) > 0)) return [];
  const chain = [...(job.pileChoices?.creationChain ?? []), job.sourceDefinitionId];
  const result = [];
  for (const definition of creationCandidates(job.sourceDefinitionId, step, faction)) {
    if (chain.includes(definition.id)) continue;
    const card = { id: definition.id, definition };
    if (cardType(card) === 'effect'
      ? !canCast(match, side, card, { ...job.pileChoices, creationChain: chain })
      : !availableRows(match.players[placementSide(side, card)], card).length) continue;
    result.push(card);
    if (firstOnly) break;
  }
  return result;
}

export function canStart(match, job) {
  const { when, select, steps } = job.ability;
  if (steps.some((step) => (step.action === 'play-from-deck' &&
    !eligiblePileCards(match, job.side, 'deck', step, job.pileChoices).length) ||
    (step.action === 'play-from-discard' && !eligiblePileCards(match, job.side, 'discard', step, job.pileChoices).length) ||
    (step.action === 'play-from-hand' && step.requiresPlayable &&
      !eligiblePileCards(match, job.side, 'hand', step, job.pileChoices).length) ||
    (step.action === 'create-play' && !playableOffer(match, job, step, true).length))) return false;
  if (steps.some((step) => step.action === 'select-row' && !eligibleRows(match.players[rowSide(job.side, step)], step.filter).length)) return false;
  return (!when || targets(match, job, when.targets, when.selectable).length >= (when.atLeast ?? 1)) &&
    (!select?.length || viableChoices(match, job, 0).length > 0);
}

export function playTiming(match, side, card) {
  return cardAbilities(card).initiative && !match.players[side].roundActed ? 'initiative' : 'deploy';
}

export function canCast(match, side, card, pileChoices, timing = playTiming(match, side, card)) {
  const ability = cardAbilities(card)[timing];
  return Boolean(ability && canStart(match, { ability, side, sourceDefinitionId: card.definition.id, pileChoices }));
}

export function valueOf(match, job, expression, target) {
  if (typeof expression === 'number') return expression;
  if (expression?.growth) return (expression.base ?? 0) + (job.sourceGrowth ?? 0);
  if (expression?.result) {
    return (expression.base ?? 0) + (job.results?.[expression.result] ?? 0) * (expression.scale ?? 1);
  }
  if (expression?.startingCategory) {
    const player = match.players[job.side];
    const groups = Math.floor((player.startingCategories?.[expression.startingCategory] ?? 0) / expression.every);
    if (groups < (expression.minimum ?? 0)) return -1;
    return Math.min(groups, expression.cap ?? Infinity) * (expression.scale ?? 1) + (expression.base ?? 0);
  }
  if (expression?.playedCategory) {
    const plays = job.priorCategoryPlays ?? match.players[job.side].categoryPlays;
    return Math.max(0, expression.base + (plays?.[expression.playedCategory] ?? 0) * expression.scale);
  }
  if (expression?.markedThisMatch) return (match.players[job.side].marksPlaced ?? 0) * expression.markedThisMatch;
  if (expression?.count) {
    const count = targets(match, job, expression.count).length;
    return Math.min(count, expression.cap ?? Infinity) * (expression.scale ?? 1);
  }
  if (expression?.status) return target ? statusCount(target.card, expression.status) * (expression.scale ?? 1) : 0;
  if (expression?.row) return target?.row === expression.row ? expression.then : expression.otherwise;
  if (expression?.stat) {
    const unit = expression.ref ? reference(match, job, expression.ref) : target;
    return (unit?.card[expression.stat] ?? 0) * (expression.scale ?? 1);
  }
  return 0;
}

export const playPiles = { 'play-from-deck': 'deck', 'play-from-discard': 'discard', 'play-from-hand': 'hand', 'create-play': 'created' };
