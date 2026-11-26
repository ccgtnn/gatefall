import assert from 'node:assert/strict';
import test from 'node:test';
import { COIN_LIMIT, ROW_LIMIT, createCard } from '../../docs/game/board.js';
import { CAPTAIN_CARDS, HOUND } from '../../docs/game/captains.js';
import { createBotView, pickBotTarget } from '../../docs/game/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { BOT_LEVELS, chooseBotTurn as decideAtLevel } from '../../docs/game/bot.js';
import { evaluatePosition } from '../../docs/game/bot-evaluation.js';
import { visibleSupply } from '../../docs/game/bot-rollouts.js';
import { readBotLevel } from '../../docs/game/bot-levels.js';
import { delayedCardValue, futureContext, remainingTurns } from '../../docs/game/bot-future-value.js';
import { publicMatch } from '../../docs/game/bot-strategy.js';
import { deckCardValue, effectSwing } from '../../docs/game/bot-effect-value.js';
import { AWAKENING, CHOIR_CARDS, TENTACLE } from '../../docs/game/choir.js';
import { FACTIONS, LARVA } from '../../docs/game/cards.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch } from '../../docs/game/match.js';

import { member, pass, plain, position, standard } from '../helpers/bot-strategy.js';

test('the strategic bot inserts between two armored allies for the double boost', () => {
  const match = position(3);
  match.players.bot.hand = [member('standard', 'protectorate', 'standard')];
  match.players.bot.board.surface = [member('left', 'protectorate', 'assault'), member('right', 'protectorate', 'warden')];
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty),
      { type: 'play', cardId: 'standard', row: 'surface', position: 1 });
  }
});

test('strategic bot uses a zealous Scavenger order to trigger a deathwish across rows', () => {
  const match = position(3);
  match.players.bot.lives = match.players.human.lives = 1;
  match.players.human.passed = true;
  match.players.human.hand = [];
  match.players.human.board.surface = [plain('lead', 9)];
  match.players.bot.hand = [member('eater', 'growth', 'scavenger')];
  match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon'), standard('larva', LARVA)];
  const played = applyAction(match, 'bot', { type: 'play', cardId: 'eater', row: 'orbit', position: 0 });
  for (const difficulty of [4, 6]) {
    const order = chooseBotTurn(played, difficulty);
    assert.deepEqual(order, { type: 'order', cardId: 'eater' });
    const pending = applyAction(played, 'bot', order);
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'cocoon' });
  }
});

test('changing the opponent’s hidden cards or either deck order cannot change a decision', () => {
  const match = position(3);
  const hidden = structuredClone(match);
  hidden.players.human.hand = hidden.players.human.hand.map(({ id }) => plain(id, 1000));
  hidden.players.human.deck = hidden.players.human.deck.toReversed().map(({ id }) => plain(id, 1000));
  hidden.players.bot.deck.reverse();
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), chooseBotTurn(hidden, difficulty));
  }
});

test('the bot cashes in its armored row for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('overload', 'protectorate', 'shield-overload'), plain('ordinary', 1)];
  match.players.bot.board.orbit = [member('small-shield', 'protectorate', 'assault')];
  match.players.bot.board.surface = [member('big-shield', 'protectorate', 'bastion')];
  match.players.human.board.orbit = [plain('enemy', 15)];
  // Isolate the armor payoff from the hidden cards sampled by hard mode.
  match.players.human.hand = [];
  match.players.human.passed = true;
  match.players.human.deck = [];
  for (const difficulty of [2, 4, 6]) {
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'overload' });
    if (difficulty !== 2) assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'play', cardId: 'overload' });
    const ownRow = chooseBotTurn(pending, difficulty);
    assert.deepEqual(ownRow, { type: 'target', cardId: 'surface' });
    const enemy = applyAction(pending, 'bot', ownRow);
    assert.deepEqual(chooseBotTurn(enemy, difficulty), { type: 'target', cardId: 'orbit' });
  }
});

