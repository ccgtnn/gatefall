import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotAction, createBotView } from '../docs/game/bot.js';
import { createMatch, ROW_LIMIT } from '../docs/game/match.js';

const cards = [8, 3, 5, 1].map((power) => ({ id: String(power), power }));

function choose(details, rules) {
  return chooseBotAction({ cards, score: 0, opponentScore: 0, opponentPassed: false, ...details }, rules);
}

test('the bot picks a median-strength card in normal play', () => {
  assert.deepEqual(choose({}), { type: 'play', cardId: '3' });
});

test('the bot passes with a large lead, and the threshold is configurable', () => {
  assert.deepEqual(choose({ score: 12 }), { type: 'pass' });
  assert.deepEqual(choose({ score: 12 }, { passLead: 13 }), { type: 'play', cardId: '3' });
});

test('the bot passes if the opponent has passed while behind', () => {
  assert.deepEqual(choose({ score: 1, opponentPassed: true }), { type: 'pass' });
});

test('the bot uses the weakest card that strictly beats a passed opponent', () => {
  assert.deepEqual(choose({ opponentScore: 3, opponentPassed: true }), { type: 'play', cardId: '5' });
  assert.deepEqual(choose({ opponentPassed: true }), { type: 'play', cardId: '1' });
});

test('the bot passes if a single card cannot overtake or there are no playable cards', () => {
  assert.deepEqual(choose({ opponentScore: 8, opponentPassed: true }), { type: 'pass' });
  assert.deepEqual(choose({ cards: [] }), { type: 'pass' });
});

test('the bot view gives legal cards from its own hand and public opponent information', () => {
  const match = createMatch({ random: () => 0.999 });
  const { human, bot } = match.players;
  bot.board.orbit = Array(ROW_LIMIT).fill(bot.hand[0]);
  human.passed = true;
  const view = createBotView(match);
  assert.deepEqual(Object.keys(view).sort(), ['cards', 'opponentPassed', 'opponentScore', 'score']);
  assert.deepEqual(view.cards, bot.hand.filter((card) => card.definition.row === 'surface'));
  assert.equal(view.opponentPassed, true);
});
