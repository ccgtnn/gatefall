import { inspectDeck } from './decks.js?v=plague-art-2';
import { FACTIONS, FIRST_SIGNAL, ROWS } from './cards.js?v=plague-art-2';
import { announcePlay, availableRows, cardType, createCard, discardCard, HAND_LIMIT, opponent, placementSide, placeCards, playDestination, spendResilience, statusCount, takeCards } from './board.js?v=plague-art-2';
import { availableOrders, canCast, canUseLeader, enqueueCardEffect, enqueueEndTurn, enqueueStartTurn, orderAbility, playTiming, runEffect } from './effects.js?v=plague-art-2';

export { availableRows, HAND_LIMIT, ROW_LIMIT } from './board.js?v=plague-art-2';

const SIDES = ['human', 'bot'];
const STARTING_LIVES = 2;
export const ROUND_DRAW = 3;

export const MULLIGAN_LIMIT = 3;
const LATER_MULLIGAN_LIMIT = 2;

export const MATCH_RULES = Object.freeze({
  nextStarter: 'winner',
  leaderCharges: 1,
});

function emptyBoard() {
  return Object.fromEntries(ROWS.map((row) => [row, []]));
}

function shuffle(cards, random) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
  return cards;
}

function createPlayer(side, definitions, random, factionId, leader, charges) {
  const faction = FACTIONS[factionId];
  const cards = definitions.map((definition, index) => createCard(`${side}-${index + 1}`, definition));
  const deck = shuffle(cards, random);
  return {
    lives: STARTING_LIVES,
    hand: deck.splice(0, HAND_LIMIT),
    deck,
    board: emptyBoard(),
    rowEffects: {},
    discard: [],
    exile: [],
    turns: 0,
    usedAbility: false,
    roundActed: false,
    extraSwaps: 0,
    leader: leader ? { ...leader, charges } : null,
    faction: faction?.name,
    factionId,
    passed: false,
  };
}

export function createMatch({ decks, humanFaction = decks ? undefined : 'protectorate', humanLeader, random = Math.random, rules = MATCH_RULES } = {}) {
  const settings = { ...MATCH_RULES, ...rules };
  const human = FACTIONS[humanFaction];
  const botFaction = human ? (humanFaction === 'growth' ? 'protectorate' : 'growth') : undefined;
  const bot = FACTIONS[botFaction];
  const selectedDecks = decks ?? { human: human.deck, bot: bot.deck };
  const leader = human?.leaders.find(({ id }) => id === humanLeader) ?? human?.leader;
  const players = {
    human: createPlayer('human', selectedDecks.human, random, humanFaction, leader, settings.leaderCharges),
    bot: createPlayer('bot', selectedDecks.bot, random, botFaction, undefined, settings.leaderCharges),
  };
  const starter = random() < 0.5 ? 'human' : 'bot';
  if (bot) players.bot.leader = { ...bot.leaders[Math.floor(random() * bot.leaders.length)], charges: settings.leaderCharges };
  return {
    rules: settings,
    players,
    phase: 'mulligan',
    mulligan: { used: 0, excluded: [] },
    round: 1,
    starter,
    turn: null,
    result: null,
    log: [],
    tokenCount: 0,
    effects: [],
    pending: null,
    playedCard: false,
    ending: null,
  };
}

export function createDeckMatch(deck, options = {}) {
  const result = inspectDeck(deck);
  if (!result.valid) return null;
  const botFaction = deck.factionId === 'growth' ? 'protectorate' : 'growth';
  return createMatch({
    random: options.random,
    rules: options.rules,
    decks: { human: result.cards, bot: FACTIONS[botFaction].deck },
    humanFaction: deck.factionId,
    humanLeader: result.leader.id,
  });
}

export function rowScore(player, row) {
  return player.board[row].reduce((score, card) => score + (card.power ?? 0), 0);
}

export function totalScore(player) {
  return ROWS.reduce((score, row) => score + rowScore(player, row), 0);
}

export function canPlayCard(match, side, card) {
  return cardType(card) === 'effect' ? canCast(match, side, card) : availableRows(match.players[placementSide(side, card)]).length > 0;
}

export function playableCards(match, side) {
  return match.players[side].hand.filter((card) => canPlayCard(match, side, card));
}

export function canPass(match, side) {
  return match.phase === 'playing' && match.turn === side && !match.pending &&
    !match.playedCard && !match.players[side].passed && !match.players[side].usedAbility;
}

export function canEndTurn(match, side) {
  return match.phase === 'playing' && match.turn === side && !match.pending && match.playedCard;
}

export function mulliganLimit(match, side) {
  return (match.round === 1 ? MULLIGAN_LIMIT : LATER_MULLIGAN_LIMIT) + match.players[side].extraSwaps;
}

