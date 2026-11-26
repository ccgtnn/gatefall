import { leaderTargetPriority, offeringPriority, preferredLeaderUse } from './bot-leaders.js';
import { cardPotential, evaluatePosition, EVAL_WEIGHTS as W } from './bot-evaluation.js';
import { compareRollouts } from './bot-rollouts.js';
import { ROWS } from './card-metadata.js';
import { cardType, createCard, findUnit, placementSide } from './board.js';
import { availableFees, availableOrders, canUseLeader } from './effects.js';
import { rowArmor } from './effect-queries.js';
import { armorTargetPriority, cleansePriority, deckCardValue, destructionRolls, destructionSwing, infectionGain, lockPriority, pendingUnitPriority, shouldProtectArmor, tributeOptions, tributeTarget } from './bot-effect-value.js';
import { cardAbilities } from './events.js';
import { ROW_LIMIT, applyAction, availableRows, canEndTurn, canPass, playableCards, totalScore } from './match.js';

import { armorBreakEmergence, consumeBonus, futureContext, inheritancePayoff, remainingTurns, wantsToHoldInheritance } from './bot-future-value.js';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
const SIMULATION = { random: () => .5 };
const UNKNOWN_PLAY = createCard('unknown-play', {
  id: 'unknown-play', name: 'Неизвестная карта', type: 'unit', power: W.defaultPower,
});

export function publicMatch(match) {
  const { bot, human } = match.players;
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: [...bot.deck].sort((a, b) => a.id.localeCompare(b.id)), exile: [] },
      human: { ...human, deck: [], exile: [], publicHandSize: human.hand.length, publicDeckSize: human.deck.length,
        hand: human.hand.length ? [UNKNOWN_PLAY] : [] },
    },
  };
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
  const legal = playableCards(state, side)
    .filter((card) => player.usedAbility || !(destructionSwing(state, side, card) < 0));
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
  const actions = availableOrders(state, side).map(({ card }) => ({ type: 'order', cardId: card.id }));
  actions.push(...availableFees(state, side).map(({ card }) => ({ type: 'fee', cardId: card.id })));
  if (preferredLeaderUse(state, side) ?? canUseLeader(state, side)) actions.push({ type: 'leader' });
  return actions;
}

