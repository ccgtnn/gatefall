import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTAIN_CARDS, HOUND } from '../../docs/game/captains.js';
import { chooseBotTurn } from '../../docs/game/bot.js';
import { evaluatePosition } from '../../docs/game/bot-evaluation.js';
import { coinValue, futureContext } from '../../docs/game/bot-future-value.js';
import { samplePosition, visibleSupply } from '../../docs/game/bot-rollouts.js';
import { publicMatch } from '../../docs/game/bot-strategy.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/match.js';
import { plain, position, standard } from '../helpers/bot-strategy.js';

const eyes = () => standard('eyes', CAPTAIN_CARDS.find(({ id }) => id === 'hound-eyes'));
const decide = (match) => chooseBotTurn(match, 4, { random: () => .99, rolloutSamples: 0 });
const fee = { type: 'fee', cardId: 'eyes' };

test('level 4 spends its last coin before ending a final turn with an empty hand', () => {
  const match = position(3);
  match.players.bot.lives = match.players.human.lives = 1;
  const { bot, human } = match.players;
  bot.hand = [];
  bot.board.orbit = [eyes(), standard('hound', HOUND)];
  bot.coins = 1;
  human.board.orbit = [plain('lead', 9)];
  human.hand = [];
  human.passed = true;
  for (const playedCard of [false, true]) {
    match.playedCard = playedCard;
    assert.deepEqual(decide(match), fee);
    const pending = applyAction(match, 'bot', fee);
    const next = applyAction(pending, 'bot', { type: 'target', cardId: 'hound' });
    assert.equal(next.players.bot.coins, 0);
  }
});

test('level 4 spends surplus coins in the first round with just one useful Fee', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.board.orbit = [eyes(), standard('hound', HOUND)];
  bot.coins = 9;
  bot.hand = [plain('small', 1)];
  human.board.orbit = [plain('lead', 9)];
  human.passed = true;
  const context = futureContext(match, 'bot');
  assert.ok(Math.abs(coinValue(context, 9) - coinValue(context, 8) - .1) < 1e-9);
  assert.deepEqual(decide(match), fee);
});

test('a shield gains value against a known or visible heavy direct hit', () => {
  const match = position(3);
  match.players.bot.lives = match.players.human.lives = 1;
  const { bot, human } = match.players;
  const shielded = plain('shielded', 8);
  bot.board.orbit = [shielded];
  const strike = { steps: [{ action: 'damage', target: { scope: 'enemy' }, amount: 8 }] };
  const gun = standard('gun', { id: 'gun', name: 'Gun', power: 8, type: 'unit', order: strike });
  human.board.orbit = [gun];
  const value = (state) => {
    const target = state.players.bot.board.orbit[0];
    target.statuses = { shield: 1 };
    const withShield = evaluatePosition(state, 'bot');
    target.statuses = {};
    return withShield - evaluatePosition(state, 'bot');
  };
  const visible = value(publicMatch(match));
  gun.readyAt = 99;
  const noThreat = value(publicMatch(match));
  human.startingDeck = [{ id: 'hidden', definition: { ...gun.definition, deploy: strike, order: undefined } }];
  assert.ok(visible > noThreat);
  assert.ok(value(publicMatch(match, true)) > noThreat);
  assert.equal(value(publicMatch(match)), noThreat);
});

test('exact samples subtract public instances and ignore the real hand and deck order', () => {
  const cards = Array.from({ length: 14 }, (_, index) => plain('definition-' + (index % 7), 4).definition);
  const match = confirmMulligan(createMatch({ decks: { human: cards, bot: cards }, random: () => .99 }));
  match.turn = 'bot';
  const { human, bot } = match.players;
  bot.hand = [plain('one', 3), plain('two', 4)];
  const revealed = human.hand.shift();
  human.discard.push(revealed);
  const supply = visibleSupply(match, true, true);
  assert.equal(supply.length, cards.length - 1);
  assert.equal(supply.filter(({ card }) => card.id === revealed.definition.id).length, 1);
  const before = publicMatch(match, true);
  const first = samplePosition(match, supply, () => .5);
  const choices = [6, 7].map((level) => chooseBotTurn(match, level, { random: () => .99, rolloutSamples: 1 }));
  human.hand = human.hand.map(({ id }) => plain(id, 99));
  human.deck.reverse();
  assert.deepEqual(publicMatch(match, true), before);
  assert.deepEqual(samplePosition(match, visibleSupply(match, true, true), () => .5), first);
  for (const [index, level] of [6, 7].entries()) {
    assert.deepEqual(chooseBotTurn(match, level, { random: () => .99, rolloutSamples: 1 }), choices[index]);
  }
  assert.equal(publicMatch(match).players.human.knownDeck, undefined);
});
