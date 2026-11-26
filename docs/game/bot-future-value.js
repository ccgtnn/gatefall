import { activeOrder, availableRows, cardType, COIN_LIMIT, infectionDamage, isUnit, opponent, placementSide, ROW_LIMIT, statusCount, units } from './board.js';
import { ROWS } from './card-metadata.js';
import { EVAL_WEIGHTS as W } from './bot-evaluation.js';
import { leaderCooldown } from './effects.js';
import { canStart, matchesPileFilter, targets, valueOf } from './effect-queries.js';
import { cardAbilities, deathwishDefinitions, inheritableDeathwishes, isLocked } from './events.js';

export function remainingTurns(match, side) {
  const player = match.players[side];
  if (match.phase !== 'playing' || player.passed) return 0;
  const handSize = Math.max(player.hand.length, (player.publicHandSize ?? 0) - Number(!player.hand.length));
  // Cap forecasts even with a full hand: either side may pass early.
  return Math.min(4, handSize + Number(match.turn === side && (match.playedCard || player.usedAbility)));
}

function consumes(ability) {
  return ability?.steps.some(({ action }) => action === 'consume');
}


function liveTurns(match, side) {
  const player = match.players[side];
  if (match.phase !== 'playing' || player.passed) return 0;
  const hidden = player.publicHandSize === undefined ? undefined : player.publicHandSize - Number(!player.hand.length);
  const hand = hidden ?? player.hand.filter((card) => availableRows(match.players[placementSide(side, card)], card).length ||
    cardType(card) === 'effect').length;
  return Math.max(match.turn === side ? 1 : 0, hand +
    Number(match.turn === side && match.playedCard));
}

function feeUses(context, fee, card, row, turns) {
  const { match, side, own, player } = context;
  if (fee.needsSourceSpace && freeSlots(context, row) <= 0) return 0;
  const step = fee.steps.find(({ action }) => ['spawn', 'transform', 'ready-order'].includes(action));
  if (!step) return 0;
  if (step.action === 'spawn') {
    if (!(step.card.power > 0)) return 0;
    return Math.ceil(freeSlots(context, row) / step.amount);
  }
  if (step.action === 'transform') {
    const pick = fee.select?.find(({ ref }) => ref === step.target.ref);
    return pick ? targets(match, { side, sourceId: card.id, ability: fee }, pick.targets, true)
      .filter(({ card: target }) => step.card.power > target.power).length : 0;
  }
  const order = cardAbilities(card).order;
  if (!order || !units(match, opponent(side)).some(({ card }) => isUnit(card))) return 0;
  const offering = order.select?.find(({ kind }) => kind === 'destroy');
  const offerings = offering ? own.filter(({ card: ally }) => ally.id !== card.id &&
    (!offering.targets.category || ally.definition.categories?.includes(offering.targets.category))).length : turns;
  const unavailableNow = card.readyAt <= player.turns || card.orderUsedTurn === player.turns;
  return Math.min(offerings, Math.max(0, turns - Number(unavailableNow)));
}

function coinSteps(context, ability, row) {
  return (ability?.steps ?? []).reduce((total, step) => {
    if (step.action === 'coins' && typeof step.amount === 'number' && step.amount < 0) return total - step.amount;
    if (step.action !== 'choose-tribute' || !(step.spawn?.card?.power > 0)) return total;
    const slots = Math.max(0, freeSlots(context, row) - Number(Boolean(row)));
    const usable = Object.entries(step.tiers).sort(([a], [b]) => Number(a) - Number(b));
    let output = 0;
    let cost = 0;
    for (const [price, count] of usable) {
      const produced = Math.min(slots, count);
      if (produced > output) { output = produced; cost = Number(price); }
    }
    return total + cost;
  }, 0);
}

