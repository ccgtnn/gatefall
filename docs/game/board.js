import { ROWS } from './card-metadata.js';
import { cardAbilities, emit, isLocked } from './events.js';

export const ROW_LIMIT = 9;
export const HAND_LIMIT = 10;
export const COIN_LIMIT = 9;
export const opponent = (side) => side === 'human' ? 'bot' : 'human';

export const cardType = ({ definition }) => definition.type ?? 'unit';
export const activeOrder = ({ card, row }) => {
  const { order } = cardAbilities(card);
  return order && card.orderCharges !== 0 && (!order.sourceRow || order.sourceRow === row) ? order : undefined;
};
export const isUnit = (card) => cardType(card) === 'unit';
export const basePower = (card) => card.basePower ?? card.definition.power;
export const placementSide = (side, card) => card.definition.enemySide ? opponent(side) : side;

export function createCard(id, definition) {
  const card = { id, definition, readyAt: 0 };
  if (isUnit(card)) Object.assign(card, { power: definition.power, basePower: definition.power, armor: definition.armor ?? 0 });
  if (definition.order?.charges !== undefined) card.orderCharges = definition.order.charges;
  if (definition.timer !== undefined) card.timer = definition.timer;
  if (definition.scenario) card.chapter = 0;
  if (definition.resilience) card.resilient = true;
  if (definition.counter) card.counter = definition.counter.amount;
  return card;
}

export function restoreCard(previous) {
  const card = createCard(previous.id, previous.definition);
  if (previous.orderCharges !== undefined) {
    card.orderCharges = previous.orderCharges;
    card.orderUsedTurn = previous.orderUsedTurn;
  }
  if (previous.resilient === false) card.resilient = false;
  if (isLocked(previous)) card.statuses = { lock: 1 };
  if (isUnit(card)) card.power = card.basePower = basePower(previous);
  return card;
}

export function spendResilience(card) {
  if (!card.resilient || isLocked(card)) return false;
  card.resilient = false;
  return true;
}

export function placeCards(player, row, position, cards) {
  for (const card of cards) {
    if (cardAbilities(card).order) card.readyAt = player.turns + Number(!card.definition.zeal);
  }
  player.board[row].splice(position, 0, ...cards);
}

export function playDestination(player, { row, position }) {
  if (!ROWS.includes(row)) return null;
  const line = player.board[row];
  if (line.length >= ROW_LIMIT || !Number.isInteger(position) || position < 0 || position > line.length) return null;
  return { row, position };
}

export function availableRows(player, card) {
  const required = card?.definition.requiredRow;
  return ROWS.filter((row) => (!required || required === row) && player.board[row].length < ROW_LIMIT);
}

export function changeCoins(match, side, amount) {
  const player = match.players[side];
  const before = player.coins ?? 0;
  if (!Number.isInteger(amount) || before + amount < 0) return;
  const coins = Math.min(COIN_LIMIT, before + amount);
  player.coins = coins;
  if (coins !== before) match.log.push({ type: 'coins', side, coins, amount: coins - before });
}

export function recordCardPlay(player, card) {
  const categories = card?.definition.categories;
  if (categories?.length) {
    const counts = { ...player.categoryPlays };
    for (const category of new Set(categories)) counts[category] = (counts[category] ?? 0) + 1;
    player.categoryPlays = counts;
    if (cardType(card) === 'effect') {
      const effectCounts = { ...player.effectCategoryPlays };
      for (const category of new Set(categories)) effectCounts[category] = (effectCounts[category] ?? 0) + 1;
      player.effectCategoryPlays = effectCounts;
    }
  }
  for (const line of Object.values(player.board)) {
    for (const scenario of line) {
      const category = scenario.definition.scenario?.countPlayedEffects;
      if (category) scenario.playedEffects = player.effectCategoryPlays?.[category] ?? 0;
    }
  }
  const firstLegendary = card?.definition.rarity === 'gold' && !player.playedLegendary;
  if (firstLegendary) player.playedLegendary = true;
  return firstLegendary;
}

