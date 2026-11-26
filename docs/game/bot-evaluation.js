import { ROWS } from './card-metadata.js';
import { activeOrder, infectionDamage, opponent, statusCount, units } from './board.js';
import { rowEffectValue } from './bot-effect-value.js';
import { carryoverValue, delayedCardValue, futureContext } from './bot-future-value.js';
import { availableOrders } from './effects.js';
import { cardAbilities } from './events.js';
import { HAND_LIMIT, ROUND_DRAW, totalScore } from './match.js';

export const EVAL_WEIGHTS = Object.freeze({
  matchWin: 100,
  life: 22,
  eliminationStake: 44,
  roundInfluence: Object.freeze([.50, .72, 1]),
  handReserve: Object.freeze([1.20, 1, .16]),
  cardBase: 3,
  cardPower: .65,
  defaultPower: 5.5,
  effectProvision: .7,
  deploy: 1,
  engine: 1.5,
  handGrowthTurns: 4,
  minimumOutput: 3,
  handTempo: .40,
  futureBoard: 1,
  scoreScale: 10,
  uncertaintyPerTurn: 1,
  projectedConversion: .78,
  cheapConversion: .98,
  cheapCatchupCards: 2,
  carriedUnit: .64,
  carriedLeader: 1.6,
  carriedArmor: .12,
  carriedShield: .4,
  carriedCoins: .35,
  readyOrder: 1.15,
  coolingOrder: .35,
  markReaction: 1.25,
  endTurn: 1.25,
  timerTurn: .5,
  timerLimit: 3,
  scenarioChapter: 2.5,
  deathReaction: 1.25,
  infection: .72,
  leaderThisRound: .9,
  markedTarget: .65,
  removalReserve: 1.5,
  inheritedWish: .4,
  visibleReply: .88,
  endTurnTie: .08,
  targetPriority: .65,
  targetPenaltyCap: 8,
  handChoice: .5,
  armorChoice: .4,
  consumeChoice: .24,
  consumeCap: 6,
  rolloutShare: .55,
  rolloutScale: 22,
});
const W = EVAL_WEIGHTS;

export function cardPotential(card) {
  const { aiHints, provision } = card.definition;
  const { deploy, endTurn, order } = cardAbilities(card);
  if (aiHints?.handPotential !== undefined) return aiHints.handPotential;
  return (card.power ?? (provision ?? W.defaultPower) * W.effectProvision)
    + (deploy ? W.deploy : 0) + (endTurn || order ? W.engine : 0);
}

function boardValue(state, side, context) {
  const player = state.players[side];
  if (player.passed) return 0;
  const ready = new Set(availableOrders(state, side).map(({ card }) => card.id));
  const enemy = state.players[opponent(side)];
  const rot = ROWS.reduce((sum, row) => {
    const effect = enemy.rowEffects?.[row];
    return sum + (effect?.type === 'rot' ? rowEffectValue(enemy, row, effect.remaining, false) : 0);
  }, 0);
  const exposed = units(state, opponent(side)).filter(({ card }) => statusCount(card, 'target')).length;
  const plans = player.hand.some(({ definition }) => definition.keywords?.includes('Цель'));
  return context.own.reduce((sum, unit) => {
    const { card, row } = unit;
    const { definition, timer } = card;
    const abilities = cardAbilities(card);
    const endTurn = abilities.endTurn?.steps.every(({ action }) => !['spawn', 'advance-growth', 'boost'].includes(action));
    return sum + delayedCardValue(context, card, row) + (definition.aiHints?.boardBonus ?? 0)
      + (ready.has(card.id) ? W.readyOrder : activeOrder(unit) ? W.coolingOrder : 0)
      + (row === 'orbit' && abilities.fieldEvents?.['target-marked'] ? W.markReaction : 0)
      + (context.turns && endTurn && (!definition.aiHints?.endTurnNeedsMarkedEnemy || exposed) ? (timer === undefined ? W.endTurn : W.timerTurn * Math.min(timer, W.timerLimit)) : 0)
      + (abilities.scenario ? Math.min(definition.scenario.chapters.length - (card.chapter ?? 0),
        player.hand.filter((entry) => entry.definition.categories?.includes(definition.scenario.category)).length) * W.scenarioChapter : 0)
      + (abilities.fieldEvents?.death && ROWS.some((row) =>
        enemy.board[row].some((entry) => entry.statuses?.infection)) ? W.deathReaction : 0)
      - W.infection * infectionDamage(card, Math.min(context.turns, statusCount(card, 'infection')));
  }, Math.min(player.leader?.charges ?? 0, context.turns) * W.leaderThisRound +
    (context.turns ? (player.coins ?? 0) * context.coinWeight : 0) + rot + (plans ? exposed * W.markedTarget : 0));
}