function coinCapacity(context, future = false) {
  const { player, own, match, side, resourceTurns } = context;
  const turns = future ? 3 + player.hand.length : resourceTurns;
  if (!turns) return 0;
  const field = future ? own.filter(({ card }) => card.resilient) : own;
  let capacity = 0;
  for (const { card, row } of field) {
    const { fee } = cardAbilities(card);
    if (fee && (!card.definition.requiredRow || card.definition.requiredRow === row)) {
      capacity += fee.coins * feeUses(context, fee, card, row, turns);
    }
    if (capacity >= COIN_LIMIT) return COIN_LIMIT;
  }
  const canPlay = Math.max(0, turns - Number(!future && match.turn === side && match.playedCard));
  const handCosts = player.hand.map((card) => {
    const rows = availableRows(match.players[placementSide(side, card)], card);
    if (!future && cardType(card) !== 'effect' && !rows.length) return 0;
    const { deploy, fee } = cardAbilities(card);
    return Math.max(0, ...((rows.length ? rows : ROWS).map((row) => coinSteps(context, deploy, row) +
      (fee ? fee.coins * feeUses(context, fee, card, row, turns) : 0))));
  }).sort((a, b) => b - a);
  capacity += handCosts.slice(0, canPlay).reduce((sum, cost) => sum + cost, 0);
  const leader = player.leader;
  if (leaderUses(context, future) && canStart(match, { side, ability: leader.ability })) {
    capacity += leaderUses(context, future) * coinSteps(context, leader.ability);
  }
  return Math.min(COIN_LIMIT, capacity);
}

export function coinValue(context, coins = context.player.coins ?? 0, capacity) {
  if (coins <= 0) return 0;
  const spendable = Math.min(coins, capacity ?? (context.coinCapacity ??= coinCapacity(context)));
  return spendable * W.usefulCoin + (coins - spendable) * W.surplusCoin;
}

export function leaderUses(context, future = false) {
  const { match, player, side } = context;
  const leader = player.leader;
  if (!leader?.ability || (leader.order && !leader.order.usesCharges)) return 0;
  const turns = future ? player.hand.length + 3 * (3 - match.round) : context.resourceTurns;
  if (!turns || (!future && turns === 1 && !canStart(match, { side, ability: leader.ability }))) return 0;
  const cooldown = leader.order ? leaderCooldown(player)
    : Number(match.turn === side && match.playedCard && player.hand.length > 0);
  const opportunities = Math.max(0, turns - (future ? 0 : cooldown));
  const recharge = leader.order && !context.own.some(({ card }) =>
    !isLocked(card) && card.definition.id === leader.order.quickenedBy) ? leader.order.cooldown + 1 : 1;
  return Math.min(leader.charges, Math.ceil(opportunities / recharge));
}

function directHit(ability) {
  return (ability?.steps ?? []).reduce((max, step) => {
    if (step.action !== 'damage' || ['source', 'ally', 'neighbors'].includes(step.target?.scope)) return max;
    const amount = typeof step.amount === 'number' ? step.amount : 0;
    return Math.max(max, amount);
  }, 0);
}

function incomingHit(context) {
  const { match, side } = context;
  const other = opponent(side);
  const enemy = match.players[other];
  if (enemy.passed || match.phase !== 'playing') return 0;
  const turns = liveTurns(match, other);
  if (!turns) return 0;
  const options = units(match, other).map((unit) => {
    const { card } = unit;
    const ability = cardAbilities(card);
    return Math.max(card.readyAt < enemy.turns + turns ? directHit(activeOrder(unit)) : 0,
      directHit(ability.startTurn), directHit(ability.endTurn), directHit(ability.timer));
  });
  if (enemy.leader?.charges > 0 || (enemy.leader?.order && !enemy.leader.order.usesCharges)) {
    options.push(directHit(enemy.leader.ability));
  }
  options.push(...enemy.hand.map((card) => directHit(cardAbilities(card).deploy)));
  if (enemy.knownDeck && (enemy.publicHandSize > 0 || match.round < 3)) {
    options.push(...enemy.knownDeck.map((card) => Math.max(directHit(card.deploy), directHit(card.order)) * W.knownHitChance));
  }
  return Math.max(0, ...options);
}

function protectionValue(context, card) {
  const armor = card.armor ?? 0;
  const shield = statusCount(card, 'shield');
  if ((!armor && !shield) || context.match.players[opponent(context.side)].passed) return 0;
  const threat = (context.incomingHit ??= incomingHit(context));
  return armor * (threat > 0 ? W.armorPerPoint : W.armorWithoutThreat)
    + shield * (threat > 0 ? Math.min(W.shieldMaxHit, threat, (card.power ?? 0) + armor) : W.shieldWithoutThreat);
}

