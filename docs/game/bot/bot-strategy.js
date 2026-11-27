import { handCount } from './bot-hand.js';
import { leaderTargetPriority, offeringPriority } from './bot-leaders.js';
import { cardPotential, evaluateBreakdown, evaluatePosition, positionStrength } from './bot-evaluation.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';
import { compareRollouts, visibleSupply } from './bot-rollouts.js';
import { ROWS } from '../shared/card-metadata.js';
import { cardType, createCard, findUnit, placementSide } from '../engine/board.js';
import { availableFees, availableOrders, canUseLeader } from '../effects/effects.js';
import { rowArmor } from '../effects/effect-queries.js';
import { armorTargetPriority, beneficialFee, cleansePriority, deckCardValue, destructionRolls, destructionSwing, infectionGain, holdUntargetedDamage, lockPriority, pendingUnitPriority, shouldProtectArmor, usefulWeatherOrder, tributeOptions } from './bot-effect-value.js';
import { cardAbilities } from '../engine/events.js';
import { ROW_LIMIT, applyAction, availableRows, canEndTurn, canPass, playableCards, totalScore } from '../engine/match.js';

import { armorBreakSwing, consumeBonus, futureContext, remainingTurns, wantsToHoldInheritance } from './bot-future-value.js';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
const SIMULATION = { random: () => .5 };
const UNKNOWN_PLAY = createCard('unknown-play', {
  id: 'unknown-play', name: 'Неизвестная карта', type: 'unit', power: W.defaultPower,
});

export function botSearchState(match, knowsDeckList = false) {
  const { bot, human } = match.players;
  if (human.publicHandSize !== undefined) {
    if (knowsDeckList || (!human.knownDeck && !Object.keys(human.startingCategories ?? {}).length)) return match;
    return { ...match, players: { ...match.players,
      human: { ...human, startingCategories: {}, knownDeck: undefined } } };
  }
  const knownDeck = knowsDeckList && human.startingDeck
    ? visibleSupply(match, true, true).map(({ card }) => card) : undefined;
  return {
    ...match,
    // Draw and hand-bottom journal entries include private cards for playback.
    // The search only needs public plays for faction-based sampling.
    log: match.log.filter(({ type }) => type === 'play'),
    players: {
      bot: { ...bot, startingDeck: undefined, deck: bot.deck.toSorted((a, b) => a.id.localeCompare(b.id)) },
      human: { ...human, startingDeck: undefined, startingCategories: knowsDeckList ? human.startingCategories : {}, knownDeck, deck: [],
        publicHandSize: handCount(human), publicDeckSize: human.deck.length, handMasked: true,
        hand: human.hand.map((_, index) => ({ ...UNKNOWN_PLAY, id: `unknown-play-${index}` })) },
    },
  };
}

export function publicMatch(match, knowsDeckList = false) {
  const state = botSearchState(match, knowsDeckList);
  const { bot, human } = state.players;
  return { ...state, log: [], players: { bot: { ...bot, exile: [] }, human: { ...human, exile: [] } } };
}

function usesNeighbors(ability) {
  return ability?.steps.some((step) => step.target?.scope === 'neighbors' ||
    step.receiver?.scope === 'neighbors' || step.action === 'spawn')
    || ability?.select?.some((pick) => pick.targets.scope === 'neighbors');
}

function positions(player, row, card) {
  const line = player.board[row];
  const valid = new Set([line.length, 0]);
  const adjacent = usesNeighbors(cardAbilities(card).deploy) || usesNeighbors(cardAbilities(card).endTurn);
  for (let i = 1; i < line.length; i += 1) {
    const neighbors = [line[i - 1], line[i]].map(cardAbilities);
    if (adjacent || neighbors.some((def) => usesNeighbors(def.endTurn) || def.neighborEvents)) valid.add(i);
  }
  return [...valid];
}