export function announcePlay(match, side, card, destination, extra) {
  const firstLegendary = recordCardPlay(match.players[side], card);
  const boardSide = destination && placementSide(side, card);
  const reactions = emit(match, { type: 'play', side, ...(boardSide && boardSide !== side && { boardSide }), row: destination?.row, name: card.definition.name,
    power: card.power, cardType: cardType(card), cardId: card.id,
    card: { ...card }, position: destination?.position, ...extra }, { played: card, firstLegendary });
  if (card.armor) emit(match, { type: 'armor', side: boardSide ?? side, name: card.definition.name, cardId: card.id,
    armor: card.armor, amount: card.armor });
  if (boardSide) {
    refreshPlacedPower(match, boardSide, destination.row, card.definition);
    reactions.push(...appearanceJobs(match, boardSide, card));
    const category = card.definition.scenario?.countPlayedEffects;
    if (category) card.playedEffects = match.players[boardSide].effectCategoryPlays?.[category] ?? 0;
  }
  return reactions;
}

export function appearanceJobs(match, side, card) {
  if (!isUnit(card) || !findUnit(match, card.id)) return [];
  return emit(match, { type: 'appearance', side }, { played: card, journal: false });
}

export function captureDestination(match, side, unit) {
  const player = match.players[side];
  return [unit.row, ...ROWS.filter((row) => row !== unit.row)].find((row) => player.board[row].length < ROW_LIMIT);
}

export function capture(match, side, unit) {
  if (!isUnit(unit.card) || unit.side === side) return;
  const row = captureDestination(match, side, unit);
  if (!row) return;
  const { card } = unit;
  const previous = match.players[unit.side];
  const player = match.players[side];
  previous.board[unit.row].splice(unit.position, 1);
  card.owner ??= unit.side;
  card.readyAt = player.turns + Math.max(0, card.readyAt - previous.turns);
  if (card.orderUsedTurn === previous.turns) card.orderUsedTurn = player.turns;
  else delete card.orderUsedTurn;
  for (const job of match.effects) {
    if (job.sourceId === card.id && (job.requiredSource || job.startTimer || job.scenarioChapter) && !job.piles) job.side = side;
  }
  const position = player.board[row].length;
  player.board[row].push(card);
  match.log.push({ type: 'capture', side, row, position, fromSide: unit.side, fromRow: unit.row,
    cardId: card.id, name: card.definition.name, card: { ...card } });
  refreshSidePower(match, unit.side);
  refreshSidePower(match, side);
  refreshRowPower(match, unit.side, unit.row);
  refreshRowPower(match, side, row);
  match.effects.unshift(...appearanceJobs(match, side, card));
}

function onPowerLoss(match, unit) {
  match.effects.unshift(...emit(match, { type: 'power-loss', side: unit.side }, { source: unit.card, journal: false }));
}

export function units(match, side, rows = ROWS) {
  return rows.flatMap((row) => match.players[side].board[row].map((card, position) => ({
    side, row, card, position,
  })));
}

export function findUnit(match, id) {
  if (!id) return undefined;
  return units(match, 'human').find(({ card }) => card.id === id) ??
    units(match, 'bot').find(({ card }) => card.id === id);
}

export function findInPiles(match, side, id, piles) {
  for (const pile of piles) {
    const card = match.players[side][pile].find((entry) => entry.id === id);
    if (card) return { card, side, pile };
  }
}

export function neighbors(match, unit) {
  if (!unit) return [];
  return units(match, unit.side, [unit.row]).filter(({ position }) =>
    Math.abs(position - unit.position) === 1);
}

export function boost(match, unit, amount, sourceDefinitionId) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  unit.card.power += amount;
  match.log.push({ type: 'boost', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount, ...(sourceDefinitionId && { sourceDefinitionId }) });
}

export function weaken(match, unit, amount) {
  if (!unit || !isUnit(unit.card) || !(amount > 0)) return;
  const { card, side } = unit;
  const lost = Math.min(card.power, amount);
  card.power -= lost;
  match.log.push({ type: 'weaken', side, name: card.definition.name, cardId: card.id, power: card.power, amount: lost });
  if (card.power === 0) removeUnit(match, unit, 'weaken');
  else onPowerLoss(match, unit);
}

export function changeBasePower(match, unit, amount) {
  if (!unit || !isUnit(unit.card) || !Number.isInteger(amount) || !amount) return;
  const { card, side, pile } = unit;
  const before = basePower(card);
  card.basePower = Math.max(1, before + amount);
  card.power = Math.max(0, card.power + card.basePower - before);
  // Growth in a hidden pile must not reveal the card or its presence in the deck.
  if (pile) return;
  match.log.push({ type: 'base-power', side, cardId: card.id, basePower: card.basePower, power: card.power });
  if (card.power === 0) removeUnit(match, unit, 'weaken');
}

