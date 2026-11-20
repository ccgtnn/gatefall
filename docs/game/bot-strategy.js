import { ROWS } from './cards.js';
import { cardType, units } from './board.js?v=step-10';
import { availableOrders, canUseLeader } from './effects.js?v=step-10';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, applyAction, playableCards, totalScore } from './match.js?v=step-10';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
const SIMULATION = { random: () => .5 };
const HIDDEN_CARD = { definition: { type: 'effect', deploy: { steps: [] } } };

function publicMatch(match) {
  const { bot, human } = match.players;
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: [...bot.deck].sort((a, b) => a.id.localeCompare(b.id)), discard: [], exile: [] },
      human: {
        lives: human.lives, board: human.board, passed: human.passed, turns: human.turns,
        usedAbility: human.usedAbility, leader: human.leader, deck: [], discard: [], exile: [],
        hand: Array(human.hand.length).fill(HIDDEN_CARD),
      },
    },
  };
}

function resolveChoices(state, pickTarget) {
  // Selections can queue other selections through deathwish and order effects.
  while (state.pending) {
    const next = applyAction(state, state.pending.side, pickTarget(state), SIMULATION);
    if (next === state) break;
    state = next;
  }
  return state;
}

function simulate(match, action, pickTarget) {
  const next = resolveChoices(applyAction(match, match.pending?.side ?? 'bot', action, SIMULATION), pickTarget);
  if (next.phase !== 'playing' || next.turn !== 'bot' || !next.playedCard || next.pending) return next;
  return resolveChoices(applyAction(next, 'bot', END, SIMULATION), pickTarget);
}

function margin(state) {
  const result = state.log.findLast(({ type }) => type === 'round-end');
  if (result) return result.scores.bot - result.scores.human;
  return totalScore(state.players.bot) - totalScore(state.players.human);
}

function value(state) {
  const score = margin(state);
  if (state.phase !== 'playing' || state.players.human.passed) return score;
  const armor = (side) => units(state, side).reduce((sum, { card }) => sum + (card.armor ?? 0), 0);
  return score + .16 * (armor('bot') - armor('human'));
}

function plays(state) {
  const { board } = state.players.bot;
  return playableCards(state, 'bot').flatMap((card) => {
    const cost = (card.definition.provision ?? 4) + (card.power ?? 0) * .15;
    const action = { type: 'play', cardId: card.id };
    if (cardType(card) === 'effect') return [{ action, cost }];
    return ROWS.flatMap((row) => board[row].length >= ROW_LIMIT ? [] :
      Array.from({ length: board[row].length + 1 }, (_, position) =>
        ({ action: { ...action, row, position }, cost })));
  });
}

function rankPlays(state, pickTarget, costWeight) {
  return plays(state).map(({ action, cost }) => {
    const next = simulate(state, action, pickTarget);
    const played = state.players.bot.hand.find(({ id }) => id === action.cardId);
    const larvae = played.definition.id === 'broodlord'
      ? state.players.bot.board[action.row].filter(({ definition }) => definition.id === 'larva').length : null;
    const preserveFinisher = larvae !== null && larvae < 3 && state.round < 3 && !state.players.human.passed;
    return { action, cost, next, rating: value(next) - costWeight * cost - (preserveFinisher ? 2 : 0) };
  }).sort((a, b) => b.rating - a.rating || a.cost - b.cost);
}

function lookAhead(candidates, pickTarget, opponentPassed, limit = 4) {
  const tried = new Set();
  const lines = [];
  for (const first of candidates) {
    const { next, action } = first;
    if (tried.has(action.cardId) || next.phase !== 'playing' || next.pending || next.players.bot.passed) continue;
    tried.add(action.cardId);
    // Estimate a follow-up on the visible board. When the opponent is still active,
    // this is a setup estimate, with no assumptions about their hidden cards.
    const after = { ...next, log: [], turn: 'bot', playedCard: false };
    const following = rankPlays(after, pickTarget, opponentPassed ? 0 : .16);
    const winning = opponentPassed ? following.filter(({ next }) => margin(next) > 0)
      .sort((a, b) => a.cost - b.cost)[0] : null;
    if (following.length) lines.push({ first, second: winning ?? following[0], wins: Boolean(winning) });
    if (tried.size === limit) break;
  }
  return lines;
}

