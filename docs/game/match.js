import { DECKS, FACTIONS, ROWS } from './cards.js';
import { createCard, opponent, ROW_LIMIT, units } from './board.js';
import { availableOrders, canUseLeader, enqueueCardEffect, runEffect } from './effects.js';

export { ROW_LIMIT } from './board.js';

const SIDES = ['human', 'bot'];
const STARTING_LIVES = 2;
export const ROUND_DRAW = 3;

export const HAND_LIMIT = 10;
export const MULLIGAN_LIMIT = 3;

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

function createPlayer(side, definitions, random, faction, charges) {
  const cards = definitions.map((definition, index) => createCard(`${side}-${index + 1}`, definition));
  const deck = shuffle(cards, random);
  return {
    lives: STARTING_LIVES,
    hand: deck.splice(0, HAND_LIMIT),
    deck,
    board: emptyBoard(),
    discard: [],
    exile: [],
    turns: 0,
    leader: faction ? { ...faction.leader, charges } : null,
    faction: faction?.name,
    passed: false,
  };
}

export function createMatch({ decks, humanFaction, random = Math.random, rules = MATCH_RULES } = {}) {
  const settings = { ...MATCH_RULES, ...rules };
  const human = FACTIONS[humanFaction];
  const bot = human ? FACTIONS[humanFaction === 'growth' ? 'protectorate' : 'growth'] : undefined;
  const selectedDecks = decks ?? (human ? { human: human.deck, bot: bot.deck } : DECKS);
  return {
    rules: settings,
    players: {
      human: createPlayer('human', selectedDecks.human, random, human, settings.leaderCharges),
      bot: createPlayer('bot', selectedDecks.bot, random, bot, settings.leaderCharges),
    },
    phase: 'mulligan',
    round: 1,
    starter: random() < 0.5 ? 'human' : 'bot',
    turn: null,
    result: null,
    log: [],
    tokenCount: 0,
    effects: [],
    pending: null,
    ending: null,
  };
}

export function rowScore(player, row) {
  return player.board[row].reduce((score, card) => score + card.power, 0);
}

export function totalScore(player) {
  return ROWS.reduce((score, row) => score + rowScore(player, row), 0);
}

export function canPlayCard(player, card) {
  return player.board[card.definition.row].length < ROW_LIMIT;
}

export function playableCards(player) {
  return player.hand.filter((card) => canPlayCard(player, card));
}

function swapStartingCards(player, selectedIds) {
  const returned = [];
  player.hand = player.hand.map((card) => {
    if (!selectedIds.has(card.id) || player.deck.length === 0) return card;
    returned.push(card);
    return player.deck.shift();
  });
  player.deck.push(...returned);
  return returned.length;
}

function beginRound(match) {
  match.phase = 'playing';
  match.turn = match.starter;
  match.log.push({ type: 'round-start', round: match.round, side: match.starter });
}

export function confirmMulligan(match, cardIds) {
  if (match.phase !== 'mulligan') return match;

  const selectedIds = new Set(cardIds);
  if (selectedIds.size > MULLIGAN_LIMIT) return match;
  if (cardIds.some((id) => !match.players.human.hand.some((card) => card.id === id))) {
    return match;
  }

  const next = structuredClone(match);
  const count = swapStartingCards(next.players.human, selectedIds);
  next.log.push({ type: 'mulligan', count });
  beginRound(next);
  progress(next, Math.random);
  return next;
}

function drawForRound(match, side) {
  const player = match.players[side];
  const drawn = player.deck.splice(0, ROUND_DRAW);
  const added = drawn.splice(0, HAND_LIMIT - player.hand.length);
  player.hand.push(...added);
  player.discard.push(...drawn);
  match.log.push({ type: 'draw', side, count: added.length, burned: drawn.length });
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
    for (const { card } of units(match, side)) {
      (card.definition.doomed ? player.exile : player.discard).push(card);
    }
    player.board = emptyBoard();
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
  beginRound(match);
}

function markPassed(match, side, reason) {
  match.players[side].passed = true;
  match.log.push({ type: 'pass', side, reason });
}

function progress(match, random) {
  while (match.phase === 'playing' && !match.pending) {
    if (match.effects.length > 0) {
      runEffect(match, match.effects.shift(), random);
      continue;
    }

    const side = match.turn;
    const player = match.players[side];
    const otherSide = opponent(side);
    if (match.ending === 'effects') {
      match.ending = 'advance';
      for (const { card } of units(match, side)) enqueueCardEffect(match, side, card, 'endTurn');
      continue;
    }
    if (match.ending === 'advance') {
      match.ending = null;
      player.turns += 1;
      if (player.passed && match.players[otherSide].passed) resolveRound(match);
      else if (!match.players[otherSide].passed) match.turn = otherSide;
      continue;
    }

    if (playableCards(player).length || canUseLeader(match, side) || availableOrders(match, side).length) return;
    markPassed(match, side, player.hand.length === 0 ? 'empty-hand' : 'full-row');
    match.ending = 'effects';
  }
}

function resumeEffect(match, side, action, random) {
  const { pending } = match;
  if (action.type !== 'target' || side !== pending.side || !pending.options.includes(action.cardId)) return match;
  const next = structuredClone(match);
  const choice = next.pending;
  choice.job[choice.key] = action.cardId;
  next.effects.unshift(choice.job);
  next.pending = null;
  progress(next, random);
  return next;
}

export function applyAction(match, side, action, { random = Math.random } = {}) {
  if (match.phase !== 'playing') return match;
  if (match.pending) return resumeEffect(match, side, action, random);
  if (match.turn !== side) return match;

  const player = match.players[side];
  const { type, cardId, position } = action;
  if (type === 'order' && !availableOrders(match, side).some(({ card }) => card.id === cardId)) return match;
  if (type === 'leader' && !canUseLeader(match, side)) return match;
  if (type !== 'play' && type !== 'pass' && type !== 'order' && type !== 'leader') return match;
  const cardIndex = type === 'play' && Number.isInteger(position) && position >= 0
    ? player.hand.findIndex((card) =>
      card.id === cardId && canPlayCard(player, card) && position <= player.board[card.definition.row].length)
    : -1;
  if (type === 'play' && cardIndex < 0) return match;

  const next = structuredClone(match);
  const current = next.players[side];
  if (type === 'pass') {
    markPassed(next, side, 'manual');
    next.ending = 'effects';
  } else if (type === 'play') {
    const [card] = current.hand.splice(cardIndex, 1);
    const row = card.definition.row;
    current.board[row].splice(position, 0, card);
    next.log.push({ type: 'play', side, row, name: card.definition.name, power: card.power });
    if (card.armor) next.log.push({ type: 'armor', side, name: card.definition.name, amount: card.armor });
    enqueueCardEffect(next, side, card, 'deploy');
    next.ending = 'effects';
  } else if (type === 'leader') {
    current.leader.charges -= 1;
    next.log.push({ type: 'leader', side, name: current.leader.name });
    next.effects.push({ effect: current.leader.effect, side });
  } else {
    const { card } = availableOrders(next, side).find((unit) => unit.card.id === cardId);
    const order = card.definition.order;
    card.readyAt = current.turns + order.cooldown + 1;
    next.log.push({ type: 'order', side, name: card.definition.name });
    next.effects.push({ effect: order.effect, side, sourceId: card.id, requiredSource: true });
  }

  progress(next, random);
  return next;
}
