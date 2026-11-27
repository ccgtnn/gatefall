import { basePower, discardCard, findUnit, isUnit, neighbors, spawnCards, units } from './board-placement.js';
import { applyStatus, statusCount } from './board-status.js';
import { cardAbilities, emit, isLocked } from './events.js';

export function onPowerLoss(match, unit) {
  match.effects.unshift(...emit(match, { type: 'power-loss', side: unit.side }, { source: unit.card, journal: false }));
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
  delete card.lockedAuraPower;
  match.log.push({ type: 'heal', side, cardId: card.id, power: card.power });
}

export function removeUnit(match, unit, reason, consumerId, extra, deathPosition = unit.position) {
  const { side, row, card, position } = unit;
  const player = match.players[side];
  player.board[row].splice(position, 1);
  const owner = card.owner ?? side;
  const exile = reason === 'banish' || statusCount(card, 'doomed') > 0;
  discardCard(match, side, card, exile);
  const death = ['discard', 'banish'].includes(reason) ? undefined : { row, position: deathPosition, refs: { consumer: consumerId } };
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

function updateAuraPower(match, side, card, key, bonus, preservePower) {
  const delta = bonus - (card[key] ?? 0);
  const frozen = card.lockedAuraPower?.[key] ?? 0;
  const thaw = isLocked(card) ? 0 : frozen;
  if (!delta && !thaw) return false;
  if (bonus) card[key] = bonus;
  else delete card[key];

  // Lock preserves current strength. Keep the removed bonus separately until Cleanse.
  if (preservePower) {
    card.lockedAuraPower ??= {};
    card.lockedAuraPower[key] = frozen - delta;
  } else {
    card.power = Math.max(0, card.power + delta - thaw);
    if (thaw) {
      delete card.lockedAuraPower[key];
      if (!Object.keys(card.lockedAuraPower).length) delete card.lockedAuraPower;
    }
  }
  match.log.push({ type: 'aura-power', side, cardId: card.id, power: card.power, [key]: bonus });
  return true;
}

export function refreshRowPower(match, side, row, preservePowerId) {
  const line = match.players[side].board[row];
  const fallen = [];
  for (const card of line) {
    const rule = card.definition.rowPower;
    if (!rule) continue;
    const { key, amount } = rule;
    const bonus = !isLocked(card) && line.some((candidate) => suppliesRowPower(candidate, rule)) ? amount : 0;
    if (updateAuraPower(match, side, card, key, bonus, card.id === preservePowerId) && card.power === 0) fallen.push(card.id);
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
    if (updateAuraPower(match, side, card, key, bonus, card.id === preservePowerId) && card.power === 0) fallen.push(card.id);
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
    if (lost > 0) {
      onPowerLoss(match, unit);
      match.effects.unshift(...emit(match, { type: 'damage', side: unit.side, lost, sourceDefinitionId },
        { source: unit.card, journal: false }));
    }
    return 0;
  }
  removeUnit(match, unit, 'damage', undefined, { sourceDefinitionId, ...extra });
  return 1;
}

export function consume(match, victim, consumer, { multiplier = 1, extra = 0, grouped, replacement } = {}) {
  if (!victim || !isUnit(victim.card)) return 0;
  if (!replacement && (!consumer || !isUnit(consumer.card) ||
      victim.side !== consumer.side || victim.card.id === consumer.card.id)) return 0;
  const nearby = neighbors(match, victim);
  const strength = victim.card.power;
  const reactions = emit(match, {
    type: 'consume', side: victim.side, name: victim.card.definition.name, cardId: victim.card.id, eaterId: consumer?.card.id, eater: consumer?.card.definition.name ?? match.players[victim.side].leader?.name, amount: strength, ...(grouped && { grouped }),
  }, { neighbors: nearby });
  removeUnit(match, victim, 'consume', consumer?.card.id, undefined, victim.position + Number(Boolean(replacement)));
  if (replacement) spawnCards(match, victim.side, victim.row, victim.position, 1, replacement, strength);
  else {
    const survivingConsumer = findUnit(match, consumer.card.id);
    if (survivingConsumer) boost(match, survivingConsumer, strength * multiplier + extra);
  }
  match.effects.unshift(...reactions);
  return strength;
}
