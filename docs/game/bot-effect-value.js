import { cardPotential, EVAL_WEIGHTS as W } from './bot-evaluation.js';
import { handCount } from './bot-hand.js';
import { availableRows, cleansableStatuses, HAND_LIMIT, infectionDamage, isUnit, neighbors, opponent, restoreCard, ROW_LIMIT, statusCount, units } from './board.js';
import { availableFees, canGrantZeal, orderAbility } from './effects.js';
import { ROWS } from './card-metadata.js';
import { canStart, eligiblePileCards, pileCandidates, playPiles, playTiming, reference, rowArmor, rowSide, targets, valueOf } from './effect-queries.js';
import { armorBreakSwing, consumeBonus, coinValue, delayedCardValue, futureContext, remainingTurns } from './bot-future-value.js';
import { cardAbilities, deathwishDefinitions, isLocked } from './events.js';

export function pendingUnitPriority(match, { kind, side, job }) {
  if (kind === 'destroy') {
    const context = futureContext(match, side);
    return (unit) => unit.side === side ? consumeBonus(context, unit) - unit.card.power
      : unit.card.power - deathwishDefinitions(unit.card).length;
  }
  if (kind === 'transform') {
    const steps = job?.ability?.steps ?? [];
    const transform = steps.find(({ action }) => action === 'transform');
    return ({ card, side: targetSide }) => {
      const finalPower = transform?.preservePower ? card.power : transform?.card.power ?? card.power;
      const gain = finalPower - card.power;
      // Prefer friendly targets, then actual strength gained and the weaker original unit.
      return (targetSide === side ? 1 : -1) * gain - card.power * (transform?.preservePower ? .4 : .01);
    };
  }
}

export function feePayoff(context, unit, free, later = false) {
  const { match, side, player } = context;
  const { card } = unit;
  const { fee, order } = cardAbilities(card);
  if (fee.needsSourceSpace && free <= 0) return 0;
  const job = { side, sourceId: card.id, ability: fee };
  return fee.steps.reduce((value, step) => {
    if (step.action === 'spawn') return value + Math.min(step.amount, free) * step.card.power;
    if (step.action === 'transform') {
      const select = fee.select?.find(({ ref }) => ref === step.target.ref);
      return value + (select ? Math.max(0, ...targets(match, job, select.targets, true)
        .map(({ card }) => step.card.power - card.power + .2 * ((step.card.armor ?? 0) - (card.armor ?? 0)))) : 0);
    }
    const refreshes = step.action === 'ready-order' && (later || card.orderUsedTurn !== player.turns);
    const grantsZeal = step.action === 'grant-zeal' && !later && canGrantZeal(unit, player.turns);
    if (!refreshes && !grantsZeal) return value;
    const ability = orderAbility(order);
    const orderJob = { ...job, ability };
    if (!canStart(match, orderJob)) return value;
    const sacrifice = ability.select?.find(({ kind }) => kind === 'destroy');
    const cost = sacrifice ? Math.min(...targets(match, orderJob, sacrifice.targets, true)
      .map((unit) => unit.card.power - consumeBonus(context, unit))) : 0;
    const damage = ability.steps.find(({ action, target }) => action === 'damage' && target.rowRef);
    const enemy = match.players[opponent(side)];
    const payoff = damage ? Math.max(...ROWS.map((row) => rowDamage(enemy, row, damage.amount))) : 0;
    const draw = ability.steps.some(({ action }) => action === 'draw');
    const weakest = player.hand.length ? Math.min(...player.hand.map(cardPotential)) : 0;
    const swapValue = draw && player.deck.length && handCount(player) < HAND_LIMIT
      ? Math.max(0, player.deck.reduce((sum, card) => sum + cardPotential(card), 0) / player.deck.length
        - weakest)
      : 0;
    return value + payoff + swapValue - cost;
  }, 0);
}

function bestFee(match, side, { coins = match.players[side].coins, tributeRow, spawned = 0, allCoinsSurplus = false } = {}) {
  const fees = availableFees(match, side);
  if (!fees.length) return;
  const player = match.players[side];
  const context = futureContext(match, side);
  let best;
  for (const unit of fees) {
    const { card, row } = unit;
    const { fee } = cardAbilities(card);
    const free = ROW_LIMIT - player.board[row].length - (row === tributeRow ? spawned : 0);
    if (fee.coins > coins) continue;
    const gain = feePayoff(context, unit, free);
    if (gain <= 0) continue;
    const value = gain + (allCoinsSurplus ? -fee.coins * W.surplusCoin
      : coinValue(context, coins - fee.coins) - coinValue(context, coins));
    if (value >= -1e-9 && (!best || value > best.value)) {
      best = { cardId: card.id, value: Math.max(0, value) };
    }
  }
  return best;
}

