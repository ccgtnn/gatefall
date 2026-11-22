import { compareRollouts } from './bot-rollouts.js?v=rebirth-1';
import { ROWS } from './cards.js?v=rebirth-1';
import { activeOrder, cardType, infectionDamage, opponent, placementSide, statusCount, units } from './board.js?v=rebirth-1';
import { availableOrders, canUseLeader, deckCardValue, destructionRolls, destructionSwing, rowArmor, rowEffectValue } from './effects.js?v=rebirth-1';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, applyAction, playableCards, totalScore } from './match.js?v=rebirth-1';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
const SIMULATION = { random: () => .5 };
const UNKNOWN_PLAY = { id: 'unknown-play', definition: { type: 'effect', deploy: { steps: [] } } };
export const BOT_BUDGET_MS = 300;

function publicMatch(match) {
  const { bot, human } = match.players;
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: [...bot.deck].sort((a, b) => a.id.localeCompare(b.id)), exile: [] },
      human: { ...human, deck: [], exile: [],
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
  const { definition: { id, provision, deploy, endTurn, order } } = card;
  if (id === 'shield-overload' || id === 'broodlord') return 11;
  return (card.power ?? (provision ?? 5) * .7)
    + (deploy ? 1 : 0) + (endTurn || order ? 1.5 : 0);
}

function boardValue(state, side) {
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
  return units(state, side).reduce((sum, unit) => {
    const { card, row } = unit;
    const { definition, power, armor, counter, timer } = card;
    return sum + (armor ?? 0) * .12 + (definition.id === 'larva' ? .12 : 0)
      + (ready.has(card.id) ? 1.15 : activeOrder(unit) ? .35 : 0)
      + (row === 'orbit' && definition.fieldEvents?.['target-marked'] ? 1.25 : 0)
      + (definition.endTurn && (definition.id !== 'spear-battery' || exposed) ? (timer === undefined ? 1.25 : .5 * Math.min(timer, 3)) : 0)
      + (counter > 0 && player.deck.length ? 1.6 / counter : 0)
      + (card.resilient && state.round < 3 ? (power ?? 0) * .4 : 0)
      + (definition.scenario ? Math.min(definition.scenario.chapters.length - (card.chapter ?? 0),
        player.hand.filter((entry) => entry.definition.categories?.includes(definition.scenario.category)).length) * 2.5 : 0)
      + (definition.fieldEvents?.death && ROWS.some((row) =>
        enemy.board[row].some((entry) => entry.statuses?.infection)) ? 1.25 : 0)
      - .72 * infectionDamage(card);
  }, (player.leader?.charges ?? 0) * .9 + rot + (plans ? exposed * .65 : 0));
}

function value(state, round) {
  const { human, bot } = state.players;
  const handWeight = round === 3 ? .13 : .28;
  const future = state.phase !== 'playing' || human.passed ? 0 : boardValue(state, 'bot') - boardValue(state, 'human');
  const turnsToGrow = bot.passed || human.passed ? 0 : Math.min(4, Math.max(0, bot.hand.length - 1));
  return margin(state) + future + handWeight * bot.hand.reduce((sum, card) =>
    sum + potential(card) + turnsToGrow * (card.definition.startTurnGrowth ?? 0), 0);
}

function usesNeighbors(ability) {
  return ability?.steps.some((step) => step.target?.scope === 'neighbors' ||
    step.receiver?.scope === 'neighbors' || step.action === 'spawn')
    || ability?.select?.some((pick) => pick.targets.scope === 'neighbors');
}

function positions(player, row, card) {
  const line = player.board[row];
  const valid = new Set([line.length, 0]);
  const adjacent = usesNeighbors(card.definition.deploy) || usesNeighbors(card.definition.endTurn);
  for (let i = 1; i < line.length; i += 1) {
    const neighbors = [line[i - 1].definition, line[i].definition];
    if (adjacent || neighbors.some((def) => usesNeighbors(def.endTurn) || def.neighborEvents)) valid.add(i);
  }
  return [...valid];
}

