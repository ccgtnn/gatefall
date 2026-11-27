// @ts-check

/** @typedef {import('../../../types/contracts').EffectJob} EffectJob */
/** @typedef {import('../../../types/contracts').MatchState} MatchState */

import { cardAbilities, emit, isLocked } from '../engine/events.js';
import { activeOrder, applyStatus, changeBasePower, damage, findUnit, isUnit, opponent, ROW_LIMIT,
  setRowEffect, statusCount, statusEndTurn, units } from '../engine/board.js';
import { ROWS, ROW_LABELS } from '../shared/card-metadata.js';
import { effectOperations, tickTimer } from './effect-operations.js';
import { canStart, PAUSED, REPEAT, reference, SCHEDULED, stepAllowed, targets, valueOf, viableChoices } from './effect-queries.js';

export { canCast, playTiming, rowArmor } from './effect-queries.js';

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
  const ready = leader.order
    ? leaderCooldown(player) === 0 && (!leader.order.usesCharges || leader.charges > 0)
    : (!match.playedCard || player.hand.length === 0) && leader.charges > 0;
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

export function canGrantZeal(unit, turns) {
  const { card } = unit;
  return activeOrder(unit) && card.orderPlayedTurn === turns && card.readyAt > turns && card.orderUsedTurn !== turns;
}

export function availableOrders(match, side) {
  const player = match.players[side];
  return units(match, side).filter((unit) => {
    const order = activeOrder(unit);
    return order && unit.card.readyAt <= player.turns && unit.card.orderUsedTurn !== player.turns &&
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

export function enqueueEndTurn(match, side) {
  const field = units(match, side);
  for (const { card } of field) match.effects.push(...emit(match, { type: 'turn-end', side },
    { source: card, journal: false }));
  for (const { card } of field) {
    const steps = statusEndTurn(card);
    if (!isLocked(card) && card.timer > 0) match.effects.push({ side, sourceId: card.id, timerTick: true });
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

export function enqueueStartTurn(match, side) {
  const player = match.players[side];
  const field = units(match, side);
  for (const unit of field) changeBasePower(match, unit, cardAbilities(unit.card).startTurnGrowth);
  for (const pile of ['deck', 'hand', 'discard']) {
    for (const card of player[pile]) changeBasePower(match, { card, side, pile }, cardAbilities(card).startTurnGrowth);
  }
  for (const row of ROWS) {
    if (match.players[side].rowEffects?.[row]) match.effects.push({ side, row, rowTick: true });
  }
  for (const { card } of field) {
    if (card.timer === 0 && !card.timerStartResolved && cardAbilities(card).timerNextTurn) {
      card.timerStartResolved = true;
      enqueueCardEffect(match, side, card, 'timerNextTurn');
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

/**
 * @param {MatchState} match
 * @param {EffectJob} job
 * @param {() => number} random
 */
export function runEffect(match, job, random) {
  if (job.rowTick) return tickRow(match, job, random);
  if (job.scenarioChapter) return playChapter(match, job);
  if (job.timerTick) {
    const source = reference(match, job);
    if (!source || source.side !== job.side || isLocked(source.card) || !(source.card.timer > 0)) return;
    const expired = tickTimer(match, source);
    enqueueCardEffect(match, source.side, source.card, 'timerPulse');
    if (expired) enqueueCardEffect(match, source.side, source.card, 'timerExpired');
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
  const operation = Object.hasOwn(effectOperations, step.action) && effectOperations[step.action];
  if (!operation) {
    throw new Error(`Unknown effect action "${step.action}" at step ${job.index + 1}` +
      (job.sourceDefinitionId ? ` of "${job.sourceDefinitionId}"` : ''));
  }
  if (!stepAllowed(match, job, step)) {
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  // The match drains the queue one step at a time so reactions can run before the continuation.
  const queuedBefore = match.effects.length;
  const outcome = operation(match, job, step, random);
  if (outcome === PAUSED || outcome === SCHEDULED) return;
  if (outcome !== REPEAT) job.index += 1;
  match.effects.splice(match.effects.length - queuedBefore, 0, job);
}