function placements(state, side, card, rows = ROWS) {
  const player = state.players[placementSide(side, card)];
  const preferred = card.definition.preferredRow;
  const required = card.definition.requiredRow;
  if (required) rows = rows.filter((row) => row === required);
  else if (rows.includes(preferred) && player.board[preferred].length < ROW_LIMIT) rows = [preferred];
  return rows.flatMap((row) => player.board[row].length >= ROW_LIMIT ? [] : positions(player, row, card)
    .map((position) => ({ row, position })));
}

function plays(state, side) {
  const player = state.players[side];
  const seen = new Set();
  const legal = holdUntargetedDamage(state, side, playableCards(state, side).filter((card) => {
    if (player.handMasked) {
      if (seen.has(card.definition.id)) return false;
      seen.add(card.definition.id);
    }
    return state.round === 3 || player.usedAbility || !(destructionSwing(state, side, card) < 0);
  }));
  const context = futureContext(state, side);
  const options = legal.filter((card) => !wantsToHoldInheritance(context, card, legal)).map((card) => {
      const action = { type: 'play', cardId: card.id };
      const cost = (card.definition.provision ?? 4) + (card.power ?? 0) * .15;
      if (cardType(card) === 'effect') return [{ action, cost }];
      return placements(state, side, card).map((placement) => ({ action: { ...action, ...placement }, cost }));
    });
  // Visit a placement for every card before spending the budget on extra positions.
  return Array.from({ length: Math.max(0, ...options.map((group) => group.length)) }, (_, index) =>
    options.flatMap((group) => group[index] ? [group[index]] : [])).flat();
}

function abilities(state, side) {
  const actions = availableOrders(state, side).filter((unit) => usefulWeatherOrder(state, side, unit)).map(({ card }) => ({ type: 'order', cardId: card.id }));
  actions.push(...availableFees(state, side).map(({ card }) => ({ type: 'fee', cardId: card.id })));
  if (canUseLeader(state, side)) actions.push({ type: 'leader' });
  return actions;
}

function targetPriority(state) {
  const { kind, side } = state.pending;
  const leaderPriority = leaderTargetPriority(state, side, kind);
  const priorities = {
    lock: (unit) => lockPriority(state, side, unit),
    cleanse: cleansePriority,
    armor: (unit) => armorTargetPriority(state, side, unit),
    'leader-offering': (unit) => offeringPriority(state, side, unit, state.pending.amount),
    'infection-target': ({ card, side: targetSide }) =>
      infectionGain(card, state.pending.amount, remainingTurns(state, targetSide)),
  };
  return leaderPriority ?? priorities[kind] ?? pendingUnitPriority(state, state.pending);
}

function choices(state, all = false) {
  const { kind, options: legal, side, cardId, cards, pile = 'deck' } = state.pending;
  if (kind === 'tribute') return tributeOptions(state).slice(0, all ? Infinity : 3).map(({ cardId }) => ({ type: 'target', cardId }));
  const allies = kind === 'transform' ? legal.filter((id) => findUnit(state, id)?.side === side) : [];
  const options = allies.length ? allies : legal;
  const priority = targetPriority(state);
  if (priority) {
    const ranked = options.map((id) => ({ id, score: priority(findUnit(state, id), side) }))
      .sort((a, b) => b.score - a.score);
    const eligible = kind === 'lock' ? ranked.filter(({ score }) => score === ranked[0].score) : ranked;
    return eligible.slice(0, all ? Infinity : 3)
      .map(({ id }) => ({ type: 'target', cardId: id }));
  }
  if (kind === 'deck-placement') {
    const card = (cards ?? state.players[side][pile]).find((item) => item.id === cardId);
    return placements(state, side, card, options).map((destination) => ({ type: 'place', ...destination }));
  }
  if (state.pending.fullDeck) {
    const legal = new Set(options);
    return state.players[side].deck.filter(({ id }) => legal.has(id))
      .map((card) => ({ id: card.id, value: deckCardValue(state, side, card) }))
      .sort((a, b) => b.value - a.value).map(({ id }) => ({ type: 'target', cardId: id }));
  }
  const ids = kind === 'deck-top'
    ? state.players[side].deck.filter(({ id }) => options.includes(id))
      .sort((a, b) => cardPotential(b) - cardPotential(a)).map(({ id }) => id)
    : options;
  return ids.map((id) => ({ type: 'target', cardId: id }));
}

