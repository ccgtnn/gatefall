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

test('the level 2 bot evaluates deathwish sacrifices and skips the leader when there are no legal victims', () => {
  const match = position();
  const { bot } = match.players;
  bot.leader = { ...FACTIONS.growth.leaders.find(({ id }) => id === 'devourer'), charges: 1 };
  bot.board.orbit = [member('cocoon', 'growth', 'cocoon'), plain('neighbor', 4)];
  const pending = applyAction(match, 'bot', { type: 'leader' });
  assert.equal(chooseBotTurn(pending, 2).cardId, 'cocoon');
  bot.board.orbit = [];
  assert.equal(chooseBotTurn(match, 2).type, 'play');
});

test('the bot uses Skara to fund a Tribute and plays the Recruiter first near the coin cap', () => {
  for (const mode of [2, 4, 6]) {
    const match = position(3);
    match.players.bot.leader = { ...FACTIONS.captains.leader, charges: 1 };
    match.players.bot.coins = 2;
    match.players.bot.hand = [member('recruiter', 'captains', 'hound-recruiter'), plain('spare', 1)];
    const action = chooseBotTurn(match, mode, { rolloutSamples: 0 });
    assert.equal(action.type, 'leader');
    const pending = applyAction(match, 'bot', action);
    assert.ok(pending.pending.options.includes(chooseBotTurn(pending, mode).cardId));
    match.players.bot.coins = 8;
    assert.equal(chooseBotTurn(match, mode, { rolloutSamples: 0 }).cardId, 'recruiter');
  }
});

test('all difficulties prefer weak offerings and use the Priest to open an Awakening chapter', () => {
  for (const mode of [2, 4, 6]) {
    const match = position(3);
    match.players.bot.leader = { ...FACTIONS.choir.leader };
    match.players.bot.hand = [plain('spare', 1)];
    match.players.bot.lives = match.players.human.lives = 1;
    match.players.bot.board.surface = [plain('strong', 6), plain('weak', 1)];
    const action = chooseBotTurn(match, mode);
    assert.equal(action.type, 'leader');
    const pending = applyAction(match, 'bot', action);
    assert.deepEqual(chooseBotTurn(pending, mode, { rolloutSamples: 0 }), { type: 'target', cardId: 'weak' });
    match.players.bot.board.surface.pop();
    assert.notEqual(chooseBotTurn(match, mode).type, 'leader');
    const scenario = createCard('scenario', AWAKENING);
    scenario.chapter = 1;
    match.players.bot.board.orbit.push(scenario);
    match.players.bot.board.surface.push(plain('victim', 2));
    const offering = applyAction(match, 'bot', { type: 'leader' });
    const chapter = applyAction(offering, 'bot', chooseBotTurn(offering, mode, { rolloutSamples: 0 }));
    assert.equal(chapter.players.bot.board.orbit.find(({ id }) => id === scenario.id).chapter, 2);
  }
});

test('the bot pays the highest affordable tribute for the Hound Recruiter', () => {
  for (const [coins, cost, hounds] of [[5, '3', 2], [6, '6', 4]]) {
    const match = position();
    match.players.bot.coins = coins;
    match.players.bot.hand.unshift(member('recruiter', 'captains', 'hound-recruiter'));
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'recruiter', row: 'surface', position: 0 });
    assert.equal(pending.pending.kind, 'tribute');

    for (const difficulty of [2, 4, 6]) {
      const action = chooseBotTurn(pending, difficulty, { rolloutSamples: 0 });
      assert.deepEqual(action, { type: 'target', cardId: cost });
      const resolved = applyAction(pending, 'bot', action);
      assert.equal(resolved.players.bot.coins, coins - Number(cost));
      assert.equal(resolved.players.bot.board.surface.filter(({ definition }) => definition.id === HOUND.id).length, hounds);
    }
  }
});

test('the bot completes Right Fang’s order by moving its least valuable hand card to the bottom', () => {
  const match = position(3);
  match.players.human.passed = true;
  match.players.human.hand = [];
  match.players.human.deck = [];
  match.players.bot.board.orbit = [member('fang', 'captains', 'hound-right-fang'), standard('hound', HOUND)];
  match.players.bot.hand = [plain('strong', 8), plain('weak', 2)];
  match.players.bot.deck = [plain('drawn', 5), plain('already-in-deck', 4)];
  const order = applyAction(match, 'bot', { type: 'order', cardId: 'fang' });
  const pending = applyAction(order, 'bot', { type: 'target', cardId: 'hound' });
  assert.equal(pending.pending.kind, 'hand-bottom');
  assert.ok(pending.pending.options.includes('drawn'));

  for (const difficulty of [2, 4, 6]) {
    const action = chooseBotTurn(pending, difficulty);
    assert.deepEqual(action, { type: 'target', cardId: 'weak' });
    const resolved = applyAction(pending, 'bot', action);
    assert.deepEqual(resolved.players.bot.deck.map(({ id }) => id), ['already-in-deck', 'weak']);
    assert.ok(!resolved.players.bot.hand.some(({ id }) => id === 'weak'));
  }
});

