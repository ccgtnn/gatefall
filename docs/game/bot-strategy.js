import { leaderTargetPriority, offeringPriority, preferredLeaderUse } from './bot-leaders.js';
import { compareRollouts } from './bot-rollouts.js';
import { ROWS } from './card-metadata.js';
import { activeOrder, cardType, findUnit, infectionDamage, opponent, placementSide, statusCount, units } from './board.js';
import { availableFees, availableOrders, canUseLeader } from './effects.js';
import { rowArmor } from './effect-queries.js';
import { armorTargetPriority, cleansePriority, deckCardValue, destructionRolls, destructionSwing, infectionGain, lockPriority, pendingUnitPriority, rowEffectValue, shouldProtectArmor, tributeOptions, tributeTarget } from './bot-effect-value.js';
import { cardAbilities, isLocked } from './events.js';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, applyAction, availableRows, canEndTurn, canPass, playableCards, totalScore } from './match.js';

import { armorBreakEmergence, consumeBonus, delayedCardValue, futureContext, inheritancePayoff, remainingTurns, wantsToHoldInheritance } from './bot-future-value.js';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
const SIMULATION = { random: () => .5 };
const UNKNOWN_PLAY = { id: 'unknown-play', definition: { type: 'effect', deploy: { steps: [] } } };


export function publicMatch(match) {
  const { bot, human } = match.players;
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: [...bot.deck].sort((a, b) => a.id.localeCompare(b.id)), exile: [] },
      human: { ...human, deck: [], exile: [], publicHandSize: human.hand.length,
        hand: human.hand.length ? [UNKNOWN_PLAY] : [] },
    },
  };
}

function margin(state) {
  const result = state.log.findLast(({ type }) => type === 'round-end');
  if (result) return result.scores.bot - result.scores.human;
  return totalScore(state.players.bot) - totalScore(state.players.human);
}

function potential(card) {
  const { aiHints, provision } = card.definition;
  const { deploy, endTurn, order } = cardAbilities(card);
  if (aiHints?.handPotential !== undefined) return aiHints.handPotential;
  return (card.power ?? (provision ?? 5) * .7)
    + (deploy ? 1 : 0) + (endTurn || order ? 1.5 : 0);
}

function boardValue(state, side) {
  const player = state.players[side];
  if (player.passed) return 0;
  const context = futureContext(state, side);
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
    const { definition, power, timer } = card;
    const abilities = cardAbilities(card);
    const endTurn = abilities.endTurn?.steps.every(({ action }) => !['spawn', 'advance-growth', 'boost'].includes(action));
    return sum + delayedCardValue(context, card, row) + (definition.aiHints?.boardBonus ?? 0)
      + (ready.has(card.id) ? 1.15 : activeOrder(unit) ? .35 : 0)
      + (row === 'orbit' && abilities.fieldEvents?.['target-marked'] ? 1.25 : 0)
      + (context.turns && endTurn && (!definition.aiHints?.endTurnNeedsMarkedEnemy || exposed) ? (timer === undefined ? 1.25 : .5 * Math.min(timer, 3)) : 0)
      + (!isLocked(card) && card.resilient && state.round < 3 ? (power ?? 0) * .4 : 0)
      + (abilities.scenario ? Math.min(definition.scenario.chapters.length - (card.chapter ?? 0),
        player.hand.filter((entry) => entry.definition.categories?.includes(definition.scenario.category)).length) * 2.5 : 0)
      + (abilities.fieldEvents?.death && ROWS.some((row) =>
        enemy.board[row].some((entry) => entry.statuses?.infection)) ? 1.25 : 0)
      - .72 * infectionDamage(card, context.turns);
  }, Math.min(player.leader?.charges ?? 0, context.turns) * .9 +
    (context.turns ? (player.coins ?? 0) * context.coinWeight : 0) + rot + (plans ? exposed * .65 : 0));
}