export function mulliganRemaining(match) {
  return match.phase === 'mulligan' ? mulliganLimit(match, 'human') - match.mulligan.used : 0;
}

function swapCards(player, selectedIds, excluded = []) {
  const blacklist = new Set(excluded);
  for (const card of player.hand) {
    if (selectedIds.has(card.id)) blacklist.add(card.definition.id);
  }
  const returned = [];
  player.hand = player.hand.map((card) => {
    if (!selectedIds.has(card.id)) return card;
    const index = player.deck.findIndex(({ definition }) => !blacklist.has(definition.id));
    if (index < 0) return card;
    returned.push(card);
    return player.deck.splice(index, 1)[0];
  });
  player.deck.push(...returned);
  return returned.length;
}

export function replaceMulliganCard(match, cardId) {
  if (!mulliganRemaining(match)) return match;
  const card = match.players.human.hand.find(({ id }) => id === cardId);
  if (!card) return match;

  const next = structuredClone(match);
  const { mulligan } = next;
  if (!swapCards(next.players.human, new Set([cardId]), mulligan.excluded)) return match;
  mulligan.used += 1;
  if (!mulligan.excluded.includes(card.definition.id)) mulligan.excluded.push(card.definition.id);
  return next;
}

function beginRound(match) {
  for (const player of Object.values(match.players)) player.roundActed = false;
  match.phase = 'playing';
  match.turn = match.starter;
  match.log.push({ type: 'round-start', round: match.round, side: match.starter });
  if (match.round === 1) {
    const card = createCard(FIRST_SIGNAL.id, FIRST_SIGNAL);
    placeCards(match.players[match.starter], 'surface', 0, [card]);
    match.log.push({ type: 'stratagem', side: match.starter, name: FIRST_SIGNAL.name });
  }
}

const mulliganValue = (card) => card.power ?? card.definition.provision ?? 0;

export function confirmMulligan(match, cardIds = [], { random = Math.random } = {}) {
  if (match.phase !== 'mulligan') return match;

  const selectedIds = new Set(cardIds);
  if (selectedIds.size > mulliganRemaining(match)) return match;
  if (cardIds.some((id) => !match.players.human.hand.some((card) => card.id === id))) {
    return match;
  }

  const next = structuredClone(match);
  const { human, bot } = next.players;
  const botChoices = [...bot.hand].sort((left, right) => mulliganValue(left) - mulliganValue(right))
    .slice(0, mulliganLimit(next, 'bot')).map(({ id }) => id);
  const counts = {
    human: next.mulligan.used + swapCards(human, selectedIds, next.mulligan.excluded),
    bot: swapCards(bot, new Set(botChoices)),
  };
  for (const side of SIDES) {
    next.players[side].extraSwaps = 0;
    next.log.push({ type: 'mulligan', side, count: counts[side], round: next.round });
  }
  beginRound(next);
  enqueueStartTurn(next, next.turn);
  progress(next, random);
  return next;
}

function drawForRound(match, side) {
  const player = match.players[side];
  const draw = Math.min(ROUND_DRAW, player.deck.length);
  const count = takeCards(player, draw).length;
  player.extraSwaps = draw - count;
  match.log.push({ type: 'draw', side, count, extraSwaps: player.extraSwaps });
}

function resolveRound(match) {
  const scores = {
    human: totalScore(match.players.human),
    bot: totalScore(match.players.bot),
  };
  const winner = scores.human === scores.bot ? null : (scores.human > scores.bot ? 'human' : 'bot');
  for (const side of SIDES) {
    const player = match.players[side];
    if (side !== winner) player.lives -= 1;
    for (const row of ROWS) {
      player.board[row] = player.board[row].filter((card) => {
        if (spendResilience(card)) return true;
        discardCard(match, side, card, Boolean(statusCount(card, 'doomed')));
        return false;
      });
    }
    player.rowEffects = {};
    player.passed = false;
  }
  match.log.push({ type: 'round-end', round: match.round, scores, winner });

  const { human, bot } = match.players;
  if (human.lives === 0 || bot.lives === 0) {
    match.phase = 'finished';
    match.turn = null;
    match.result = human.lives === bot.lives ? 'draw' : (human.lives > bot.lives ? 'win' : 'loss');
    return;
  }

  if (match.rules.nextStarter === 'alternate') {
    match.starter = opponent(match.starter);
  } else if (winner !== null) {
    match.starter = winner;
  }
  match.round += 1;
  for (const side of SIDES) drawForRound(match, side);
  match.phase = 'mulligan';
  match.mulligan = { used: 0, excluded: [] };
  match.turn = null;
}

function markPassed(match, side, reason) {
  match.players[side].passed = true;
  match.log.push({ type: 'pass', side, reason });
}

