import { handCount } from './bot-hand.js';
import { ROWS } from '../shared/card-metadata.js';
import { activeOrder, infectionDamage, opponent, statusCount, units } from '../engine/board.js';
import { rowEffectValue } from './bot-effect-value.js';
import { carryoverValue, coinValue, delayedCardValue, futureContext, leaderUses, leaderChargeValue } from './bot-future-value.js';
import { availableOrders } from '../effects/effects.js';
import { cardAbilities } from '../engine/events.js';
import { HAND_LIMIT, ROUND_DRAW, totalScore } from '../engine/match.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';

export function cardPotential(card) {
  const { aiHints, provision } = card.definition;
  const { deploy, endTurn, order } = cardAbilities(card);
  if (aiHints?.handPotential !== undefined) return aiHints.handPotential;
  return (card.power ?? (provision ?? W.defaultPower) * W.effectProvision)
    + (deploy ? W.deploy : 0) + (endTurn || order ? W.engine : 0);
}

function boardValue(state, side, context) {
  const player = state.players[side];
  const { passed } = context;
  const ready = new Set(passed ? [] : availableOrders(state, side).map(({ card }) => card.id));
  const enemy = state.players[opponent(side)];
  const rot = ROWS.reduce((sum, row) => {
    const effect = enemy.rowEffects?.[row];
    return sum + (effect?.type === 'rot' ? rowEffectValue(enemy, row, effect.remaining, false, context.opponentTurns) : 0);
  }, 0);
  const exposed = units(state, opponent(side)).filter(({ card }) => statusCount(card, 'target')).length;
  const plans = player.hand.some(({ definition }) => definition.keywords?.includes('Цель'));
  return context.own.reduce((sum, unit) => {
    const { card, row } = unit;
    const { definition, timer } = card;
    const abilities = cardAbilities(card);
    const endTurn = abilities.endTurn?.steps.every(({ action, target }) =>
      !['spawn', 'advance-growth', 'boost'].includes(action) && !(action === 'damage' && target?.scope === 'neighbors'));
    const orderValue = !passed && card.orderCharges === undefined
      ? (ready.has(card.id) ? W.readyOrder : activeOrder(unit) ? W.coolingOrder : 0) : 0;
    const delayed = delayedCardValue(context, card, row)
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
  }, rot + (passed ? 0 : leaderUses(context) * leaderChargeValue(context) + coinValue(context) + (plans ? exposed * W.markedTarget : 0)));
}

function handCards(player, play, roundChanged, growthTurns) {
  if (player.publicHandSize !== undefined) {
    const remaining = Math.max(0, handCount(player) - Number(play?.type === 'play'));
    const draw = roundChanged ? Math.min(ROUND_DRAW, player.publicDeckSize, HAND_LIMIT - remaining) : 0;
    const count = remaining + draw;
    return Array.from({ length: count }, () => W.defaultPower);
  }
  return player.hand.filter(({ id }) => id !== play?.cardId).map((card) =>
    cardPotential(card) + growthTurns * (cardAbilities(card).startTurnGrowth ?? 0));
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

function passOutcome(active, waiting, activeInfo, waitingInfo, round) {
  const lead = activeInfo.raw - waitingInfo.raw;
  const win = roundStake(active, waiting);
  const loss = -roundStake(waiting, active);
  if (lead > 0) return win;
  // A tied round costs both players a life. With one life each, it ends in a draw.
  const tie = active.lives === waiting.lives ? 0 : active.lives > waiting.lives ? win : loss;
  const pass = lead < 0 ? loss : tie;
  if (!activeInfo.cards.length) return pass;

  // Spend the fewest plays, then use the cheapest card that can close the gap.
  const cards = activeInfo.cards.toSorted((a, b) => a - b);
  let gain = activeInfo.score - waitingInfo.score;
  let spent = 0;
  while (gain <= 0 && cards.length) {
    const sufficient = cards.findIndex((points) => Math.max(W.minimumOutput, points) > -gain);
    const [points] = cards.splice(sufficient < 0 ? cards.length - 1 : sufficient, 1);
    gain += Math.max(W.minimumOutput, points);
    spent += 1;
  }
  if (gain <= 0) return pass;
  const cost = activeInfo.reserve - reserve(active, cards, round);
  const confidence = spent <= W.cheapCatchupCards ? W.cheapConversion : W.projectedConversion;
  return Math.max(pass, confidence * win + (1 - confidence) * loss - cost);
}

// A caller can score a cheap one-move projection for rollout policy. The full search
// supplies a state already advanced by the engine. Hidden cards must be masked or sampled first.
export function evaluatePosition(state, side, projection) {
  if (state.phase === 'finished' && state.result) {
    if (state.result === 'draw') return 0;
    return (state.result === (side === 'human' ? 'win' : 'loss') ? 1 : -1) * W.matchWin;
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
    const cards = handCards(player, move, state.phase === 'mulligan', growthTurns);
    const raw = totalScore(player) + (move?.gain ?? 0);
    return {
      passed, cards, turns: context.turns, raw,
      score: raw + W.futureBoard * boardValue(state, key, context),
      reserve: round === 3 && (passed || !context.turns) ? 0 : reserve(player, cards, round),
      carry: round < 3 ? carryoverValue(context, passed) : 0,
    };
  };
  const left = info(side, own);
  const right = info(other, rival);
  const base = W.life * (own.lives - rival.lives) + left.reserve - right.reserve + left.carry - right.carry;
  if (left.passed && right.passed) {
    if (left.raw > right.raw) return rival.lives === 1 ? W.matchWin : base + W.life;
    if (right.raw > left.raw) return own.lives === 1 ? -W.matchWin : base - W.life;
    if (own.lives === 1 || rival.lives === 1) return Math.sign(own.lives - rival.lives) * W.matchWin;
    return base;
  }
  if (left.passed) {
    if (own.lives === 1 && (right.raw > left.raw || right.raw === left.raw && rival.lives > own.lives)) return -W.matchWin;
    return base - passOutcome(rival, own, right, left, round);
  }
  if (right.passed) {
    if (rival.lives === 1 && (left.raw > right.raw || left.raw === right.raw && own.lives > rival.lives)) return W.matchWin;
    return base + passOutcome(own, rival, left, right, round);
  }

  const lead = left.score - right.score;
  const maxGain = (cards) => cards.reduce((sum, points) => sum + Math.max(W.minimumOutput, points), 0);
  if (lead > maxGain(right.cards) && round < 3) return base + roundStake(own, rival);
  if (-lead > maxGain(left.cards) && round < 3) return base - roundStake(rival, own);
  const pressure = lead + (left.cards.length - right.cards.length) * W.defaultPower * W.handTempo;
  const uncertainty = W.scoreScale + (left.turns + right.turns) * W.uncertaintyPerTurn;
  const stake = pressure >= 0 ? roundStake(own, rival) : roundStake(rival, own);
  return base + W.roundInfluence[round - 1] * stake * Math.tanh(pressure / uncertainty);
}

// Finished simulations clear the board. The round journal retains its last score.
export function positionStrength(state, side, round = state.round) {
  const other = opponent(side);
  const roundEnded = state.phase === 'finished' || state.round !== round;
  const scores = roundEnded && state.log.findLast((event) => event.type === 'round-end' && event.round === round)?.scores;
  return scores ? scores[side] - scores[other]
    : totalScore(state.players[side]) - totalScore(state.players[other]);
}
