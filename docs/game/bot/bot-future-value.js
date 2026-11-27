import { activeOrder, availableRows, cardType, COIN_LIMIT, infectionDamage, isUnit, opponent, placementSide, ROW_LIMIT, statusCount, units } from '../engine/board.js';
import { handCount } from './bot-hand.js';
import { ROWS } from '../shared/card-metadata.js';
import { feePayoff, leaderFirestormStep, leaderFirestormValue } from './bot-effect-value.js';
import { carriedCoins } from '../engine/match.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';
import { canGrantZeal, leaderCooldown } from '../effects/effects.js';
import { canStart, matchesPileFilter, stepAllowed, targets, valueOf } from '../effects/effect-queries.js';
import { cardAbilities, deathwishDefinitions, inheritableDeathwishes, isLocked } from '../engine/events.js';

export function remainingTurns(match, side, passingSide) {
  if (match.phase !== 'playing') return 0;
  const other = opponent(side);
  const passed = match.players[side].passed || passingSide === side;
  if (passed && (match.players[other].passed || passingSide === other)) return 0;
  const active = passed ? other : side;
  const player = match.players[active];
  const handSize = handCount(player);
  // Cap forecasts even with a full hand: either side may pass early.
  return Math.min(4, handSize + Number(match.turn === active && (match.playedCard || (player.usedAbility && handSize === 0))));
}

function consumes(ability) {
  return ability?.steps.some(({ action }) => action === 'consume');
}

function liveTurns(match, side) {
  const player = match.players[side];
  if (match.phase === 'mulligan') return handCount(player);
  if (match.phase !== 'playing' || player.passed) return 0;
  const hidden = player.publicHandSize === undefined ? undefined : handCount(player);
  const hand = hidden ?? player.hand.filter((card) => availableRows(match.players[placementSide(side, card)], card).length ||
    cardType(card) === 'effect').length;
  return Math.max(match.turn === side ? 1 : 0, hand +
    Number(match.turn === side && match.playedCard));
}

function addCoinUse(rates, cost, payoff) {
  const rate = Math.min(W.usefulCoin, payoff / cost);
  if (rate <= W.surplusCoin) return;
  for (let coin = 0; coin < cost; coin += 1) rates.push(rate);
}

function feeRates(context, unit, turns, slots, transformed, future) {
  const { match, side, own, player } = context;
  const { card, row } = unit;
  const { fee, order } = cardAbilities(card);
  const rates = [];
  const step = fee.steps.find(({ action }) => ['spawn', 'transform', 'ready-order'].includes(action));
  if (!step || (fee.needsSourceSpace && slots[row] <= 0)) return rates;
  if (step.action === 'spawn') {
    if (!(step.card.power > 0 && step.amount > 0)) return rates;
    while (slots[row] > 0 && rates.length < COIN_LIMIT) {
      const count = Math.min(slots[row], step.amount);
      addCoinUse(rates, fee.coins, count * step.card.power);
      slots[row] -= count;
    }
  } else if (step.action === 'transform') {
    const pick = fee.select?.find(({ ref }) => ref === step.target.ref);
    if (!pick) return rates;
    for (const { card: target } of targets(match, { side, sourceId: card.id, ability: fee }, pick.targets, true)) {
      if (transformed.has(target.id) || step.card.power <= target.power) continue;
      addCoinUse(rates, fee.coins, step.card.power - target.power + .2 * ((step.card.armor ?? 0) - (target.armor ?? 0)));
      transformed.add(target.id);
    }
  } else if (order) {
    const offering = order.select?.find(({ kind }) => kind === 'destroy');
    const offerings = offering ? own.filter(({ card: ally }) => ally.id !== card.id &&
      (!offering.targets.category || ally.definition.categories?.includes(offering.targets.category))).length : turns;
    const unavailableNow = !future && card.orderUsedTurn === player.turns;
    const payoff = feePayoff(context, unit, slots[row], future || turns > 1);
    const uses = Math.min(offerings, Math.max(0, turns - Number(unavailableNow)));
    for (let use = 0; use < uses; use += 1) addCoinUse(rates, fee.coins, payoff);
  }
  return rates;
}

