import assert from 'node:assert/strict';
import test from 'node:test';
import { findUnit } from '../../docs/game/engine/board.js';
import { chooseBotTurn, chooseEasyTurn, pickBotTarget } from '../../docs/game/bot/bot.js';
import { evaluatePosition } from '../../docs/game/bot/bot-evaluation.js';
import { effectSwing } from '../../docs/game/bot/bot-effect-value.js';
import { carryoverValue, coinValue, delayedCardValue, futureContext, leaderUses, remainingTurns } from '../../docs/game/bot/bot-future-value.js';
import { visibleSupply } from '../../docs/game/bot/bot-rollouts.js';
import { botSearchState, publicMatch } from '../../docs/game/bot/bot-strategy.js';
import { FACTIONS, LARVA } from '../../docs/game/cards/cards.js';
import { NEUTRAL_CARDS } from '../../docs/game/cards/factions/neutral-cards.js';
import { SLEEPER, TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { applyAction } from '../../docs/game/engine/match.js';
import { plain, position, standard } from '../helpers/bot-strategy.js';

const card = (id, faction) => standard(id, FACTIONS[faction].pool.find((def) => def.id === id));
const fixed = { random: () => .99, rolloutSamples: 0 };
const forecast = (match, unit, row = 'orbit') => delayedCardValue(futureContext(match, 'bot'), unit, row);

test('passive turns are forecast for infection and Rot on passed enemies', () => {
  const match = position();
  match.players.human.passed = true;
  const enemy = plain('enemy', 15);
  match.players.human.board.orbit = [enemy];
  assert.equal(remainingTurns(match, 'human'), 4);
  const status = standard('infection', { id: 'infection', type: 'effect', deploy: { steps: [
    { action: 'status', status: 'infection', amount: 4, target: { scope: 'enemy' } },
  ] } });
  assert.ok(effectSwing(match, 'bot', status) > 0);
  assert.ok(effectSwing(match, 'bot', card('rot', 'growth')) > 0);
});

test('the fallback can explicitly end an empty turn after the last ability', () => {
  const match = position();
  match.players.bot.hand = [];
  match.players.bot.usedAbility = true;
  assert.deepEqual(chooseEasyTurn(match), { type: 'end-turn' });
});

test('armor spending favors a fresh Boil and avoids breaking a grown one', () => {
  const match = position();
  const boil = card('boil', 'growth');
  const armored = plain('armored', 4);
  armored.armor = 1;
  match.players.bot.board = { orbit: [boil], surface: [armored] };
  match.pending = { kind: 'armor-row', side: 'bot', options: ['surface', 'orbit'] };
  assert.equal(pickBotTarget(match).cardId, 'orbit');
  boil.power = 8;
  assert.equal(pickBotTarget(match).cardId, 'surface');
});

test('a simulated Genome Keeper play receives only the resulting position rating', () => {
  const match = position();
  const { bot } = match.players;
  bot.hand = [card('genome-keeper', 'growth'), plain('spare', 1)];
  bot.discard = [card('cocoon', 'growth')];
  let candidates;
  chooseBotTurn(match, 2, { ...fixed, onDecision: (trace) => { candidates = trace.candidates; } });
  const keeper = candidates.find(({ action }) => action.cardId === 'genome-keeper');
  assert.ok(keeper);
  const next = applyAction(publicMatch(match), 'bot', keeper.action, fixed);
  assert.ok(findUnit(next, 'genome-keeper').card.inheritedDeathwishes.length);
  assert.equal(keeper.score, evaluatePosition(next, 'bot'));
});

test('Priest chooses the armoured Altar Guardian when it beats the weakest offering', () => {
  const match = position();
  const { bot, human } = match.players;
  bot.leader = { ...FACTIONS.choir.leader };
  bot.hand = [plain('spare', 2), plain('later', 2)];
  const guardian = card('altar-guardian', 'choir');
  guardian.power = 5;
  bot.startingCategories['Псионика'] = 6;
  bot.board.orbit = [plain('weak', 1), guardian];
  human.board.orbit = [plain('enemy', 16)];
  const pending = applyAction(match, 'bot', { type: 'leader' }, fixed);
  assert.equal(chooseBotTurn(pending, 4, fixed).cardId, guardian.id);
});

test('Sleeper forecasts a refreshed Order when it can damage an adjacent unit', () => {
  const match = position();
  const sleeper = standard('sleeper', SLEEPER);
  sleeper.readyAt = 4;
  const ally = standard('neighbor', TENTACLE);
  match.players.bot.board.orbit = [sleeper, ally];
  match.players.human.board.orbit = [plain('enemy', 12)];
  const withNeighbor = forecast(match, sleeper);
  match.players.bot.board.orbit.pop();
  assert.ok(withNeighbor > forecast(match, sleeper));
});

test('Claw only forecasts growth if its end-turn condition holds', () => {
  const match = position();
  const claw = card('hound-claw', 'captains');
  match.players.bot.board.orbit = [claw, plain('outsider', 5)];
  assert.equal(forecast(match, claw), 0);
  match.players.bot.board.orbit.push(card('black-hound', 'captains'));
  assert.ok(forecast(match, claw) > 0);
});

test('Tentacle end-turn forecast depends on the unit immediately to its right', () => {
  const match = position();
  const tentacle = standard('tentacle', TENTACLE);
  const ally = plain('ally', 6);
  match.players.bot.board.orbit = [ally, tentacle];
  const withoutTarget = forecast(match, tentacle);
  match.players.bot.board.orbit.reverse();
  assert.ok(forecast(match, tentacle) < withoutTarget);
});

test('a ready Shield Generator charge is counted only once', () => {
  const match = position();
  const generator = card('shield-generator', 'protectorate');
  generator.orderCharges = 1;
  match.players.bot.board.orbit = [generator, plain('ally', 4)];
  const ready = evaluatePosition(match, 'bot');
  generator.readyAt = 1;
  assert.equal(ready, evaluatePosition(match, 'bot'));
});

test('resilient Incubator and Awakening carry value into another round', () => {
  const match = position();
  for (const [id, faction] of [['incubator', 'growth'], ['ulmarin-awakening', 'choir']]) {
    match.players.bot.board.orbit = [card(id, faction)];
    assert.ok(carryoverValue(futureContext(match, 'bot'), false) > 0, id);
  }
});

test('Right Fang can use coins for its draw Order even without enemies and before playing', () => {
  const match = position(3);
  const { bot } = match.players;
  bot.coins = 5;
  bot.deck = [plain('replacement', 9)];
  bot.hand = [plain('weak', 1)];
  bot.board.orbit = [card('hound-right-fang', 'captains'), card('hound-foreman', 'captains')];
  bot.board.orbit[1].definition = { ...bot.board.orbit[1].definition, fee: undefined };
  assert.ok(coinValue(futureContext(match, 'bot')) > .5);
  bot.board.orbit[0].orderUsedTurn = bot.turns;
  assert.equal(coinValue(futureContext(match, 'bot')), .5);
});

test('hidden category counts are cleared below deck-list levels', () => {
  const match = position();
  match.players.human.startingCategories = { 'Псионика': 6 };
  assert.deepEqual(botSearchState(match).players.human.startingCategories, {});
  const detailed = botSearchState(match, true);
  assert.deepEqual(detailed.players.human.startingCategories, match.players.human.startingCategories);
  assert.deepEqual(botSearchState(detailed).players.human.startingCategories, {});
});

test('deck memory ignores journal events from the bot side', () => {
  const match = position();
  const [known] = match.players.human.startingDeck;
  const before = visibleSupply(match, true, true);
  match.log.push({ type: 'play', side: 'bot', cardId: known.id, card: known });
  match.log.push({ type: 'spawn', from: 'deck', side: 'bot', cards: [match.players.human.startingDeck[1]] });
  assert.deepEqual(visibleSupply(match, true, true), before);
});

test('Broodlord chooses the row with larvae of strength 2 and 4 at levels 4 and 7', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.lives = human.lives = 1;
  bot.hand = [card('broodlord', 'growth')];
  bot.board.surface = [standard('larva-two', LARVA), standard('larva-four', LARVA)];
  bot.board.surface[0].power = 2;
  bot.board.surface[1].power = 4;
  human.board.orbit = [plain('enemy', 18)];
  for (const level of [4, 7]) {
    const action = chooseBotTurn(match, level, fixed);
    assert.equal(action.row, 'surface');
    assert.equal(findUnit(applyAction(match, 'bot', action, fixed), 'broodlord').card.power, 16);
  }
});