export function heal(match, unit) {
  if (!unit || !isUnit(unit.card)) return;
  const { card, side } = unit;
  const { sidePower, rowPower } = card.definition;
  card.power = basePower(card) + (card[sidePower?.key] ?? 0) + (card[rowPower?.key] ?? 0);
  match.log.push({ type: 'heal', side, cardId: card.id, power: card.power });
}

export function setRowEffect(match, side, row, effect) {
  const player = match.players[side];
  player.rowEffects ??= {};
  if (effect) player.rowEffects[row] = effect;
  else delete player.rowEffects[row];
  match.log.push({ type: 'row-effect', side, row, effect });
}

const STATUS_RULES = Object.freeze({
  armor: { read: (card) => card.armor ?? 0, next: (current, amount) => Math.max(0, current + amount), unit: true },
  immune: { read: (card) => Number(card.definition.immune ?? false) },
  doomed: { read: (card) => Number(card.statuses?.doomed ?? card.definition.doomed ?? false),
    next: (_current, amount) => Number(amount > 0) },
  shield: { read: (card) => Number(card.statuses?.shield ?? card.definition.shield ?? false),
    next: (_current, amount) => Number(amount > 0), unit: true },
  target: { read: (card) => card.statuses?.target ?? 0, next: (current, amount) => Math.max(current, Number(amount > 0)), unit: true },
  lock: { read: (card) => Number(isLocked(card)), next: (current, amount) => Math.max(current, Number(amount > 0)), unit: true },
  infection: { read: (card) => card.statuses?.infection ?? 0,
    next: (current, amount) => Math.max(0, current + amount),
    unit: true, turnEnd: 'infection-tick' },
});

export function statusEndTurn(card) {
  return Object.values(STATUS_RULES).filter((rule) => rule.turnEnd && rule.read(card))
    .map((rule) => ({ action: rule.turnEnd, target: { scope: 'source' } }));
}

export function statusCount(card, status) {
  return STATUS_RULES[status]?.read(card) ?? 0;
}

export function cleansableStatuses(card) {
  return Object.entries(card.statuses ?? {}).filter(([status, count]) =>
    Boolean(count) && status !== 'armor' && (status !== 'doomed' || !card.definition.doomed))
    .map(([status]) => status);
}

export function cleanse(match, unit) {
  if (!unit || !isUnit(unit.card)) return;
  const { card, side, row } = unit;
  const removed = cleansableStatuses(card);
  const inherited = Boolean(card.inheritedDeathwishes?.length);
  if (!removed.length && !inherited) return;

  const statuses = { ...card.statuses };
  for (const status of removed) {
    // A stored active shield was granted after creation. A spent native shield stays spent.
    if (status === 'shield' && card.definition.shield) statuses.shield = 0;
    else delete statuses[status];
  }
  card.statuses = statuses;
  if (removed.includes('infection')) delete card.infectionSource;
  if (inherited) delete card.inheritedDeathwishes;
  match.log.push({ type: 'cleanse', side, cardId: card.id, name: card.definition.name, statuses, removed, inherited });
  if (removed.includes('lock')) {
    if (card.definition.sidePowerAura) refreshSidePower(match, side, card.id);
    if (card.definition.rowPower) refreshRowPower(match, side, row, card.id);
  }
}

export function applyStatus(match, unit, status, amount, extra) {
  const rule = STATUS_RULES[status];
  if (!unit || !rule?.next || (rule.unit && !isUnit(unit.card)) || !Number.isInteger(amount)) return 0;
  const { card, side } = unit;
  if (status === 'target' && extra?.attacker !== opponent(side)) return 0;
  const before = rule.read(card);
  const count = rule.next(before, amount);
  if (count === before) return 0;

  if (status === 'armor') card.armor = count;
  else {
    card.statuses = { ...card.statuses, [status]: count };
    if (status === 'infection' && count === 0) {
      delete card.statuses.infection;
      delete card.infectionSource;
    } else if (status === 'infection' && amount > 0) {
      card.infectionSource = extra?.sourceDefinitionId ? { sourceDefinitionId: extra.sourceDefinitionId, attacker: extra.attacker } : undefined;
    }
  }
  const event = { type: status === 'armor' ? 'armor' : 'status', status, count,
    side, name: card.definition.name, cardId: card.id, amount: count - before, ...extra };
  if (status === 'armor') event.armor = count;
  if (status === 'target') {
    const attacker = match.players[extra.attacker];
    attacker.marksPlaced = (attacker.marksPlaced ?? 0) + 1;
  }
  const context = { source: card, neighbors: neighbors(match, unit) };
  const effects = emit(match, event, context);
  if (status === 'armor' && before > 0 && count === 0) {
    effects.push(...emit(match, { type: 'armor-break', side, cardId: card.id, sourceDefinitionId: extra?.sourceDefinitionId }, { ...context, journal: false }));
  }
  if (status === 'infection' && before === 0 && count > 0) {
    effects.push(...emit(match, { ...event, type: 'first-infection' }, { ...context, journal: false }));
  }
  if (status === 'target') {
    effects.push(...emit(match, { ...event, type: 'target-marked', side: extra.attacker }, { journal: false }));
  }
  match.effects.unshift(...effects);
  if (status === 'lock' && card.definition.sidePowerAura) refreshSidePower(match, side, card.id);
  if (status === 'lock' && card.definition.rowPower) refreshRowPower(match, side, unit.row, card.id);
  return before - count;
}