function deployCoinRates(deploy, slots) {
  const rates = [];
  for (const step of deploy?.steps ?? []) {
    if (step.action === 'coins' && typeof step.amount === 'number' && step.amount < 0) {
      const cost = -step.amount;
      const penalty = deploy.steps.find((other) => other.action === 'weaken' && other.when?.coinsBelow === cost);
      if (penalty) addCoinUse(rates, cost, penalty.amount);
    }
    if (step.action !== 'choose-tribute' || !(step.spawn?.card?.power > 0)) continue;
    const tiers = Object.entries(step.tiers).sort(([a], [b]) => Number(a) - Number(b));
    let previous = 0;
    let spent = 0;
    for (const [price, count] of tiers) {
      const produced = Math.min(slots, count);
      if (produced <= previous) break;
      addCoinUse(rates, Number(price) - spent, (produced - previous) * step.spawn.card.power);
      previous = produced;
      spent = Number(price);
    }
  }
  return rates;
}

const coinRateSum = (rates) => rates.reduce((sum, rate) => sum + rate, 0);

function coinRates(context, future = false) {
  const { player, own, match, side } = context;
  const turns = future ? Math.max(1, handCount(player)) : context.resourceTurns;
  if (!turns) return [];
  const field = future ? own.filter(({ card }) => card.resilient && !isLocked(card)) : own;
  const slots = Object.fromEntries(ROWS.map((row) => [row, future
    ? ROW_LIMIT - field.filter((unit) => unit.row === row).length : freeSlots(context, row)]));
  const rate = (unit) => {
    const { fee } = cardAbilities(unit.card);
    return feePayoff(context, unit, slots[unit.row]) / fee.coins;
  };
  const fees = field.filter(({ card, row }) => cardAbilities(card).fee &&
    (!card.definition.requiredRow || card.definition.requiredRow === row));
  fees.sort((a, b) => rate(b) - rate(a));
  const transformed = new Set();
  const rates = fees.flatMap((unit) => feeRates(context, unit, turns, slots, transformed, future));
  const canPlay = Math.max(0, turns - Number(!future && match.turn === side && match.playedCard));
  const handRates = player.hand.map((card) => {
    const { deploy, fee } = cardAbilities(card);
    if (!fee && !deploy?.steps.some(({ action, amount }) => action === 'choose-tribute' || action === 'coins' && amount < 0)) {
      return [];
    }
    const recipient = placementSide(side, card);
    const rows = future && recipient === side
      ? ROWS.filter((row) => (!card.definition.requiredRow || card.definition.requiredRow === row) && slots[row] > 0)
      : availableRows(match.players[recipient], card);
    if (cardType(card) !== 'effect' && !rows.length) return [];
    const choices = (rows.length ? rows : ROWS).map((row) => {
      const remaining = { ...slots, [row]: Math.max(0, slots[row] - Number(cardType(card) !== 'effect')) };
      return [...deployCoinRates(deploy, remaining[row]),
        ...(fee ? feeRates(context, { card, row }, turns, remaining, new Set(transformed), future) : [])];
    });
    return choices.sort((a, b) => coinRateSum(b) - coinRateSum(a))[0];
  }).sort((a, b) => coinRateSum(b) - coinRateSum(a));
  rates.push(...handRates.slice(0, canPlay).flat());
  return rates.sort((a, b) => b - a).slice(0, COIN_LIMIT);
}

// Coins left after this round can fund only half as much next round.
function futureCoinValue(context, coins) {
  if (context.match.round >= 3 || coins < 2) return 0;
  const kept = carriedCoins(context.match, coins);
  const rates = context.futureCoinRates ??= coinRates(context, true);
  return coinRateSum(rates.slice(0, kept)) + Math.max(0, kept - rates.length) * W.surplusCoin;
}

export function coinValue(context, coins = context.player.coins ?? 0) {
  if (coins <= 0) return 0;
  if (context.player.passed) return futureCoinValue(context, coins);
  const rates = context.coinRates ??= coinRates(context);
  const spendable = Math.min(coins, rates.length);
  if (context.match.round >= 3) return coinRateSum(rates.slice(0, spendable)) + (coins - spendable) * W.surplusCoin;
  let value = 0;
  let spentValue = 0;
  for (let spent = 0; spent <= spendable; spent += 1) {
    if (spent) spentValue += rates[spent - 1];
    value = Math.max(value, spentValue + futureCoinValue(context, coins - spent));
  }
  return value;
}

