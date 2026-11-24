import { cardAbilities, deathwishDefinitions, deathwishJobs, emit, isLocked } from './events.js?v=ulmarin-1';
import { FACTIONS, NEUTRAL_CARDS, ROWS, ROW_LABELS } from './cards.js?v=world-gates-premium-1';
import {
  activeOrder, announcePlay, appearanceJobs, applyStatus, availableRows, boost, capture, captureDestination, cardType, createCard, changeCoins, cleansableStatuses, cleanse, consume, damage, damageOverflow, findUnit,
  changeBasePower, findInPiles, heal, isUnit, neighbors, opponent, placementSide, placeCards, playDestination, removeUnit, restoreCard, ROW_LIMIT,
  refreshHoundAura, refreshShipRowBonus, setRowEffect, spawnCards, statusCount, statusEndTurn, takeCards, tickInfection, infectionDamage, transformUnit, units, weaken,
} from './board.js?v=world-gates-premium-1';
import { CAPTAIN_CARDS, HOUND_CATEGORY } from './captains.js?v=captains-independent-1';

function reference(match, job, key = 'source') {
  if (key === 'source' && job.piles) return findInPiles(match, job.side, job.sourceId, job.piles);
  return findUnit(match, key === 'source' ? job.sourceId : job.refs?.[key]);
}