function removalShortfall(before, after, actor, card) {
  const reserve = card?.definition?.removalReserve;
  if (actor !== 'bot' || !reserve) return 0;
  if (before.players.human.passed) {
    const result = after.log.findLast(({ type }) => type === 'round-end');
    if (result ? result.winner === 'bot' : totalScore(after.players.bot) > totalScore(after.players.human)) return 0;
  }
  let swing = 0;
  for (const event of after.log.slice(before.log.length)) {
    if (event.sourceDefinitionId !== card.definition.id) continue;
    const lost = event.type === 'damage' ? event.lost
      : event.reason === 'destroy' || event.type === 'discard' ? event.power ?? 0 : 0;
    swing += event.side === actor ? -lost : lost;
  }
  return Math.max(0, reserve - swing);
}

function choicePreference(state, side, action) {
  if (action.type !== 'target') return 0;
  const { kind, amount } = state.pending ?? {};
  if (kind === 'tribute') {
    const ranked = tributeOptions(state);
    const chosen = ranked.find(({ cardId }) => cardId === action.cardId);
    return chosen ? chosen.score - ranked[0].score : 0;
  }
  const priority = state.pending && targetPriority(state);
  if (priority) return priority(findUnit(state, action.cardId), side);
  if (kind === 'hand-bottom' || kind === 'hand-return') {
    const card = state.players[side].hand.find(({ id }) => id === action.cardId);
    return card ? -deckCardValue(state, side, card) : 0;
  }
  if (kind === 'armor-row') return state.players[side].board[action.cardId]
    .reduce((sum, card) => sum + (armorBreakSwing(card) ?? 0), 0);
  if (kind !== 'consume' && kind !== 'spend-armor') return 0;
  const victim = findUnit(state, action.cardId);
  if (!victim) return 0;
  if (kind === 'consume') return consumeBonus(futureContext(state, side), victim);
  if (kind === 'spend-armor' && victim.card.armor <= (amount || Infinity)) {
    return armorBreakSwing(victim.card) ?? 0;
  }
  return 0;
}

// After the opponent passes, the round result depends only on our next decisions.
// Finish it greedily through the engine (pass when ahead, else the cheapest single play
// that takes the lead, then pass) so every candidate is rated in the next round's terms.
function resolveTurn(match, side, move) {
  let next = applyAction(match, side, move, SIMULATION);
  for (let guard = 0; next !== match && next.pending && guard < 12; guard++) {
    const [choice] = choices(next);
    const after = choice && applyAction(next, next.pending.side, choice, SIMULATION);
    if (!after || after === next) return match;
    next = after;
  }
  if (!next.pending && next.turn === side && canEndTurn(next, side)) next = applyAction(next, side, END, SIMULATION);
  return next;
}

function settleWonRound(match, side, round, depth = 0) {
  const rival = side === 'bot' ? 'human' : 'bot';
  if (round === 3 || match.phase !== 'playing' || match.round !== round || match.pending || match.turn !== side ||
      !match.players[rival].passed || !canPass(match, side)) return match;
  const lead = () => totalScore(match.players[side]) - totalScore(match.players[rival]);
  if (lead() > 0) {
    const after = applyAction(match, side, PASS, SIMULATION);
    return after === match ? match : after;
  }
  if (depth >= 1) return match;
  let best;
  const tried = new Set();
  for (const { action, cost } of plays(match, side)) {
    if (tried.has(action.cardId) || (best && cost >= best.cost)) continue;
    tried.add(action.cardId);
    const next = resolveTurn(match, side, action);
    if (next === match || next.phase !== 'playing' || next.round !== round || next.turn !== side) continue;
    if (totalScore(next.players[side]) > totalScore(next.players[rival])) best = { next, cost };
  }
  return best ? settleWonRound(best.next, side, round, depth + 1) : match;
}