export function futureContext(match, side) {
  const player = match.players[side];
  const own = units(match, side);
  const other = opponent(side);
  const turns = remainingTurns(match, side);
  const attacks = remainingTurns(match, other);
  const available = player.hand.some((card) => consumes(cardAbilities(card).deploy) || consumes(cardAbilities(card).order)) ||
    own.some((unit) => consumes(activeOrder(unit)) && unit.card.readyAt < player.turns + turns) ||
    (player.leader?.charges > 0 && consumes(player.leader.ability));
  const inDeck = !available && player.deck.some(({ definition }) => consumes(definition.deploy) || consumes(definition.order));
  return { match, side, player, own, turns, attacks, get resourceTurns() { return liveTurns(match, side); },
    armorPlans: player.hand.some(({ definition }) => definition.aiHints?.placement === 'armored-neighbors'),
    triggerChance: available ? .68 : inDeck ? .48 : .32 };
}

function freeSlots(context, row) {
  return row ? ROW_LIMIT - context.player.board[row].length
    : Math.max(...ROWS.map((lane) => ROW_LIMIT - context.player.board[lane].length));
}

function enemyImpact(context, job, step) {
  if (!step.target) return 0;
  const { match, side, attacks } = context;
  const candidates = targets(match, job, step.target).filter((target) => isUnit(target.card));
  if (!candidates.length) return 0;
  const points = candidates.map((target) => {
    const { card } = target;
    const sign = target.side === side ? -1 : 1;
    const amount = valueOf(match, job, step.amount, target);
    if (step.action === 'destroy') return sign * card.power;
    if (step.action === 'damage') return sign * Math.min(card.power, statusCount(card, 'shield') ? 0 : Math.max(0, amount - (card.armor ?? 0)));
    if (step.status === 'infection') {
      const current = statusCount(card, 'infection');
      // An infection can still be useful later in a long round, but never ticks on a passed defender.
      const ticks = target.side === side ? context.turns : attacks;
      return sign * (infectionDamage(card, Math.min(ticks, current + amount)) - infectionDamage(card, Math.min(ticks, current)));
    }
    return 0;
  });
  const count = step.count === undefined ? 1 : valueOf(match, job, step.count);
  const sum = points.reduce((total, point) => total + point, 0);
  return step.mode === 'random' ? sum * Math.min(count, points.length) / points.length : sum;
}

function delayedAbilityValue(context, card, ability, row, onDeath = false, activations = 1) {
  const { match, side, player } = context;
  const job = { side, ability, sourceGrowth: card.growth };
  return (ability?.steps ?? []).reduce((sum, step) => {
    if (step.action === 'spawn') {
      const power = step.power === undefined ? step.card.power : valueOf(match, job, step.power);
      const lanes = step.row === 'all' ? ROWS : [ROWS.includes(step.row) ? step.row : row];
      const count = lanes.reduce((total, lane) =>
        total + Math.min(step.amount * activations, freeSlots(context, lane) + Number(onDeath)), 0);
      return sum + count * (power ?? 0);
    }
    if (step.action === 'transform') return sum + (step.card.power ?? 0) - (card.power ?? 0);
    if (step.action === 'summon-from-deck' && (onDeath || freeSlots(context, row) > 0)) {
      return sum + (player.deck.find(({ definition }) => matchesPileFilter(definition, step.filter))?.power ?? 0);
    }
    return sum + enemyImpact(context, job, step);
  }, 0);
}

export function deathwishPayoff(context, card, row, definitions = deathwishDefinitions(card)) {
  return definitions.reduce((sum, definition) =>
    sum + delayedAbilityValue(context, card, definition.deathwish, row, true), 0);
}

export function inheritsDeathwishes(card) {
  return cardAbilities(card).deploy?.steps.some(({ action }) => action === 'inherit-deathwishes');
}

export function inheritancePayoff(context, card) {
  if (!inheritsDeathwishes(card)) return 0;
  return deathwishPayoff(context, card, undefined, inheritableDeathwishes(context.player));
}

