import { cardPotential } from './bot-evaluation.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';
import { handCount } from './bot-hand.js';
import { availableRows, cleansableStatuses, HAND_LIMIT, infectionDamage, isUnit, neighbors, opponent, placementSide, restoreCard, ROW_LIMIT, statusCount, units } from '../engine/board.js';
import { availableFees, canGrantZeal, orderAbility } from '../effects/effects.js';
import { ROWS } from '../shared/card-metadata.js';
import { canStart, eligiblePileCards, pileCandidates, playPiles, playTiming, reference, rowArmor, rowSide, targets, valueOf } from '../effects/effect-queries.js';
import { armorBreakSwing, consumeBonus, coinValue, delayedCardValue, futureContext, leaderChargeValue, leaderUses, remainingTurns } from './bot-future-value.js';
import { cardAbilities, deathwishDefinitions, isLocked } from '../engine/events.js';

function woundBoost(card) {
  return (cardAbilities(card).events?.damage?.steps ?? []).reduce((sum, step) =>
    step.action === 'boost' && step.target?.scope === 'source' && !step.when &&
    typeof step.amount === 'number' ? sum + step.amount : sum, 0);
}

export function damagePoints(card, amount, armor = card.armor ?? 0) {
  if (statusCount(card, 'shield')) return 0;
  const loss = Math.min(card.power, Math.max(0, amount - armor));
  const swing = amount >= armor ? armorBreakSwing(card) : undefined;
  return swing === undefined ? loss - (loss > 0 && loss < card.power ? woundBoost(card) : 0) : -swing;
}

export function damageTargetPriority({ side, amount, amounts }) {
  return ({ card, side: targetSide }) => {
    const hit = amounts?.[card.id] ?? amount;
    const points = damagePoints(card, hit);
    if (targetSide === side) return -1 - points;
    const lethal = points > 0 && (lethalDamage(card, hit) || armorBreakSwing(card) < 0 && hit >= card.armor);
    // Keep the existing preference for killing an enemy or interrupting a big unit.
    if (lethal) return 100 + points;
    if (statusCount(card, 'shield') || (hit > (card.armor ?? 0) && woundBoost(card)) || points < 0) return points;
    return Math.min(98, card.power);
  };
}

export function lethalDamage(card, amount) {
  return !statusCount(card, 'shield') && amount >= card.power + (card.armor ?? 0);
}

export function pendingUnitPriority(match, { kind, side, job }) {
  if (kind === 'weather-deathwish') {
    return (unit) => stormDeathwishValue(match, unit, 2);
  }
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
    const swing = armor === 0 ? armorBreakSwing(card) : undefined;
    return sum + (swing === undefined ? damagePoints(card, amount, armor) : -swing);
  }, 0);
}