function targets(match, job, query, choosing = false) {
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

function viableChoices(match, job, index) {
  const selection = job.ability.select ?? [];
  const pick = selection[index];
  if (!pick) return [];
  const candidates = targets(match, job, pick.targets, pick.mode !== 'random');
  if (index === selection.length - 1) return candidates;
  return candidates.filter(({ card }) => viableChoices(match, {
    ...job, refs: { ...job.refs, [pick.ref]: card.id },
  }, index + 1).length);
}

export function rowDamage(player, row, amount, armorStrip = 0) {
  return player.board[row].filter(isUnit).reduce((sum, card) => {
    const armor = Math.max(0, (card.armor ?? 0) - armorStrip);
    const shielded = statusCount(card, 'shield') > 0;
    const breaks = card.armor > 0 && armor <= (shielded ? 0 : amount) &&
      cardAbilities(card).events?.['armor-break']?.steps.some((step) => step.action === 'discard' && step.target.scope === 'source');
    if (breaks) return sum + card.power;
    return sum + (shielded ? 0 : Math.min(card.power, Math.max(0, amount - armor)));
  }, 0);
}

export function rowScatterValue(player, row, amount) {
  const units = player.board[row].filter(isUnit);
  const perUnit = amount / Math.max(1, units.length);
  return units.reduce((sum, card) => sum +
    Math.min(card.power, Math.max(0, perUnit - (card.armor ?? 0) - statusCount(card, 'shield'))), 0);
}

export function infectionGain(card, amount, turns = Infinity) {
  const current = statusCount(card, 'infection');
  return Math.max(0, infectionDamage(card, Math.min(current + amount, turns)) -
    infectionDamage(card, Math.min(current, turns)));
}

export function lockPriority({ card, side }, actor) {
  const locked = isLocked(card);
  const { order, fee, houndAura, fieldEvents, neighborEvents, endTurn, startTurnGrowth, events } = cardAbilities(card);
  const primary = Boolean(order || fee || houndAura || fieldEvents || neighborEvents || (!locked && card.timer > 0));
  const secondary = Boolean(endTurn || startTurnGrowth || events ||
    (!locked && (card.counter > 0 || card.resilient)) || deathwishDefinitions(card).length);
  const value = Number(primary) * 3 + Number(secondary);
  return side === actor ? -value : 5 + value;
}

export function cleansePriority({ card, side }, actor) {
  const statuses = cleansableStatuses(card);
  let value = card.inheritedDeathwishes?.length ? 2 : 0;
  if (statuses.includes('shield')) value += 2;
  if (statuses.includes('lock')) value -= 5;
  if (statuses.includes('infection')) value -= Math.min(4, statusCount(card, 'infection')) + 1;
  if (statuses.includes('target')) value -= 2;
  if (statuses.includes('doomed')) value -= 1;
  return side === actor ? -value : value;
}

export function rowArmor(player, row) {
  return player.board[row].reduce((sum, card) => sum + (card.armor ?? 0), 0);
}

function matchesPileFilter(definition, filter) {
  return (filter.anyType || (definition.type ?? 'unit') === 'unit') &&
    (!filter.rarity || definition.rarity === filter.rarity) &&
    (!filter.category || definition.categories?.includes(filter.category)) &&
    (!filter.definitionId || definition.id === filter.definitionId) &&
    (!filter.faction || definition.faction === filter.faction) &&
    (filter.provision === undefined || definition.provision === filter.provision) &&
    (filter.maxProvision === undefined || definition.provision <= filter.maxProvision || definition.id === filter.provisionException) &&
    (filter.maxPower === undefined || definition.power <= filter.maxPower);
}

function pileCandidates(cards, filter) {
  return cards.filter(({ definition }) => matchesPileFilter(definition, filter));
}

function eligiblePileCards(match, side, pile, step, piles = {}) {
  const cards = piles[pile] ?? match.players[side][pile];
  const candidates = step.fullDeck ? cards : pileCandidates(cards, step.filter);
  return candidates.filter((card) => {
    if (cardType(card) !== 'effect') return availableRows(match.players[placementSide(side, card)], card).length > 0;
    return canCast(match, side, card, { ...piles, [pile]: cards.filter(({ id }) => id !== card.id) }, 'deploy');
  });
}

function chooseSubset(cards, count, random) {
  return Array.from({ length: Math.min(count, cards.length) }, () =>
    cards.splice(Math.floor(random() * cards.length), 1)[0].id);
}

function eligibleRows(player, filter) {
  if (filter === 'space') return availableRows(player);
  if (filter === 'any') return ROWS;
  if (filter === 'units') return ROWS.filter((row) => player.board[row].some(isUnit));
  return ROWS.filter((row) => rowArmor(player, row));
}

const rowSide = (side, step) => step.side === 'enemy' || step.filter === 'units' ? opponent(side) : side;


function canStart(match, job) {
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

export function leaderCooldown(player) {
  const { leader } = player;
  if (!leader?.order || leader.lastUsedTurn === undefined) return 0;
  const accelerated = ROWS.some((row) => player.board[row].some((card) => !isLocked(card) && card.definition.id === leader.order.quickenedBy));
  const recharge = accelerated ? 0 : leader.order.cooldown;
  return Math.max(0, leader.lastUsedTurn + recharge + 1 - player.turns);
}

export function canUseLeader(match, side) {
  const player = match.players[side];
  const { leader } = player;
  if (!leader?.ability) return false;
  const ready = leader.order ? leaderCooldown(player) === 0 : !match.playedCard && leader.charges > 0;
  return ready && canStart(match, { ability: leader.ability, side });
}

export function orderAbility(order) {
  if (!order.cost) return order;
  return {
    ...order,
    select: [...(order.cost.select ?? []), ...(order.select ?? [])],
    steps: [...order.cost.steps, ...order.steps],
  };
}

export function availableOrders(match, side) {
  const player = match.players[side];
  return units(match, side).filter((unit) => {
    const order = activeOrder(unit);
    return order && unit.card.readyAt <= player.turns &&
      canStart(match, { ability: orderAbility(order), side, sourceId: unit.card.id });
  });
}

export function availableFees(match, side) {
  const player = match.players[side];
  return units(match, side).filter((unit) => {
    const { card, row } = unit;
    const fee = cardAbilities(card).fee;
    return fee && (player.coins ?? 0) >= fee.coins &&
      (!card.definition.requiredRow || row === card.definition.requiredRow) &&
      (!fee.needsSourceSpace || player.board[row].length < ROW_LIMIT) &&
      (!fee.needsExhaustedOrder || (activeOrder(unit) && card.readyAt > player.turns)) &&
      canStart(match, { ability: fee, side, sourceId: card.id });
  });
}

export function enqueueCardEffect(match, side, card, timing, requiredSource = true, priorCategoryPlays) {
  const abilities = cardAbilities(card);
  const ability = abilities[timing] ?? (timing === 'deploy' ? abilities.scenario?.prologue : undefined);
  if (ability) match.effects.push({ ability, side, sourceId: card.id, sourceDefinitionId: card.definition.id, requiredSource, cardAbility: true, priorCategoryPlays });
}

function valueOf(match, job, expression, target) {
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

function selectTargets(match, job, random) {
  job.refs ??= {};
  const choices = job.ability.select ?? [];
  for (let index = 0; index < choices.length; index += 1) {
    const pick = choices[index];
    if (job.refs[pick.ref]) continue;
    const options = viableChoices(match, job, index);
    if (!options.length) return false;
    if (pick.mode === 'random') {
      job.refs[pick.ref] = options[Math.floor(random() * options.length)].card.id;
      continue;
    }
    const amounts = Object.fromEntries(options.map((target) =>
      [target.card.id, valueOf(match, job, pick.amount, target)]));
    const values = [...new Set(Object.values(amounts))];
    const amount = values.length === 1 ? values[0] : 0;
    let prompt = pick.prompt;
    if (pick.kind === 'damage') {
      const detail = amount ? String(amount) : Object.entries(pick.amount?.row ? ROW_LABELS : {})
        .map(([row, label]) => `${label}: ${row === pick.amount.row ? pick.amount.then : pick.amount.otherwise}`).join(' · ');
      if (detail) {
        const target = pick.targets.scope === 'field' ? 'отряд' : 'врага';
        prompt = `Выбери ${target} для урона: ${detail}.`;
      }
    }
    match.pending = {
      side: job.side, options: options.map(({ card }) => card.id), prompt, kind: pick.kind, amount, amounts,
      preferHigherAmount: Boolean(pick.amount?.row), key: pick.ref, job,
    };
    return false;
  }
  return true;
}

function spawn(match, job, step) {
  const origin = reference(match, job);
  const { position, row } = step;
  const rows = row === 'all' ? ROWS : [step.rowRef ? job.refs[step.rowRef] : row === 'source' ? origin?.row : row === 'death' ? job.row : row];
  if (step.overflow && rows[0]) rows.push(...ROWS.filter((row) => row !== rows[0]));
  let remaining = step.amount;
  for (const row of rows.filter(Boolean)) {
    if (remaining <= 0) break;
    const nearSource = origin?.row === row && (origin.side === job.side || step.row === 'source');
    const side = nearSource ? origin.side : job.side;
    const index = position === 'death' ? job.position
      : nearSource && position ? origin.position + Number(position === 'right')
        : match.players[side].board[row].length;
    const count = step.overflow ? Math.min(remaining, ROW_LIMIT - match.players[side].board[row].length) : step.amount;
    spawnCards(match, side, row, index, count, step.card);
    if (step.overflow) remaining -= count;
  }
}

function pause(match, job, kind, key, options, prompt, extra) {
  match.pending = { side: job.side, kind, key, options, prompt, job, ...extra };
}

const playPiles = { 'play-from-deck': 'deck', 'play-from-discard': 'discard', 'play-from-hand': 'hand', 'create-play': 'created' };
const creatableCards = [...Object.values(FACTIONS).flatMap(({ pool }) => pool), ...NEUTRAL_CARDS, ...CAPTAIN_CARDS];

function creationCandidates(sourceId, step, faction) {
  return creatableCards.filter((definition) => !definition.token &&
    definition.id !== sourceId && definition.rarity === step.rarity &&
    (!faction || definition.faction === faction) && (!step.type || definition.type === step.type));
}

export function relatedEffectCards(definition) {
  const fixed = new Map();
  const possible = new Map();
  const visited = new WeakSet();
  function visit(node) {
    if (node === null || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (['spawn', 'transform'].includes(node.action) && node.card) fixed.set(node.card.id, node.card);
    if (node.action === 'create-play') {
      for (const card of creationCandidates(definition.id, node)) {
        if (node.faction !== 'enemy' || Object.hasOwn(FACTIONS, card.faction)) possible.set(card.id, card);
      }
    }
    if (node.action === 'summon-from-deck' && node.filter) {
      const pool = FACTIONS[definition.faction]?.pool ?? creatableCards;
      const matches = node.filter.definitionId ? creatableCards : new Set([...pool, ...NEUTRAL_CARDS]);
      for (const card of matches) {
        if (matchesPileFilter(card, node.filter)) (node.filter.definitionId ? fixed : possible).set(card.id, card);
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'card') visit(child);
  }
  visit(definition);
  fixed.delete(definition.id);
  possible.delete(definition.id);
  for (const id of fixed.keys()) possible.delete(id);
  return { fixed: [...fixed.values()], possible: [...possible.values()] };
}

function createOffer(match, job, step, random) {
  const other = match.players[opponent(job.side)];
  const faction = step.faction === 'enemy' ? other.factionId : undefined;
  if (step.faction === 'enemy' && !faction) return [];
  const candidates = creationCandidates(job.sourceDefinitionId, step, faction)
    .map((definition) => createCard(definition.id, definition));
  const eligible = candidates.filter((card) => cardType(card) === 'effect' ||
    availableRows(match.players[placementSide(job.side, card)], card).length);
  const offered = chooseSubset(eligible, valueOf(match, job, step.amount), random);
  return offered.map((id) => createCard(`token-${++match.tokenCount}`, candidates.find((card) => card.id === id).definition));
}

function playFromPile(match, job, step, random) {
  const pile = playPiles[step.action];
  const player = match.players[job.side];
  if (pile === 'created') job.created ??= createOffer(match, job, step, random);
  const cards = pile === 'created' ? job.created : player[pile];
  if (!job.refs.deckCard) {
    const eligible = pile === 'created' ? cards : eligiblePileCards(match, job.side, pile, step);
    const offerAll = pile !== 'deck' || step.fullDeck || step.chooseAll;
    const options = offerAll ? eligible.map(({ id }) => id) : chooseSubset(eligible, step.choose ?? 1, random);
    if (!options.length) return true;
    if (offerAll || step.choose) {
      pause(match, job, 'deck-card', 'deckCard', options,
        step.prompt ?? (pile === 'created' ? 'Выбери карту для Сотворения.' : pile === 'discard' ? 'Выбери обычный отряд из сброса.'
          : step.fullDeck ? 'Выбери карту, которую хочешь сыграть из колоды.' : 'Выбери отряд из колоды.'),
        { pile, ...(step.fullDeck && { fullDeck: true }), ...(pile === 'created' && { cards }) });
      return false;
    }
    [job.refs.deckCard] = options;
  }
  const index = cards.findIndex(({ id }) => id === job.refs.deckCard);
  if (index < 0) return true;
  const isEffect = cardType(cards[index]) === 'effect';
  const destinationSide = placementSide(job.side, cards[index]);
  const recipient = match.players[destinationSide];
  if (!isEffect && !job.refs.deckPlacement) {
    const rows = availableRows(recipient, cards[index]);
    if (!rows.length) return true;
    const type = cardType(cards[index]) === 'artifact' ? 'артефакта' : 'отряда';
    pause(match, job, 'deck-placement', 'deckPlacement', rows, `Выбери ряд и позицию для ${type}.`,
      { cardId: job.refs.deckCard, pile, ...(pile === 'created' && { cards }),
        ...(destinationSide !== job.side && { selectionSide: destinationSide }) });
    return false;
  }
  const [chosen] = cards.splice(index, 1);
  const card = pile === 'discard' ? restoreCard(chosen) : chosen;
  const destination = job.refs.deckPlacement;
  if (destination) {
    if (destinationSide !== job.side) card.owner = job.side;
    placeCards(recipient, destination.row, destination.position, [card]);
  }
  if (isEffect) match.effects.unshift({ discard: card, side: job.side });
  const priorCategoryPlays = player.categoryPlays ?? {};
  const reactions = announcePlay(match, job.side, card, destination, { from: pile });
  match.effects.unshift(...reactions);
  if (step.after) match.effects.unshift({ side: job.side, sourceId: card.id, requiredSource: true,
    ability: { steps: [step.after] } });
  const timing = pile === 'created' || pile === 'hand' ? playTiming(match, job.side, card) : 'deploy';
  const abilities = cardAbilities(card);
  const nestedAbility = abilities[timing] ?? abilities.scenario?.prologue;
  if (nestedAbility) match.effects.unshift({ ability: nestedAbility, side: job.side, sourceId: card.id,
    sourceDefinitionId: card.definition.id, requiredSource: !isEffect, cardAbility: true, priorCategoryPlays });
  delete job.refs.deckCard;
  delete job.refs.deckPlacement;
  delete job.created;
  return true;
}

function summonFromDeck(match, job, step, random) {
  const source = reference(match, job);
  if (step.row === 'random') {
    if (source?.pile !== 'deck') return;
    const player = match.players[job.side];
    const rows = availableRows(player, source.card);
    if (!rows.length) return;
    const row = rows.length === 1 ? rows[0] : rows[Math.floor(random() * rows.length)];
    placeSummonedCard(match, job.side, row, player.board[row].length, source.card);
    return;
  }
  const location = source ?? (step.position === 'death' ? job : undefined);
  if (!location?.row) return;
  const { side, row, position } = location;
  const player = match.players[side];
  const index = Math.min(player.board[row].length,
    position + Number(step.position === 'right' || (step.position === 'death' && Boolean(source))));
  if (!playDestination(player, { row, position: index })) return;
  const candidates = pileCandidates(player.deck, step.filter).filter((card) => availableRows(player, card).includes(row));
  if (!candidates.length) return;
  const selected = candidates[Math.floor(random() * candidates.length)];
  placeSummonedCard(match, side, row, index, selected);
}

function placeSummonedCard(match, side, row, index, selected) {
  const player = match.players[side];
  const [card] = player.deck.splice(player.deck.indexOf(selected), 1);
  placeCards(player, row, index, [card]);
  match.log.push({ type: 'spawn', from: 'deck', side, row, position: index,
    name: card.definition.name, count: 1, cards: [{ ...card }] });
  if (card.definition.categories?.includes(HOUND_CATEGORY)) refreshHoundAura(match, side);
  refreshShipRowBonus(match, side, row);
  match.effects.unshift(...appearanceJobs(match, side, card));
}

export function enqueueEndTurn(match, side) {
  const field = units(match, side);
  for (const { card } of field) match.effects.push(...emit(match, { type: 'turn-end', side },
    { source: card, journal: false }));
  for (const { card } of field) {
    const steps = statusEndTurn(card);
    if (!isLocked(card) && card.counter > 0) steps.push({ action: 'counter', target: { scope: 'source' } });
    if (steps.length) match.effects.push({
      ability: { steps },
      side, sourceId: card.id, requiredSource: true,
    });
  }
}

export const ROW_EFFECTS = Object.freeze({
  rot: { label: 'Гниение', icon: '☣' },
});

export function rowEffectValue(player, row, turns = 3, incremental = true) {
  if (player.passed) return 0;
  const candidates = player.board[row].filter(isUnit);
  if (!candidates.length) return 0;
  const previous = incremental ? player.rowEffects?.[row]?.remaining ?? 0 : 0;
  const horizon = Math.max(0, Math.min(turns, player.hand.length + 1) - previous);
  return horizon * candidates.reduce((sum, card) => sum +
    (statusCount(card, 'infection') ? Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0))) : Math.min(card.power, 2) * .75), 0)
    / candidates.length;
}

export function enqueueStartTurn(match, side) {
  const player = match.players[side];
  const field = units(match, side);
  for (const unit of [...field, ...units(match, opponent(side))]) {
    if ((unit.card.owner ?? unit.side) === side) changeBasePower(match, unit, cardAbilities(unit.card).startTurnGrowth);
  }
  for (const pile of ['deck', 'hand', 'discard']) {
    for (const card of player[pile]) changeBasePower(match, { card, side, pile }, cardAbilities(card).startTurnGrowth);
  }
  for (const row of ROWS) {
    if (match.players[side].rowEffects?.[row]) match.effects.push({ side, row, rowTick: true });
  }
  for (const { card } of field) {
    if (card.timer > 0 && (cardAbilities(card).startTurn || cardAbilities(card).startTurnPulse)) {
      match.effects.push({ side, sourceId: card.id, startTimer: true });
    }
  }
}

function tickRow(match, job, random) {
  const { side, row } = job;
  const effect = match.players[side].rowEffects?.[row];
  if (!effect) return;
  setRowEffect(match, side, row, effect.remaining > 1 ? { ...effect, remaining: effect.remaining - 1 } : null);
  const targets = units(match, side, [row]).filter(({ card }) => isUnit(card));
  if (!targets.length || effect.type !== 'rot') return;
  const unit = targets[Math.floor(random() * targets.length)];
  if (statusCount(unit.card, 'infection')) damage(match, unit, 2, effect.sourceDefinitionId, { attacker: effect.attacker });
  else applyStatus(match, unit, 'infection', 2, { sourceDefinitionId: effect.sourceDefinitionId, attacker: effect.attacker });
}

function playChapter(match, job) {
  const unit = findUnit(match, job.sourceId);
  if (!unit) return;
  const { card, side } = unit;
  const scenario = cardAbilities(card).scenario;
  if (!scenario) return;
  const { chapters, finalChapterMinimum } = scenario;
  const chapter = (card.chapter ?? 0) + 1;
  if (chapter > chapters.length ||
      (chapter === chapters.length && (job.playedEffects ?? 0) < (finalChapterMinimum ?? 0))) return;
  card.chapter = chapter;
  match.log.push({ type: 'scenario-chapter', side, cardId: card.id, name: card.definition.name, chapter });
  match.effects.unshift({ ...job, scenarioChapter: false, requiredSource: true,
    sourceDefinitionId: card.definition.id, ability: chapters[chapter - 1] });
}

function tickTimer(match, { card, side }) {
  if (isLocked(card) || !(card.timer > 0)) return false;
  card.timer -= 1;
  match.log.push({ type: 'tick', side, name: card.definition.name, cardId: card.id, remaining: card.timer });
  return card.timer === 0;
}

function reduceOrderCooldown(match, unit, amount) {
  const { card, side } = unit;
  if (!activeOrder(unit) || card.readyAt <= match.players[side].turns) return;
  card.readyAt = Math.max(match.players[side].turns, card.readyAt - amount);
  match.log.push({ type: 'order-ready', side, cardId: card.id, name: card.definition.name, readyAt: card.readyAt,
    cooldown: card.readyAt - match.players[side].turns });
}

const operations = {
  'base-power': changeBasePower,
  heal,
  weaken,
  cleanse,

  counter: (match, { card, side }) => {
    if (isLocked(card) || !(card.counter > 0)) return;
    card.counter -= 1;
    match.log.push({ type: 'counter', side, cardId: card.id, name: card.definition.name, remaining: card.counter });
    if (card.counter === 0) match.effects.unshift({ ability: card.definition.counter.effect,
      side, sourceId: card.id, requiredSource: true, cardAbility: true });
  },
  armor: (match, target, amount, sourceDefinitionId) => applyStatus(match, target, 'armor', amount, { sourceDefinitionId }),
  'infection-tick': tickInfection,
  'ready-order': (match, target) => reduceOrderCooldown(match, target, Infinity),
  'reduce-order-cooldown': reduceOrderCooldown,
  boost,
  damage,
  break: (match, target) => removeUnit(match, target, 'timer'),
  tick: (match, target) => {
    if (tickTimer(match, target)) removeUnit(match, target, 'timer');
  },
};

export function runEffect(match, job, random) {
  if (job.rowTick) return tickRow(match, job, random);
  if (job.scenarioChapter) return playChapter(match, job);
  if (job.startTimer) {
    const source = reference(match, job);
    if (!source || isLocked(source.card) || !(source.card.timer > 0)) return;
    const expired = tickTimer(match, source);
    enqueueCardEffect(match, job.side, source.card, 'startTurnPulse');
    if (expired) enqueueCardEffect(match, job.side, source.card, 'startTurn');
    return;
  }
  const needsSource = job.requiredSource || job.ability.sourceRow;
  const source = job.cardAbility || (!job.started && needsSource) ? reference(match, job) : undefined;
  if (job.cardAbility && isLocked(source?.card)) return;
  if (!job.started) {
    if ((job.requiredSource && !source) || (job.ability.sourceRow && source?.row !== job.ability.sourceRow)) return;
    if (job.deathwish && !job.announced) {
      match.log.push({ type: 'deathwish', side: job.side, name: job.deathwish });
      job.announced = true;
    }
    const { when, requiresResult } = job.ability;
    if (requiresResult && !job.results?.[requiresResult]) return;
    if (when && targets(match, job, when.targets, when.selectable).length < (when.atLeast ?? 1)) return;
    if (!selectTargets(match, job, random)) return;
    job.started = true;
    job.index = 0;
    job.results ??= {};
  }

  const step = job.ability.steps[job.index];
  if (!step) return;
  const holdsCategory = step.when?.orAlliesCategory &&
    units(match, job.side).every(({ card }) => card.definition.categories?.includes(step.when.orAlliesCategory));
  const coins = match.players[job.side].coins ?? 0;
  if ((step.requiresResult && !job.results[step.requiresResult]) ||
      (step.sourceRow && reference(match, job)?.row !== step.sourceRow) ||
      (step.when?.targets && !holdsCategory && !targets(match, job, step.when.targets).length) ||
      coins < (step.when?.coinsAtLeast ?? 0) || coins >= (step.when?.coinsBelow ?? Infinity)) {
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'coins' || step.action === 'choose-tribute' || step.action === 'choose-hand-bottom') {
    const player = match.players[job.side];
    if (step.action === 'coins') changeCoins(match, job.side, step.amount);
    if (step.action === 'choose-tribute') {
      const origin = reference(match, job);
      if (origin && player.board[origin.row].length < ROW_LIMIT) {
        const options = Object.keys(step.tiers).filter((cost) => Number(cost) <= (player.coins ?? 0));
        if (!job.refs.tribute && options.length) {
          pause(match, job, 'tribute', 'tribute', ['0', ...options], 'Выбери размер взноса.',
            { tiers: step.tiers });
          return;
        }
        if (step.tiers[job.refs.tribute]) {
          changeCoins(match, job.side, -Number(job.refs.tribute));
          spawn(match, job, { ...step.spawn, amount: step.tiers[job.refs.tribute] });
        }
      }
    }
    if (step.action === 'choose-hand-bottom' && player.hand.length) {
      if (!job.refs.bottomCard) {
        pause(match, job, 'hand-bottom', 'bottomCard', player.hand.map(({ id }) => id),
          'Выбери карту из руки на дно колоды.', { pile: 'hand' });
        return;
      }
      const index = player.hand.findIndex(({ id }) => id === job.refs.bottomCard);
      if (index >= 0) {
        const [card] = player.hand.splice(index, 1);
        player.deck.push(card);
        match.log.push({ type: 'hand-bottom', side: job.side, cardId: card.id, name: card.definition.name });
      }
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'choose-unit') {
    if (!job.refs[step.ref]) {
      const options = targets(match, job, step.target, true).map(({ card }) => card.id);
      if (options.length) {
        pause(match, job, step.kind, step.ref, options, step.prompt);
        return;
      }
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'inherit-deathwishes') {
    const unit = reference(match, job);
    if (unit) {
      const wishes = new Map();
      for (const card of match.players[job.side].discard) {
        if (card.definition.rarity !== 'bronze') continue;
        for (const definition of deathwishDefinitions(card)) {
          const signature = JSON.stringify(definition.deathwish);
          if (!wishes.has(signature)) wishes.set(signature, definition);
        }
      }
      const inheritedDeathwishes = [...wishes.values()];
      unit.card.inheritedDeathwishes = inheritedDeathwishes;
      match.log.push({ type: 'inherit-deathwishes', side: unit.side, cardId: unit.card.id, inheritedDeathwishes });
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.status === 'target') {
    const reactions = [];
    const queued = match.effects.length;
    for (const unit of targets(match, job, step.target)) {
      applyStatus(match, unit, 'target', 1, { attacker: job.side, sourceDefinitionId: job.sourceDefinitionId });
      reactions.push(...match.effects.splice(0, match.effects.length - queued));
    }
    job.index += 1;
    match.effects.unshift(...reactions, job);
    return;
  }
  if (step.action === 'select-row') {
    if (!job.refs[step.ref]) {
      const selectionSide = rowSide(job.side, step);
      const rows = eligibleRows(match.players[selectionSide], step.filter);
      if (rows.length) {
        const markRow = job.ability.steps.some((part) => part.status === 'target' && part.target?.rowRef === step.ref);
        const kind = markRow ? 'mark-row' : { space: 'spawn-row', armor: 'armor-row', units: 'enemy-row', any: 'row-effect' }[step.filter];
        const damage = job.ability.steps.find((part) => part.action === 'damage' && part.target?.rowRef === step.ref);
        const armor = job.ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.ref);
        const scatter = job.ability.steps.find((part) => part.action === 'scatter' && part.rowRef === step.ref);
        const amount = scatter && valueOf(match, job, scatter.amount);
        const prompt = scatter ? `Выбери вражеский ряд · Ударов: ${amount} по 1 урону.` : step.prompt;
        pause(match, job, kind, step.ref, rows, prompt, {
          selectionSide,
          ...(kind === 'row-effect' && { amount: job.ability.steps.find((part) => part.action === 'row-effect')?.amount }),
          ...(damage && { amount: damage.amount, armorStrip: -(armor?.amount ?? 0) }),
          ...(scatter && { amount, scatter: true }),
        });
        return;
      }
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (Object.hasOwn(playPiles, step.action)) {
    const queued = match.effects.length;
    if (playFromPile(match, job, step, random)) {
      job.index += 1;
      match.effects.splice(match.effects.length - queued, 0, job);
    }
    return;
  }
  if (step.action === 'choose-deck-top') {
    const { deck } = match.players[job.side];
    if (deck.length && !job.refs.topCard) {
      pause(match, job, 'deck-top', 'topCard', deck.map(({ id }) => id), 'Выбери карту на верх колоды.');
      return;
    }
    const index = deck.findIndex(({ id }) => id === job.refs.topCard);
    if (index > 0) deck.unshift(...deck.splice(index, 1));
    if (deck.length) match.log.push({ type: 'deck-top', side: job.side });
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'return-hand') {
    const { hand, deck } = match.players[job.side];
    job.returns ??= valueOf(match, job, step.amount);
    if (job.returns > 0 && hand.length) {
      if (!job.refs.returnCard) {
        pause(match, job, 'hand-return', 'returnCard', hand.map(({ id }) => id),
          `Верни карту из руки в колоду. Осталось: ${job.returns}.`, { pile: 'hand' });
        return;
      }
      const [card] = hand.splice(hand.findIndex(({ id }) => id === job.refs.returnCard), 1);
      const position = Math.floor(random() * (deck.length + 1));
      deck.splice(position, 0, card);
      match.log.push({ type: 'hand-return', side: job.side, cardId: card.id, position });
      job.returns -= 1;
      delete job.refs.returnCard;
      match.effects.unshift(job);
      return;
    }
    delete job.returns;
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'draw') {
    const cards = takeCards(match.players[job.side], valueOf(match, job, step.amount));
    if (step.save) job.results[step.save] = cards.length;
    if (cards.length) match.log.push({ type: 'draw', side: job.side, count: cards.length, cards });
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'scatter') {
    job.hits ??= valueOf(match, job, step.amount);
    const rows = step.rowRef ? [job.refs[step.rowRef]].filter(Boolean) : ROWS;
    const side = step.side === 'ally' ? job.side : opponent(job.side);
    const candidates = units(match, side, rows).filter(({ card }) => isUnit(card));
    if (!candidates.length || job.hits <= 0) {
      delete job.hits;
      job.index += 1;
      match.effects.unshift(job);
      return;
    }
    job.hits -= 1;
    match.effects.unshift(job);
    damage(match, candidates[Math.floor(random() * candidates.length)], 1, job.sourceDefinitionId, {
      scattered: true, attacker: job.side, sourceRow: step.rowRef ? reference(match, job)?.row : job.refs.row,
      ...(step.visual && { visual: step.visual }),
      ...(step.visual === 'turret' && { sourceId: job.sourceId }),
    });
    return;
  }
  if (step.action === 'row-effect') {
    const side = rowSide(job.side, step);
    const player = match.players[side];
    const score = (row) => player.board[row].reduce((sum, card) => sum + (card.power ?? 0), 0);
    const rows = step.row === 'all' ? ROWS : [step.row === 'strongest'
      ? ROWS.reduce((best, row) => score(row) > score(best) ? row : best)
      : step.rowRef ? job.refs[step.rowRef] : step.row];
    for (const row of rows.filter((row) => ROWS.includes(row))) {
      setRowEffect(match, side, row, { type: step.effect, remaining: step.amount,
        sourceDefinitionId: job.sourceDefinitionId, attacker: job.side });
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'replace-leader') {
    const player = match.players[job.side];
    const { ability, text, ...order } = step.order;
    const leader = { ...(player.leader ?? { name: 'Файлура' }), ability, text,
      order: { ...order, sourceDefinitionId: job.sourceDefinitionId } };
    player.leader = leader;
    match.log.push({ type: 'leader-replaced', side: job.side, name: leader.name, leader });
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (['spawn', 'summon-from-deck', 'boost-deck', 'watch-sacrifice', 'remember-row'].includes(step.action)) {
    const queued = match.effects.length;
    if (step.action === 'spawn') spawn(match, job, step);
    if (step.action === 'summon-from-deck') summonFromDeck(match, job, step, random);
    if (step.action === 'remember-row') job.refs[step.ref] = targets(match, job, step.target)[0]?.row;
    if (step.action === 'watch-sacrifice') {
      const scenario = reference(match, job);
      if (scenario) scenario.card.scenarioSacrifice = job.refs[step.ref];
    }
    if (step.action === 'boost-deck') {
      for (const card of match.players[job.side].deck) {
        if (card.definition.categories?.includes(step.category)) changeBasePower(match, { card, side: job.side, pile: 'deck' }, step.amount);
      }
    }
    job.index += 1;
    match.effects.splice(match.effects.length - queued, 0, job);
    return;
  }

  if (!job.remaining) {
    const eligible = targets(match, job, step.target);
    const count = step.count ?? 1;
    job.remaining = step.mode === 'random' && eligible.length > count
      ? chooseSubset(eligible.map(({ card }) => card), count, random)
      : eligible.map(({ card }) => card.id);
    if (step.saveTargets) job.refs[step.saveTargets] = [...job.remaining];
    if (step.grouped && job.remaining.length) {
      const [receiver] = targets(match, job, step.receiver);
      emit(match, { type: 'consume-group', side: job.side, cardIds: [...job.remaining], eaterId: receiver.card.id });
    }
  }
  const next = job.remaining.shift();
  if (job.remaining.length === 0) {
    delete job.remaining;
    job.index += 1;
  }
  match.effects.unshift(job);

  const target = job.piles ? findInPiles(match, job.side, next, job.piles) : findUnit(match, next);
  if (!target) return;
  let result;
  if (step.action === 'consume') {
    const [receiver] = targets(match, job, step.receiver);
    result = consume(match, target, receiver, step);
  } else if (step.action === 'capture') {
    capture(match, job.side, target);
  } else if (step.action === 'transform') {
    transformUnit(match, target, step.card);
  } else if (step.action === 'art-state') {
    target.card.artState = step.state;
    match.log.push({ type: 'art-state', side: target.side, cardId: target.card.id, artState: step.state });
  } else if (step.action === 'activate-deathwish') {
    match.effects.unshift(...deathwishJobs(target.card, {
      side: target.side, row: target.row, position: target.position, sourceId: target.card.id,
    }));
  } else if (step.action === 'destroy') {
    removeUnit(match, target, 'destroy', undefined, {
      sourceDefinitionId: job.sourceDefinitionId,
      ...(step.visual && { visual: step.visual }),
    });
  } else if (step.action === 'discard') {
    removeUnit(match, target, 'discard', undefined, { sourceDefinitionId: job.causeDefinitionId });
  } else if (step.action === 'status') {
    result = applyStatus(match, target, step.status, valueOf(match, job, step.amount, target), { sourceDefinitionId: job.sourceDefinitionId, ...(step.status === 'infection' && { attacker: job.side }) });
  } else {
    const operation = operations[step.action];
    if (!operation) throw new Error(`Unknown action: ${step.action}`);
    const amount = valueOf(match, job, step.amount, target);
    const overflow = step.action === 'damage' && step.slay ? damageOverflow(target.card, amount) : 0;
    const measuredDamage = step.measureDamage && isUnit(target.card) && !statusCount(target.card, 'shield')
      ? Math.min(amount, target.card.power + (target.card.armor ?? 0)) : 0;
    result = operation(match, target, amount, job.sourceDefinitionId, { attacker: job.side });
    if (step.measureDamage) result = measuredDamage;
    if (step.action === 'damage' && result && step.slay) {
      match.effects.splice(match.effects.indexOf(job), 0, {
        ability: step.slay, side: job.side, sourceId: job.sourceId, sourceDefinitionId: job.sourceDefinitionId,
        cardAbility: job.cardAbility, refs: { slain: target.card.id }, results: { overflow },
      });
    }
  }
  if (step.save) job.results[step.save] = (job.results[step.save] ?? 0) + (result ?? 0);
}

function strongestDestruction(match, side, card) {
  const ability = cardAbilities(card)[playTiming(match, side, card)];
  const step = ability?.steps.find(({ action, target }) => action === 'destroy' && target.strongest);
  if (!step) return;
  const options = targets(match, { side }, step.target);
  return { options, random: step.mode === 'random' };
}

export function destructionSwing(match, side, card) {
  const destruction = strongestDestruction(match, side, card);
  if (!destruction) return;
  const { options, random } = destruction;
  const swing = options.reduce((sum, target) => sum + (target.side === side ? -1 : 1) * target.card.power, 0);
  return swing / (random ? Math.max(1, options.length) : 1);
}

export function destructionRolls(match, side, card) {
  const destruction = card && strongestDestruction(match, side, card);
  const count = destruction?.random ? destruction.options.length : 0;
  return count > 1 ? Array.from({ length: count }, (_, index) => (index + .5) / count) : [.5];
}

// Estimate immediate score swing from public targets for the bot's existing pass calculation.
export function effectSwing(match, side, card) {
  const { deploy, scenario } = cardAbilities(card);
  const ability = deploy ?? scenario?.prologue;
  const player = match.players[side];
  const job = { ability, side };
  let swing = destructionSwing(match, side, card) ?? 0;
  const applyInfection = ability?.steps.some((step) => step.status === 'infection') && canStart(match, job);
  for (const step of ability?.steps ?? []) {
    if (step.action === 'row-effect') {
      const defender = match.players[rowSide(side, step)];
      const values = ROWS.map((row) => rowEffectValue(defender, row, step.amount));
      swing += step.row === 'all' ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
    }
    if (step.action === 'boost' && (step.amount?.count || step.amount?.markedThisMatch || step.amount?.startingCategory)) swing += valueOf(match, job, step.amount);
    if (step.action === 'consume') swing += step.extra ?? 0;
    if (step.action === 'play-from-hand' || step.chooseAll) {
      const candidates = eligiblePileCards(match, side, playPiles[step.action], step);
      swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, candidate)));
    } else if (step.action === 'play-from-deck') {
      if (step.fullDeck) {
        const candidates = eligiblePileCards(match, side, 'deck', step);
        swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, candidate)));
      } else {
        const deck = pileCandidates(player.deck, step.filter);
        swing += deck.reduce((sum, candidate) => sum + candidate.definition.power, 0) / Math.max(1, deck.length)
          + Number(Boolean(step.after));
      }
    }
    if (step.action === 'play-from-discard' && step.filter.anyType) {
      const candidates = eligiblePileCards(match, side, 'discard', step);
      swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, restoreCard(candidate))));
    }
    if (step.action === 'summon-from-deck' && availableRows(player).some((row) => player.board[row].length < ROW_LIMIT - 1)) {
      const deck = pileCandidates(player.deck, step.filter);
      swing += deck.reduce((sum, candidate) => sum + candidate.power, 0) / Math.max(1, deck.length);
    }
    if (step.action === 'spawn' && step.rowRef) {
      const free = ROW_LIMIT - Math.min(...ROWS.map((row) => player.board[row].length));
      swing += Math.min(step.amount, free) * step.card.power;
    }
    if (step.action === 'spawn' && step.overflow) {
      const free = ROWS.reduce((sum, row) => sum + ROW_LIMIT - player.board[row].length, 0) - 1;
      swing += Math.min(step.amount, Math.max(0, free)) * step.card.power;
    }
    if (step.action === 'replace-leader') swing += 2;
    if (step.action === 'scatter') {
      const enemy = match.players[opponent(side)];
      if (step.rowRef) {
        const amount = valueOf(match, job, step.amount);
        swing += Math.max(...ROWS.map((row) => rowScatterValue(enemy, row, amount)));
      } else {
        const health = units(match, opponent(side)).reduce((sum, { card }) => sum + (card.power ?? 0), 0);
        swing += Math.min(health, Math.max(...ROWS.map((row) => rowArmor(player, row))));
      }
    }
    if (step.action === 'status' && step.status === 'infection' && applyInfection) {
      const selection = ability.select?.find(({ ref }) => ref === step.target.ref);
      const candidates = targets(match, job, selection?.targets ?? step.target, Boolean(selection && selection.mode !== 'random'));
      const gains = candidates.map((target) => {
        const player = match.players[target.side];
        return player.passed ? 0 : (target.side === side ? -1 : 1) *
          infectionGain(target.card, valueOf(match, job, step.amount, target), Math.max(1, player.hand.length));
      });
      swing += (selection ? Math.max(0, ...gains) : gains.reduce((sum, gain) => sum + gain, 0)) * .75;
    }
    if (step.status === 'target') {
      const candidates = units(match, opponent(side)).filter(({ card }) => isUnit(card) && !statusCount(card, 'target'));
      swing += step.target.rowRef ? Math.max(...ROWS.map((row) => candidates.filter((unit) => unit.row === row).length)) * 1.3
        : Number(candidates.length > 0) * 1.3;
    }
    if (step.action !== 'damage') continue;
    if (step.target.scope === 'source') {
      if (!statusCount(card, 'shield')) swing -= Math.min(card.power ?? 0,
        Math.max(0, valueOf(match, job, step.amount) - (card.armor ?? 0)));
      continue;
    }
    if (step.target.rowRef) {
      const strip = ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.target.rowRef);
      swing += Math.max(0, ...ROWS.map((row) => rowDamage(match.players[opponent(side)], row, step.amount, -(strip?.amount ?? 0))));
      continue;
    }
    const index = (ability.select ?? []).findIndex(({ ref }) => ref === step.target.ref);
    const options = index < 0 ? targets(match, job, step.target) : targets(match, job, ability.select[index].targets, ability.select[index].mode !== 'random');
    const stripArmor = step.amount?.result === 'armor' && step.amount.base !== undefined;
    const amounts = options.map((target) => valueOf(match, job, step.amount, target) + (stripArmor ? target.card.armor : 0));
    const highest = Math.max(0, ...amounts);
    const points = options.map(({ card, side: targetSide }, index) =>
      statusCount(card, 'shield') || (step.amount?.row && amounts[index] !== highest) ? 0
        : (targetSide === side ? -1 : 1) * Math.min(card.power, Math.max(0, amounts[index] - (stripArmor ? 0 : card.armor ?? 0))));
    swing += (step.target.infected || step.target.marked) && !step.mode ? points.reduce((sum, value) => sum + value, 0)
      : points.length ? Math.max(...points) : 0;
  }
  return swing;
}

export function deckCardValue(match, side, card) {
  const { definition } = card;
  const { deploy, order, endTurn, scenario } = cardAbilities(card);
  const value = (card.power ?? 0) * (definition.enemySide ? -1 : 1) + (card.armor ?? 0) * .15;
  const swing = deploy?.steps.some((step) => step.fullDeck || step.action === 'play-from-discard') ? 0 : effectSwing(match, side, card);
  return value + swing + Number(Boolean(deploy || order || endTurn || scenario));
}