test('the bot plays Broodlord in the row with three larvae', () => {
  const match = position(3);
  match.players.bot.hand = [member('lord', 'growth', 'broodlord'), plain('ordinary', 5)];
  match.players.bot.board.orbit = [standard('spare-larva', LARVA)];
  match.players.bot.board.surface = ['a', 'b', 'c'].map((id) => standard(id, LARVA));
  // Compare the two row payoffs without sampling the opponent's hidden responses.
  match.players.human.hand = [];
  match.players.human.deck = [];
  match.players.human.board.orbit = [plain('enemy', 9)];
  for (const difficulty of [4, 6]) {
    const action = chooseBotTurn(match, difficulty);
    assert.equal(action.cardId, 'lord');
    assert.equal(action.row, 'surface');
  }

  const { definition } = match.players.bot.hand[0];
  match.players.bot.hand[0] = standard('lord', { ...definition, id: 'another-brood-finisher' });
  const [finisher] = createBotView(match).cards;
  assert.equal(finisher.preferredRow, 'surface');
  assert.equal(finisher.swing, finisher.power + 3);
});

test('bot preserves finishers when their current payoff is weak', () => {
  for (const difficulty of [4, 6]) {
    const shields = position(3);
    shields.players.bot.hand = [member('overload', 'protectorate', 'shield-overload'), plain('ordinary', 4)];
    shields.players.bot.board.orbit = [member('small', 'protectorate', 'assault')];
    shields.players.human.board.orbit = [plain('enemy', 2)];
    assert.equal(chooseBotTurn(shields, difficulty).cardId, 'ordinary');

    const brood = position(3);
    brood.players.bot.hand = [member('lord', 'growth', 'broodlord'), plain('ordinary', 4)];
    assert.equal(chooseBotTurn(brood, difficulty).cardId, 'ordinary');
  }
});

test('both strategic bots explore multiple targets in one chain', () => {
  const match = position(3);
  match.players.bot.hand = [member('shot', 'growth', 'ravager')];
  match.players.bot.board.surface = [plain('costly', 8), member('spores', 'growth', 'spore-sac')];
  match.players.human.board.surface = [plain('small', 2), plain('large', 6)];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'shot', row: 'orbit', position: 0 });
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'spores' });
  }
});

test('level 6 anticipates a visible Surface-only reply without reading the enemy hand', () => {
  const match = position(3);
  match.players.human.hand.length = 2;
  match.players.bot.hand = [plain('ship', 6), plain('spare', 1)];
  match.players.bot.board.surface = [standard('armor-aura', {
    type: 'artifact', endTurn: { steps: [{ action: 'armor', target: { scope: 'neighbors' }, amount: 1 }] },
  })];
  match.players.human.leader = { name: 'Surface battery', charges: 1, ability: {
    select: [{ ref: 'enemy', targets: { scope: 'enemy', type: 'unit', row: 'surface' } }],
    steps: [{ action: 'damage', target: { scope: 'ref', ref: 'enemy' }, amount: 6 }],
  } };
  assert.equal(chooseBotTurn(match, 2).row, 'surface');
  assert.equal(chooseBotTurn(match, 6, { rolloutSamples: 0 }).row, 'orbit');
});

test('level 6 places Gate Guardian outside the row it is building for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('guard', 'protectorate', 'gate-guardian'),
    member('overload', 'protectorate', 'shield-overload')];
  match.players.bot.board.orbit = [member('bastion', 'protectorate', 'bastion')];
  const action = chooseBotTurn(match, 6);
  assert.equal(action.cardId, 'guard');
  assert.equal(action.row, 'surface');
});

test('the bot prioritizes new infection over refreshing an already infected enemy', () => {
  const match = position(3);
  match.players.bot.board.orbit = [member('spitter', 'growth', 'spitter')];
  const already = plain('infected', 8);
  already.armor = 10;
  already.statuses = { infection: 3 };
  const fresh = plain('fresh', 3);
  fresh.armor = 10;
  match.players.human.board.orbit = [already, fresh];
  const pending = applyAction(match, 'bot', { type: 'order', cardId: 'spitter' });
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'fresh' });
  }
});

