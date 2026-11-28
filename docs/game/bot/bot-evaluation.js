import { handCount } from './bot-hand.js';
import { ROWS } from '../shared/card-metadata.js';
import { activeOrder, createCard, infectionDamage, isUnit, opponent, statusCount, units } from '../engine/board.js';
import { deckPlayTrigger, effectSwing, rowEffectValue, stormDeathwishValue } from './bot-effect-value.js';
import { carryoverValue, coinValue, delayedCardValue, futureContext, leaderUses, leaderChargeValue } from './bot-future-value.js';
import { availableOrders } from '../effects/effects.js';
import { cardAbilities } from '../engine/events.js';
import { HAND_LIMIT, ROUND_DRAW, totalScore } from '../engine/match.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';
import { visibleSupply } from './bot-supply.js';

export function cardPotential(card) {
  const { aiHints, provision, rarity } = card.definition;
  const { deploy, endTurn, order } = cardAbilities(card);
  if (aiHints?.handPotential !== undefined) return aiHints.handPotential;
  const printed = (card.power ?? (provision ?? W.defaultPower) * W.effectProvision)
    + (deploy ? W.deploy : 0) + (endTurn || order ? W.engine : 0);
  // Strong low-body golds store the value of their effect until it has a good target.
  return rarity === 'gold' && (deploy || order) ? Math.max(printed, (provision ?? 0) * W.effectProvision) : printed;
}

function boardValue(state, side, context, parts) {
  const player = state.players[side];
  const { passed } = context;
  const ready = new Set(passed ? [] : availableOrders(state, side).map(({ card }) => card.id));
  const enemy = state.players[opponent(side)];
  const weather = ROWS.reduce((sum, row) => {
    const effect = enemy.rowEffects?.[row];
    const active = effect && (effect.attacker === side || (!effect.attacker && effect.type === 'rot'))
      ? rowEffectValue(enemy, row, effect.remaining, false, context.opponentTurns, effect.type) : 0;
    return sum + active;
  }, 0);
  const enemyUnits = units(state, opponent(side));
  const marked = enemyUnits.reduce((value, unit) => {
    if (!unit.card.inheritedDeathwishes?.length) return value;
    const duration = unit.card.inheritedDeathwishes
      .filter(({ grantedBy }) => grantedBy === side)
      .flatMap(({ deathwish }) => deathwish.steps)
      .reduce((total, step) => total + (step.effect === 'firestorm' ? step.amount : 0), 0);
    return value + (duration ? stormDeathwishValue(state, unit, duration, true) : 0);
  }, 0);
  const exposed = enemyUnits.filter(({ card }) => statusCount(card, 'target')).length;
  const plans = player.hand.some(({ definition }) => definition.keywords?.includes('Цель'));
  const leader = passed ? 0 : leaderUses(context) * leaderChargeValue(context);
  const coins = passed ? 0 : coinValue(context);
  const freeSummons = passed ? 0 : player.deck.reduce((sum, card) =>
    sum + (deckPlayTrigger(player, card, player.hand, false) ? (card.power ?? 0) * .75 : 0), 0);
  const marks = !passed && plans ? exposed * W.markedTarget : 0;
  if (parts) Object.assign(parts, { rowEffects: weather + marked, leaderCharges: leader, coins });
  const board = context.own.reduce((sum, unit) => {
    const { card, row } = unit;
    const { definition, timer } = card;
    const abilities = cardAbilities(card);
    const endTurn = abilities.endTurn?.steps.every(({ action, target }) =>
      !['spawn', 'advance-growth', 'boost'].includes(action) && !(action === 'damage' && target?.scope === 'neighbors'));
    const orderValue = !passed && card.orderCharges === undefined
      ? (ready.has(card.id) ? W.readyOrder : activeOrder(unit) ? W.coolingOrder : 0) : 0;
    if (parts) parts.orders += orderValue;
    const delayed = delayedCardValue(context, card, row, false, parts)
      - W.infection * infectionDamage(card, Math.min(context.turns, statusCount(card, 'infection')));
    if (passed) return sum + delayed;
    return sum + delayed + (definition.aiHints?.boardBonus ?? 0)
      + orderValue
      + (row === 'orbit' && abilities.fieldEvents?.['target-marked'] ? W.markReaction : 0)
      + (context.turns && endTurn && (!definition.aiHints?.endTurnNeedsMarkedEnemy || exposed) ? (timer === undefined ? W.endTurn : W.timerTurn * Math.min(timer, W.timerLimit)) : 0)
      + (abilities.scenario ? Math.min(definition.scenario.chapters.length - (card.chapter ?? 0),
        player.hand.filter((entry) => entry.definition.categories?.includes(definition.scenario.category)).length) * W.scenarioChapter : 0)
      + (abilities.fieldEvents?.death && ROWS.some((row) =>
        enemy.board[row].some((entry) => entry.statuses?.infection)) ? W.deathReaction : 0);
  }, weather + marked + (passed ? 0 : leader + coins + marks + freeSummons));
  if (parts) parts.delayed = board - Object.values(parts).reduce((sum, value) => sum + value, 0);
  return board;
}

