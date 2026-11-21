import { ROWS } from './cards.js?v=step-20';
import { emit } from './events.js?v=step-16';

export const ROW_LIMIT = 9;
export const HAND_LIMIT = 10;
export const opponent = (side) => side === 'human' ? 'bot' : 'human';

export const cardType = ({ definition }) => definition.type ?? 'unit';
export const isUnit = (card) => cardType(card) === 'unit';

export function createCard(id, definition) {
  const card = { id, definition, readyAt: 0 };
  if (isUnit(card)) Object.assign(card, { power: definition.power, armor: definition.armor ?? 0 });
  if (definition.timer !== undefined) card.timer = definition.timer;
  if (definition.counter) card.counter = definition.counter.amount;
  return card;
}

export function placeCards(player, row, position, cards) {
  for (const card of cards) {
    if (card.definition.order) card.readyAt = player.turns + Number(!card.definition.zeal);
  }
  player.board[row].splice(position, 0, ...cards);
}

export function playDestination(player, { row, position }) {
  if (!ROWS.includes(row)) return null;
  const line = player.board[row];
  if (line.length >= ROW_LIMIT || !Number.isInteger(position) || position < 0 || position > line.length) return null;
  return { row, position };
}

export function availableRows(player) {
  return ROWS.filter((row) => player.board[row].length < ROW_LIMIT);
}

export function announcePlay(match, side, card, destination, extra) {
  emit(match, { type: 'play', side, row: destination?.row, name: card.definition.name,
    power: card.power, cardType: cardType(card), cardId: card.id,
    card: { ...card }, position: destination?.position, ...extra });
  if (card.armor) emit(match, { type: 'armor', side, name: card.definition.name, cardId: card.id,
    armor: card.armor, amount: card.armor });
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

export function neighbors(match, unit) {
  if (!unit) return [];
  return units(match, unit.side, [unit.row]).filter(({ position }) =>
    Math.abs(position - unit.position) === 1);
}

export function boost(match, unit, amount) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  unit.card.power += amount;
  match.log.push({ type: 'boost', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount });
}

const STATUS_RULES = Object.freeze({
  armor: { read: (card) => card.armor ?? 0, next: (current, amount) => Math.max(0, current + amount), unit: true },
  doomed: { read: (card) => Number(card.statuses?.doomed ?? card.definition.doomed ?? false),
    next: (_current, amount) => Number(amount > 0) },
  infection: { read: (card) => card.statuses?.infection ?? 0,
    next: (current, amount) => amount < 0 ? Math.max(0, current + amount) : Math.max(current, amount),
    unit: true, turnEnd: 'infection-tick' },
});

export function statusEndTurn(card) {
  return Object.values(STATUS_RULES).filter((rule) => rule.turnEnd && rule.read(card))
    .map((rule) => ({ action: rule.turnEnd, target: { scope: 'source' } }));
}

export function statusCount(card, status) {
  return STATUS_RULES[status]?.read(card) ?? 0;
}

export function applyStatus(match, unit, status, amount, extra) {
  const rule = STATUS_RULES[status];
  if (!unit || !rule || (rule.unit && !isUnit(unit.card)) || !Number.isInteger(amount)) return 0;
  const { card, side } = unit;
  const before = rule.read(card);
  const count = rule.next(before, amount);
  if (count === before) return 0;

  if (status === 'armor') card.armor = count;
  else {
    card.statuses = { ...card.statuses, [status]: count };
    if (status === 'infection' && count === 0) delete card.statuses.infection;
  }
  const event = { type: status === 'armor' ? 'armor' : 'status', status, count,
    side, name: card.definition.name, cardId: card.id, amount: count - before, ...extra };
  if (status === 'armor') event.armor = count;
  const context = { source: card, neighbors: neighbors(match, unit) };
  const effects = emit(match, event, context);
  if (status === 'armor' && before > 0 && count === 0) {
    effects.push(...emit(match, { type: 'armor-break', side, cardId: card.id, sourceDefinitionId: extra?.sourceDefinitionId }, { ...context, journal: false }));
  }
  match.effects.unshift(...effects);
  return before - count;
}

export function tickInfection(match, unit) {
  if (!statusCount(unit.card, 'infection')) return;
  const { card } = unit;
  card.power -= 1;
  applyStatus(match, unit, 'infection', -1, { tick: true, power: card.power });
  if (card.power === 0) removeUnit(match, unit, 'infection');
}

export function removeUnit(match, unit, reason, consumerId, extra) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const exile = reason === 'destroy' || statusCount(card, 'doomed') > 0;
  (exile ? player.exile : player.discard).push(card);
  const death = reason === 'destroy' || reason === 'discard' ? undefined : { row, position, refs: { consumer: consumerId } };
  match.effects.unshift(...emit(match, {
    type: death ? 'death' : reason, side, name: card.definition.name, cardId: card.id, power: card.power, exile, reason, ...extra,
  }, { source: card, death }));
}

export function damage(match, unit, amount, sourceDefinitionId, extra) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  const absorbed = Math.min(amount, unit.card.armor ?? 0);
  applyStatus(match, unit, 'armor', -absorbed, { ...extra, sourceDefinitionId });
  const lost = Math.min(unit.card.power, amount - absorbed);
  unit.card.power -= lost;
  emit(match, { type: 'damage', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount, absorbed, lost, sourceDefinitionId, ...extra });
  if (unit.card.power > 0) return 0;
  removeUnit(match, unit, 'damage');
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
}