test('all bots end a turn with an empty hand after already using an order', () => {
  const match = position(3);
  const bot = match.players.bot;
  bot.hand = [];
  bot.coins = 2;
  bot.board.orbit = [
    standard('order', { id: 'order', name: 'Order', power: 4, zeal: true, order: {
      steps: [{ action: 'boost', target: { scope: 'source' }, amount: 1 }],
    } }),
    member('eyes', 'captains', 'hound-eyes'),
    standard('strong-hound', HOUND),
  ];
  bot.board.orbit[2].power = 6;
  const first = { type: 'order', cardId: 'order' };
  const next = applyAction(match, 'bot', first);
  assert.equal(next.players.bot.usedAbility, true);
  assert.equal(canPass(next, 'bot'), false);
  assert.equal(canEndTurn(next, 'bot'), true);
  for (const difficulty of [2, 4, 6]) {
    const action = chooseBotTurn(next, difficulty);
    assert.deepEqual(action, { type: 'end-turn' });
    assert.notStrictEqual(applyAction(next, 'bot', action), next);
  }
});


test('all bots can spend a Generator charge on armor synergy', () => {
  const match = position(3);
  match.players.bot.hand = [member('formation', 'protectorate', 'standard')];
  const commander = member('commander', 'protectorate', 'commander');
  commander.readyAt = 10;
  match.players.bot.board.surface = [member('generator', 'protectorate', 'shield-generator'), commander, plain('large', 9)];
  match.players.human.board.surface = [plain('enemy', 20)];
  match.playedCard = true;
  const order = { type: 'order', cardId: 'generator' };
  const pending = applyAction(match, 'bot', order);
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'commander' });
  }
  const result = applyAction(pending, 'bot', chooseBotTurn(pending));
  assert.equal(result.players.bot.board.surface[1].armor, 2);
  assert.equal(result.players.bot.board.surface[0].orderCharges, 2);
});


test('each bot uses Incubator each turn with space and targets the available row', () => {
  for (const difficulty of [2, 4, 6]) {
    let match = position(3);
    const { bot, human } = match.players;
    bot.board.orbit = [member('incubator', 'growth', 'incubator'),
      ...Array.from({ length: 8 }, (_, i) => plain('blocked-' + i, 1))];
    bot.hand = [plain('keep', 2), plain('spare', 2)];
    human.board.orbit = [plain('enemy', 20)];
    const order = { type: 'order', cardId: 'incubator' };
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
    match = applyAction(match, 'bot', order);
    assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'target', cardId: 'surface' });
    match = applyAction(match, 'bot', chooseBotTurn(match, difficulty));
    assert.equal(match.players.bot.board.surface.length, 2);
    assert.notDeepEqual(chooseBotTurn(match, difficulty), order);
    match = applyAction(match, 'bot', { type: 'play', cardId: 'keep', row: 'surface', position: 2 });
    match = applyAction(match, 'human', { type: 'pass' });
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
  }
});

test('Predator lets every bot choose a friendly Deathwish rather than an enemy', () => {
  for (const difficulty of [2, 4, 6]) {
    const match = position(3);
    match.players.bot.hand = [member('predator', 'growth', 'predator')];
    match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon')];
    match.players.human.board.surface = [plain('enemy', 12)];
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'predator', row: 'surface', position: 1 });
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'cocoon' });
    const next = applyAction(pending, 'bot', chooseBotTurn(pending, difficulty));
    assert.deepEqual(next.players.bot.board.surface.map(({ power }) => power), [1, 1, 7]);
  }
});

test('all bots hold Genome Keeper with an empty discard and play it with three useful Deathwishes', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const card = (id) => standard(id, FACTIONS.growth.pool.find((definition) => definition.id === id));
  bot.hand = [card('genome-keeper'), plain('alternative', 4), card('predator')];
  human.board.surface = [plain('foe', 10), plain('another', 7)];
  const modes = [2, 4, 6];
  for (const mode of modes) assert.notEqual(chooseBotTurn(match, mode, { rolloutSamples: 0 }).cardId, 'genome-keeper');
  bot.discard = ['acid-capsule', 'cocoon', 'spore-sac'].map(card);
  for (const mode of modes) assert.equal(chooseBotTurn(match, mode, { rolloutSamples: 0 }).cardId, 'genome-keeper', mode);
});

test('all bots prefer a Deathwish or Larva over consuming an equally strong plain unit', () => {
  for (const sacrifice of [standard('larva', LARVA), member('cocoon', 'growth', 'cocoon')]) {
    const match = position(3);
    const { bot } = match.players;
    bot.hand = [member('predator', 'growth', 'predator'), plain('alternate', 3)];
    bot.board.surface = [plain('blank', sacrifice.power), sacrifice];
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'predator', row: 'surface', position: 2 });
    for (const mode of [2, 4, 6]) {
      assert.equal(chooseBotTurn(pending, mode, { rolloutSamples: 0 }).cardId, sacrifice.id, mode);
    }
  }
});

test('strategic tribute spends only for seats it can fill and keeps coins for useful Fees', () => {
  const match = position(3);
  const bot = match.players.bot;
  const recruiter = CAPTAIN_CARDS.find(({ id }) => id === 'hound-recruiter');
  const foreman = CAPTAIN_CARDS.find(({ id }) => id === 'hound-foreman');
  bot.coins = 6;
  bot.hand.unshift(standard('recruiter', recruiter));
  bot.board.orbit = [standard('fee', foreman)];
  bot.board.surface = Array.from({ length: ROW_LIMIT - 4 }, (_, i) => plain('filler-' + i, 3));
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'recruiter', row: 'surface', position: bot.board.surface.length });
  assert.equal(pending.pending.kind, 'tribute');
  for (const difficulty of [4, 6]) {
    assert.equal(chooseBotTurn(pending, difficulty, { rolloutSamples: 0 }).cardId, '3');
  }
  pending.players.bot.board.surface.splice(0, 2);
  assert.equal(chooseBotTurn(pending, 6, { rolloutSamples: 0 }).cardId, '6');
});