export function beneficialFee(match, side, options) {
  const best = bestFee(match, side, options);
  if (best) return { type: 'fee', cardId: best.cardId };
}

export function shouldProtectArmor(card, player) {
  return card?.definition.aiHints?.armorBreakCostsPower &&
    player.hand.some(({ definition }) => definition.aiHints?.spendsRowArmor);
}

export function rowDamage(player, row, amount, armorStrip = 0) {
  return player.board[row].filter(isUnit).reduce((sum, card) => {
    const armor = Math.max(0, (card.armor ?? 0) - armorStrip);
    const shielded = statusCount(card, 'shield') > 0;
    const swing = armor <= (shielded ? 0 : amount) ? armorBreakSwing(card) : undefined;
    return sum + (swing === undefined ? (shielded ? 0 : Math.min(card.power, Math.max(0, amount - armor))) : -swing);
  }, 0);
}

export function rowScatterValue(player, row, amount) {
  const units = player.board[row].filter(isUnit);
  const perUnit = amount / Math.max(1, units.length);
  return units.reduce((sum, card) => {
    const absorbed = (card.armor ?? 0) + statusCount(card, 'shield');
    const swing = perUnit >= absorbed ? armorBreakSwing(card) : undefined;
    return sum + (swing === undefined ? Math.min(card.power, Math.max(0, perUnit - absorbed)) : -swing);
  }, 0);
}

export function armorTargetPriority(match, side, unit) {
  const { card } = unit;
  const armor = card.armor ?? 0;
  const player = match.players[side];
  const abilities = cardAbilities(card);
  const enablesCost = abilities.order?.cost?.select?.some(({ targets }) => targets.armorAtLeast > armor && targets.armorAtLeast <= armor + 2);
  const formations = player.hand.some(({ definition }) => definition.aiHints?.placement === 'armored-neighbors');
  return Number(Boolean(enablesCost)) * 3 + Number(Boolean(card.definition.aiHints?.armorBreakCostsPower)) * 3 +
    Number(formations && armor === 0) * (neighbors(match, unit).length + 1) + card.power * .1 - armor * .1;
}

export function infectionGain(card, amount, turns = Infinity) {
  const current = statusCount(card, 'infection');
  return Math.max(0, infectionDamage(card, Math.min(current + amount, turns)) -
    infectionDamage(card, Math.min(current, turns)));
}

export function lockPriority(match, actor, { card, row, side }) {
  if (isLocked(card)) return -1;
  const { order, fee, sidePowerAura, rowPower, fieldEvents, neighborEvents, endTurn, startTurnGrowth, events } = cardAbilities(card);
  const context = futureContext(match, side);
  const engine = Number(Boolean(order && card.orderCharges !== 0 || fee ||
    sidePowerAura || rowPower || fieldEvents || neighborEvents || endTurn || startTurnGrowth));
  const reactions = Object.values(events ?? {}).reduce((value, { steps }) =>
    value + steps.reduce((sum, step) => sum + (typeof step.amount === 'number' ? Math.max(0, step.amount) : 1), 0), 0);
  // A recurring hit can set up a neighbor's damage reaction even without a target right now.
  const recurringHits = (endTurn?.steps ?? []).reduce((value, step) =>
    value + (step.action === 'damage' && typeof step.amount === 'number' ? step.amount : 0), 0);
  const delay = Number(Boolean(card.counter > 0 || card.timer > 0 || card.resilient));
  const value = engine * 3 + reactions + recurringHits + delay + deathwishDefinitions(card).length +
    Math.max(0, delayedCardValue(context, card, row));
  return side === actor ? -value : value;
}

export function holdUntargetedDamage(match, side, cards) {
  if (units(match, opponent(side)).some(({ card }) => isUnit(card))) return cards;
  const productive = cards.filter((card) => {
    const { deploy, endTurn, order, scenario, timerPulse, timerExpired } = cardAbilities(card);
    if (card.power || endTurn || order || scenario || timerPulse || timerExpired || !deploy?.steps.length) return true;
    return !deploy.steps.every((step) => step.action === 'select-row' ||
      (step.action === 'scatter' && step.side !== 'ally') ||
      (step.action === 'damage' && step.target?.scope === 'enemy'));
  });
  return productive.length ? productive : cards;
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

export function rowEffectValue(player, row, turns = 3, incremental = true, horizonTurns = handCount(player) + 1) {
  const candidates = player.board[row].filter(isUnit);
  if (!candidates.length) return 0;
  const previous = incremental ? player.rowEffects?.[row]?.remaining ?? 0 : 0;
  const horizon = Math.max(0, Math.min(turns, horizonTurns) - previous);
  return horizon * candidates.reduce((sum, card) => sum +
    (statusCount(card, 'infection') ? Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0))) : Math.min(card.power, 2) * .75), 0)
    / candidates.length;
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