function progress(match, random) {
  while (match.phase === 'playing' && !match.pending) {
    if (match.effects.length > 0) {
      const job = match.effects.shift();
      if (job.discard) match.players[job.side].discard.push(job.discard);
      else runEffect(match, job, random);
      continue;
    }

    const side = match.turn;
    const player = match.players[side];
    const otherSide = opponent(side);
    if (match.ending === 'effects') {
      match.ending = 'advance';
      enqueueEndTurn(match, side);
      continue;
    }
    if (match.ending === 'advance') {
      match.ending = null;
      match.playedCard = false;
      player.turns += 1;
      player.usedAbility = false;
      if (player.passed && match.players[otherSide].passed) resolveRound(match);
      else {
        if (!match.players[otherSide].passed) match.turn = otherSide;
        enqueueStartTurn(match, match.turn);
      }
      continue;
    }

    if (match.playedCard) {
      if (availableOrders(match, side).length) return;
      match.ending = 'effects';
      continue;
    }
    if (playableCards(match, side).length) return;
    if (player.usedAbility) {
      match.log.push({ type: 'turn-skip', side });
      match.ending = 'effects';
      continue;
    }
    if (canUseLeader(match, side) || availableOrders(match, side).length) return;
    const reason = player.hand.length === 0 ? 'empty-hand'
      : player.hand.every((card) => cardType(card) === 'effect') ? 'no-target' : 'full-row';
    markPassed(match, side, reason);
    match.ending = 'effects';
  }
}

function resumeEffect(match, side, action, random, copy) {
  const { pending } = match;
  if (side !== pending.side) return match;
  const placement = pending.kind === 'deck-placement';
  const selection = placement && action.type === 'place' && pending.options.includes(action.row)
    ? playDestination(match.players[pending.selectionSide ?? side], action)
    : !placement && action.type === 'target' && pending.options.includes(action.cardId) && action.cardId;
  if (!selection) return match;
  const next = copy(match);
  const choice = next.pending;
  choice.job.refs[choice.key] = selection;
  next.effects.unshift(choice.job);
  next.pending = null;
  progress(next, random);
  return next;
}

export function applyAction(match, side, action, { random = Math.random, copy = structuredClone } = {}) {
  if (match.phase !== 'playing') return match;
  if (match.pending) return resumeEffect(match, side, action, random, copy);
  if (match.turn !== side) return match;

  const player = match.players[side];
  const { type, cardId } = action;
  if (type === 'pass' && !canPass(match, side)) return match;
  if (type === 'end-turn' && !canEndTurn(match, side)) return match;
  if (type === 'order' && !availableOrders(match, side).some(({ card }) => card.id === cardId)) return match;
  if (type === 'leader' && (match.playedCard || !canUseLeader(match, side))) return match;
  if (type !== 'play' && type !== 'pass' && type !== 'order' && type !== 'leader' && type !== 'end-turn') return match;
  const cardIndex = type === 'play' ? player.hand.findIndex(({ id }) => id === cardId) : -1;
  let destination;
  if (type === 'play') {
    const card = player.hand[cardIndex];
    if (match.playedCard || !card || !canPlayCard(match, side, card)) return match;
    if (cardType(card) !== 'effect') {
      destination = playDestination(match.players[placementSide(side, card)], action);
      if (!destination) return match;
    }
  }

  const next = copy(match);
  const current = next.players[side];
  if (type === 'pass') {
    markPassed(next, side, 'manual');
    next.ending = 'effects';
  } else if (type === 'end-turn') {
    next.ending = 'effects';
  } else if (type === 'play') {
    const [card] = current.hand.splice(cardIndex, 1);
    if (destination) {
      const { row, position } = destination;
      const recipient = placementSide(side, card);
      if (recipient !== side) card.owner = side;
      placeCards(next.players[recipient], row, position, [card]);
    }
    const timing = playTiming(next, side, card);
    const reactions = announcePlay(next, side, card, destination, timing === 'initiative' ? { initiative: true } : undefined);
    current.roundActed = true;
    enqueueCardEffect(next, side, card, timing, Boolean(destination));
    next.effects.push(...reactions);
    if (!destination) next.effects.push({ discard: card, side });
    next.playedCard = true;
  } else if (type === 'leader') {
    current.usedAbility = true;
    current.roundActed = true;
    current.leader.charges -= 1;
    next.log.push({ type: 'leader', side, name: current.leader.name });
    next.effects.push({ ability: current.leader.ability, side });
  } else {
    current.usedAbility = true;
    current.roundActed = true;
    const { card } = availableOrders(next, side).find((unit) => unit.card.id === cardId);
    const order = card.definition.order;
    card.readyAt = current.turns + (order.cooldown ?? 0) + 1;
    next.log.push({ type: 'order', side, name: card.definition.name, cardId: card.id });
    next.effects.push({ ability: orderAbility(order), side, sourceId: card.id, requiredSource: true });
  }

  progress(next, random);
  return next;
}
