import { ROWS } from './cards.js';

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
  if (change) match.log.push({ type: 'armor', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, armor: unit.card.armor, amount: change });
  return -change;
}

export function removeUnit(match, unit, reason, consumerId) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const exile = reason === 'destroy' || card.definition.doomed;
  (exile ? player.exile : player.discard).push(card);
  match.log.push({ type: reason === 'destroy' ? 'destroy' : 'death', side, name: card.definition.name, cardId: card.id, exile, reason });
  if (reason !== 'destroy' && card.definition.deathwish) {
    match.effects.unshift({
      ability: card.definition.deathwish, side, row, position, refs: { consumer: consumerId }, deathwish: card.definition.name,
    });
  }
}

export function damage(match, unit, amount, sourceDefinitionId) {
  if (!unit || !isUnit(unit.card) || amount <= 0) return;
  const absorbed = Math.min(amount, unit.card.armor ?? 0);
  changeArmor(match, unit, -absorbed);
  const lost = Math.min(unit.card.power, amount - absorbed);
  unit.card.power -= lost;
  match.log.push({ type: 'damage', side: unit.side, name: unit.card.definition.name, cardId: unit.card.id, power: unit.card.power, amount, absorbed, lost, sourceDefinitionId });
  if (unit.card.power === 0) removeUnit(match, unit, 'damage');
}

export function consume(match, victim, consumer, { multiplier = 1, extra = 0 } = {}) {
  if (!victim || !consumer || !isUnit(victim.card) || !isUnit(consumer.card) ||
      victim.side !== consumer.side || victim.card.id === consumer.card.id) return 0;
  const nearby = neighbors(match, victim);
  const strength = victim.card.power;
  match.log.push({
    type: 'consume', side: victim.side, name: victim.card.definition.name, cardId: victim.card.id, eaterId: consumer.card.id, eater: consumer.card.definition.name, amount: strength,
  });
  removeUnit(match, victim, 'consume', consumer.card.id);
  boost(match, consumer, strength * multiplier + extra);
  match.effects.unshift(...nearby.filter(({ card }) => card.definition.neighborConsumed)
    .map((unit) => {
      const { card, side } = unit;
      return { ability: card.definition.neighborConsumed, sourceId: card.id, side, requiredSource: true };
    }));
  return strength;
}

export function spawnCards(match, side, row, position, count, definition) {
  const line = match.players[side].board[row];
  const added = Math.min(count, ROW_LIMIT - line.length);
  if (added <= 0) return;
  const tokens = Array.from({ length: added }, () => createCard(`token-${++match.tokenCount}`, definition));
  placeCards(match.players[side], row, position, tokens);
  match.log.push({ type: 'spawn', side, row, count: added, name: definition.name, position, cards: tokens.map((card) => ({ ...card })) });
}
