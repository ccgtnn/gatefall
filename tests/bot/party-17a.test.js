import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTAIN_CARDS, SKARA_REINHOLD } from '../../docs/game/captains.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { beneficialFee, effectSwing } from '../../docs/game/bot-effect-value.js';
import { chooseEasyTurn } from '../../docs/game/bot.js';
import { evaluatePosition } from '../../docs/game/bot-evaluation.js';
import { remainingTurns } from '../../docs/game/bot-future-value.js';
import { publicMatch } from '../../docs/game/bot-strategy.js';
import { applyAction } from '../../docs/game/match.js';
import { chooseBestBotTurn } from '../helpers/bot-choice.js';
import { pass, plain, position, standard } from '../helpers/bot-strategy.js';

const decide = (match) => chooseBestBotTurn(match, 4, { rolloutSamples: 0 });

test('a simulated reply consumes just one of five masked cards without auto-passing', () => {
  const match = position();
  match.turn = 'human';
  match.players.human.hand.push(plain('fifth', 5));
  const hidden = publicMatch(match);
  const [card] = hidden.players.human.hand;
  const next = applyAction(hidden, 'human', { type: 'play', cardId: card.id, row: 'orbit', position: 0 });
  assert.equal(next.players.human.passed, false);
  assert.equal(next.players.human.hand.length, 4);
  assert.equal(new Set(next.players.human.hand.map(({ id }) => id)).size, 4);
  assert.equal(remainingTurns(next, 'human'), 4);
});

test('infection and rot have more time to deal damage against six masked cards than against one', () => {
  const match = position();
  match.players.human.board.orbit = [plain('target', 10)];
  const infection = standard('infection', {
    id: 'infection', type: 'effect', name: 'Заражение',
    deploy: { steps: [{ action: 'status', status: 'infection', amount: 4, target: { scope: 'enemy' } }] },
  });
  const rot = standard('rot', FACTIONS.growth.pool.find(({ id }) => id === 'rot'));
  const swing = (card, size) => {
    match.players.human.hand = Array.from({ length: size }, (_, i) => plain('hidden-' + i, 5));
    return effectSwing(publicMatch(match), 'bot', card);
  };
  assert.ok(swing(infection, 6) > swing(infection, 1));
  assert.ok(swing(rot, 6) > swing(rot, 1));
});

test('six public cards even without placeholders give infection more time than one', () => {
  const match = position();
  match.players.human.board.orbit = [plain('target', 10)];
  match.players.human.hand = [plain('placeholder', 5)];
  const carrier = FACTIONS.growth.leaders.find(({ id }) => id === 'carrier');
  const infection = standard('infection', { id: 'infection', type: 'effect', deploy: carrier.ability });
  const swing = (size) => {
    match.players.human.publicHandSize = size;
    return effectSwing(match, 'bot', infection);
  };
  assert.ok(swing(6) > swing(1));
});

test('a ready Incubator does not displace a play with Initiative', () => {
  const match = position();
  const { bot } = match.players;
  bot.hand = [standard('smuggler', NEUTRAL_CARDS.find(({ id }) => id === 'smuggler')), plain('spare', 1)];
  bot.board.orbit = [standard('incubator', FACTIONS.growth.pool.find(({ id }) => id === 'incubator'))];
  assert.equal(decide(match).cardId, 'smuggler');
});

test('Smuggler gets Initiative on the first turn instead of opening with Skara', () => {
  const match = position();
  match.players.bot.hand = [standard('smuggler', NEUTRAL_CARDS.find(({ id }) => id === 'smuggler')), plain('spare', 1)];
  match.players.bot.leader = { ...SKARA_REINHOLD, charges: 1 };
  const action = decide(match);
  assert.equal(action.cardId, 'smuggler');
  assert.equal(applyAction(match, 'bot', action).players.bot.board[action.row][0].power, 6);
});

test('one Brood Mother charge costs at most about two evaluation points in round one', () => {
  const match = position();
  match.players.bot.leader = { ...FACTIONS.growth.leaders.find(({ id }) => id === 'brood-mother'), charges: 5 };
  const full = evaluatePosition(match, 'bot');
  match.players.bot.leader.charges -= 1;
  const cost = full - evaluatePosition(match, 'bot');
  assert.ok(cost > 0 && cost <= 2.1, `charge cost: ${cost}`);
});

const foreman = () => standard('foreman', CAPTAIN_CARDS.find(({ id }) => id === 'hound-foreman'));
const fee = { type: 'fee', cardId: 'foreman' };

test('with four coins and no better use, the bot values and pays the Foreman fee', () => {
  const match = position();
  match.playedCard = true;
  const { bot } = match.players;
  bot.turns = 4;
  bot.coins = 4;
  bot.board.surface = [foreman()];
  assert.deepEqual(beneficialFee(match, 'bot'), fee);
  assert.deepEqual(decide(match), fee);
  match.playedCard = false;
  assert.deepEqual(decide(match), fee);
  bot.hand.push(standard('recruiter', CAPTAIN_CARDS.find(({ id }) => id === 'hound-recruiter')));
  assert.equal(beneficialFee(match, 'bot'), undefined);
});

test('with five coins and a Fee available, the bot spends before passing in round one', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.hand = [];
  bot.coins = 5;
  bot.board.surface = [foreman(), plain('lead', 10)];
  human.passed = true;
  assert.deepEqual(decide(match), fee);
});

test('using an ability before a required play adds no extra forecast turn', () => {
  const match = position();
  const { bot } = match.players;
  bot.hand = [plain('one', 2), plain('two', 2)];
  bot.usedAbility = true;
  assert.equal(remainingTurns(match, 'bot'), 2);
  bot.hand.length = 0;
  assert.equal(remainingTurns(match, 'bot'), 1);
});

test('the bot passes on a tied second round when the opponent will lose their last life', () => {
  const match = position(2, 'bot');
  const { bot, human } = match.players;
  bot.board.surface = [plain('ally', 5)];
  human.board.surface = [plain('enemy', 5)];
  human.passed = true;
  assert.equal(applyAction(match, 'bot', pass).result, 'loss');
  assert.equal(evaluatePosition(match, 'bot'), 100);
  assert.equal(evaluatePosition(match, 'human'), -100);
  assert.deepEqual(decide(match), pass);
});

test('in round three the bot passes rather than annihilate its own strongest unit', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.lives = human.lives = 1;
  human.passed = true;
  human.board.orbit = [plain('enemy', 5)];
  bot.hand = [standard('annihilation', NEUTRAL_CARDS.find(({ id }) => id === 'annihilation'))];
  for (const backup of [[], [plain('another-ally', 8)]]) {
    bot.board.orbit = [plain('strongest', 10), ...backup];
    for (const level of [2, 4, 6]) {
      assert.deepEqual(chooseBestBotTurn(match, level, { rolloutSamples: 0 }), pass);
    }
    assert.deepEqual(chooseEasyTurn(match), pass);
  }
});