export function rowScatterValue(player, row, amount) {
  const units = player.board[row].filter(isUnit);
  const perUnit = amount / Math.max(1, units.length);
  return units.reduce((sum, card) => {
    const absorbed = (card.armor ?? 0) + statusCount(card, 'shield');
    const swing = perUnit >= absorbed ? armorBreakSwing(card) : undefined;
    return sum + (swing === undefined ? Math.min(card.power, Math.max(0, perUnit - absorbed)) -
      (perUnit > absorbed && perUnit < absorbed + card.power ? woundBoost(card) * Math.min(1, perUnit - absorbed) : 0) : -swing);
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

export function deckPlayTrigger(player, card, remaining = player.hand, includeDeck = true) {
  const rule = cardAbilities(card).pileEvents?.play;
  return rule?.pile === 'deck' && rule.firstLegendary && !player.playedLegendary &&
    [...remaining, ...(includeDeck ? player.deck : [])].some(({ definition }) => definition.rarity === 'gold');
}

export function handReturnPriority(match, side, card) {
  return deckPlayTrigger(match.players[side], card, match.players[side].hand, match.round < 3) ? card.power + W.defaultPower : -deckCardValue(match, side, card);
}

export function missedDeployValue(match, side, card, placement) {
  const player = match.players[side];
  const alternatives = player.hand.filter((other) => other.id !== card.id);
  if (!alternatives.length) return 0;
  if (deckPlayTrigger(player, card, alternatives, match.round < 3) && alternatives.some((entry) =>
      cardAbilities(entry).deploy?.steps.some(({ action }) => ['return-hand', 'choose-hand-bottom'].includes(action)))) {
    return card.power ?? 0;
  }
  const ability = cardAbilities(card)[playTiming(match, side, card)];
  if (!ability) return 0;
  const relevant = ({ scope, rowRef }) => !rowRef && ['ally', 'enemy', 'field', 'neighbors'].includes(scope);
  const queries = ability.select?.length
    ? ability.select.map((pick) => pick.targets).filter(relevant)
    : ability.steps.map((step) => step.target).filter((target) => target && relevant(target));
  if (!queries.length) return 0;

  const job = { side, ability, sourceId: card.id, sourceDefinitionId: card.definition.id };
  const recipient = placementSide(side, card);
  const owner = match.players[recipient];
  const row = placement?.row;
  const withUnit = (state, key, lane, unit, index) => {
    const placed = state.players[key];
    const line = placed.board[lane].toSpliced(index, 0, unit);
    return { ...state, players: { ...state.players, [key]: { ...placed, board: { ...placed.board, [lane]: line } } } };
  };
  const field = row ? withUnit(match, recipient, row, card, placement.position ?? owner.board[row].length) : match;
  const available = (state) => ability.select?.length
    ? canStart(state, job)
    : queries.some((query) => targets(state, job, query).length > 0);
  if (available(field)) return 0;

  const waitsForEnemy = queries.some(({ scope }) => scope === 'enemy' || scope === 'field');
  const enemy = match.players[opponent(side)];
  const candidates = match.round < 3 ? [...alternatives, ...player.deck] : alternatives;
  const waitsForAlly = queries.some(({ scope }) => scope !== 'enemy') && candidates.some((unit) =>
    !unit.definition.enemySide && isUnit(unit) && availableRows(field.players[side], unit).some((lane) =>
      available(withUnit(field, side, lane, unit, lane === row ? (placement.position ?? owner.board[row].length) + 1 : 0)) ||
      available(withUnit(field, side, lane, unit, lane === row ? placement.position ?? owner.board[row].length : 0))));
  if (!waitsForAlly && !(waitsForEnemy && !enemy.passed && handCount(enemy))) return 0;

  // Immediate points already come from the engine. Price the missed chance to use
  // the deploy later, independently of the unit's body and without banning the play.
  const payoff = ability.steps.some(({ action }) => ['activate-deathwish', 'consume', 'capture'].includes(action))
    ? 4 : W.deploy;
  return payoff;
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

function firestormDamage(candidates, hits, lossesByTurn) {
  // Track each unit's hit count. Use expected survivors as the size of the next target pool.
  const units = candidates.map((card) => {
    const protection = (card.armor ?? 0) + statusCount(card, 'shield');
    const boost = woundBoost(card);
    const lethal = boost > 0 && card.power > 1 ? Infinity : protection + card.power;
    const chance = new Float64Array(Math.min(hits, lethal) + 1);
    chance[0] = 1;
    return { protection, lethal, boost, chance };
  });
  let expected = 0;
  for (let hit = 0; hit < hits; hit += 1) {
    const alive = units.reduce((sum, { chance, lethal }) => sum + 1 - (chance[lethal] ?? 0), 0);
    if (alive <= 0) break;
    for (const { chance, protection, lethal, boost } of units) {
      for (let prior = Math.min(hit, lethal - 1); prior >= 0; prior -= 1) {
        const change = chance[prior] / Math.max(1, alive);
        chance[prior] -= change;
        chance[prior + 1] += change;
        if (prior >= protection) {
          expected += change * (prior + 1 === lethal ? 1 : 1 - boost);
          if (lossesByTurn) lossesByTurn[Math.floor(hit / 3)] += change;
        }
      }
    }
  }
  return expected;
}

export function firestormGrowth(defender, horizon, cap, extension, extra = 0, excludedId) {
  const losses = Array(horizon).fill(0);
  for (const row of ROWS) {
    const previous = defender.rowEffects?.[row];
    const duration = (previous?.type === 'firestorm' ? previous.remaining : 0)
      + (extension === row || extension === 'all' ? extra : 0);
    const hits = 3 * Math.min(duration, horizon);
    if (!hits) continue;
    const victims = defender.board[row].filter((card) => isUnit(card) && card.id !== excludedId);
    firestormDamage(victims, hits, losses);
  }
  return losses.reduce((total, loss) => total + Math.min(cap, loss), 0);
}

function firestormGrowthGain(match, defenderSide, horizon, row, extra, excludedId, prior = 0) {
  const defender = match.players[defenderSide];
  return units(match, opponent(defenderSide)).reduce((gain, { card }) => {
    const cap = card.definition.firestormGrowthCap;
    if (!cap || isLocked(card)) return gain;
    return gain + firestormGrowth(defender, horizon, cap, row, extra + prior, excludedId)
      - firestormGrowth(defender, horizon, cap, row, prior, excludedId);
  }, 0);
}

export function rowEffectValue(player, row, turns = 3, incremental = true,
  horizonTurns = handCount(player) + 1, type = 'rot', excludedId) {
  const candidates = player.board[row].filter((card) => isUnit(card) && card.id !== excludedId);
  if (!candidates.length) return 0;
  const previous = incremental ? player.rowEffects?.[row] : undefined;
  const duration = turns + (previous?.type === type ? previous.remaining : 0);
  const value = (weather, remaining) => weatherValue(candidates, weather, Math.max(0, Math.min(remaining, horizonTurns)));
  return value(type, duration) - (previous ? value(previous.type, previous.remaining) : 0);
}

function weatherValue(candidates, type, horizon) {
  if (type === 'firestorm') return firestormDamage(candidates, 3 * horizon);
  if (type !== 'rot') return 0;
  return horizon * candidates.reduce((sum, card) => sum +
    (statusCount(card, 'infection') ? Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0))) : Math.min(card.power, 2) * .75), 0)
    / candidates.length;
}

export function stormDeathwishValue(match, { card, row, side }, duration, alreadyGranted = false) {
  if (isLocked(card)) return 0;
  const player = match.players[side];
  const weather = player.rowEffects?.[row]?.type;
  const damage = Math.max(0, (card.definition.power ?? card.power) - card.power);
  const durability = card.power + (card.armor ?? 0) + statusCount(card, 'shield');
  const hazard = statusCount(card, 'infection') * .5 + (weather === 'firestorm' ? 2 : weather === 'rot' ? 1 : 0);
  const probability = Math.min(1, (2 + hazard + damage * .5) / (durability + 2));
  const prior = alreadyGranted ? 0 : (card.inheritedDeathwishes ?? []).filter(({ grantedBy, deathwish }) =>
    grantedBy && deathwish.steps.some(({ effect }) => effect === 'firestorm')).length * duration;
  const horizon = remainingTurns(match, side);
  const gain = rowEffectValue(player, row, duration + prior, true, horizon, 'firestorm', card.id);
  const existing = prior ? rowEffectValue(player, row, prior, true, horizon, 'firestorm', card.id) : 0;
  const growth = firestormGrowthGain(match, side, horizon, row, duration, card.id, prior);
  return Math.max(0, gain - existing + growth) * probability;
}

export function usefulWeatherOrder(match, side, { card }) {
  const wish = card.definition.order.steps.find(({ action }) => action === 'grant-deathwish');
  if (!wish) return true;
  const duration = wish.deathwish.steps.find(({ effect }) => effect === 'firestorm')?.amount;
  if (!duration) return true;
  const ability = orderAbility(card.definition.order);
  const [pick] = ability.select;
  return targets(match, { side, sourceId: card.id }, pick.targets, true)
    .some((unit) => stormDeathwishValue(match, unit, duration) > 0);
}

export function immediateWeatherOrder(match, side, orders) {
  if (!match.playedCard) return undefined;
  return orders.find(({ card }) => card.definition.zeal && card.orderPlayedTurn === match.players[side].turns &&
    card.definition.order.steps.some(({ action, effect }) => action === 'row-effect' && effect === 'firestorm'));
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
  const turns = step.effect === 'firestorm' || defender.passed ? remainingTurns(match, side) : undefined;
  if (step.row === 'all') {
    const damage = ROWS.reduce((sum, row) => sum + rowEffectValue(defender, row, step.amount, true, turns, step.effect), 0);
    return damage + (step.effect === 'firestorm' ? firestormGrowthGain(match, side, turns, 'all', step.amount) : 0);
  }
  const rows = step.effect === 'firestorm' && ROWS.includes(step.row) ? [step.row] : ROWS;
  return Math.max(...rows.map((row) => rowWeatherPlayValue(match, side, row, step.amount, turns, step.effect)));
}

export function rowWeatherPlayValue(match, defenderSide, row, amount, horizon, type) {
  const defender = match.players[defenderSide];
  const damage = rowEffectValue(defender, row, amount, true, horizon, type);
  return damage + (type === 'firestorm' ? firestormGrowthGain(match, defenderSide, horizon, row, amount) : 0);
}

export function leaderFirestormStep(ability) {
  return ability?.steps.find(({ action, effect, row }) =>
    action === 'row-effect' && effect === 'firestorm' && row === 'all');
}

export function leaderFirestormValue(match, side, weather) {
  return rowEffectSwing({ match, job: { side } }, weather);
}

function replacementLeaderSwing({ match, job, player }, step) {
  const weather = leaderFirestormStep(step.order.ability);
  if (!weather) return 2;

  const { side } = job;
  const current = futureContext(match, side);
  const replacement = { ...current, player: { ...player, leader: {
    ability: step.order.ability, order: step.order, charges: 0, readyAtTurn: player.turns + 1,
  } } };
  const enemy = match.players[opponent(side)];
  const deployed = job.ability.steps.find(({ action, effect, row }) =>
    action === 'row-effect' && effect === 'firestorm' && row === 'all')?.amount ?? 0;
  const extra = leaderUses(replacement) * weather.amount;
  const liveValue = ROWS.reduce((sum, row) =>
    sum + rowEffectValue(enemy, row, deployed + extra, true, current.opponentTurns, 'firestorm') -
      rowEffectValue(enemy, row, deployed, true, current.opponentTurns, 'firestorm'), 0);
  const nextRoundValue = leaderUses(replacement, true) * leaderChargeValue(replacement, true);
  const currentUses = leaderUses(current);
  const futureUses = leaderUses(current, true);
  const oldLeader = player.leader;
  const savedUses = oldLeader?.order?.usesCharges
    ? Math.min(Math.max(0, oldLeader.charges - currentUses), futureUses) : futureUses;
  const growth = extra ? firestormGrowthGain(match, opponent(side), current.opponentTurns, 'all', extra, undefined, deployed) : 0;
  return liveValue + growth + nextRoundValue -
    currentUses * leaderChargeValue(current) - savedUses * leaderChargeValue(current, true);
}

function boostSwing({ match, job }, { amount }) {
  return amount?.count || amount?.markedThisMatch || amount?.startingCategory ? valueOf(match, job, amount) : 0;
}

function playChoiceSwing({ match, job }, step) {
  const pile = playPiles[step.action];
  const candidates = eligiblePileCards(match, job.side, pile, step);
  const value = pile === 'hand' ? handPlayValue : deckCardValue;
  return Math.max(0, ...candidates.map((candidate) => value(match, job.side, candidate)));
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
    return -damagePoints(card, valueOf(match, job, step.amount));
  }
  if (step.target.rowRef) {
    const strip = ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.target.rowRef);
    const defender = match.players[opponent(side)];
    return Math.max(...ROWS.map((row) => rowDamage(defender, row, step.amount, -(strip?.amount ?? 0))));
  }
  const selection = ability.select?.find(({ ref }) => ref === step.target.ref);
  const options = selection ? targets(match, job, selection.targets, selection.mode !== 'random') : targets(match, job, step.target);
  const stripArmor = step.amount?.result === 'armor' && step.amount.base !== undefined;
  const amounts = options.map((target) => valueOf(match, job, step.amount, target) + (stripArmor ? target.card.armor : 0));
  const highest = Math.max(0, ...amounts);
  const points = options.map(({ card, side: targetSide }, index) => {
    if (statusCount(card, 'shield') || (step.amount?.row && amounts[index] !== highest)) return 0;
    const armor = stripArmor ? 0 : card.armor ?? 0;
    return (targetSide === side ? -1 : 1) * damagePoints(card, amounts[index], armor);
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
  'replace-leader': replacementLeaderSwing,
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

export function immediateWeatherValue(match, side, card, row) {
  const { order } = cardAbilities(card);
  if (!card.definition.zeal || order?.sourceRow !== row) return 0;
  const weather = order?.steps.find(({ action, effect }) => action === 'row-effect' && effect === 'firestorm');
  return weather ? rowEffectSwing({ match, job: { side } }, weather) : 0;
}

export function deckCardValue(match, side, card) {
  const { definition } = card;
  const { deploy, order, endTurn, scenario } = cardAbilities(card);
  const value = (card.power ?? 0) * (definition.enemySide ? -1 : 1) + (card.armor ?? 0) * .15;
  const swing = deploy?.steps.some((step) => step.fullDeck || step.action === 'play-from-discard') ? 0 : effectSwing(match, side, card);
  return value + swing + delayedCardValue(futureContext(match, side), card, undefined, true) + Number(Boolean(deploy || order || endTurn || scenario));
}

export function handPlayValue(match, side, card) {
  // A nested tutor cannot offer itself or a card already played by its parent.
  const player = match.players[side];
  const hand = player.hand.filter(({ id }) => id !== card.id);
  return deckCardValue({ ...match, players: { ...match.players, [side]: { ...player, hand } } }, side, card);
}