function handCards(state, side, player, play, roundChanged, growthTurns) {
  if (player.publicHandSize !== undefined) {
    const remaining = Math.max(0, handCount(player) - Number(play?.type === 'play'));
    const draw = roundChanged ? Math.min(ROUND_DRAW, player.publicDeckSize, HAND_LIMIT - remaining) : 0;
    const count = remaining + draw;
    return Array.from({ length: count }, () => W.defaultPower);
  }
  const potential = (card) => cardPotential(card) + growthTurns * (cardAbilities(card).startTurnGrowth ?? 0);
  // Shallow search executes draw-dependent rules with real cards, but values the
  // unknown draw in reserve using the remaining deck's average.
  const draws = side === 'bot' && state.players.human.handMasked
    ? state.log.filter(({ type, side }) => type === 'draw' && side === 'bot').flatMap(({ cards }) => cards ?? []) : [];
  const drawn = new Map(draws.map((card) => [card.id, card]));
  const pool = drawn.size ? [...new Map([...drawn, ...player.deck.map((card) => [card.id, card])]).values()] : [];
  const average = pool.length ? pool.reduce((sum, card) => sum + potential(card), 0) / pool.length : 0;
  return player.hand.filter(({ id }) => id !== play?.cardId)
    .map((card) => drawn.has(card.id) ? average : potential(card));
}

function reserve(player, cards, round) {
  const cardWorth = (points) => W.cardBase + W.cardPower * (points - W.defaultPower);
  const worth = cards.reduce((sum, points) => sum + cardWorth(points), 0);
  const deckCount = player.publicDeckSize ?? player.deck.length;
  const overflow = round < 3 ? Math.max(0, cards.length + Math.min(ROUND_DRAW, deckCount) - HAND_LIMIT) : 0;
  return (worth - overflow * W.cardBase) * W.handReserve[round - 1];
}

function roundStake(winner, loser) {
  if (loser.lives === 1) {
    return Math.min(W.matchWin - (winner.lives - loser.lives) * W.life, W.eliminationStake);
  }
  return W.life;
}

function passOutcome(active, waiting, activeInfo, waitingInfo, round, estimatedCards = activeInfo.cards) {
  const lead = activeInfo.raw - waitingInfo.raw;
  const win = roundStake(active, waiting);
  const loss = -roundStake(waiting, active);
  if (lead > 0) return win;
  // A tied round costs both players a life. With one life each, it ends in a draw.
  const tie = active.lives === waiting.lives ? 0 : active.lives > waiting.lives ? win : loss;
  const pass = lead < 0 ? loss : tie;
  if (!estimatedCards.length) return pass;

  // Spend the fewest plays, then use the cheapest card that can close the gap.
  const cards = estimatedCards.toSorted((a, b) => a - b);
  let gain = activeInfo.score - waitingInfo.score;
  let spent = 0;
  while (gain <= 0 && cards.length) {
    const sufficient = cards.findIndex((points) => Math.max(W.minimumOutput, points) > -gain);
    const [points] = cards.splice(sufficient < 0 ? cards.length - 1 : sufficient, 1);
    gain += Math.max(W.minimumOutput, points);
    spent += 1;
  }
  if (gain <= 0) return pass;
  const cost = reserve(active, estimatedCards, round) - reserve(active, cards, round);
  const confidence = spent <= W.cheapCatchupCards ? W.cheapConversion : W.projectedConversion;
  return Math.max(pass, confidence * win + (1 - confidence) * loss - cost);
}

function removalCard(definition) {
  return definition.removalReserve || definition.deploy?.steps.some(({ action }) => action === 'destroy' || action === 'capture');
}