export function leaderUses(context, future = false) {
  const { match, player, side } = context;
  const leader = player.leader;
  const order = leader?.order;
  if (!leader?.ability || !order) return 0;
  const futureTurns = 3 * (3 - match.round);
  const turns = future ? futureTurns + (order.usesCharges ? handCount(player) : 0) : context.resourceTurns;
  if (turns <= 0 || (!future && turns === 1 && !canStart(match, { side, ability: leader.ability }))) return 0;
  const cooldown = future ? 0 : leaderCooldown(player);
  const opportunities = Math.max(0, turns - cooldown);
  const accelerated = order.quickenedBy && context.own.some(({ card }) =>
    !isLocked(card) && card.definition.id === order.quickenedBy);
  const recharge = accelerated ? 1 : order.cooldown + 1;
  const uses = Math.ceil(opportunities / recharge);
  return order.usesCharges ? Math.min(leader.charges, uses) : uses;
}

export function leaderChargeValue({ match, side, player }, future = false) {
  const leader = player.leader;
  if (!leader?.ability) return 0;
  const weather = leaderFirestormStep(leader.ability);
  if (weather) {
    // The next round starts with cleared rows. Assume one point per row tick against new targets.
    return future ? ROWS.length * weather.amount : Math.max(0, leaderFirestormValue(match, side, weather));
  }
  const printed = leader.ability.steps.reduce((points, step) => {
    if (step.action === 'spawn') return points + (step.card.power ?? 0) * (step.amount ?? 1);
    if (['boost', 'damage'].includes(step.action) && typeof step.amount === 'number') return points + step.amount;
    return points;
  }, 0);
  return Math.min(W.leaderChargeCap, leader.aiHints?.leaderChargeValue ?? printed);
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
      directHit(ability.timerPulse), directHit(ability.endTurn), directHit(ability.timerExpired));
  });
  if (enemy.leader?.charges > 0 || (enemy.leader?.order && !enemy.leader.order.usesCharges)) {
    options.push(directHit(enemy.leader.ability));
  }
  options.push(...enemy.hand.map((card) => directHit(cardAbilities(card).deploy)));
  if (enemy.knownDeck && (handCount(enemy) > 0 || match.round < 3)) {
    options.push(...enemy.knownDeck.map((card) => Math.max(directHit(card.deploy), directHit(card.order)) * W.knownHitChance));
  }
  return Math.max(0, ...options);
}

function protectionValue(context, card, parts) {
  const armor = card.armor ?? 0;
  const shield = statusCount(card, 'shield');
  if ((!armor && !shield) || context.match.players[opponent(context.side)].passed) return 0;
  const threat = (context.incomingHit ??= incomingHit(context));
  const armorValue = armor * (threat > 0 ? W.armorPerPoint : W.armorWithoutThreat);
  const shieldValue = shield * (threat > 0 ? Math.min(W.shieldMaxHit, threat, (card.power ?? 0) + armor) : W.shieldWithoutThreat);
  if (parts) {
    parts.armor += armorValue;
    parts.shields += shieldValue;
  }
  return armorValue + shieldValue;
}

export function futureContext(match, side, passingSide) {
  const player = match.players[side];
  const own = units(match, side);
  const other = opponent(side);
  const passed = player.passed || passingSide === side;
  const opponentPassed = match.players[other].passed || passingSide === other;
  const turns = remainingTurns(match, side, passingSide);
  const opponentTurns = remainingTurns(match, other, passingSide);
  const attacks = opponentPassed ? 0 : opponentTurns;
  const available = player.hand.some((card) => consumes(cardAbilities(card).deploy) || consumes(cardAbilities(card).order)) ||
    own.some((unit) => consumes(activeOrder(unit)) && unit.card.readyAt < player.turns + turns) ||
    (player.leader?.charges > 0 && consumes(player.leader.ability));
  const inDeck = !available && player.deck.some(({ definition }) => consumes(definition.deploy) || consumes(definition.order));
  return { match, side, player, own, turns, attacks, opponentTurns, passed,
    get resourceTurns() { return passed ? 0 : liveTurns(match, side); },
    armorPlans: player.hand.some(({ definition }) => definition.aiHints?.placement === 'armored-neighbors'),
    triggerChance: available ? .68 : inDeck ? .48 : .32 };
}