function bestAbility(state, pickTarget, oldAction, afterPlay) {
  const actions = availableOrders(state, 'bot').map(({ card }) => ({ type: 'order', cardId: card.id }));
  if (!afterPlay && canUseLeader(state, 'bot')) actions.push({ type: 'leader' });
  if (!actions.length) return null;
  const baseline = afterPlay ? value(simulate(state, END, pickTarget)) : value(state);
  const ranked = actions.map((action) => ({ action, gain: value(simulate(state, action, pickTarget)) - baseline }))
    .sort((a, b) => b.gain - a.gain);
  if (ranked[0]?.gain > .65) return ranked[0].action;
  if (oldAction.type === 'order' && ranked.some(({ action, gain }) => action.cardId === oldAction.cardId && gain > 0)) {
    return oldAction;
  }
  return null;
}

export function chooseStrategicTarget(match, pickTarget) {
  if (match.pending.side !== 'bot') return pickTarget(match);
  const state = publicMatch(match);
  const preferred = pickTarget(match);
  let best = preferred;
  let score = -Infinity;
  const { kind, options } = match.pending;
  const actions = kind === 'deck-placement' ? options.flatMap((row) =>
    Array.from({ length: state.players.bot.board[row].length + 1 }, (_, position) =>
      ({ type: 'place', row, position }))) : options.filter((id) => id !== preferred.cardId)
    .map((cardId) => ({ type: 'target', cardId }));
  for (const action of [preferred, ...actions]) {
    const rating = value(simulate(state, action, pickTarget));
    if (rating > score) {
      score = rating;
      best = action;
    }
  }
  return best;
}

export function chooseStrategicTurn(match, difficulty, pickTarget, oldAction) {
  const { bot, human } = match.players;
  const { round } = match;
  const hard = difficulty === 'hard';
  const lead = totalScore(bot) - totalScore(human);
  const canPass = !bot.usedAbility && !match.playedCard;
  if (canPass && human.passed && lead > 0) return PASS;

  const previousRound = match.log.findLast(({ type }) => type === 'round-end');
  const dryPass = round === 2 && previousRound?.winner === 'bot';
  if (canPass && dryPass && !human.passed) return PASS;

  const roundStart = match.log.findLastIndex(({ type }) => type === 'round-start');
  const spent = match.log.slice(roundStart + 1).filter(({ type, side, from }) => type === 'play' && side === 'bot' && from !== 'deck').length;
  const budget = hard ? 4 : 3;
  const average = Math.max(3, bot.hand.reduce((sum, card) => sum + (card.power ?? 4), 0) / Math.max(1, bot.hand.length));
  if (canPass && round === 1 && (spent >= budget || (!human.passed && lead > average))) return PASS;

  const state = publicMatch(match);
  if (match.playedCard) {
    return (human.passed && lead > 0 ? null : bestAbility(state, pickTarget, oldAction, true)) ?? END;
  }

  const ranked = rankPlays(state, pickTarget, round === 1 ? .33 : .12);
  const best = ranked[0];
  const ability = bestAbility(state, pickTarget, oldAction, false);
  if (!best) return ability ?? oldAction;
  const bestGain = Math.max(0, ...ranked.map(({ next }) => margin(next) - lead));
  const expectedCards = bestGain > 0 ? Math.max(1, Math.ceil((1 - lead) / bestGain)) : Infinity;
  const affordable = (cards) => Math.min(HAND_LIMIT, bot.hand.length - cards + ROUND_DRAW) + (hard ? 1 : 0)
    >= Math.min(HAND_LIMIT, human.hand.length + ROUND_DRAW);

  if (canPass && round === 1 && !human.passed && lead < -average &&
      (!affordable(expectedCards) || expectedCards > budget - spent)) return PASS;

  if (human.passed) {
    const winning = ranked.filter(({ next }) => margin(next) > 0).sort((a, b) => a.cost - b.cost)[0];
    if (winning && (!canPass || round > 1 || affordable(1))) return winning.action;

    const twoTurnWin = hard ? lookAhead(ranked, pickTarget, true)
      .filter(({ wins }) => wins).sort((a, b) => a.first.cost + a.second.cost - b.first.cost - b.second.cost)[0] : null;
    if (twoTurnWin && (!canPass || !dryPass && (round > 1 || (spent + 2 <= budget && affordable(2))))) {
      return twoTurnWin.first.action;
    }
    if (canPass && (dryPass || (round === 1 && (expectedCards > budget - spent || !affordable(expectedCards))))) {
      return PASS;
    }
    return ability ?? best.action;
  }

  if (ability) return ability;
  if (!hard) return best.action;
  const combo = lookAhead(ranked, pickTarget, false)
    .sort((a, b) => b.first.rating + .45 * (b.second.rating - value(b.first.next))
      - a.first.rating - .45 * (a.second.rating - value(a.first.next)))[0];
  return combo?.first.action ?? best.action;
}
