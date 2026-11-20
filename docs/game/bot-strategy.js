import { ROWS } from './cards.js?v=card-art-13';
import { cardType, units } from './board.js?v=card-art-13';
import { availableOrders, canUseLeader, destructionRolls, destructionSwing } from './effects.js?v=card-art-13';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, applyAction, playableCards, totalScore } from './match.js?v=card-art-13';

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
      bot: { ...bot, deck: [...bot.deck].sort((a, b) => a.id.localeCompare(b.id)), discard: [], exile: [] },
      human: { ...human, deck: [], discard: [], exile: [],
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
  return units(state, side).reduce((sum, { card }) => {
    const { definition, power, armor, timer } = card;
    return sum + (armor ?? 0) * .12 + (definition.id === 'larva' ? .12 : 0)
      + (ready.has(card.id) ? 1.15 : definition.order ? .35 : 0)
      + (definition.endTurn ? (timer === undefined ? 1.25 : .5 * Math.min(timer, 3)) : 0)
      - .72 * Math.min(power ?? 0, card.statuses?.infection ?? 0);
  }, (player.leader?.charges ?? 0) * .9);
}

function value(state, round) {
  const { human, bot } = state.players;
  const handWeight = round === 3 ? .13 : .28;
  const future = state.phase !== 'playing' || human.passed ? 0 : boardValue(state, 'bot') - boardValue(state, 'human');
  return margin(state) + future + handWeight * bot.hand.reduce((sum, card) => sum + potential(card), 0);
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
  const player = state.players[side];
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
  if (!state.playedCard && canUseLeader(state, side)) actions.push({ type: 'leader' });
  return actions;
}

function choices(state) {
  const { kind, options, side, cardId } = state.pending;
  if (kind === 'deck-placement') {
    const card = state.players[side].deck.find((item) => item.id === cardId);
    return placements(state, side, card, options).map((destination) => ({ type: 'place', ...destination }));
  }
  return options.map((id) => ({ type: 'target', cardId: id }));
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
    if (rolls.length === 1) {
      const next = applyAction(before, actor, move, SIMULATION);
      return next === before ? undefined : finish(next, depth);
    }

    let worst;
    let total = 0;
    for (const roll of rolls) {
      if (search.expired()) return;
      const next = applyAction(before, actor, move, { random: () => roll });
      const result = next !== before && finish(next, depth);
      if (!result) return;
      total += result.rating;
      // Pass calculations require a line that wins even if the tie goes against the actor.
      if (!worst || (actor === 'bot' ? margin(result.next) < margin(worst) : margin(result.next) > margin(worst))) {
        worst = result.next;
      }
    }
    return { next: worst, rating: total / rolls.length };
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

export function chooseStrategicTarget(match, pickTarget, difficulty = 'normal') {
  const fallback = pickTarget(match);
  if (match.pending.side !== 'bot') return fallback;
  const state = publicMatch(match);
  const search = deadline();
  let best;
  for (const action of choices(state)) {
    if (search.expired()) break;
    const candidate = evaluateAction(state, 'bot', action, search);
    if (!candidate) continue;
    const rating = difficulty === 'hard' ? replyRating(candidate, state.round, search) : candidate.rating;
    if (!best || rating > best.rating) best = { action, rating };
  }
  return best?.action ?? fallback;
}

export function chooseStrategicTurn(match, difficulty, oldAction) {
  const search = deadline();
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
    if (human.passed && lead > 0) return END;
    const baseline = evaluateAction(state, 'bot', END, search);
    const evaluate = (candidate) => hard ? replyRating(candidate, round, search) : candidate.rating;
    let rating = baseline ? evaluate(baseline) + .08 : Infinity;
    let action = END;
    for (const candidate of rankAbilities(state, search)) {
      const score = evaluate(candidate);
      if (score > rating) {
        rating = score;
        action = candidate.action;
      }
    }
    return action;
  }

  // Give ordinary plays and ability sequences separate shares of the same time budget.
  const playSearch = deadline(hard ? 115 : 155);
  const ranked = rankPlays(state, { expired: () => search.expired() || playSearch.expired() });
  const abilitySearch = deadline(hard ? 100 : 130);
  const withAbilities = rankAbilities(state, { expired: () => search.expired() || abilitySearch.expired() });
  const best = ranked[0];
  const ability = withAbilities[0];
  if (!best) return ability?.action ?? oldAction;
  const bestGain = Math.max(0, ...ranked.map(({ next }) => margin(next) - lead));
  const expectedCards = bestGain > 0 ? Math.max(1, Math.ceil((1 - lead) / bestGain)) : Infinity;
  const affordable = (cards) => Math.min(HAND_LIMIT, bot.hand.length - cards + ROUND_DRAW) + (hard ? 1 : 0)
    >= Math.min(HAND_LIMIT, human.hand.length + ROUND_DRAW);

  if (canPass && round === 1 && !human.passed && lead < -average &&
      (!affordable(expectedCards) || expectedCards > budget - spent)) return PASS;

  if (human.passed) {
    const winning = ranked.filter(({ next }) => margin(next) > 0).sort((a, b) => a.cost - b.cost)[0];
    if (winning && (!canPass || round > 1 || affordable(1))) return winning.action;

    const twoTurnWin = hard ? cheapestTwoTurnWin(ranked, search) : null;
    if (twoTurnWin && (!canPass || !dryPass && (round > 1 || (spent + 2 <= budget && affordable(2))))) {
      return twoTurnWin.action;
    }
    if (canPass && (dryPass || (round === 1 && (expectedCards > budget - spent || !affordable(expectedCards))))) return PASS;
    return ability && ability.rating > best.rating ? ability.action : best.action;
  }

  const candidates = [...ranked, ...withAbilities].sort((a, b) => b.rating - a.rating);
  if (!hard) {
    const near = candidates.filter(({ rating }) => candidates[0].rating - rating > .001 && candidates[0].rating - rating < .08);
    return near.length && Math.random() < .12 ? near[0].action : candidates[0].action;
  }
  let selected = candidates[0];
  let rating = -Infinity;
  for (const candidate of candidates.slice(0, 8)) {
    if (search.expired()) break;
    const score = replyRating(candidate, round, search);
    if (score > rating) {
      rating = score;
      selected = candidate;
    }
  }
  return selected.action;
}