function secondRoundPlan(state, side, info, rivalInfo, projection) {
  const player = state.players[side];
  const rivalSide = opponent(side);
  const rival = state.players[rivalSide];
  if (state.round !== 2 || state.phase !== 'playing' || player.lives !== 2 || rival.lives !== 1) return;
  const hidden = rival.publicHandSize !== undefined;
  const count = rivalInfo.cards.length;
  const supply = hidden ? visibleSupply(state, true, Boolean(rival.knownDeck)) : [];
  const deckSize = rival.publicDeckSize ?? rival.deck.length;
  const available = hidden ? supply.map(({ card, weight }) => ({
    card: { definition: card, power: card.power }, weight,
  })) : rival.hand.filter(({ id }) => id !== projection?.cardId || state.turn !== rivalSide)
    .map((card) => ({ card, weight: 1 }));
  const totalWeight = available.reduce((sum, { weight }) => sum + weight, 0);
  const handPotential = available.map(({ card, weight }) => ({ points: cardPotential(card), weight }));
  const expected = totalWeight ? handPotential.reduce((sum, { points, weight }) => sum + points * weight, 0) / totalWeight : W.defaultPower;
  const gain = (cards) => cards.reduce((sum, points) => sum + Math.max(W.minimumOutput, points), 0);
  const response = !hidden ? rivalInfo.cards : rival.knownDeck && supply.length >= count
    ? handPotential.map(({ points }) => points).sort((a, b) => b - a).slice(0, count)
    : Array.from({ length: count }, () => Math.max(W.defaultPower, expected) + 2);
  const ceiling = gain(response);

  let exposure = 0;
  if (!info.passed && !rivalInfo.passed && count && info.raw > rivalInfo.raw) {
    let field = state;
    if (projection?.type === 'play' && state.turn === side && projection.row) {
      const played = player.hand.find(({ id }) => id === projection.cardId);
      if (played && isUnit(played) && !played.definition.enemySide) {
        const board = { ...player.board, [projection.row]: [...player.board[projection.row], played] };
        field = { ...state, players: { ...state.players, [side]: { ...player, board } } };
      }
    }
    const bodies = units(field, side).filter(({ card }) => isUnit(card)).map(({ card }) => card.power);
    const [, second = 0] = bodies.toSorted((a, b) => b - a);
    for (const { card, weight } of available) {
      if (!removalCard(card.definition)) continue;
      const chance = hidden ? 1 - (1 - weight / totalWeight) ** count : 1;
      const threat = hidden ? createCard(card.definition.id, card.definition) : card;
      const swing = effectSwing(field, rivalSide, threat);
      exposure = Math.max(exposure, chance * Math.max(0, swing - second));
    }
  }

  const ownDraw = Math.min(ROUND_DRAW, player.deck.length, HAND_LIMIT - info.cards.length);
  const rivalDraw = Math.min(ROUND_DRAW, deckSize, HAND_LIMIT - count);
  const ownAverage = player.deck.length ? gain(player.deck.map(cardPotential)) / player.deck.length : W.defaultPower;
  const rivalAverage = !hidden && rival.deck.length ? gain(rival.deck.map(cardPotential)) / rival.deck.length : expected;
  const edge = gain(info.cards) + ownDraw * ownAverage -
    (hidden ? count * expected : gain(rivalInfo.cards)) - rivalDraw * rivalAverage;
  const finalRound = info.cards.some((points) => points >= W.defaultPower + 2) && edge > W.defaultPower
    ? W.life * Math.tanh((edge - W.defaultPower) / W.scoreScale) : 0;
  return { ceiling, exposure, finalRound, response };
}

const boardParts = () => ({ rowEffects: 0, leaderCharges: 0, coins: 0, armor: 0, shields: 0, orders: 0, delayed: 0 });

function describePosition(total, lives = 0, left, right, scale = 0, handTempo = 0) {
  const parts = { field: 0, handReserve: 0, handTempo: 0, ...boardParts(), carryover: 0, lives, outcome: 0 };
  if (left && right) {
    parts.handReserve = left.reserve - right.reserve;
    parts.carryover = left.carry - right.carry;
    if (scale) {
      parts.field = (left.raw - right.raw) * scale;
      parts.handTempo = handTempo * scale;
      for (const key of Object.keys(left.parts)) parts[key] = (left.parts[key] - right.parts[key]) * W.futureBoard * scale;
    }
  }
  parts.outcome = total - Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { total, parts };
}

function outcomeScore(breakdown, total, lives, left, right) {
  return breakdown ? describePosition(total, lives, left, right) : total;
}

export function evaluateBreakdown(state, side, projection) {
  return evaluate(state, side, projection, true);
}

// A caller can score a cheap one-move projection for rollout policy. The full search
// supplies a state already advanced by the engine. Hidden cards must be masked or sampled first.
export function evaluatePosition(state, side, projection) {
  return evaluate(state, side, projection, false);
}