function freeSlots(context, row) {
  return row ? ROW_LIMIT - context.player.board[row].length
    : Math.max(...ROWS.map((lane) => ROW_LIMIT - context.player.board[lane].length));
}

function enemyImpact(context, job, step) {
  if (!step.target) return 0;
  const { match, side, opponentTurns } = context;
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
      const ticks = target.side === side ? context.turns : opponentTurns;
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

// Undefined means armor break does not remove the unit; zero is a genuine even trade.
export function armorBreakSwing(card) {
  const steps = cardAbilities(card).events?.['armor-break']?.steps;
  if (!(card.armor > 0) || !steps?.some(({ action, target }) =>
    ['kill', 'discard', 'destroy'].includes(action) && target?.scope === 'source')) return;
  return steps.reduce((sum, step) => step.action === 'spawn' ? sum + step.amount * (step.card.power ?? 0) : sum, -card.power);
}

function infectionGrowth(context, job, amount, turns) {
  const { match, side, opponentTurns } = context;
  const infected = targets(match, job, amount.count);
  let growth = 0;
  for (let turn = 0; turn < turns; turn += 1) {
    const ticks = Math.min(opponentTurns, turn + Number(match.turn !== side));
    const count = infected.filter(({ card }) =>
      statusCount(card, 'infection') > ticks && infectionDamage(card, ticks) < card.power).length;
    growth += Math.min(count, amount.cap ?? Infinity) * (amount.scale ?? 1);
  }
  return growth;
}

function infectionEngine(context, job, step, turns) {
  const { match, side, opponentTurns } = context;
  const enemies = targets(match, job, { ...step.target, infected: undefined });
  const leviathan = context.own.some(({ card }) => card.definition.id === 'plague-leviathan' && !isLocked(card));
  const applications = [];
  let value = 0;
  for (let turn = 0; turn < turns; turn += 1) {
    const ticks = turn + Number(match.turn !== side);
    if (ticks >= opponentTurns) break;
    const clean = enemies.filter(({ card }) => {
      const infection = statusCount(card, 'infection');
      return infection <= ticks && infectionDamage(card, infection) < card.power;
    });
    // Recently infected targets need time to become eligible again.
    if (clean.length <= applications.filter((expires) => expires > ticks).length) continue;
    const amount = valueOf(match, job, step.amount);
    const payoff = clean.reduce((total, { card }) => {
      const infection = statusCount(card, 'infection');
      const shields = Math.max(0, statusCount(card, 'shield') - infection);
      const damage = Math.max(0, Math.min(amount, opponentTurns - ticks) - shields);
      const power = card.power - infectionDamage(card);
      const feedsLeviathan = leviathan && turn + 1 < turns && amount > 1 && (power > 1 || shields > 0);
      return total + Math.min(damage, power) + (feedsLeviathan ? .65 : 0);
    }, 0);
    value += payoff / clean.length;
    applications.push(ticks + amount);
  }
  return value;
}

function endTurnValue(context, card, ability, row, turns) {
  if (!ability || !turns) return 0;
  const { match, side, passed, player } = context;
  const job = { side, ability, sourceId: card.id, results: {} };
  let value = 0;
  for (const step of ability.steps) {
    if (!stepAllowed(match, job, step)) continue;
    if (step.action === 'spawn') {
      value += delayedAbilityValue(context, card, { steps: [step] }, row, false, turns) * .67;
    } else if (step.action === 'damage' && step.target?.scope === 'neighbors') {
      const hit = targets(match, job, step.target).reduce((sum, unit) => {
        const target = unit.card;
        const amount = valueOf(match, job, step.amount, unit);
        if (statusCount(target, 'shield')) return sum;
        const lost = Math.min(target.power, Math.max(0, amount * turns - (target.armor ?? 0)));
        if (step.save) job.results[step.save] = (job.results[step.save] ?? 0) + lost;
        const emergence = amount * turns >= target.armor ? armorBreakSwing(target) : undefined;
        return sum + (unit.side === side ? 1 : -1) * (emergence ?? -lost);
      }, 0);
      value += hit * .65;
    } else if (step.action === 'boost' && step.target?.scope === 'source') {
      const amount = step.amount;
      const growth = amount?.count?.scope === 'enemy' && amount.count.infected
        ? infectionGrowth(context, job, amount, turns)
        : valueOf(match, job, amount) * (amount?.result ? 1 : turns);
      value += growth * .65;
    } else if (step.action === 'status' && step.status === 'infection' &&
      step.mode === 'random' && step.target?.scope === 'enemy' && step.target.infected === false) {
      value += infectionEngine(context, job, step, turns);
    } else if (!passed && card.readyAt > player.turns &&
      ((step.action === 'ready-order' && card.orderUsedTurn !== player.turns) ||
        (step.action === 'grant-zeal' && canGrantZeal({ card, row, side }, player.turns)))) {
      const order = activeOrder({ card, row });
      if (order && canStart(match, { ...job, ability: order })) value += W.readyOrder - W.coolingOrder;
    }
  }
  return value;
}

export function delayedCardValue(context, card, row, inHand = false, parts) {
  const { turns, attacks, player, triggerChance } = context;
  if (!turns && !attacks) return 0;
  const abilities = cardAbilities(card);
  const armor = card.armor ?? 0;
  const protection = protectionValue(context, card, parts);
  const armorSynergy = turns && armor > 0 && context.armorPlans ? .55 : 0;
  const emergence = armor > 0 && attacks ? (armorBreakSwing(card) ?? 0) * .45 : 0;
  const wish = deathwishPayoff(context, card, row) + (inHand ? inheritancePayoff(context, card) : 0);
  const activation = turns ? triggerChance : .25;
  const futureTurns = Math.min(turns, card.timer ?? turns);
  const engine = endTurnValue(context, card, abilities.endTurn, row, futureTurns);
  const growth = (abilities.startTurnGrowth ?? 0) * .65 * futureTurns + (card.growth !== undefined && wish ? .22 * futureTurns : 0);
  const countdown = !isLocked(card) && card.counter > 0 && card.counter <= turns ? card.definition.counter?.effect : undefined;
  const coins = countdown?.steps.find(({ action }) => action === 'coins');
  const counter = countdown ? coins ? coinValue(context, Math.min(COIN_LIMIT, (player.coins ?? 0) + Math.max(0, coins.amount))) - coinValue(context)
    : countdown.steps.some(({ action }) => action === 'draw') ? (player.deck.length ? 1.6 : 0)
      : delayedAbilityValue(context, card, countdown, row) : 0;
  const charges = card.orderCharges > 0 && activeOrder({ card, row })
    ? Math.min(card.orderCharges, Math.max(0, context.resourceTurns - Math.max(0, card.readyAt - player.turns))) * .48 : 0;
  if (parts) {
    parts.armor += armorSynergy + emergence;
    parts.orders += charges;
  }
  return protection + armorSynergy + emergence + activation * wish + engine + growth + counter * .8 + charges;
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
  const { own, player } = context;
  const resilience = own.reduce((total, { card, row }) => {
    if (!card.resilient || isLocked(card)) return total;
    const { endTurn, order, scenario } = cardAbilities(card);
    const carriedArtifact = cardType(card) === 'artifact'
      ? delayedAbilityValue(context, card, endTurn, row, false, 2) +
        (order ? W.readyOrder : 0) + (scenario ? (scenario.chapters.length - (card.chapter ?? 0)) * W.scenarioChapter / 2 : 0)
      : 0;
    return total + ((card.power ?? 0) + carriedArtifact + protectionValue(context, card)) * W.carriedUnit;
  }, 0);
  const futureUses = leaderUses(context, true);
  const currentUses = passed ? 0 : leaderUses(context);
  const carryLeader = player.leader?.order?.usesCharges
    ? Math.min(Math.max(0, player.leader.charges - currentUses), futureUses)
    : futureUses;
  const carryCoins = passed ? futureCoinValue(context, player.coins ?? 0) : 0;
  return resilience + carryLeader * leaderChargeValue(context, true) + carryCoins;
}