function evaluateAction(state, side, action, search) {
  const choiceValue = choicePreference(state, side, action);
  const finalRound = state.round === 3;
  const strength = finalRound ? positionStrength(state, side) : 0;
  function finish(next, depth, move) {
    const actor = next.pending?.side ?? next.turn;
    if (depth >= 36 || (!next.pending && (next.phase !== 'playing' || actor !== side ||
        next.players[side].turns !== state.players[side].turns))) {
      const rating = evaluatePosition(settleWonRound(next, side, state.round), 'bot');
      const contribution = finalRound ? positionStrength(next, side, state.round) - strength : 0;
      return { next, rating, contribution };
    }

    let actions;
    if (next.pending) actions = choices(next);
    else if (canEndTurn(next, side)) actions = [END, ...abilities(next, side)];
    else {
      actions = plays(next, side).map(({ action }) => action);
      if (move.type === 'fee') {
        const ready = availableOrders(next, side).find(({ card }) => card.id === move.cardId);
        if (ready) actions.unshift({ type: 'order', cardId: move.cardId });
      }
    }

    let best;
    for (const continuation of actions) {
      if (search.expired()) break;
      const result = advance(next, actor, continuation, depth + 1);
      if (result && (!best || (result.rating === best.rating ? result.contribution > best.contribution
        : actor === 'bot' ? result.rating > best.rating : result.rating < best.rating))) best = result;
    }
    return best;
  }
  function advance(before, actor, move, depth) {
    const card = move.type === 'play' && before.players[actor].hand.find(({ id }) => id === move.cardId);
    const rolls = destructionRolls(before, actor, card);
    let worst;
    let worstRating;
    let total = 0;
    let contribution = 0;
    let shortfall = 0;
    for (const roll of rolls) {
      if (rolls.length > 1 && search.expired()) return;
      const next = applyAction(before, actor, move, roll === .5 ? SIMULATION : { random: () => roll });
      const result = next !== before && finish(next, depth, move);
      if (!result) return;
      shortfall += removalShortfall(before, result.next, actor, card);
      total += result.rating;
      contribution += result.contribution;
      if (!worst || (actor === 'bot' ? result.rating < worstRating : result.rating > worstRating)) {
        worst = result.next;
        worstRating = result.rating;
      }
    }
    const reserveCost = shortfall / rolls.length;
    return { next: worst, rating: total / rolls.length - reserveCost * W.removalReserve, contribution: contribution / rolls.length, reserveCost, choiceValue };
  }
  return advance(state, side, action, 0);
}

function deadline(time) {
  const end = performance.now() + time;
  return { expired: () => performance.now() >= end };
}

function searchLimit(random) {
  // Keep the time limits for normal play. A supplied generator uses fixed work limits
  // so the same seed is reproducible even when the host is under different load.
  if (!random) return (budget) => deadline(budget * .98);
  return (budget) => {
    let checks = budget * 4;
    return { expired: () => checks-- <= 0 };
  };
}

function rankPlays(state, search, limit, level) {
  const ranked = [];
  for (const { action, cost } of plays(state, 'bot').slice(0, level.candidates)) {
    if (search.expired()) break;
    const local = limit(Math.max(15, level.budgetMs / 40));
    const candidate = evaluateAction(state, 'bot', action, { expired: () => search.expired() || local.expired() });
    if (candidate) ranked.push({ ...candidate, action, cost });
  }
  return ranked.sort((a, b) => b.rating - a.rating || a.cost - b.cost);
}

function rankAbilities(state, search, level) {
  const ranked = [];
  const { bot, human } = state.players;
  const finish = state.round === 3 && !handCount(bot) && human.passed;
  const usefulFee = beneficialFee(state, 'bot', { allCoinsSurplus: finish });
  for (const action of abilities(state, 'bot').slice(0, level.candidates)) {
    if (search.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, search);
    if (candidate) {
      const tie = action.type === 'fee' && action.cardId === usefulFee?.cardId ? W.feeTie : 0;
      ranked.push({ ...candidate, rating: candidate.rating + tie, action });
    }
  }
  return ranked.sort((a, b) => b.rating - a.rating);
}