function value(state, round) {
  const { human, bot } = state.players;
  const handWeight = round === 3 ? .13 : .28;
  const future = state.phase !== 'playing' ? 0 : boardValue(state, 'bot') - boardValue(state, 'human');
  const turnsToGrow = bot.passed || human.passed ? 0 : Math.min(4, Math.max(0, bot.hand.length - 1));
  return margin(state) + future + handWeight * bot.hand.reduce((sum, card) =>
    sum + potential(card) + turnsToGrow * (cardAbilities(card).startTurnGrowth ?? 0), 0);
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
      .sort((a, b) => potential(b) - potential(a)).map(({ id }) => id)
    : options;
  return ids.map((id) => ({ type: 'target', cardId: id }));
}

function removalShortfall(before, after, actor, card) {
  const reserve = card?.definition?.removalReserve;
  if (actor !== 'bot' || !reserve) return 0;
  if (before.players.human.passed && margin(after) > 0) return 0;
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
    return Math.max(-8, .65 * (priority(unit, side) - best));
  }
  if (kind === 'hand-bottom' || kind === 'hand-return') {
    const card = state.players[side].hand.find(({ id }) => id === action.cardId);
    return card ? -.5 * deckCardValue(state, side, card) : 0;
  }
  if (kind === 'armor-row') return -.4 * state.players[side].board[action.cardId]
    .reduce((sum, card) => sum + armorBreakEmergence(card), 0);
  if (kind !== 'consume' && kind !== 'spend-armor') return 0;
  const victim = findUnit(state, action.cardId);
  if (!victim) return 0;
  if (kind === 'consume') return Math.min(6, consumeBonus(futureContext(state, side), victim)) * .24;
  if (kind === 'spend-armor' && victim.card.armor <= (amount || Infinity)) {
    return -armorBreakEmergence(victim.card) * .4;
  }
  return 0;
}