function placements(state, side, card, rows = ROWS) {
  const player = state.players[placementSide(side, card)];
  const preferred = card.definition.preferredRow;
  if (rows.includes(preferred) && player.board[preferred].length < ROW_LIMIT) rows = [preferred];
  return rows.flatMap((row) => player.board[row].length >= ROW_LIMIT ? [] : positions(player, row, card)
    .map((position) => ({ row, position })));
}

function plays(state, side) {
  const player = state.players[side];
  const options = playableCards(state, side)
    .filter((card) => player.usedAbility || !(destructionSwing(state, side, card) < 0))
    .map((card) => {
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
  if (canUseLeader(state, side)) actions.push({ type: 'leader' });
  return actions;
}

function choices(state) {
  const { kind, options, side, cardId, pile = 'deck' } = state.pending;
  if (kind === 'deck-placement') {
    const card = state.players[side][pile].find((item) => item.id === cardId);
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
      : event.type === 'destroy' || event.type === 'discard' ? event.power ?? 0 : 0;
    swing += event.side === actor ? -lost : lost;
  }
  return Math.max(0, reserve - swing);
}

function evaluateAction(state, side, action, search) {
  function finish(next, depth) {
    const actor = next.pending?.side ?? next.turn;
    if (depth >= 36 || (!next.pending && (next.phase !== 'playing' || actor !== side ||
        next.players[side].turns !== state.players[side].turns))) {
      return { next, rating: value(next, state.round) };
    }

    let actions;
    if (next.pending) actions = choices(next);
    else if (next.playedCard) actions = [END, ...abilities(next, side)];
    else actions = plays(next, side).map(({ action }) => action);

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
      const result = next !== before && finish(next, depth);
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

function deadline(time = BOT_BUDGET_MS) {
  const end = performance.now() + time;
  return { expired: () => performance.now() >= end };
}

function rankPlays(state, search) {
  const ranked = [];
  for (const { action, cost } of plays(state, 'bot')) {
    if (search.expired()) break;
    const local = deadline(22);
    const candidate = evaluateAction(state, 'bot', action, { expired: () => search.expired() || local.expired() });
    if (candidate) ranked.push({ ...candidate, action, cost });
  }
  return ranked.sort((a, b) => b.rating - a.rating || a.cost - b.cost);
}

function rankAbilities(state, search) {
  const ranked = [];
  for (const action of abilities(state, 'bot')) {
    if (search.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, search);
    if (candidate) ranked.push({ ...candidate, action });
  }
  return ranked.sort((a, b) => b.rating - a.rating);
}

function replyRating(candidate, round, search) {
  const state = candidate.next;
  if (state.phase !== 'playing' || state.turn !== 'human' || state.players.human.passed) return candidate.rating;
  const actions = [...plays(state, 'human').map(({ action }) => action), ...abilities(state, 'human')];
  if (!actions.length) actions.push(PASS);
  let worst = Infinity;
  for (const action of actions) {
    if (search.expired()) break;
    const response = evaluateAction(state, 'human', action, search);
    if (response) worst = Math.min(worst, value(response.next, round));
  }
  return Number.isFinite(worst) ? .3 * candidate.rating + .7 * worst : candidate.rating;
}

function cheapestTwoTurnWin(ranked, search) {
  const tried = new Set();
  let best;
  for (const first of ranked) {
    const { next, action } = first;
    if (search.expired() || tried.size >= 4) break;
    if (tried.has(action.cardId) || next.phase !== 'playing' || next.turn !== 'bot' || next.pending) continue;
    tried.add(action.cardId);
    const second = rankPlays(next, search).filter(({ next }) => margin(next) > 0)
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

function protectsGuardian(candidate, player) {
  const { action } = candidate;
  const card = player.hand.find(({ id }) => id === action.cardId);
  if (card?.definition.id !== 'gate-guardian' ||
      !player.hand.some(({ definition }) => definition.id === 'shield-overload')) return true;
  const other = ROWS.find((row) => row !== action.row);
  return player.board[other].length >= ROW_LIMIT || rowArmor(player, action.row) <= rowArmor(player, other);
}

export function chooseStrategicTarget(match, pickTarget, difficulty = 'normal', options = {}) {
  const fallback = pickTarget(match);
  if (match.pending.side !== 'bot') return fallback;
  const state = publicMatch(match);
  const search = deadline();
  const ranked = [];
  for (const action of choices(state)) {
    if (search.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, search);
    if (!candidate) continue;
    const rating = difficulty === 'hard' ? replyRating(candidate, state.round, search) : candidate.rating;
    ranked.push({ action, rating });
  }
  ranked.sort((a, b) => b.rating - a.rating);
  return report(options, ranked[0]?.action ?? fallback, 'Выбор цели или позиции по итогам розыгрыша.', ranked);
}

export function chooseStrategicTurn(match, difficulty, oldAction, options = {}) {
  const search = deadline(difficulty === 'hard' ? (match.playedCard ? 45 : 380) : BOT_BUDGET_MS);
  const decide = (action, reason, ranked) => report(options, action, reason, ranked);
  const { bot, human } = match.players;
  const { round } = match;
  const hard = difficulty === 'hard';
  const lead = totalScore(bot) - totalScore(human);
  const canPass = !bot.usedAbility && !match.playedCard;
  if (canPass && lead > 0 && (human.passed || (round === 3 && !human.hand.length))) {
    return decide(PASS, 'Очков для победы уже хватает.');
  }

  const previousRound = match.log.findLast(({ type }) => type === 'round-end');
  const dryPass = round === 2 && previousRound?.winner === 'bot';

  const roundStart = match.log.findLastIndex(({ type }) => type === 'round-start');
  const spent = match.log.slice(roundStart + 1).filter(({ type, side, from }) => type === 'play' && side === 'bot' && !from).length;
  const normalRoundOneBudget = 5;
  const afterDraw = (count) => Math.min(HAND_LIMIT, count + ROUND_DRAW);
  if (canPass && dryPass && !human.passed && (bot.lives === human.lives ||
      (!hard && (bot.hand.length + 1 < human.hand.length || bot.hand.length <= 5 ||
        (spent >= 2 && lead < 5))))) {
    return decide(PASS, 'После победы в первом раунде сохраняю карты.');
  }
  const average = Math.max(3, bot.hand.reduce((sum, card) => sum + (card.power ?? 4), 0) / Math.max(1, bot.hand.length));
  const safeLead = Math.max(hard ? 18 : 16, average * 2);
  if (canPass && round === 1 && !human.passed && lead > safeLead && spent >= 2) {
    return decide(PASS, 'В первом раунде уже есть запас очков.');
  }
  if (canPass && round === 1 && !hard && spent >= normalRoundOneBudget && !human.passed && lead > 0) {
    return decide(PASS, 'Достигнут лимит карт на первый раунд.');
  }

  const state = publicMatch(match);
  if (match.playedCard) {
    if (human.passed && lead > 0) return decide(END, 'Очков уже достаточно. Сохраняю Приказы.');
    const baseline = evaluateAction(state, 'bot', END, search);
    const evaluate = (candidate) => hard ? replyRating(candidate, round, search) : candidate.rating;
    const ranked = [{ action: END, rating: baseline ? evaluate(baseline) + .08 : Infinity }];
    for (const candidate of rankAbilities(state, search)) {
      ranked.push({ action: candidate.action, rating: evaluate(candidate) });
    }
    ranked.sort((a, b) => b.rating - a.rating);
    return decide(ranked[0].action, 'Сравниваю завершение хода и доступные Приказы.', ranked);
  }

  // Give ordinary plays and ability sequences separate shares of the same time budget.
  const playSearch = deadline(hard ? 115 : 155);
  const ranked = rankPlays(state, { expired: () => search.expired() || playSearch.expired() });
  const abilitySearch = deadline(hard ? 100 : 130);
  const withAbilities = rankAbilities(state, { expired: () => search.expired() || abilitySearch.expired() });
  const allowed = ranked.filter((candidate) => protectsGuardian(candidate, bot));
  const mustWin = round === 3 || bot.lives === 1;
  const canConserve = canPass && (!mustWin || allowed.some(({ reserveCost }) => reserveCost === 0));
  const ready = canConserve ? allowed.filter(({ reserveCost }) => reserveCost === 0) : allowed;
  const best = ready[0];
  const ability = withAbilities[0];
  if (!best) {
    return decide(ability?.action ?? (ranked.length && canPass && !mustWin ? PASS : oldAction),
      'Сохраняю ремувал для более ценной цели или использую доступную способность.', withAbilities);
  }
  const bestGain = Math.max(0, ...ready.map(({ next }) => margin(next) - lead));
  const expectedCards = bestGain > 0 ? Math.max(1, Math.ceil((1 - lead) / bestGain)) : Infinity;
  const affordable = (cards) => afterDraw(bot.hand.length - cards) + 1 >= afterDraw(human.hand.length);

  if (canPass && round === 1 && !human.passed && lead < -average &&
      (!affordable(expectedCards) || (!hard && expectedCards > normalRoundOneBudget - spent))) {
    return decide(PASS, 'Догонять в первом раунде слишком дорого.', ready);
  }

  if (human.passed) {
    const winning = allowed.filter(({ next }) => margin(next) > 0).sort((a, b) => a.cost - b.cost);
    if (winning.length && (!canPass || round > 1 || affordable(1))) {
      return decide(winning[0].action, 'Закрываю раунд самой дешёвой картой, которой хватает для победы.', winning);
    }

    const twoTurnWin = cheapestTwoTurnWin(ready, { expired: () => search.expired() || abilitySearch.expired() });
    if (twoTurnWin && (!canPass || !dryPass && (round > 1 || affordable(2)))) {
      return decide(twoTurnWin.action, 'Закрываю раунд двумя недорогими картами.', ready);
    }
    if (canPass && (dryPass || (round === 1 && !affordable(expectedCards)))) {
      return decide(PASS, 'Дальнейшая борьба за раунд слишком дорога.', ready);
    }
    if (!hard || !canPass) {
      const candidates = [...ready, ...withAbilities].sort((a, b) => b.rating - a.rating);
      return decide(candidates[0].action, 'Выбираю лучший ответ после паса соперника.', candidates);
    }
  }

  const candidates = [...ready, ...withAbilities].sort((a, b) => b.rating - a.rating);
  if (!hard) {
    const near = candidates.filter(({ rating }) => candidates[0].rating - rating > .001 && candidates[0].rating - rating < .08);
    const explore = near.length && Math.random() < .12;
    return decide(explore ? near[0].action : candidates[0].action,
      explore ? 'Оценки близки. Выбираю один из равноценных вариантов.' : 'Лучшая оценка розыгрыша.', candidates);
  }
  // Keep distinct cards and both rows in the shortlist before considering equivalent slots.
  const seen = new Set();
  const shortlist = candidates.filter(({ action }) => {
    const key = [action.type, action.cardId, action.row].join('/');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
  if (canPass && (dryPass || (round === 1 && spent >= 2 && (lead > 0 || spent >= 4)) ||
      (round === 2 && bot.lives > human.lives))) {
    const pass = evaluateAction(state, 'bot', PASS, search);
    if (pass) {
      if (shortlist.length === 8) shortlist.pop();
      shortlist.push({ ...pass, action: PASS });
    }
  }
  const plausible = shortlist.length > 1;
  const simulated = plausible && options.pickTarget && compareRollouts(match, shortlist, { ...options, expired: search.expired });
  if (simulated?.length) {
    return decide(simulated[0].action, 'Лучший средний исход партии с учётом текущего раунда и оставшихся карт.', simulated);
  }
  const tactical = shortlist.map((candidate) => ({ ...candidate, rating: replyRating(candidate, round, search) }))
    .sort((a, b) => b.rating - a.rating);
  return decide(tactical[0].action, 'Выбираю по тактической оценке и видимому ответу соперника.', tactical);
}
