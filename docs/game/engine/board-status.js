import { isUnit, neighbors, opponent } from './board-placement.js';
import { onPowerLoss, refreshRowPower, refreshSidePower, removeUnit } from './board-power.js';
import { emit, isLocked } from './events.js';

export function setRowEffect(match, side, row, effect) {
  const current = match.players[side].rowEffects?.[row];
  updateRowEffect(match, side, row, effect && current?.type === effect.type
    ? { ...effect, remaining: current.remaining + effect.remaining } : effect);
}

export function tickRowEffectDuration(match, side, row, effect) {
  updateRowEffect(match, side, row, effect.remaining > 1 ? { ...effect, remaining: effect.remaining - 1 } : null);
}

function updateRowEffect(match, side, row, effect) {
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
    if (card.definition.sidePower || card.definition.sidePowerAura) refreshSidePower(match, side);
    if (card.definition.rowPower) refreshRowPower(match, side, row);
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
    const breakJobs = emit(match, { type: 'armor-break', side, cardId: card.id, sourceDefinitionId: extra?.sourceDefinitionId }, { ...context, journal: false });
    for (const job of breakJobs) {
      if (job.ability.survivesSource) Object.assign(job, { requiredSource: false, row: unit.row, position: unit.position });
    }
    effects.push(...breakJobs);
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
