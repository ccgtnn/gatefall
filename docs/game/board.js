import { ROWS } from './cards.js';
import { emit } from './events.js?v=step-12';

export const ROW_LIMIT = 9;
export const opponent = (side) => side === 'human' ? 'bot' : 'human';

export const cardType = ({ definition }) => definition.type ?? 'unit';
export const isUnit = (card) => cardType(card) === 'unit';

export function createCard(id, definition) {
  const card = { id, definition, readyAt: 0 };
  if (isUnit(card)) Object.assign(card, { power: definition.power, armor: definition.armor ?? 0 });
  if (definition.timer !== undefined) card.timer = definition.timer;
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

export function changeArmor(match, unit, amount) {
  if (!unit || !isUnit(unit.card) || amount === 0) return 0;
  const change = Math.max(amount, -(unit.card.armor ?? 0));
  unit.card.armor = (unit.card.armor ?? 0) + change;
  if (change) emit(match, { type: 'armor', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, armor: unit.card.armor, amount: change });
  return -change;
}

export function removeUnit(match, unit, reason, consumerId) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const exile = reason === 'destroy' || card.definition.doomed;
  (exile ? player.exile : player.discard).push(card);
  const death = reason === 'destroy' ? undefined : { row, position, refs: { consumer: consumerId } };
  match.effects.unshift(...emit(match, {
    type: death ? 'death' : 'destroy', side, name: card.definition.name, cardId: card.id, exile, reason,
  }, { source: card, death }));
}

export function damage(match, unit, amount, sourceDefinitionId, extra) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  const absorbed = Math.min(amount, unit.card.armor ?? 0);
  changeArmor(match, unit, -absorbed);
  const lost = Math.min(unit.card.power, amount - absorbed);
  unit.card.power -= lost;
  emit(match, { type: 'damage', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount, absorbed, lost, sourceDefinitionId, ...extra });
  if (unit.card.power === 0) removeUnit(match, unit, 'damage');
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

export function spawnCards(match, side, row, position, count, definition) {
  const line = match.players[side].board[row];
  const added = Math.min(count, ROW_LIMIT - line.length);
  if (added <= 0) return;
  const tokens = Array.from({ length: added }, () => createCard(`token-${++match.tokenCount}`, definition));
  placeCards(match.players[side], row, position, tokens);
  emit(match, { type: 'spawn', side, row, count: added, name: definition.name, position, cards: tokens.map((card) => ({ ...card })) });
}
