import assert from 'node:assert/strict';
import test from 'node:test';
import { COIN_LIMIT, ROW_LIMIT, applyStatus, createCard, findUnit } from '../../docs/game/engine/board.js';
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

test('the position evaluation counts the Fence payout only while coins can fit', () => {
  const fence = CAPTAIN_CARDS.find(({ id }) => id === 'stolen-goods-fence');
  const control = { ...fence, id: 'plain-fence', counter: undefined };
  const match = position();
  match.players.bot.deck = [];
  match.players.bot.hand = [plain('spare-a', 3), plain('spare-b', 3), plain('spare-c', 3)];
  const rating = (definition) => {
    match.players.bot.board.orbit = [standard('producer', definition)];
    return evaluatePosition(match, 'bot');
  };
  assert.ok(rating(fence) > rating(control));
  match.players.bot.coins = COIN_LIMIT;
  assert.equal(rating(fence), rating(control));
});

test('Vine and Spore Sac gain forecast value as they mature, and Fence needs time to pay out', () => {
  const match = position(3);
  match.players.human.board.surface = ['a', 'b', 'c'].map((id) => plain(id, 8));
  match.players.bot.hand.push(member('predator', 'growth', 'predator'));
  const context = futureContext(match, 'bot');
  for (const id of ['vine', 'spore-sac']) {
    const card = member(id, 'growth', id);
    const before = delayedCardValue(context, card, 'surface');
    assert.ok(delayedCardValue(context, { ...card, growth: 2 }, 'surface') > before);
  }
  const fence = standard('fence', CAPTAIN_CARDS.find(({ id }) => id === 'stolen-goods-fence'));
  assert.ok(delayedCardValue(context, fence, 'surface') > 0);
  match.players.bot.hand = [plain('last', 4)];
  assert.equal(delayedCardValue(futureContext(match, 'bot'), fence, 'surface'), 0);
});

test('public bot analysis forecasts the real number of human turns without reading hidden cards', () => {
  for (const count of [0, 1, 3, 6]) {
    const match = position();
    match.players.human.hand = Array.from({ length: count }, (_, i) => plain('hidden-' + i, 5));
    const state = publicMatch(match);
    assert.equal(new Set(state.players.human.hand.map(({ id }) => id)).size, count);
    assert.ok(state.players.human.hand.every(({ definition }) => definition.id === 'unknown-play'));
    assert.equal(state.players.human.publicHandSize, count);
    assert.equal(remainingTurns(state, 'human'), Math.min(4, count));
  }
});

test('discard plays value the best restored legal card once, with or without anyType and chooseAll', () => {
  const match = position(3);
  const target = standard('target', { id: 'target', name: 'Target', rarity: 'bronze', power: 8 });
  target.power = 1;
  match.players.bot.discard = [target];
  const medic = member('medic', 'captains', 'field-medic');
  const expected = deckCardValue(match, 'bot', { ...target, power: target.basePower });
  assert.equal(effectSwing(match, 'bot', medic), expected);
  const medicine = medic.definition.deploy.steps[0];
  const versatile = standard('versatile', { ...medic.definition,
    deploy: { steps: [{ ...medicine, chooseAll: true, filter: { ...medicine.filter, anyType: true } }] },
  });
  assert.equal(effectSwing(match, 'bot', versatile), expected);
});

test('Great Sacrifice scores each tentacle once even when it can overflow', () => {
  const match = position();
  const definition = CHOIR_CARDS.find(({ id }) => id === 'great-sacrifice');
  match.players.bot.board.orbit = Array.from({ length: 3 }, (_, i) =>
    standard('armored-' + i, { id: 'armored', name: 'Armored', power: 5, armor: 2 }));
  assert.equal(effectSwing(match, 'bot', standard('sacrifice', definition)), 3 * TENTACLE.power);
});

test('deck-play estimates stay finite when the eligible card has no printed power', () => {
  const match = position();
  const effect = standard('effect', { id: 'effect', name: 'Effect', type: 'effect' });
  match.players.bot.deck = [effect];
  const tutor = standard('tutor', { id: 'tutor', name: 'Tutor', type: 'effect',
    deploy: { steps: [{ action: 'play-from-deck', filter: { anyType: true } }] } });
  assert.equal(effectSwing(match, 'bot', tutor), 0);
});

