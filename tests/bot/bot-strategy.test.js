import assert from 'node:assert/strict';
import test from 'node:test';
import { COIN_LIMIT, ROW_LIMIT, createCard } from '../../docs/game/engine/board.js';
import { CAPTAIN_CARDS, HOUND } from '../../docs/game/cards/factions/captains.js';
import { createBotView, pickBotTarget } from '../../docs/game/bot/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { BOT_LEVELS, chooseBotTurn as decideAtLevel } from '../../docs/game/bot/bot.js';
import { evaluatePosition } from '../../docs/game/bot/bot-evaluation.js';
import { visibleSupply } from '../../docs/game/bot/bot-rollouts.js';
import { readBotLevel } from '../../docs/game/bot/bot-levels.js';
import { delayedCardValue, futureContext, remainingTurns } from '../../docs/game/bot/bot-future-value.js';
import { publicMatch } from '../../docs/game/bot/bot-strategy.js';
import { deckCardValue, effectSwing } from '../../docs/game/bot/bot-effect-value.js';
import { AWAKENING, CHOIR_CARDS, TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { FACTIONS, LARVA } from '../../docs/game/cards/cards.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';

import { member, pass, plain, position, standard } from '../helpers/bot-strategy.js';

test('strategic bots keep playing with a narrow lead and can pass with a large lead', () => {
  const match = position();
  match.players.bot.board.orbit = [plain('lead', 4)];
  match.log.push({ type: 'play', side: 'bot' });
  assert.equal(chooseBotTurn(match, 4).type, 'play');
  assert.equal(chooseBotTurn(match, 2).type, 'play');

  match.log.push({ type: 'play', side: 'bot' });
  match.players.bot.board.orbit[0].power = 28;
  assert.deepEqual(chooseBotTurn(match, 4, { rolloutSamples: 0 }), pass);
  assert.deepEqual(chooseBotTurn(match, 6, { rolloutSamples: 0 }), pass);
});

test('level 4 spends its last removal in round two when a life is at stake', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.board.orbit = [plain('small-enemy', 2)];
  match.players.human.passed = true;
  match.players.bot.board.surface = [plain('survivor', 1)];
  match.players.bot.hand = [member('salvo', 'protectorate', 'orbital-salvo')];
  assert.deepEqual(chooseBotTurn(match, 4), { type: 'play', cardId: 'salvo' });

  match.players.bot.lives = 2;
  match.players.human.passed = false;
  match.players.bot.board.surface = [];
  assert.deepEqual(chooseBotTurn(match, 4), pass);
});

test('round one gives up expensive chases and respects the no-pass rule after an ability', () => {
  const match = position();
  match.players.human.board.orbit = [plain('ahead', 25)];
  assert.deepEqual(chooseBotTurn(match, 4), pass);
  match.players.bot.usedAbility = true;
  assert.equal(chooseBotTurn(match, 4).type, 'play');
});

test('round two can dry pass after winning round one and fights after losing it', () => {
  const won = position(2, 'bot');
  won.players.bot.hand = [plain('small', 2), plain('spare', 3)];
  won.players.human.board.orbit = [plain('lead', 22)];
  assert.deepEqual(chooseBotTurn(won, 4), pass);
  assert.deepEqual(chooseBotTurn(won, 6), pass);
  won.players.human.passed = true;
  won.players.human.board.orbit = [plain('passed-lead', 1)];
  assert.equal(chooseBotTurn(won, 4).type, 'play');

  const lost = position(2, 'human');
  lost.players.human.board.orbit = [plain('ahead', 18)];
  assert.equal(chooseBotTurn(lost, 4).type, 'play');
  assert.equal(chooseBotTurn(lost, 6).type, 'play');
});

test('in the deciding round a safe productive play wins a rating tie with pass', () => {
  const match = position(3, 'human');
  const { bot, human } = match.players;
  bot.lives = human.lives = 1;
  bot.board.orbit = [plain('ahead', 10)];
  bot.hand = [standard('surface-only', { id: 'surface-only', power: 1, requiredRow: 'surface' })];
  human.board.orbit = [plain('enemy', 5)];
  human.hand = [];
  for (const opponentPassed of [true, false]) {
    human.passed = opponentPassed;
    for (const difficulty of [2, 4, 6]) {
      const action = chooseBotTurn(match, difficulty);
      assert.equal(action.type, 'play', difficulty);
      assert.notStrictEqual(applyAction(match, 'bot', action), match, difficulty);
    }
  }

  bot.board.surface = Array.from({ length: ROW_LIMIT }, (_, i) => plain('filled-' + i, 1));
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), pass, difficulty);
  }
});

test('the deciding round refuses to pass with legal cards when behind or the opponent can still reply', () => {
  for (const difficulty of [2, 4, 6]) {
    const match = position(3);
    match.players.bot.hand = [plain('one', 1), plain('two', 2)];
    match.players.bot.board.orbit = [plain('ahead', 20)];
    assert.notEqual(chooseBotTurn(match, difficulty).type, 'pass');

    match.players.bot.board.orbit = [];
    match.players.human.board.orbit = [plain('enemy', 20)];
    match.players.human.passed = true;
    assert.equal(chooseBotTurn(match, difficulty).type, 'play');
  }
});