function rowEffectSwing({ match, job }, step) {
  const side = rowSide(job.side, step);
  const defender = match.players[side];
  const turns = defender.passed ? remainingTurns(match, side) : undefined;
  const values = ROWS.map((row) => rowEffectValue(defender, row, step.amount, true, turns));
  return step.row === 'all' ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
}

function boostSwing({ match, job }, { amount }) {
  return amount?.count || amount?.markedThisMatch || amount?.startingCategory ? valueOf(match, job, amount) : 0;
}

function playChoiceSwing({ match, job }, step) {
  const candidates = eligiblePileCards(match, job.side, playPiles[step.action], step);
  return Math.max(0, ...candidates.map((candidate) => deckCardValue(match, job.side, candidate)));
}

function deckPlaySwing(context, step) {
  if (step.fullDeck || step.chooseAll) return playChoiceSwing(context, step);
  const cards = pileCandidates(context.player.deck, step.filter);
  return cards.reduce((sum, card) => sum + (card.definition.power ?? 0), 0) / Math.max(1, cards.length)
    + Number(Boolean(step.after));
}

function discardPlaySwing(context, step) {
  const { match, job } = context;
  const candidates = eligiblePileCards(match, job.side, 'discard', step);
  return Math.max(0, ...candidates.map((card) => deckCardValue(match, job.side, restoreCard(card))));
}

function summonSwing({ player }, step) {
  if (!availableRows(player).some((row) => player.board[row].length < ROW_LIMIT - 1)) return 0;
  const cards = pileCandidates(player.deck, step.filter);
  return cards.reduce((sum, card) => sum + card.power, 0) / Math.max(1, cards.length);
}

function spawnSwing({ player, card }, step) {
  if (step.overflow) {
    const free = ROWS.reduce((sum, row) => sum + ROW_LIMIT - player.board[row].length, 0)
      - Number(card.definition.type !== 'effect');
    return Math.min(step.amount, Math.max(0, free)) * (step.card.power ?? 0);
  }
  if (step.rowRef) {
    const free = ROW_LIMIT - Math.min(...ROWS.map((row) => player.board[row].length));
    return Math.min(step.amount, free) * (step.card.power ?? 0);
  }
  return 0;
}

export function tributeOptions(match) {
  const { side, options, job, tiers } = match.pending;
  const origin = job && reference(match, job);
  const spawn = job?.ability.steps[job.index]?.spawn;
  if (!origin || !spawn) return options.map((cardId) => ({ cardId, score: 0 }));
  const context = futureContext(match, side);
  const { player } = context;
  const free = ROW_LIMIT - player.board[origin.row].length;
  const score = (option) => {
    const spawned = Math.min(free, tiers[option] ?? 0);
    const remaining = player.coins - Number(option);
    const fee = bestFee(match, side, { coins: remaining, tributeRow: origin.row, spawned });
    return spawned * (spawn.card.power ?? 0) + coinValue(context, remaining) + (fee?.value ?? 0);
  };
  return options.map((cardId) => ({ cardId, score: score(cardId) })).sort((a, b) => b.score - a.score);
}

export function tributeTarget(match) {
  return { type: 'target', cardId: tributeOptions(match)[0].cardId };
}

function scatterSwing({ match, job, player }, step) {
  const side = opponent(job.side);
  if (step.rowRef) {
    const amount = step.amount?.result === 'armor'
      ? Math.max(...ROWS.map((row) => rowArmor(player, row))) : valueOf(match, job, step.amount);
    return Math.max(...ROWS.map((row) => rowScatterValue(match.players[side], row, amount)));
  }
  const recipient = step.side === 'ally' ? player : match.players[side];
  const amount = step.amount?.result === 'armor'
    ? Math.max(...ROWS.map((row) => rowArmor(player, row))) : valueOf(match, job, step.amount);
  const health = ROWS.reduce((sum, row) => sum + rowScatterValue(recipient, row, amount), 0);
  return Math.min(health, amount) * (step.side === 'ally' ? -1 : 1);
}

