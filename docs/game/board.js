import { LARVA, ROWS } from './cards.js';

export const ROW_LIMIT = 9;
export const opponent = (side) => side === 'human' ? 'bot' : 'human';

export function createCard(id, definition) {
  return { id, definition, power: definition.power, armor: definition.armor ?? 0, readyAt: 0 };
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
  if (!unit || amount <= 0) return;
  unit.card.power += amount;
  match.log.push({ type: 'boost', side: unit.side, name: unit.card.definition.name, amount });
}

export function changeArmor(match, unit, amount) {
  if (!unit || amount === 0) return;
  unit.card.armor = (unit.card.armor ?? 0) + amount;
  match.log.push({ type: 'armor', side: unit.side, name: unit.card.definition.name, amount });
}

export function removeUnit(match, unit, reason, consumerId) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const exile = reason === 'destroy' || card.definition.doomed;
  (exile ? player.exile : player.discard).push(card);
  match.log.push({ type: reason === 'destroy' ? 'destroy' : 'death', side, name: card.definition.name, exile });
  if (reason !== 'destroy' && card.definition.deathwish) {
    match.effects.unshift({
      effect: card.definition.deathwish, side, row, position, consumerId, deathwish: card.definition.name,
    });
  }
}

export function damage(match, unit, amount) {
  if (!unit || amount <= 0) return;
  const absorbed = Math.min(amount, unit.card.armor ?? 0);
  changeArmor(match, unit, -absorbed);
  const lost = Math.min(unit.card.power, amount - absorbed);
  unit.card.power -= lost;
  match.log.push({ type: 'damage', side: unit.side, name: unit.card.definition.name, amount, absorbed, lost });
  if (unit.card.power === 0) removeUnit(match, unit, 'damage');
}

export function consume(match, victim, consumer, { multiplier = 1, extra = 0 } = {}) {
  if (!victim || !consumer || victim.card.id === consumer.card.id) return;
  const nearby = neighbors(match, victim);
  const strength = victim.card.power;
  match.log.push({
    type: 'consume', side: victim.side, name: victim.card.definition.name, eater: consumer.card.definition.name, amount: strength,
  });
  removeUnit(match, victim, 'consume', consumer.card.id);
  boost(match, consumer, strength * multiplier + extra);
  for (const unit of nearby) {
    if (unit.card.definition.onNeighborConsumed) boost(match, unit, 2);
  }
  return strength;
}

export function spawnLarvae(match, side, row, position, count) {
  const line = match.players[side].board[row];
  const added = Math.min(count, ROW_LIMIT - line.length);
  if (added <= 0) return;
  const larvae = Array.from({ length: added }, () =>
    createCard(`token-${++match.tokenCount}`, { ...LARVA, row }));
  line.splice(position, 0, ...larvae);
  match.log.push({ type: 'spawn', side, row, count: added });
}