test('level 6 defends a passed second-round bleed with a cheap win', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.passed = true;
  match.players.human.board.orbit = [plain('bleed', 4)];
  match.players.bot.hand = [member('finisher', 'growth', 'colossus'), plain('cheap', 5)];
  assert.equal(chooseBotTurn(match, 6).cardId, 'cheap');
});

test('level 6 overtakes a passed opponent with one card and then passes', () => {
  const match = position(2, 'human');
  const { bot, human } = match.players;
  bot.lives = 1;
  bot.hand = [plain('two', 2), plain('five', 5)];
  human.hand = human.hand.slice(0, 2);
  human.board.orbit = [plain('lead', 3)];
  human.passed = true;
  const options = { random: () => .99 };

  const play = decideAtLevel(match, 6, options);
  assert.equal(play.type, 'play');
  assert.equal(play.cardId, 'five');
  const afterTurn = applyAction(match, 'bot', play);
  assert.deepEqual(afterTurn.players.bot.hand.map(({ id }) => id), ['two']);

  const takeRound = decideAtLevel(afterTurn, 6, options);
  assert.deepEqual(takeRound, pass);
  const nextRound = applyAction(afterTurn, 'bot', takeRound);
  assert.equal(nextRound.round, 3);
  assert.equal(nextRound.players.human.lives, 1);
});

test('level 6 banks a one-point lead after the opponent passes in round one', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.board.orbit = [plain('ahead', 4)];
  bot.hand = [plain('spare', 5)];
  human.board.orbit = [plain('behind', 3)];
  human.passed = true;

  assert.deepEqual(decideAtLevel(match, 6, { random: () => .99 }), pass);
});

test('a bot with a winning lead passes before using the Incubator', () => {
  const match = position();
  match.players.bot.board.surface = [member('incubator', 'growth', 'incubator'), plain('lead', 12)];
  match.players.human.passed = true;
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), pass, difficulty);
  }
});

test('levels 5–7 compare pass with plays using the match position', () => {
  for (const level of [5, 6, 7]) {
    const ahead = position(1);
    ahead.players.bot.board.orbit = [plain('lead', 24)];
    assert.deepEqual(chooseBotTurn(ahead, level), pass, 'bank a large lead at level ' + level);

    const behind = position(1);
    behind.players.human.board.orbit = [plain('enemy-lead', 26)];
    behind.players.bot.hand.pop();
    assert.deepEqual(chooseBotTurn(behind, level), pass, 'give up the chase at level ' + level);

    const close = position(2, 'human');
    close.players.human.passed = true;
    close.players.human.board.orbit = [plain('target-score', 4)];
    close.players.bot.hand = [plain('enough', 5), plain('excess', 12), plain('short', 2)];
    assert.equal(chooseBotTurn(close, level).cardId, 'enough', 'spend just enough at level ' + level);

    const final = position(3);
    final.players.bot.lives = final.players.human.lives = 1;
    final.players.human.passed = true;
    final.players.bot.board.orbit = [plain('lead', 30)];
    assert.equal(chooseBotTurn(final, level).type, 'play', 'prefer gaining points when both lines win the final round');
  }
});

test('level 1 can choose far down its shortlist and pass at the wrong time, deterministically', () => {
  const match = position(1);
  match.players.bot.hand = [10, 8, 6, 4, 2, 1].map((power) => plain('unit-' + power, power));
  const normal = decideAtLevel(match, 1, { random: () => .99 });
  const replay = (...rolls) => decideAtLevel(match, 1, { random: () => rolls.shift() ?? .99 });
  assert.equal(normal.type, 'play');
  assert.equal(replay(0, 0).type, 'pass');
  const mistake = replay(0, .99, .99);
  assert.notDeepEqual(mistake, normal);
  assert.deepEqual(replay(0, .99, .99), mistake);
  const decisions = Array.from({ length: 20 }, (_, index) =>
    replay((index + .5) / 20, .99, .99));
  assert.equal(decisions.filter((action) => action.cardId !== normal.cardId).length, 8);
});

test('with a round in hand the bot pressures round two and stops once the chase is too costly', () => {
  const match = position(2, 'bot');
  match.players.bot.hand = [6, 7, 8, 9].map((power) => plain('pressure-' + power, power));
  match.players.human.hand = [3, 4, 5, 6].map((power) => plain('defense-' + power, power));
  for (const level of [5, 6, 7]) assert.equal(chooseBotTurn(match, level).type, 'play');

  match.players.human.hand.splice(2);
  match.players.human.board.orbit = [plain('paid-for-lead', 24)];
  match.players.bot.hand.pop();
  for (const level of [5, 6, 7]) assert.deepEqual(chooseBotTurn(match, level), pass);
});
