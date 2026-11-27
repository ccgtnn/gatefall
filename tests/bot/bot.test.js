import assert from 'node:assert/strict';
import test from 'node:test';
import { DECKS } from '../helpers/prototype-decks.js';
import { BOT_RULES, chooseBotAction, createBotView } from '../../docs/game/bot/bot.js';
import {
  ROW_LIMIT, applyAction, confirmMulligan, createMatch,
} from '../../docs/game/engine/match.js';

function card(power, id = String(power)) {
  return { id, power, definition: { name: id } };
}

function choose(details, rules) {
  const cards = details.cards ?? [8, 3, 5, 1].map((power) => card(power));
  return chooseBotAction({
    cards,
    score: 0,
    opponentScore: 0,
    opponentPassed: false,
    lives: 2,
    opponentLives: 2,
    handSize: cards.length,
    opponentHandSize: 2,
    rowLengths: { orbit: 0, surface: 0 },
    ...details,
  }, rules);
}

const play = (cardId, position = 0, row = 'orbit') => ({ type: 'play', cardId, row, position });
const pass = { type: 'pass' };

test('the bot picks a median-strength card and appends it to a row with space', () => {
  assert.deepEqual(choose({ rowLengths: { orbit: 2, surface: 1 } }), play('3', 1, 'surface'));
});

test('the bot may pass with a large lead, except when it has one life left', () => {
  assert.deepEqual(choose({ score: 12 }), pass);
  assert.deepEqual(choose({ score: 12 }, { ...BOT_RULES, passLead: 13 }), play('3'));
  assert.deepEqual(choose({ score: 12, lives: 1 }), play('3'));
});

test('the bot passes if the opponent has passed while behind', () => {
  assert.deepEqual(choose({ score: 1, opponentPassed: true }), pass);
});

test('the bot uses the weakest card that wins, including when currently tied', () => {
  assert.deepEqual(choose({ opponentScore: 3, opponentPassed: true }), play('5'));
  assert.deepEqual(choose({ opponentPassed: true }), play('1'));
});

test('the bot favors one stronger card over a weaker two-card combination', () => {
  assert.deepEqual(choose({
    cards: [2, 3, 8].map((power) => card(power)), opponentScore: 4, opponentPassed: true,
  }), play('8'));
});

test('among minimum-length wins it spends the lowest total power and preserves the strongest card on a tie', () => {
  assert.deepEqual(choose({
    cards: [2, 3, 7, 9].map((power) => card(power)), opponentScore: 11,
    opponentPassed: true, lives: 1,
  }), play('3'));
  assert.deepEqual(choose({
    cards: [2, 4, 6, 7, 9].map((power) => card(power)), opponentScore: 10,
    opponentPassed: true, lives: 1,
  }), play('4')); // Both 4 + 7 and 2 + 9 make 11. The bot keeps the 9.
});

test('at 15 to 5, a bot on one life plays 6 and 7 in consecutive legal turns', () => {
  let match = confirmMulligan(createMatch({ decks: DECKS, random: () => 0.999 }), []);
  match.round = 3;
  const { human, bot } = match.players;
  human.lives = bot.lives = 1;
  human.board.orbit = [card(7, 'human-7'), card(8, 'human-8')];
  bot.board.orbit = [card(5, 'bot-5')];
  bot.board.surface = [];
  bot.hand = [card(6), card(7)];
  match.turn = 'human';

  match = applyAction(match, 'human', pass);
  assert.deepEqual(chooseBotAction(createBotView(match)), play('6', 0, 'surface'));
  match = applyAction(match, 'bot', play('6', 0, 'surface'));
  assert.equal(match.turn, 'bot');
  assert.deepEqual(chooseBotAction(createBotView(match)), play('7', 1, 'orbit'));
  match = applyAction(match, 'bot', play('7', 1, 'orbit'));
  assert.equal(match.result, 'loss');
  const round = match.log.find(({ type }) => type === 'round-end');
  assert.deepEqual(round.scores, { human: 15, bot: 18 });
});

test('a multi-card win needs enough combined spaces across both rows', () => {
  const details = {
    cards: [card(7), card(6), card(4)],
    rowLengths: { orbit: ROW_LIMIT - 1, surface: ROW_LIMIT - 1 },
    score: 5, opponentScore: 15, opponentPassed: true, lives: 1,
  };
  assert.deepEqual(choose(details), play('4', ROW_LIMIT - 1));
  assert.deepEqual(choose({ ...details, rowLengths: { orbit: ROW_LIMIT - 1, surface: ROW_LIMIT } }), pass);
  assert.deepEqual(choose({ ...details, cards: [] }), pass);
});

test('with two lives the bot spends according to the hand deficit it would carry into the next round', () => {
  const details = {
    cards: [card(6), card(7), card(1), card(2)],
    score: 5, opponentScore: 15, opponentPassed: true,
  };
  assert.deepEqual(choose({ ...details, opponentHandSize: 3 }), play('6'));
  assert.deepEqual(choose({ ...details, opponentHandSize: 4 }), pass);
  assert.deepEqual(choose({ ...details, opponentHandSize: 4, opponentLives: 1 }), play('6'));
});

test('the bot accounts for the next draw filling both hands', () => {
  assert.deepEqual(choose({
    cards: [card(6), card(7), ...Array.from({ length: 8 }, (_, index) => card(1, `low-${index}`))],
    score: 5, opponentScore: 15, opponentPassed: true, opponentHandSize: 10,
  }), play('6'));
});

test('the bot view includes legal plays, row space and public opponent information', () => {
  const match = createMatch({ decks: DECKS, random: () => 0.999 });
  const { human, bot } = match.players;
  bot.board.orbit = Array(ROW_LIMIT).fill(bot.hand[0]);
  human.passed = true;
  human.lives = 1;
  const view = createBotView(match);
  assert.deepEqual(Object.keys(view).sort(), [
    'cards', 'handSize', 'lives', 'mustPlay', 'opponentHandSize', 'opponentLives', 'opponentPassed',
    'opponentScore', 'rowLengths', 'score',
  ]);
  assert.deepEqual(view.cards, bot.hand);
  assert.deepEqual(view.rowLengths, { orbit: ROW_LIMIT, surface: 0 });
  assert.equal(view.opponentPassed, true);
  assert.equal(view.opponentLives, 1);
  assert.equal(view.opponentHandSize, human.hand.length);
});