export function infectionDamage(card, ticks = statusCount(card, 'infection')) {
  return Math.min(card.power ?? 0, Math.max(0, ticks - statusCount(card, 'shield')));
}

export function tickInfection(match, unit) {
  if (!statusCount(unit.card, 'infection')) return;
  const { card } = unit;
  const infection = statusCount(card, 'infection');
  const cause = card.infectionSource;
  const blocked = Boolean(statusCount(card, 'shield'));
  if (blocked) applyStatus(match, unit, 'shield', -1, { ...cause, blockedDamage: 1 });
  else card.power -= 1;
  applyStatus(match, unit, 'infection', -1, { ...cause, tick: true, blocked, power: card.power });
  if (card.power === 0) removeUnit(match, unit, 'infection', undefined, { infection, ...cause });
  else if (!blocked) onPowerLoss(match, unit);
}

export function removeUnit(match, unit, reason, consumerId, extra) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const owner = card.owner ?? side;
  const exile = reason === 'destroy' || statusCount(card, 'doomed') > 0;
  discardCard(match, side, card, exile);
  const death = ['destroy', 'discard'].includes(reason) ? undefined : { row, position, refs: { consumer: consumerId } };
  match.effects.unshift(...emit(match, {
    type: death ? 'death' : reason, side,
    ...(owner !== side && { owner }), name: card.definition.name, cardId: card.id, power: card.power,
    infection: statusCount(card, 'infection'), exile, reason, ...extra,
  }, { source: card, death }));
  if (card.definition.sidePowerAura) refreshSidePower(match, side);
  if (player.board[row].some(({ definition }) => suppliesRowPower(card, definition.rowPower))) refreshRowPower(match, side, row);
}

function suppliesRowPower(card, rule) {
  return rule && isUnit(card) && rule.requires.values.includes(card.definition[rule.requires.field]);
}

export function refreshRowPower(match, side, row, preservePowerId) {
  const line = match.players[side].board[row];
  const fallen = [];
  for (const card of line) {
    const rule = card.definition.rowPower;
    if (!rule) continue;
    const { key, amount } = rule;
    const bonus = !isLocked(card) && line.some((candidate) => suppliesRowPower(candidate, rule)) ? amount : 0;
    const delta = bonus - (card[key] ?? 0);
    if (!delta) continue;
    if (bonus) card[key] = bonus;
    else delete card[key];
    if (card.id !== preservePowerId) card.power = Math.max(0, card.power + delta);
    match.log.push({ type: 'aura-power', side, cardId: card.id, power: card.power, [key]: bonus });
    if (card.power === 0) fallen.push(card.id);
  }
  for (const id of fallen) {
    const unit = findUnit(match, id);
    if (unit?.card.power === 0) removeUnit(match, unit, 'aura');
  }
}

