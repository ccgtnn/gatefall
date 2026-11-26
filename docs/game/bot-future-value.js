import { activeOrder, COIN_LIMIT, infectionDamage, isUnit, opponent, ROW_LIMIT, statusCount, units } from './board.js';
import { ROWS } from './card-metadata.js';
import { matchesPileFilter, targets, valueOf } from './effect-queries.js';
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

function spendsCoins(card) {
  const { fee, deploy } = cardAbilities(card);
  return fee || deploy?.steps.some(({ action }) => action === 'choose-tribute');
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
  return { match, side, player, own, turns, attacks,
    armorPlans: player.hand.some(({ definition }) => definition.aiHints?.placement === 'armored-neighbors'),
    triggerChance: available ? .68 : inDeck ? .48 : .32,
    coinWeight: [...player.hand, ...own.map(({ card }) => card)].some(spendsCoins) ? .42 : .25 };
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
  const { turns, attacks, player, triggerChance, coinWeight } = context;
  if (!turns && !attacks) return 0;
  const abilities = cardAbilities(card);
  const armor = card.armor ?? 0;
  const shield = statusCount(card, 'shield');
  const protection = attacks ? .12 * Math.min(armor, attacks * 2) + .5 * shield : 0;
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
  const counter = countdown ? coins ? Math.min(COIN_LIMIT - (player.coins ?? 0), Math.max(0, coins.amount)) * coinWeight
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

export function carryoverValue({ match, own, player }, weights) {
  const resilience = own.reduce((total, { card }) => {
    if (!card.resilient || isLocked(card)) return total;
    return total + (card.power ?? 0) * weights.carriedUnit + (card.armor ?? 0) * weights.carriedArmor
      + statusCount(card, 'shield') * weights.carriedShield;
  }, 0);
  const leader = player.leader;
  const uses = leader?.order && !leader.order.usesCharges ? 1 : leader?.charges ?? 0;
  return resilience + uses * weights.carriedLeader
    + (match.rules.coinsPersistBetweenRounds ? (player.coins ?? 0) * weights.carriedCoins : 0);
}