function evaluate(state, side, projection, breakdown) {
  if (state.phase === 'finished' && state.result) {
    const total = state.result === 'draw' ? 0 :
      (state.result === (side === 'human' ? 'win' : 'loss') ? 1 : -1) * W.matchWin;
    return outcomeScore(breakdown, total);
  }
  const other = opponent(side);
  const own = state.players[side];
  const rival = state.players[other];
  const round = Math.min(3, state.round);
  const projectedSide = projection && state.turn;
  const passingSide = projection?.type === 'pass' ? projectedSide : undefined;
  const info = (key, player) => {
    const move = projectedSide === key ? projection : undefined;
    const context = futureContext(state, key, passingSide);
    const passed = player.passed || move?.type === 'pass';
    const growthTurns = round < 3 ? Math.min(W.handGrowthTurns, context.turns) : 0;
    const cards = handCards(state, key, player, move, state.phase === 'mulligan', growthTurns);
    const raw = totalScore(player) + (move?.gain ?? 0);
    const parts = breakdown ? boardParts() : undefined;
    return {
      passed, cards, turns: context.turns, raw, parts,
      score: raw + W.futureBoard * boardValue(state, key, context, parts),
      reserve: round === 3 && state.phase === 'playing' && (passed || !context.turns) ? 0 : reserve(player, cards, round),
      carry: round < 3 ? carryoverValue(context, passed) : 0,
    };
  };
  const left = info(side, own);
  const right = info(other, rival);
  const lives = W.life * (own.lives - rival.lives);
  const base = lives + left.reserve - right.reserve + left.carry - right.carry;
  const leftPlan = secondRoundPlan(state, side, left, right, projection);
  const rightPlan = secondRoundPlan(state, other, right, left, projection);
  if (left.passed && right.passed) {
    if (left.raw > right.raw) return rival.lives === 1
      ? outcomeScore(breakdown, W.matchWin) : outcomeScore(breakdown, base + W.life, lives, left, right);
    if (right.raw > left.raw) return own.lives === 1
      ? outcomeScore(breakdown, -W.matchWin) : outcomeScore(breakdown, base - W.life, lives, left, right);
    if (own.lives === 1 || rival.lives === 1) return outcomeScore(breakdown, Math.sign(own.lives - rival.lives) * W.matchWin);
    return outcomeScore(breakdown, base, lives, left, right);
  }
  if (left.passed) {
    if (own.lives === 1 && (right.raw > left.raw || right.raw === left.raw && rival.lives > own.lives)) return outcomeScore(breakdown, -W.matchWin);
    return outcomeScore(breakdown, base - passOutcome(rival, own, right, left, round, leftPlan?.response) + (leftPlan?.finalRound ?? 0), lives, left, right);
  }
  if (right.passed) {
    if (rival.lives === 1 && (left.raw > right.raw || left.raw === right.raw && own.lives > rival.lives)) return outcomeScore(breakdown, W.matchWin);
    return outcomeScore(breakdown, base + passOutcome(own, rival, left, right, round, rightPlan?.response) - (rightPlan?.finalRound ?? 0), lives, left, right);
  }

  const lead = left.score - right.score - (leftPlan?.exposure ?? 0) + (rightPlan?.exposure ?? 0);
  const maxGain = (cards) => cards.reduce((sum, points) => sum + Math.max(W.minimumOutput, points), 0);
  if (lead > (leftPlan?.ceiling ?? maxGain(right.cards)) && round < 3) return outcomeScore(breakdown, base + roundStake(own, rival), lives, left, right);
  if (-lead > (rightPlan?.ceiling ?? maxGain(left.cards)) && round < 3) return outcomeScore(breakdown, base - roundStake(rival, own), lives, left, right);
  const handTempo = (left.cards.length - right.cards.length) * W.defaultPower * W.handTempo;
  const pressure = lead + handTempo;
  const uncertainty = W.scoreScale + (left.turns + right.turns) * W.uncertaintyPerTurn;
  const stake = pressure >= 0 ? roundStake(own, rival) : roundStake(rival, own);
  const influence = W.roundInfluence[round - 1] * stake;
  const roundValue = influence * Math.tanh(pressure / uncertainty);
  // A R1 winner with a lead close to the rival's remaining reach can keep pushing.
  // Value closing that gap continuously so cheap pressure counts before a clinch.
  const push = (advantage, plan) => plan && advantage > 0
    ? W.life * Math.min(1, advantage / Math.max(W.defaultPower, plan.ceiling)) : 0;
  const pressureValue = roundValue + push(lead, leftPlan) - push(-lead, rightPlan);
  const total = base + Math.min(roundStake(own, rival), Math.max(-roundStake(rival, own), pressureValue));
  if (!breakdown) return total;
  // Apportion the nonlinear round estimate by each input's share of pressure.
  // At zero pressure, the limiting slope keeps offsetting contributions visible.
  const scale = pressure ? roundValue / pressure : influence / uncertainty;
  return describePosition(total, lives, left, right, scale, handTempo);
}

// Finished simulations clear the board. The round journal retains its last score.
export function positionStrength(state, side, round = state.round) {
  const other = opponent(side);
  const roundEnded = state.phase === 'finished' || state.round !== round;
  const scores = roundEnded && state.log.findLast((event) => event.type === 'round-end' && event.round === round)?.scores;
  return scores ? scores[side] - scores[other]
    : totalScore(state.players[side]) - totalScore(state.players[other]);
}