test('the shared evaluation values a strong deploy effect above raw power at all seven levels', () => {
  const match = position(3);
  const { bot, human } = match.players;
  human.passed = true;
  human.board.surface = [plain('decisive-enemy', 16)];
  bot.hand = [plain('strength', 7), standard('deploy', {
    id: 'deploy', name: 'Deploy', power: 3,
    deploy: { steps: [{ action: 'damage', target: { scope: 'enemy' }, amount: 15 }] },
  })];
  for (const level of [1, 2, 3, 4, 5, 6, 7]) {
    assert.equal(chooseBotTurn(match, level).cardId, 'deploy', String(level));
  }
});

test('memory removes both a played card and a visible copy from the hidden supply only once each', () => {
  const match = position();
  const card = member('used', 'protectorate', 'infantry');
  match.players.human.factionId = 'protectorate';
  match.players.human.board.orbit = [card];
  match.log.push({ type: 'play', side: 'human', cardId: card.id, card });
  const options = (memory) => visibleSupply(match, memory).filter(({ card }) => card.id === 'infantry').length;
  assert.equal(options(false), 2);
  assert.equal(options(true), 1);
  match.log.push({ type: 'play', side: 'human', cardId: 'other-copy', card });
  assert.equal(options(true), 0);
});

test('the shared evaluation prices life, early hand reserve and resilient strength', () => {
  const match = position(1);
  const neutral = evaluatePosition(match, 'bot');
  match.players.bot.hand.push(plain('extra', 6));
  const earlyCard = evaluatePosition(match, 'bot') - neutral;
  match.round = 3;
  const lateCard = evaluatePosition(match, 'bot');
  assert.ok(earlyCard > lateCard);
  assert.equal(evaluatePosition(match, 'human'), -lateCard);

  match.round = 2;
  match.players.human.lives = 1;
  const before = evaluatePosition(match, 'bot');
  const unit = plain('carry', 4);
  match.players.bot.board.orbit = [unit];
  const withoutResilience = evaluatePosition(match, 'bot');
  unit.resilient = true;
  assert.ok(evaluatePosition(match, 'bot') > withoutResilience && withoutResilience > before);
});

test('once the opponent has passed, surplus points add no match value to a secured win', () => {
  const match = position(1);
  const { bot, human } = match.players;
  human.passed = true;
  human.board.orbit = [plain('opponent', 6)];
  const lead = plain('lead', 7);
  bot.board.orbit = [lead];
  const enough = evaluatePosition(match, 'bot');
  lead.power = 30;
  assert.equal(evaluatePosition(match, 'bot'), enough);
});

test('Plague engines are worth playing when the enemy board gives them targets', () => {
  const match = position();
  const card = (id) => standard(id, FACTIONS.growth.pool.find((definition) => definition.id === id));
  const leviathan = card('plague-leviathan');
  const sower = card('plague-sower');
  const forecast = (candidate) => delayedCardValue(futureContext(match, 'bot'), candidate, 'orbit', true);
  const score = (candidate) => {
    match.players.bot.board.orbit = [plain('anchor', 20), ...(candidate ? [candidate] : [])];
    return evaluatePosition(match, 'bot');
  };
  assert.equal(forecast(leviathan), 0);
  assert.equal(forecast(sower), 0);
  const infected = plain('infected', 8);
  match.players.human.board.orbit = [infected, plain('clean', 8), plain('other-clean', 8)];
  applyStatus(match, findUnit(match, infected.id), 'infection', 2);
  const baseline = score();
  assert.ok(forecast(leviathan) > 0);
  assert.ok(forecast(sower) > 0);
  assert.ok(score(leviathan) > baseline);
  const paired = forecast(sower);
  assert.ok(score(sower) > baseline);
  assert.ok(paired > forecast(sower));
  for (const { id } of match.players.human.board.orbit) {
    applyStatus(match, findUnit(match, id), 'infection', 5);
  }
  assert.equal(forecast(sower), 0);
});