function replyRating(candidate, search, level) {
  const state = candidate.next;
  if (state.phase !== 'playing' || state.turn !== 'human' || state.players.human.passed) return candidate.rating;
  const actions = [...plays(state, 'human').map(({ action }) => action), ...abilities(state, 'human')];
  if (!actions.length) actions.push(PASS);
  let worst = Infinity;
  for (const action of actions.slice(0, level.candidates)) {
    if (search.expired()) break;
    const response = evaluateAction(state, 'human', action, search);
    if (response) worst = Math.min(worst, response.rating);
  }
  return Number.isFinite(worst) ? candidate.rating + W.visibleReply * (worst - evaluatePosition(state, 'bot')) : candidate.rating;
}

function report(options, action, reason, candidates = [], state) {
  if (options.onDecision) {
    const baseline = candidates.length ? evaluateBreakdown(state, 'bot').parts : undefined;
    options.onDecision({
      action, reason,
      candidates: candidates.slice(0, 3).map(({ action, rating, average, samples, next }) => {
        const { parts } = evaluateBreakdown(next, 'bot');
        const changes = Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value - baseline[key]]));
        return { action, score: average === undefined ? rating : 100 * average, samples, changes };
      }),
    });
  }
  return action;
}

function preservesArmor(candidate, player) {
  const { action } = candidate;
  const card = player.hand.find(({ id }) => id === action.cardId);
  if (!shouldProtectArmor(card, player)) return true;
  const other = ROWS.find((row) => row !== action.row);
  return player.board[other].length >= ROW_LIMIT || rowArmor(player, action.row) <= rowArmor(player, other);
}

// Rank complete turns first. Keep only the strongest placement per card and row for trials.
function distinct(candidates, key) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const id = key(candidate.action);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function selectRanked(options, level, ranked, reason, state) {
  const best = ranked[0];
  const random = options.random ?? Math.random;
  if (level.errorRate > 0 && ranked.length > 1 && random() < level.errorRate) {
    const pass = ranked.find(({ action }) => action.type === 'pass');
    if (pass && best !== pass && level.passMistakeRate > 0 && random() < level.passMistakeRate) {
      return report(options, pass.action, 'Ошибаюсь с моментом паса.', ranked, state);
    }
    const choices = distinct(ranked, (action) => [action.type, action.cardId ?? action.row].join('/'));
    const pool = (choices.length > 1 ? choices : ranked).slice(1, level.errorPool);
    if (pool.length) {
      const choice = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
      return report(options, choice.action, 'Выбираю ход с более низкой оценкой.', ranked, state);
    }
  }
  return report(options, best.action, best.action.type === 'pass' ? 'Пас сохраняет лучшую позицию на матч.' : reason, ranked, state);
}

function forecast(match, ranked, level, search, options) {
  if (ranked.length < 2 || level.horizon === 'turn') return ranked;
  const shortlist = distinct(ranked, (action) => [action.type, action.cardId, action.row].join('/'))
    .slice(0, level.candidates);
  const pass = ranked.find(({ action }) => action.type === 'pass');
  if (pass && !shortlist.includes(pass)) shortlist[shortlist.length - 1] = pass;
  const simulated = shortlist.length > 1 && compareRollouts(match, shortlist, {
    pickTarget: options.pickTarget,
    expired: search.expired, horizon: level.horizon, memory: level.memory, knowsDeckList: level.knowsDeckList,
    rolloutSamples: options.rolloutSamples ?? level.samples,
  });
  if (simulated?.length) return simulated;
  return shortlist.map((candidate) => ({
    ...candidate, rating: replyRating(candidate, search, level),
  })).sort((a, b) => b.rating - a.rating);
}