export function refreshSidePower(match, side, preservePowerId) {
  const field = units(match, side);
  const byGroup = new Map();
  for (const { card } of field) {
    const amount = cardAbilities(card).sidePowerAura;
    const group = card.definition.sidePower?.group;
    if (amount && group) byGroup.set(group, (byGroup.get(group) ?? 0) + amount);
  }
  const fallen = [];
  for (const { card } of field) {
    if (!isUnit(card) || !card.definition.sidePower) continue;
    const { group, key } = card.definition.sidePower;
    const bonus = byGroup.get(group) ?? 0;
    const delta = bonus - (card[key] ?? 0);
    if (!delta) continue;
    if (bonus) card[key] = bonus;
    else delete card[key];
    // Lock removes the aura from other cards while preserving the target's current power.
    if (card.id !== preservePowerId) card.power += delta;
    match.log.push({ type: 'aura-power', side, cardId: card.id, power: card.power, [key]: bonus });
    if (card.power <= 0) fallen.push(card.id);
  }
  for (const id of fallen) {
    const unit = findUnit(match, id);
    if (unit && unit.card.power <= 0) removeUnit(match, unit, 'aura');
  }
}

export function refreshPlacedPower(match, side, row, definition) {
  if (definition.sidePower) refreshSidePower(match, side);
  refreshRowPower(match, side, row);
}

export function transformUnit(match, unit, definition, preservePower = false) {
  const { side, row, position, card } = unit;
  const replacement = createCard(card.id, definition);
  if (preservePower) replacement.power = card.power;
  if (card.owner) replacement.owner = card.owner;
  if (isLocked(card)) replacement.statuses = { lock: 1 };
  match.players[side].board[row][position] = replacement;
  match.log.push({ type: 'transform', side, cardId: card.id, name: card.definition.name, card: { ...replacement } });
  refreshSidePower(match, side);
  refreshRowPower(match, side, row);
  match.effects.unshift(...appearanceJobs(match, side, replacement));
}

export function discardCard(match, side, card, exile = false) {
  const player = match.players[card.owner ?? side];
  player[exile ? 'exile' : 'discard'].push(card);
}

export function damageOverflow(card, amount) {
  return statusCount(card, 'shield') ? 0 : Math.max(0, amount - (card.armor ?? 0) - card.power);
}

export function damage(match, unit, amount, sourceDefinitionId, extra) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  if (statusCount(unit.card, 'shield')) {
    applyStatus(match, unit, 'shield', -1, { ...extra, sourceDefinitionId, blockedDamage: amount });
    return 0;
  }
  const absorbed = Math.min(amount, unit.card.armor ?? 0);
  applyStatus(match, unit, 'armor', -absorbed, { ...extra, sourceDefinitionId });
  const lost = Math.min(unit.card.power, amount - absorbed);
  unit.card.power -= lost;
  emit(match, { type: 'damage', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount, absorbed, lost, sourceDefinitionId, ...extra });
  if (unit.card.power > 0) {
    if (lost) onPowerLoss(match, unit);
    if (lost || absorbed) match.effects.unshift(...emit(match, { type: 'damage', side: unit.side },
      { source: unit.card, journal: false }));
    return 0;
  }
  removeUnit(match, unit, 'damage', undefined, { sourceDefinitionId, ...extra });
  return 1;
}

export function consume(match, victim, consumer, { multiplier = 1, extra = 0, grouped } = {}) {
  if (!victim || !consumer || !isUnit(victim.card) || !isUnit(consumer.card) ||
      victim.side !== consumer.side || victim.card.id === consumer.card.id) return 0;
  const nearby = neighbors(match, victim);
  const strength = victim.card.power;
  const reactions = emit(match, {
    type: 'consume', side: victim.side, name: victim.card.definition.name, cardId: victim.card.id, eaterId: consumer.card.id, eater: consumer.card.definition.name, amount: strength, ...(grouped && { grouped }),
  }, { neighbors: nearby });
  removeUnit(match, victim, 'consume', consumer.card.id);
  boost(match, consumer, strength * multiplier + extra);
  match.effects.unshift(...reactions);
  return strength;
}

export function takeCards(player, amount) {
  const cards = player.deck.splice(0, Math.max(0, Math.min(amount, HAND_LIMIT - player.hand.length)));
  player.hand.push(...cards);
  return cards;
}

export function spawnCards(match, side, row, position, count, definition) {
  const line = match.players[side].board[row];
  const added = Math.min(count, ROW_LIMIT - line.length);
  if (added <= 0) return;
  const tokens = Array.from({ length: added }, () => createCard(`token-${++match.tokenCount}`, definition));
  placeCards(match.players[side], row, position, tokens);
  emit(match, { type: 'spawn', side, row, count: added, name: definition.name, position, cards: tokens.map((card) => ({ ...card })) });
  refreshPlacedPower(match, side, row, definition);
  match.effects.unshift(...tokens.flatMap((card) => appearanceJobs(match, side, card)));
}