function handCards(player, play, roundChanged, growthTurns) {
  if (player.publicHandSize !== undefined) {
    const remaining = Math.max(0, player.publicHandSize - Number(!player.hand.length));
    const draw = roundChanged ? Math.min(ROUND_DRAW, player.publicDeckSize, HAND_LIMIT - remaining) : 0;
    const count = remaining + draw;
    return Array.from({ length: count }, () => W.defaultPower);
  }
  return player.hand.filter(({ id }) => id !== play?.cardId).map((card) =>
    cardPotential(card) + growthTurns * (cardAbilities(card).startTurnGrowth ?? 0));
}

function reserve(player, cards, round) {
  const worth = cards.reduce((sum, points) => sum + W.cardBase + W.cardPower * points, 0);
  const deckCount = player.publicDeckSize ?? player.deck.length;
  const overflow = round < 3 ? Math.max(0, cards.length + Math.min(ROUND_DRAW, deckCount) - HAND_LIMIT) : 0;
  return (worth - overflow * (W.cardBase + W.cardPower * W.defaultPower)) * W.handReserve[round - 1];
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
  if (!activeInfo.cards.length) return lead < 0 ? loss : 0;

  // Spend the fewest plays, then use the cheapest card that can close the gap.
  const cards = activeInfo.cards.toSorted((a, b) => a - b);
  let gain = lead;
  let spent = 0;
  while (gain <= 0 && cards.length) {
    const sufficient = cards.findIndex((points) => Math.max(W.minimumOutput, points) > -gain);
    const [points] = cards.splice(sufficient < 0 ? cards.length - 1 : sufficient, 1);
    gain += Math.max(W.minimumOutput, points);
    spent += 1;
  }
  if (gain <= 0) return lead < 0 ? loss : 0;
  const cost = activeInfo.reserve - reserve(active, cards, round);
  const confidence = spent <= W.cheapCatchupCards ? W.cheapConversion : W.projectedConversion;
  return Math.max(lead < 0 ? loss : 0, confidence * win + (1 - confidence) * loss - cost);
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
  const info = (key, player) => {
    const move = projectedSide === key ? projection : undefined;
    const context = futureContext(state, key);
    const passed = player.passed || move?.type === 'pass';
    const growthTurns = round < 3 && !passed ? Math.min(W.handGrowthTurns, context.turns) : 0;
    const cards = handCards(player, move, state.phase === 'mulligan', growthTurns);
    const raw = totalScore(player) + (move?.gain ?? 0);
    return {
      passed, cards, turns: context.turns, raw,
      score: raw + (passed ? 0 : W.futureBoard * boardValue(state, key, context)),
      reserve: reserve(player, cards, round),
      carry: round < 3 ? carryoverValue(context, W) : 0,
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
    if (own.lives === 1 && right.raw > left.raw) return -W.matchWin;
    return base - passOutcome(rival, own, right, left, round);
  }
  if (right.passed) {
    if (rival.lives === 1 && left.raw > right.raw) return W.matchWin;
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