function targetPriority(state) {
  const { kind, side } = state.pending;
  const leaderPriority = leaderTargetPriority(state, side, kind);
  const priorities = {
    lock: lockPriority,
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
  if (kind === 'tribute') return all
    ? tributeOptions(state).map(({ cardId }) => ({ type: 'target', cardId })) : [tributeTarget(state)];
  const allies = kind === 'transform' ? legal.filter((id) => findUnit(state, id)?.side === side) : [];
  const options = allies.length ? allies : legal;
  const priority = targetPriority(state);
  if (priority) {
    const ranked = options.map((id) => ({ id, score: priority(findUnit(state, id), side) }))
      .sort((a, b) => b.score - a.score);
    return (all ? ranked : ranked.filter(({ score }) => score === ranked[0].score))
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
  if (priority) {
    const unit = findUnit(state, action.cardId);
    const best = Math.max(...state.pending.options.map((id) => priority(findUnit(state, id), side)));
    return Math.max(-W.targetPenaltyCap, W.targetPriority * (priority(unit, side) - best));
  }
  if (kind === 'hand-bottom' || kind === 'hand-return') {
    const card = state.players[side].hand.find(({ id }) => id === action.cardId);
    return card ? -W.handChoice * deckCardValue(state, side, card) : 0;
  }
  if (kind === 'armor-row') return -W.armorChoice * state.players[side].board[action.cardId]
    .reduce((sum, card) => sum + armorBreakEmergence(card), 0);
  if (kind !== 'consume' && kind !== 'spend-armor') return 0;
  const victim = findUnit(state, action.cardId);
  if (!victim) return 0;
  if (kind === 'consume') return Math.min(W.consumeCap, consumeBonus(futureContext(state, side), victim)) * W.consumeChoice;
  if (kind === 'spend-armor' && victim.card.armor <= (amount || Infinity)) {
    return -armorBreakEmergence(victim.card) * W.armorChoice;
  }
  return 0;
}

function evaluateAction(state, side, action, search) {
  const choiceValue = choicePreference(state, side, action);
  function finish(next, depth, move) {
    const actor = next.pending?.side ?? next.turn;
    if (depth >= 36 || (!next.pending && (next.phase !== 'playing' || actor !== side ||
        next.players[side].turns !== state.players[side].turns))) {
      return { next, rating: evaluatePosition(next, 'bot') + (side === 'bot' ? choiceValue : -choiceValue) };
    }

    let actions;
    if (next.pending) actions = choices(next);
    else if (next.playedCard) actions = [END, ...abilities(next, side)];
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
      if (result && (!best || (actor === 'bot' ? result.rating > best.rating : result.rating < best.rating))) best = result;
    }
    return best;
  }
  function advance(before, actor, move, depth) {
    const card = move.type === 'play' && before.players[actor].hand.find(({ id }) => id === move.cardId);
    const rolls = destructionRolls(before, actor, card);
    let worst;
    let worstRating;
    let total = 0;
    let shortfall = 0;
    for (const roll of rolls) {
      if (rolls.length > 1 && search.expired()) return;
      const next = applyAction(before, actor, move, roll === .5 ? SIMULATION : { random: () => roll });
      const result = next !== before && finish(next, depth, move);
      if (!result) return;
      shortfall += removalShortfall(before, result.next, actor, card);
      total += result.rating;
      if (!worst || (actor === 'bot' ? result.rating < worstRating : result.rating > worstRating)) {
        worst = result.next;
        worstRating = result.rating;
      }
    }
    const reserveCost = shortfall / rolls.length;
    return { next: worst, rating: total / rolls.length - reserveCost * W.removalReserve, reserveCost };
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
  if (!random) return deadline;
  return (budget) => {
    let checks = budget * 4;
    return { expired: () => checks-- <= 0 };
  };
}

function rankPlays(state, search, limit, level) {
  const ranked = [];
  const context = futureContext(state, 'bot');
  for (const { action, cost } of plays(state, 'bot').slice(0, level.candidates)) {
    if (search.expired()) break;
    const local = limit(Math.max(15, level.budgetMs / 40));
    const candidate = evaluateAction(state, 'bot', action, { expired: () => search.expired() || local.expired() });
    if (candidate) {
      const card = state.players.bot.hand.find(({ id }) => id === action.cardId);
      const inherited = inheritancePayoff(context, card);
      ranked.push({ ...candidate, rating: candidate.rating + (context.turns > 1 ? W.inheritedWish * inherited : 0), action, cost });
    }
  }
  return ranked.sort((a, b) => b.rating - a.rating || a.cost - b.cost);
}

function rankAbilities(state, search, level) {
  const ranked = [];
  for (const action of abilities(state, 'bot').slice(0, level.candidates)) {
    if (search.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, search);
    if (candidate) ranked.push({ ...candidate, action });
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

function report(options, action, reason, candidates = []) {
  options.onDecision?.({
    action, reason,
    candidates: candidates.slice(0, 3).map(({ action, rating, average, samples }) => ({
      action, score: average === undefined ? rating : 100 * average, samples,
    })),
  });
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

function selectRanked(options, level, ranked, reason, decide = (action, reason, ranked) => report(options, action, reason, ranked)) {
  const best = ranked[0];
  const random = options.random ?? Math.random;
  if (level.errorRate > 0 && ranked.length > 1 && random() < level.errorRate) {
    const pass = ranked.find(({ action }) => action.type === 'pass');
    if (pass && best !== pass && level.passMistakeRate > 0 && random() < level.passMistakeRate) {
      return decide(pass.action, 'Ошибаюсь с моментом паса.', ranked);
    }
    const choices = distinct(ranked, (action) => [action.type, action.cardId ?? action.row].join('/'));
    const pool = (choices.length > 1 ? choices : ranked).slice(1, level.errorPool);
    if (pool.length) {
      const choice = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
      return decide(choice.action, 'Выбираю ход с более низкой оценкой.', ranked);
    }
  }
  return decide(best.action, best.action.type === 'pass' ? 'Пас сохраняет лучшую позицию на матч.' : reason, ranked);
}

function forecast(match, ranked, level, search, options) {
  if (ranked.length < 2 || level.horizon === 'turn') return ranked;
  const shortlist = distinct(ranked, (action) => [action.type, action.cardId, action.row].join('/'))
    .slice(0, level.candidates);
  const pass = ranked.find(({ action }) => action.type === 'pass');
  if (pass && !shortlist.includes(pass)) shortlist[shortlist.length - 1] = pass;
  const simulated = shortlist.length > 1 && compareRollouts(match, shortlist, {
    ...options, expired: search.expired, horizon: level.horizon, memory: level.memory,
    rolloutSamples: options.rolloutSamples ?? level.samples,
  });
  if (simulated?.length) return simulated;
  return shortlist.map((candidate) => ({
    ...candidate, rating: replyRating(candidate, search, level),
  })).sort((a, b) => b.rating - a.rating);
}

export function chooseStrategicTarget(match, level, options) {
  const state = publicMatch(match);
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
  ranked.sort((a, b) => b.rating - a.rating);
  return selectRanked(options, level, forecast(match, ranked, level, search, options),
    'Выбор цели или позиции по итогам розыгрыша.');
}

export function chooseStrategicTurn(match, level, options) {
  const limit = searchLimit(options.random);
  const search = limit(level.budgetMs);
  const state = publicMatch(match);
  const { bot, human } = state.players;
  const lead = totalScore(bot) - totalScore(human);
  const legal = playableCards(state, 'bot');
  // The deciding round requires a play whenever one is available.
  const mayPass = canPass(state, 'bot') && (state.round !== 3 || !legal.length);
  const preserveLead = human.passed && lead > 0;
  const repeatable = !preserveLead && availableOrders(state, 'bot').find(({ card }) => card.definition.aiHints?.useOrderWhenReady);
  const preferredLeader = !human.passed && preferredLeaderUse(state, 'bot');
  const decide = (action, reason, ranked) => {
    if (action.type === 'play' || action.type === 'end-turn') {
      if (preferredLeader) return report(options, { type: 'leader' }, 'Использую подходящий момент для способности лидера.');
      if (repeatable) return report(options, { type: 'order', cardId: repeatable.card.id }, 'Использую Приказ на порождение.');
    }
    return report(options, action, reason, ranked);
  };
  const share = (fraction) => {
    const local = limit(level.budgetMs * fraction);
    return { expired: () => search.expired() || local.expired() };
  };
  const canEnd = canEndTurn(state, 'bot');
  const local = share(.16);
  const baseline = canEnd ? evaluateAction(state, 'bot', END, local) : undefined;
  const pass = mayPass ? evaluateAction(state, 'bot', PASS, local) : undefined;
  const ranked = canEnd ? [] : rankPlays(state, share(.35), limit, level)
    .filter((candidate) => preservesArmor(candidate, bot));
  const efficient = ranked.filter(({ reserveCost }) => reserveCost === 0);
  // A listed removal reserve protects finishers when another play is available.
  const alternatives = efficient.length ? efficient : ranked;
  const candidates = [...alternatives, ...rankAbilities(state, share(.16), level)];
  if (pass) candidates.push({ ...pass, action: PASS });
  if (baseline) candidates.push({ ...baseline, action: END, rating: baseline.rating + W.endTurnTie });
  candidates.sort((a, b) => b.rating - a.rating || Number(b.action.type === 'pass') - Number(a.action.type === 'pass')
    || (a.cost ?? 0) - (b.cost ?? 0));
  if (candidates.length) {
    return selectRanked(options, level, forecast(match, candidates, level, search, options),
      'Сравниваю позицию на матч для доступных ходов.', decide);
  }
  if (canEnd) return decide(END, 'Завершаю ход.');
  if (mayPass && !legal.length) return decide(PASS, 'Нет доступных розыгрышей.');
  const [card] = legal;
  if (!card) return decide(abilities(state, 'bot')[0] ?? END, 'Завершаю ход без доступного розыгрыша.');
  const recipient = state.players[placementSide('bot', card)];
  const [row] = availableRows(recipient, card);
  const placement = cardType(card) === 'effect' ? {} : { row, position: recipient.board[row].length };
  return decide({ type: 'play', cardId: card.id, ...placement }, 'Выбираю допустимый розыгрыш.');
}