export function chooseStrategicTarget(match, level, options) {
  const state = publicMatch(match, level.knowsDeckList);
  const limit = searchLimit(options.random);
  const search = limit(level.budgetMs);
  const local = limit(level.budgetMs * .4);
  const ranked = [];
  if (!match.pending.job || match.pending.side !== 'bot') {
    return report(options, options.pickTarget(match), 'Выбираю допустимую цель.');
  }
  for (const action of choices(state, true).slice(0, level.candidates)) {
    if (search.expired() || local.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, {
      expired: () => search.expired() || local.expired(),
    });
    if (candidate) ranked.push({ ...candidate, action });
  }
  if (!ranked.length) return report(options, options.pickTarget(match), 'Выбираю допустимую цель.');
  ranked.sort((a, b) => b.rating - a.rating || b.choiceValue - a.choiceValue);
  return selectRanked(options, level, forecast(match, ranked, level, search, options),
    'Выбор цели или позиции по итогам розыгрыша.', state);
}

export function chooseStrategicTurn(match, level, options) {
  const limit = searchLimit(options.random);
  const search = limit(level.budgetMs);
  const state = publicMatch(match, level.knowsDeckList);
  const { bot } = state.players;
  const finalRound = state.round === 3;
  const legal = holdUntargetedDamage(state, 'bot', playableCards(state, 'bot'));
  const mayPass = canPass(state, 'bot');
  const share = (fraction) => {
    const local = limit(level.budgetMs * fraction);
    return { expired: () => search.expired() || local.expired() };
  };
  const canEnd = canEndTurn(state, 'bot');
  const local = share(.16);
  const baseline = canEnd ? evaluateAction(state, 'bot', END, local) : undefined;
  const pass = mayPass ? evaluateAction(state, 'bot', PASS, local) : undefined;
  const plays = canEnd ? [] : rankPlays(state, share(.35), limit, level);
  const ranked = plays.filter((candidate) => preservesArmor(candidate, bot));
  const efficient = ranked.filter(({ reserveCost }) => reserveCost === 0);
  // A listed removal reserve protects finishers when another play is available.
  const alternatives = efficient.length ? efficient : ranked;
  const candidates = [...alternatives, ...rankAbilities(state, share(.16), level)];
  if (pass) {
    if (!finalRound) candidates.push({ ...pass, action: PASS });
    else if (candidates.every(({ contribution }) => contribution <= 0)) {
      const productive = plays.filter(({ contribution }) => contribution > 0);
      candidates.push(...(productive.length ? productive : [{ ...pass, action: PASS }]));
    }
  }
  if (baseline) candidates.push({ ...baseline, action: END, rating: baseline.rating + W.endTurnTie });
  candidates.sort((a, b) => {
    const passOrder = Number(a.action.type === 'pass') - Number(b.action.type === 'pass');
    return b.rating - a.rating || (finalRound ? b.contribution - a.contribution || passOrder : -passOrder)
      || (a.cost ?? 0) - (b.cost ?? 0);
  });
  if (candidates.length) {
    return selectRanked(options, level, forecast(match, candidates, level, search, options),
      'Сравниваю позицию на матч для доступных ходов.', state);
  }
  if (canEnd) return report(options, END, 'Завершаю ход.');
  const [card] = finalRound && mayPass
    ? legal.filter((entry) => !(destructionSwing(state, 'bot', entry) < 0)) : legal;
  if (mayPass && !card) return report(options, PASS, 'Нет подходящих розыгрышей.');
  if (!card) return report(options, abilities(state, 'bot')[0] ?? END, 'Завершаю ход без доступного розыгрыша.');
  const recipient = state.players[placementSide('bot', card)];
  const [row] = availableRows(recipient, card);
  const placement = cardType(card) === 'effect' ? {} : { row, position: recipient.board[row].length };
  return report(options, { type: 'play', cardId: card.id, ...placement }, 'Выбираю допустимый розыгрыш.');
}
