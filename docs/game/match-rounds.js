// @ts-check

/** @typedef {import('../../types/contracts').MatchState} MatchState */
/** @typedef {import('../../types/contracts').Side} Side */

import {
  availableRows, cardType, changeCoins, createCard, discardCard, opponent, placementSide, placeCards,
  refreshRowPower, refreshSidePower, spendResilience, statusCount, takeCards,
} from './board.js';
import { FIRST_SIGNAL } from './cards.js';
import { carriedCoins } from './match-setup.js';
import { ROWS } from './card-metadata.js';
import { availableFees, availableOrders, canCast, canUseLeader, enqueueEndTurn, enqueueStartTurn, runEffect } from './effects.js';

const SIDES = ['human', 'bot'];
export const ROUND_DRAW = 3;
export const MULLIGAN_LIMIT = 3;
const LATER_MULLIGAN_LIMIT = 2;

export function rowScore(player, row) {
  return player.board[row].reduce((score, card) => score + (card.power ?? 0), 0);
}

export function totalScore(player) {
  return ROWS.reduce((score, row) => score + rowScore(player, row), 0);
}

export function canPlayCard(match, side, card) {
  return cardType(card) === 'effect' ? canCast(match, side, card) : availableRows(match.players[placementSide(side, card)], card).length > 0;
}

export function playableCards(match, side) {
  return match.players[side].hand.filter((card) => canPlayCard(match, side, card));
}

/**
 * @param {MatchState} match
 * @param {Side} side
 */
export function canPass(match, side) {
  return match.phase === 'playing' && match.turn === side && !match.pending &&
    !match.playedCard && !match.players[side].passed && !match.players[side].usedAbility;
}

/**
 * @param {MatchState} match
 * @param {Side} side
 */
export function canEndTurn(match, side) {
  return match.phase === 'playing' && match.turn === side && !match.pending &&
    (match.playedCard || (match.players[side].usedAbility && !playableCards(match, side).length));
}

export function mulliganLimit(match, side) {
  return (match.round === 1 ? MULLIGAN_LIMIT : LATER_MULLIGAN_LIMIT) + match.players[side].extraSwaps;
}

export function mulliganRemaining(match) {
  return match.phase === 'mulligan' ? mulliganLimit(match, 'human') - match.mulligan.used : 0;
}

function swapCards(player, selectedIds, random, excluded = []) {
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
  for (const card of returned) {
    const position = Math.floor(random() * (player.deck.length + 1));
    player.deck.splice(position, 0, card);
  }
  return returned.length;
}

export function replaceMulliganCard(match, cardId, { random = Math.random } = {}) {
  if (!mulliganRemaining(match)) return match;
  const card = match.players.human.hand.find(({ id }) => id === cardId);
  if (!card) return match;

  const next = structuredClone(match);
  const { mulligan } = next;
  if (!swapCards(next.players.human, new Set([cardId]), random, mulligan.excluded)) return match;
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
    human: next.mulligan.used + swapCards(human, selectedIds, random, next.mulligan.excluded),
    bot: swapCards(bot, new Set(botChoices), random),
  };
  for (const side of SIDES) {
    next.players[side].extraSwaps = 0;
    next.log.push({ type: 'mulligan', side, count: counts[side], round: next.round });
  }
  beginRound(next);
  beginTurn(next);
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
  for (const side of SIDES) {
    refreshSidePower(match, side);
    for (const row of ROWS) refreshRowPower(match, side, row);
    const coins = match.players[side].coins ?? 0;
    changeCoins(match, side, carriedCoins(match, coins) - coins);
    drawForRound(match, side);
  }
  match.phase = 'mulligan';
  match.mulligan = { used: 0, excluded: [] };
  match.turn = null;
}

function beginTurn(match) {
  match.startingTurn = true;
  enqueueStartTurn(match, match.turn);
}

export function markPassed(match, side, reason) {
  match.players[side].passed = true;
  match.log.push({ type: 'pass', side, reason });
}

export function progress(match, random) {
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
      if (match.playedCard && player.hand.length === 0) markPassed(match, side, 'empty-hand');
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
        beginTurn(match);
      }
      continue;
    }

    const startingTurn = match.startingTurn;
    match.startingTurn = false;
    if (match.playedCard) {
      if (availableOrders(match, side).length || canUseLeader(match, side) || availableFees(match, side).length) return;
      match.ending = 'effects';
      continue;
    }
    if (playableCards(match, side).length || availableFees(match, side).length) return;
    if (player.usedAbility) {
      match.log.push({ type: 'turn-skip', side });
      match.ending = 'effects';
      continue;
    }
    if (canUseLeader(match, side) || availableOrders(match, side).length) return;
    if (!startingTurn && player.hand.length === 0) return;
    const reason = player.hand.length === 0 ? 'empty-hand'
      : player.hand.every((card) => cardType(card) === 'effect') ? 'no-target' : 'full-row';
    markPassed(match, side, reason);
    match.ending = 'effects';
  }
}