function markSwing({ match, job }, step) {
  const candidates = units(match, opponent(job.side)).filter(({ card }) => isUnit(card) && !statusCount(card, 'target'));
  return step.target.rowRef ? Math.max(...ROWS.map((row) => candidates.filter((unit) => unit.row === row).length)) * 1.3
    : Number(candidates.length > 0) * 1.3;
}

function infectionSwing({ match, job, applyInfection }, step) {
  if (step.status !== 'infection' || !applyInfection) return 0;
  const selection = job.ability.select?.find(({ ref }) => ref === step.target.ref);
  const candidates = targets(match, job, selection?.targets ?? step.target, Boolean(selection && selection.mode !== 'random'));
  const gains = candidates.map((target) => {
    const defender = match.players[target.side];
    const ticks = defender.passed ? remainingTurns(match, target.side) : Math.max(1, handCount(defender));
    return (target.side === job.side ? -1 : 1) *
      infectionGain(target.card, valueOf(match, job, step.amount, target), ticks);
  });
  return (selection ? Math.max(0, ...gains) : gains.reduce((sum, gain) => sum + gain, 0)) * .75;
}

function damageSwing({ match, job, card }, step) {
  const { ability, side } = job;
  if (step.target.scope === 'source') {
    return statusCount(card, 'shield') ? 0 : -Math.min(card.power ?? 0,
      Math.max(0, valueOf(match, job, step.amount) - (card.armor ?? 0)));
  }
  if (step.target.rowRef) {
    const strip = ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.target.rowRef);
    const defender = match.players[opponent(side)];
    return Math.max(0, ...ROWS.map((row) => rowDamage(defender, row, step.amount, -(strip?.amount ?? 0))));
  }
  const selection = ability.select?.find(({ ref }) => ref === step.target.ref);
  const options = selection ? targets(match, job, selection.targets, selection.mode !== 'random') : targets(match, job, step.target);
  const stripArmor = step.amount?.result === 'armor' && step.amount.base !== undefined;
  const amounts = options.map((target) => valueOf(match, job, step.amount, target) + (stripArmor ? target.card.armor : 0));
  const highest = Math.max(0, ...amounts);
  const points = options.map(({ card, side: targetSide }, index) => {
    if (statusCount(card, 'shield') || (step.amount?.row && amounts[index] !== highest)) return 0;
    const armor = stripArmor ? 0 : card.armor ?? 0;
    const swing = amounts[index] >= armor ? armorBreakSwing(card) : undefined;
    const lost = swing === undefined ? Math.min(card.power, Math.max(0, amounts[index] - armor)) : -swing;
    return (targetSide === side ? -1 : 1) * lost;
  });
  return !selection && !step.mode && ['ally', 'enemy', 'field'].includes(step.target.scope) ? points.reduce((sum, value) => sum + value, 0)
    : points.length ? Math.max(...points) : 0;
}

const stepValues = {
  'row-effect': rowEffectSwing,
  boost: boostSwing,
  consume: (_context, step) => step.extra ?? 0,
  'play-from-hand': playChoiceSwing,
  'play-from-deck': deckPlaySwing,
  'play-from-discard': discardPlaySwing,
  'summon-from-deck': summonSwing,
  spawn: spawnSwing,
  'replace-leader': () => 2,
  scatter: scatterSwing,
  status: infectionSwing,
  damage: damageSwing,
};

// Estimate immediate score swing from public targets for the bot's existing pass calculation.
export function effectSwing(match, side, card) {
  const { deploy, scenario } = cardAbilities(card);
  const ability = deploy ?? scenario?.prologue;
  let swing = destructionSwing(match, side, card) ?? 0;
  if (!ability) return swing;

  const job = { ability, side };
  const applyInfection = ability.steps.some((step) => step.status === 'infection') && canStart(match, job);
  const context = { match, job, card, player: match.players[side], applyInfection };
  for (const step of ability.steps) {
    if (step.status === 'target') {
      swing += markSwing(context, step);
    } else if (Object.hasOwn(stepValues, step.action)) {
      swing += stepValues[step.action](context, step);
    }
  }
  return swing;
}

export function deckCardValue(match, side, card) {
  const { definition } = card;
  const { deploy, order, endTurn, scenario } = cardAbilities(card);
  const value = (card.power ?? 0) * (definition.enemySide ? -1 : 1) + (card.armor ?? 0) * .15;
  const swing = deploy?.steps.some((step) => step.fullDeck || step.action === 'play-from-discard') ? 0 : effectSwing(match, side, card);
  return value + swing + delayedCardValue(futureContext(match, side), card, undefined, true) + Number(Boolean(deploy || order || endTurn || scenario));
}