test('bot avoids breaking enemy fresh Boil and allied grown Boil when alternatives exist', () => {
  const match = position(3);
  const definition = FACTIONS.growth.pool.find(({ id }) => id === 'boil');
  match.players.human.board.surface = [standard('enemy-boil', definition), plain('enemy-unit', 4)];
  match.pending = { side: 'bot', options: ['enemy-boil', 'enemy-unit'], kind: 'damage', amount: 3 };
  assert.equal(pickBotTarget(match).cardId, 'enemy-unit');
  match.players.bot.board.orbit = [standard('own-boil', definition), { ...plain('armored', 2), armor: 1 }];
  match.players.bot.board.orbit[0].power = 8;
  match.pending = { side: 'bot', options: ['own-boil', 'armored'], kind: 'spend-armor' };
  assert.equal(pickBotTarget(match).cardId, 'armored');
});

test('all difficulties pay to restore Left Fang when it can hit a packed enemy row', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const fang = member('fang', 'captains', 'hound-left-fang');
  fang.readyAt = bot.turns + 1;
  bot.coins = 5;
  bot.board.orbit = [fang, standard('token', HOUND)];
  bot.board.orbit[1].power = 1;
  human.board.surface = Array.from({ length: 8 }, (_, i) => plain('enemy-' + i, 1));
  human.passed = true;
  match.playedCard = true;
  const fee = { type: 'fee', cardId: 'fang' };
  for (const difficulty of [2, 4, 6]) {
    const options = { random: () => .5, rolloutSamples: 0 };
    assert.deepEqual(chooseBotTurn(match, difficulty, options), fee, difficulty);
    const ready = applyAction(match, 'bot', fee);
    assert.equal(ready.players.bot.coins, 0);
    assert.deepEqual(chooseBotTurn(ready, difficulty, options), { type: 'order', cardId: 'fang' }, difficulty);
  }
  human.board.surface = [];
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'end-turn' }, difficulty);
  }
});

test('Fang Orders destroy a weak Hound, accounting for a useful Deathwish', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const spores = member('spores', 'growth', 'spore-sac').definition;
  bot.board.orbit = [
    member('fang', 'captains', 'hound-left-fang'),
    standard('weak-token', HOUND),
    standard('useful-deathwish', { ...spores, categories: HOUND.categories, power: 3 }),
    standard('strong-hound', { ...HOUND, power: 7 }),
  ];
  human.board.surface = [plain('enemy', 5)];
  const pending = applyAction(match, 'bot', { type: 'order', cardId: 'fang' });
  // A grown Larva can repay more than the extra strength spent on the victim.
  pending.players.bot.board.orbit[2].growth = 5;
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'useful-deathwish' }, difficulty);
  }
  pending.players.bot.board.orbit[2].growth = 0;
  assert.deepEqual(pickBotTarget(pending), { type: 'target', cardId: 'weak-token' });
});

test('Call of the Deep prefers the weakest ally even with a stronger enemy on the field', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.hand.push(member('call', 'choir', 'call-of-the-deep'));
  bot.board.orbit = [plain('weak-ally', 2)];
  bot.board.surface = [plain('strong-ally', 9)];
  human.board.surface = [plain('enemy', 15)];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'call' });
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'weak-ally' }, difficulty);
  }
});

test('Hound Eyes transforms the Hound that gains the most power', () => {
  const match = position(3);
  const { bot } = match.players;
  bot.coins = 2;
  bot.board.orbit = [member('eyes', 'captains', 'hound-eyes'), standard('hound-a', HOUND), standard('hound-b', HOUND)];
  bot.board.orbit[1].power = 1;
  bot.board.orbit[2].power = 6;
  const pending = applyAction(match, 'bot', { type: 'fee', cardId: 'eyes' });
  assert.deepEqual(pickBotTarget(pending), { type: 'target', cardId: 'hound-a' });
});

test('strategic placement respects a mandatory row even when the preferred row differs', () => {
  const match = position(3);
  const resident = standard('resident', { id: 'resident', name: 'Resident', power: 9,
    requiredRow: 'surface', preferredRow: 'orbit' });
  match.players.bot.hand = [plain('spare', 1), resident];
  match.players.human.passed = true;
  match.players.human.board.surface = [plain('lead', 6)];
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty),
      { type: 'play', cardId: 'resident', row: 'surface', position: 0 });
  }
});