test('Falura adds value through immediate and future uses of the repeatable leader Order', () => {
  const match = position();
  const falura = standard('falura', NEUTRAL_CARDS.find(({ id }) => id === 'falura'));
  match.players.bot.hand = [falura, plain('one', 4), plain('two', 4), plain('three', 4)];
  match.players.human.board.surface = [plain('enemy', 8)];
  const next = applyAction(match, 'bot', { type: 'play', cardId: falura.id, row: 'orbit', position: 0 }, fixed);
  const { bot } = next.players;
  const leader = bot.leader;
  assert.equal(leader.order.sourceDefinitionId, 'falura');
  assert.equal(bot.board.orbit.filter(({ definition }) => definition.id === 'shadow').length, 2);

  next.round = 3;
  const ready = evaluatePosition(next, 'bot');
  bot.leader = undefined;
  assert.ok(ready > evaluatePosition(next, 'bot'));

  next.round = 1;
  bot.leader = leader;
  const accelerated = leaderUses(futureContext(next, 'bot'));
  for (const shadow of bot.board.orbit.filter(({ definition }) => definition.id === 'shadow')) {
    shadow.statuses = { lock: 1 };
  }
  assert.ok(accelerated > leaderUses(futureContext(next, 'bot')));
  assert.ok(carryoverValue(futureContext(next, 'bot'), true) > 0);
});