export function armorBreakEmergence(card) {
  if (!(card.armor > 0)) return 0;
  const steps = cardAbilities(card).events?.['armor-break']?.steps ?? [];
  return steps.reduce((sum, step) => step.action === 'spawn' ? sum + step.amount * (step.card.power ?? 0) : sum, 0);
}

export function delayedCardValue(context, card, row, inHand = false) {
  const { turns, attacks, player, triggerChance } = context;
  if (!turns && !attacks) return 0;
  const abilities = cardAbilities(card);
  const armor = card.armor ?? 0;
  const protection = protectionValue(context, card);
  const armorSynergy = turns && armor > 0 && context.armorPlans ? .55 : 0;
  const emergence = armor > 0 && attacks ? armorBreakEmergence(card) * .45 : 0;
  const wish = deathwishPayoff(context, card, row) + (inHand ? inheritancePayoff(context, card) : 0);
  const activation = turns ? triggerChance : .25;
  const futureTurns = Math.min(turns, card.timer ?? turns);
  const endSteps = abilities.endTurn?.steps ?? [];
  const spawnGrowth = endSteps.some(({ action }) => action === 'spawn')
    ? delayedAbilityValue(context, card, abilities.endTurn, row, false, futureTurns) * .67 : 0;
  const powerGrowth = endSteps.reduce((sum, step) =>
    step.action === 'boost' && step.target.scope === 'source' && typeof step.amount === 'number' ? sum + step.amount : sum, 0);
  const growth = powerGrowth * .65 * futureTurns + (card.growth !== undefined && wish ? .22 * futureTurns : 0);
  const countdown = !isLocked(card) && card.counter > 0 && card.counter <= turns ? card.definition.counter?.effect : undefined;
  const coins = countdown?.steps.find(({ action }) => action === 'coins');
  const counter = countdown ? coins ? coinValue(context, Math.min(COIN_LIMIT, (player.coins ?? 0) + Math.max(0, coins.amount))) - coinValue(context)
    : countdown.steps.some(({ action }) => action === 'draw') ? (player.deck.length ? 1.6 : 0)
      : delayedAbilityValue(context, card, countdown, row) : 0;
  const charges = !isLocked(card) && card.orderCharges > 0
    ? Math.min(card.orderCharges, Math.max(0, turns - Math.max(0, card.readyAt - player.turns))) * .48 : 0;
  return protection + armorSynergy + emergence + activation * wish + spawnGrowth + growth + counter * .8 + charges;
}

export function consumeBonus(context, unit) {
  const { card, row } = unit;
  const token = card.definition.aiHints?.sacrificeBonus ?? Number(Boolean(card.definition.token)) * .25;
  return token + Number(deathwishDefinitions(card).length > 0) * .2 + deathwishPayoff(context, card, row);
}

export function wantsToHoldInheritance(context, card, alternatives) {
  return inheritsDeathwishes(card) && inheritancePayoff(context, card) < 2 &&
    alternatives.some((other) => other !== card && !inheritsDeathwishes(other) &&
      (other.power ?? other.definition.provision ?? 0) >= 3);
}

export function carryoverValue(context, passed) {
  const { match, own, player } = context;
  const resilience = own.reduce((total, { card }) => {
    if (!card.resilient || isLocked(card)) return total;
    return total + (card.power ?? 0) * W.carriedUnit + protectionValue(context, card) * W.carriedUnit;
  }, 0);
  const currentUses = passed ? 0 : leaderUses(context);
  const carryLeader = Math.min(Math.max(0, (player.leader?.charges ?? 0) - currentUses), leaderUses(context, true));
  const coins = player.coins ?? 0;
  if (!coins || !match.rules.coinsPersistBetweenRounds) return resilience + carryLeader * W.leaderCharge;
  const currentCapacity = passed ? 0 : (context.coinCapacity ??= coinCapacity(context));
  const carryCoins = coinValue(context, coins, currentCapacity + coinCapacity(context, true))
    - (passed ? 0 : coinValue(context));
  return resilience + carryLeader * W.leaderCharge + carryCoins;
}