function evaluateAction(state, side, action, search) {
  const choiceValue = choicePreference(state, side, action);
  function finish(next, depth, move) {
    const actor = next.pending?.side ?? next.turn;
    if (depth >= 36 || (!next.pending && (next.phase !== 'playing' || actor !== side ||
        next.players[side].turns !== state.players[side].turns))) {
      return { next, rating: value(next, state.round) + (side === 'bot' ? choiceValue : -choiceValue) };
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
    let total = 0;
    let shortfall = 0;
    for (const roll of rolls) {
      if (rolls.length > 1 && search.expired()) return;
      const next = applyAction(before, actor, move, roll === .5 ? SIMULATION : { random: () => roll });
      const result = next !== before && finish(next, depth, move);
      if (!result) return;
      shortfall += removalShortfall(before, result.next, actor, card);
      total += result.rating;
      // Keep a conservative outcome for pass calculations when targets are random.
      if (!worst || (actor === 'bot' ? margin(result.next) < margin(worst) : margin(result.next) > margin(worst))) {
        worst = result.next;
      }
    }
    const reserveCost = shortfall / rolls.length;
    return { next: worst, rating: total / rolls.length - reserveCost * 1.5, reserveCost };
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
      ranked.push({ ...candidate, rating: candidate.rating + (context.turns > 1 ? .4 * inherited : 0), action, cost });
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

function replyRating(candidate, round, search, level) {
  const state = candidate.next;
  if (state.phase !== 'playing' || state.turn !== 'human' || state.players.human.passed) return candidate.rating;
  const actions = [...plays(state, 'human').map(({ action }) => action), ...abilities(state, 'human')];
  if (!actions.length) actions.push(PASS);
  let worst = Infinity;
  for (const action of actions.slice(0, level.candidates)) {
    if (search.expired()) break;
    const response = evaluateAction(state, 'human', action, search);
    if (response) worst = Math.min(worst, value(response.next, round));
  }
  return Number.isFinite(worst) ? candidate.rating + .7 * (worst - value(state, round)) : candidate.rating;
}

function cheapestTwoTurnWin(ranked, search, limit, level) {
  const tried = new Set();
  let best;
  for (const first of ranked) {
    const { next, action } = first;
    if (search.expired() || tried.size >= 4) break;
    if (tried.has(action.cardId) || next.phase !== 'playing' || next.turn !== 'bot' || next.pending) continue;
    tried.add(action.cardId);
    const second = rankPlays(next, search, limit, level).filter(({ next }) => margin(next) > 0)
      .sort((a, b) => a.cost - b.cost)[0];
    if (second && (!best || first.cost + second.cost < best.cost)) best = { action, cost: first.cost + second.cost };
  }
  return best;
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
  if (level.errorRate > 0) {
    const choices = distinct(ranked, (action) => [action.type, action.cardId ?? action.row].join('/'));
    const top = (choices.length > 1 ? choices : ranked).slice(0, 3);
    const random = options.random ?? Math.random;
    if (top.length > 1 && random() < level.errorRate) {
      const choice = top[1 + Math.min(top.length - 2, Math.floor(random() * (top.length - 1)))];
      return decide(choice.action, 'Выбираю другой ход из ближайших по оценке.', ranked);
    }
  }
  return decide(best.action, reason, ranked);
}

function forecast(match, ranked, level, search, options) {
  if (ranked.length < 2 || level.horizon === 'turn') return ranked;
  const shortlist = distinct(ranked, (action) => [action.type, action.cardId, action.row].join('/'))
    .slice(0, level.candidates);
  const simulated = shortlist.length > 1 && compareRollouts(match, shortlist, {
    ...options, expired: search.expired, horizon: level.horizon, memory: level.memory,
    rolloutSamples: options.rolloutSamples ?? level.samples,
  });
  if (simulated?.length) return simulated;
  return shortlist.map((candidate) => ({
    ...candidate, rating: replyRating(candidate, match.round, search, level),
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
  const repeatable = availableOrders(match, 'bot').find(({ card }) => card.definition.aiHints?.useOrderWhenReady);
  const decide = (action, reason, ranked) => {
    if (repeatable && action.type === 'play') {
      return report(options, { type: 'order', cardId: repeatable.card.id }, 'Использую Приказ на порождение до размещения карты.');
    }
    return report(options, action, reason, ranked);
  };
  const select = (candidates, reason) => selectRanked(options, level, candidates, reason, decide);
  const { bot, human } = match.players;
  const { round } = match;
  const plansRounds = level.horizon !== 'turn';
  const lead = totalScore(bot) - totalScore(human);
  const mayPass = canPass(match, 'bot');
  const legal = playableCards(match, 'bot');
  if (mayPass && lead > 0 && human.passed && (round < 3 || !legal.length)) {
    return decide(PASS, 'Очков для победы уже хватает.');
  }

  const previousRound = match.log.findLast(({ type }) => type === 'round-end');
  const dryPass = round === 2 && previousRound?.winner === 'bot' && bot.lives > human.lives;
  const roundStart = match.log.findLastIndex(({ type }) => type === 'round-start');
  const spent = match.log.slice(roundStart + 1).filter(({ type, side, from }) => type === 'play' && side === 'bot' && !from).length;
  const afterDraw = (count) => Math.min(HAND_LIMIT, count + ROUND_DRAW);
  if (plansRounds && mayPass && dryPass && !human.passed) {
    return decide(PASS, 'После победы в первом раунде сохраняю карты.');
  }
  const average = Math.max(3, bot.hand.reduce((sum, card) => sum + (card.power ?? 4), 0) / Math.max(1, bot.hand.length));
  const safeLead = Math.max(16, average * 2);
  if (plansRounds && mayPass && round === 1 && !human.passed && lead > safeLead && spent >= 2) {
    return decide(PASS, 'В первом раунде уже есть запас очков.');
  }

  if (!(human.passed && lead > 0) && preferredLeaderUse(match, 'bot')) {
    return decide({ type: 'leader' }, 'Использую подходящий момент для способности лидера.');
  }
  const state = publicMatch(match);
  const share = (fraction) => {
    const local = limit(level.budgetMs * fraction);
    return { expired: () => search.expired() || local.expired() };
  };
  if (canEndTurn(match, 'bot')) {
    if (human.passed && lead > 0) return decide(END, 'Очков уже достаточно. Сохраняю Приказы.');
    const local = share(.44);
    const baseline = evaluateAction(state, 'bot', END, local);
    const ranked = rankAbilities(state, local, level);
    ranked.push({ ...baseline, action: END, rating: baseline ? baseline.rating + .08 : -Infinity });
    ranked.sort((a, b) => b.rating - a.rating);
    const candidates = baseline ? forecast(match, ranked, level, search, options) : ranked;
    return select(candidates, 'Сравниваю завершение хода и доступные способности.');
  }

  const ranked = rankPlays(state, share(.35), limit, level);
  const withAbilities = rankAbilities(state, share(.16), level);
  const allowed = ranked.filter((candidate) => preservesArmor(candidate, bot));
  const mustWin = round === 3 || bot.lives === 1;
  const canConserve = mayPass && (!mustWin || allowed.some(({ reserveCost }) => reserveCost === 0));
  const ready = canConserve ? allowed.filter(({ reserveCost }) => reserveCost === 0) : allowed;
  if (!ready.length) {
    if (withAbilities.length) return select(withAbilities, 'Использую доступную способность.');
    const harmful = legal.every((card) => destructionSwing(state, 'bot', card) < 0);
    if (mayPass && (!legal.length || (!mustWin && (ranked.length || harmful)))) {
      return decide(PASS, 'Сохраняю карты для подходящего момента.');
    }
    const [card] = legal;
    if (!card) return decide(abilities(state, 'bot')[0] ?? END, 'Завершаю ход без доступного розыгрыша.');
    const recipient = state.players[placementSide('bot', card)];
    const [row] = availableRows(recipient, card);
    const placement = cardType(card) === 'effect' ? {} : { row, position: recipient.board[row].length };
    return decide(ranked[0]?.action ?? { type: 'play', cardId: card.id, ...placement }, 'Выбираю допустимый розыгрыш.');
  }

  const bestGain = Math.max(0, ...ready.map(({ next }) => margin(next) - lead));
  const expectedCards = bestGain > 0 ? Math.max(1, Math.ceil((1 - lead) / bestGain)) : Infinity;
  const affordable = (cards) => afterDraw(bot.hand.length - cards) + 1 >= afterDraw(human.hand.length);
  if (plansRounds && mayPass && round === 1 && !human.passed && lead < -average &&
      !affordable(expectedCards)) {
    return decide(PASS, 'Догонять в первом раунде слишком дорого.', ready);
  }

  if (human.passed && round < 3) {
    const winning = allowed.filter(({ next }) => margin(next) > 0).sort((a, b) => a.cost - b.cost || b.rating - a.rating);
    if (winning.length && (!mayPass || round > 1 || affordable(1))) {
      return select(winning, 'Закрываю раунд самой дешёвой картой, которой хватает для победы.');
    }
    if (plansRounds) {
      const twoTurnWin = cheapestTwoTurnWin(ready, share(.12), limit, level);
      if (twoTurnWin && (!mayPass || !dryPass && (round > 1 || affordable(2)))) {
        return decide(twoTurnWin.action, 'Закрываю раунд двумя недорогими картами.', ready);
      }
      if (mayPass && (dryPass || (round === 1 && !affordable(expectedCards)))) {
        return decide(PASS, 'Дальнейшая борьба за раунд слишком дорога.', ready);
      }
    }
  }

  const candidates = [...ready, ...withAbilities].sort((a, b) => b.rating - a.rating).slice(0, level.candidates);
  if (plansRounds && mayPass && ((round === 1 && spent >= 2 && (lead > 0 || spent >= 4)) ||
      (round === 2 && bot.lives > human.lives))) {
    const pass = evaluateAction(state, 'bot', PASS, search);
    if (pass) {
      if (candidates.length === level.candidates) candidates.pop();
      candidates.push({ ...pass, action: PASS });
    }
  }
  return select(forecast(match, candidates, level, search, options),
    'Выбираю по оценке розыгрыша и доступному горизонту прогноза.');
}
