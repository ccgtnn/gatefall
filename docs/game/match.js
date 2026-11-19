import { DECKS, ROWS } from './cards.js';

const SIDES = ['human', 'bot'];
const STARTING_LIVES = 2;
export const ROUND_DRAW = 3;

export const HAND_LIMIT = 10;
export const ROW_LIMIT = 9;
export const MULLIGAN_LIMIT = 3;

export const MATCH_RULES = Object.freeze({
  nextStarter: 'winner',
});

function opponent(side) {
  return side === 'human' ? 'bot' : 'human';
}

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

function createPlayer(side, definitions, random) {
  const cards = definitions.map((definition, index) => ({
    id: `${side}-${index + 1}`,
    definition,
    power: definition.power,
  }));
  const deck = shuffle(cards, random);
  return {
    lives: STARTING_LIVES,
    hand: deck.splice(0, HAND_LIMIT),
    deck,
    board: emptyBoard(),
    discard: [],
    passed: false,
  };
}

export function createMatch({ decks = DECKS, random = Math.random, rules = MATCH_RULES } = {}) {
  return {
    rules: { ...MATCH_RULES, ...rules },
    players: {
      human: createPlayer('human', decks.human, random),
      bot: createPlayer('bot', decks.bot, random),
    },
    phase: 'mulligan',
    round: 1,
    starter: random() < 0.5 ? 'human' : 'bot',
    turn: null,
    result: null,
    log: [],
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
  settleTurn(match);
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
    player.discard.push(...ROWS.flatMap((row) => player.board[row]));
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

function settleTurn(match) {
  while (true) {
    const side = match.turn;
    const player = match.players[side];
    const otherSide = opponent(side);
    if (!player.passed) {
      if (playableCards(player).length > 0) return;
      markPassed(match, side, player.hand.length === 0 ? 'empty-hand' : 'full-row');
    }
    if (match.players[otherSide].passed) {
      resolveRound(match);
      return;
    }
    match.turn = otherSide;
  }
}

export function applyAction(match, side, action) {
  if (match.phase !== 'playing' || match.turn !== side) return match;

  const player = match.players[side];
  const { type, cardId, position } = action;
  const cardIndex = type === 'play' && Number.isInteger(position) && position >= 0
    ? player.hand.findIndex((card) =>
      card.id === cardId && canPlayCard(player, card) && position <= player.board[card.definition.row].length)
    : -1;
  if (action.type !== 'pass' && cardIndex === -1) return match;

  const next = structuredClone(match);
  if (action.type === 'pass') {
    markPassed(next, side, 'manual');
  } else {
    const current = next.players[side];
    const [card] = current.hand.splice(cardIndex, 1);
    const row = card.definition.row;
    current.board[row].splice(position, 0, card);
    next.log.push({ type: 'play', side, row, name: card.definition.name, power: card.power });
  }

  next.turn = opponent(side);
  settleTurn(next);
  return next;
}
