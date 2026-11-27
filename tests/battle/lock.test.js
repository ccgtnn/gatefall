import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStatus, consume, createCard, findUnit, refreshSidePower, removeUnit, restoreCard, spendResilience, statusCount,
} from '../../docs/game/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { CAPTAIN_CARDS } from '../../docs/game/captains.js';
import { AWAKENING } from '../../docs/game/choir.js';
import { KEYWORDS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { availableFees, availableOrders, enqueueCardEffect, enqueueEndTurn, enqueueStartTurn } from '../../docs/game/effects.js';
import { emit } from '../../docs/game/events.js';
import { applyAction } from '../../docs/game/match.js';
import { createRewardProgress } from '../../docs/game/rewards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { drain, emptyPlayingMatch, play as playCard, unit } from '../helpers/battle-helpers.js';

const suppressor = NEUTRAL_CARDS.find(({ id }) => id === 'suppressor');

const recruiter = CAPTAIN_CARDS.find(({ id }) => id === 'hound-recruiter');
const createUnit = (id, traits) => unit(id, 5, traits);
const self = { scope: 'source' };
const selfBoost = { steps: [{ action: 'boost', target: self, amount: 3 }] };
const fixed = () => .5;

function setup(side = 'human') {
  const match = emptyPlayingMatch({ side, random: fixed });
  for (const [side, player] of Object.entries(match.players)) player.hand.push(createUnit(side + '-spare'));
  match.players[side].hand.unshift(createCard('suppressor', suppressor));
  return match;
}

function play(match, cardId) {
  const { turn: side } = match;
  return playCard(match, cardId, { side, position: match.players[side].board.surface.length });
}

function lock(match, id) {
  return applyStatus(match, findUnit(match, id), 'lock', 1);
}

function resolve(match) {
  drain(match, fixed);
}

const statusEvents = (match) => match.log.filter(({ status }) => status === 'lock');

test('Suppressor targets either side, keeps its stats and participates in the neutral epic booster pool', async () => {
  assert.deepEqual([suppressor.faction, suppressor.rarity, suppressor.provision, suppressor.power], ['neutral', 'epic', 6, 5]);
  assert.ok(KEYWORDS.Блокировка.includes('До конца матча'));
  for (const target of ['ally', 'enemy']) {
    const match = setup();
    match.players.human.board.surface.push(createUnit('ally'));
    match.players.bot.board.surface.push(createUnit('enemy'), createUnit('artifact', { type: 'artifact' }));
    const pending = play(match, 'suppressor');
    assert.equal(pending.pending.kind, 'lock');
    assert.deepEqual(pending.pending.options, ['ally', 'suppressor', 'enemy']);
    const locked = applyAction(pending, 'human', { type: 'target', cardId: target });
    assert.equal(statusCount(findUnit(locked, target).card, 'lock'), 1);
    assert.equal(findUnit(locked, 'suppressor').card.power, 5);
  }
  const rolls = [.8, 0];
  const progress = createRewardProgress(undefined, null, { random: () => rolls.shift() ?? 0 });
  for (let win = 0; win < 5; win++) await progress.rewardMatch('win-' + win, 'win', 'growth');
  assert.equal(await progress.buyPack('neutral'), 'done');
  assert.equal(await progress.openPack('neutral'), 'done');
  assert.ok(progress.inventory().pendingPack.cards.includes(suppressor.id));
});

test('lock is idempotent, preserves current power and statuses, and replays from the journal', () => {
  const match = setup();
  const card = createUnit('locked', { armor: 4, shield: true });
  Object.assign(card, { power: 8, statuses: { infection: 3, target: 1 } });
  match.players.human.board.surface.push(card);
  const playback = createPlaybackState(match);
  lock(match, card.id);
  lock(match, card.id);
  assert.equal(statusEvents(match).length, 1);
  const expected = [8, 4, 1, 3, 1, 1];
  const values = (unit) => [unit.power, unit.armor,
    ...['shield', 'infection', 'target', 'lock'].map((status) => statusCount(unit, status))];
  assert.deepEqual(values(card), expected);
  applyJournalEvent(playback, statusEvents(match)[0]);
  assert.deepEqual(values(playback.players.human.board.surface[0]), expected);
  enqueueEndTurn(match, 'human');
  resolve(match);
  assert.deepEqual(values(card), [8, 4, 0, 2, 1, 1]);
  enqueueEndTurn(match, 'human');
  resolve(match);
  assert.deepEqual(values(card), [7, 4, 0, 1, 1, 1]);
});

test('locked orders and fees cannot be activated or spend coins', () => {
  const match = setup();
  const order = createUnit('order', { order: selfBoost });
  const fee = createUnit('fee', { fee: { coins: 1, ...selfBoost } });
  match.players.human.board.surface.push(order, fee);
  match.players.human.coins = 2;
  assert.equal(availableOrders(match, 'human').length, 1);
  assert.equal(availableFees(match, 'human').length, 1);
  lock(match, 'order');
  lock(match, 'fee');
  assert.deepEqual(availableOrders(match, 'human'), []);
  assert.deepEqual(availableFees(match, 'human'), []);
  assert.equal(applyAction(match, 'human', { type: 'order', cardId: 'order' }), match);
  assert.equal(applyAction(match, 'human', { type: 'fee', cardId: 'fee' }), match);
  assert.equal(match.players.human.coins, 2);
});

test('lock survives round cleanup and revival and prevents deploy and tribute', () => {
  const match = setup();
  const card = createCard('recruiter', { ...recruiter, resilience: true });
  match.players.human.board.surface.push(card);
  match.players.human.coins = 6;
  const control = structuredClone(match);
  control.players.human.board.surface = [];
  control.players.human.hand.push(restoreCard(card));
  assert.equal(play(control, card.id).pending.kind, 'tribute');

  lock(match, card.id);
  assert.equal(spendResilience(card), false);
  const afterHumanPass = applyAction(match, 'human', { type: 'pass' }, { random: fixed });
  const afterRound = applyAction(afterHumanPass, 'bot', { type: 'pass' }, { random: fixed });
  const discarded = afterRound.players.human.discard.find(({ id }) => id === card.id);
  assert.equal(statusCount(discarded, 'lock'), 1);
  const revived = restoreCard(discarded);
  assert.equal(statusCount(revived, 'lock'), 1);
  const replay = setup();
  replay.players.human.coins = 6;
  replay.players.human.hand.push(revived);
  const next = play(replay, card.id);
  assert.equal(next.pending, null);
  assert.equal(next.players.human.board.surface.length, 1);
  assert.equal(next.players.human.coins, 6);
});

test('lock stops native and inherited Deathwish both on death and when triggered directly', () => {
  const match = setup();
  const wish = { steps: [{ action: 'draw', amount: 1 }] };
  const card = createUnit('victim', { deathwish: wish });
  card.inheritedDeathwishes = [{ deathwish: wish }];
  match.players.human.board.surface.push(card);
  match.players.human.deck.push(createUnit('undrawn'));
  lock(match, card.id);
  match.effects.push({ side: 'human', sourceId: card.id, ability: { steps: [{ action: 'activate-deathwish', target: self }] } });
  resolve(match);
  assert.equal(match.players.human.deck.length, 1);
  removeUnit(match, findUnit(match, card.id), 'damage');
  resolve(match);
  assert.equal(match.players.human.deck.length, 1);
  assert.ok(!match.log.some(({ type }) => type === 'deathwish'));
});

test('lock stops end-turn effects, counters, timers and start-turn growth', () => {
  const match = setup();
  const counter = createUnit('counter', { counter: { amount: 1, effect: selfBoost }, endTurn: selfBoost });
  const endTimer = createUnit('end-timer', { timer: 1, timerExpired: selfBoost });
  const startTimer = createUnit('start-timer', { timer: 1, timerPulse: selfBoost, timerNextTurn: selfBoost, startTurnGrowth: 1 });
  const control = createUnit('control', { endTurn: selfBoost });
  match.players.human.board.surface.push(counter, endTimer, startTimer, control);
  for (const card of [counter, endTimer, startTimer]) lock(match, card.id);
  enqueueStartTurn(match, 'human');
  enqueueEndTurn(match, 'human');
  resolve(match);
  assert.deepEqual([counter.power, counter.counter, endTimer.timer, startTimer.timer, startTimer.power], [5, 1, 1, 1, 5]);
  assert.equal(control.power, 8);
  assert.ok(!match.log.some(({ type }) => ['tick', 'counter', 'base-power'].includes(type)));
});

test('lock removes an aura from its allies while keeping the locked unit’s current power', () => {
  const match = setup();
  const sidePower = { group: 'test-group', key: 'testBonus' };
  const source = createUnit('aura', { power: 4, sidePower, sidePowerAura: 1 });
  const ally = createUnit('ally', { power: 2, sidePower });
  match.players.human.board.surface.push(source, ally);
  refreshSidePower(match, 'human');
  assert.deepEqual([source.power, ally.power], [5, 3]);
  lock(match, source.id);
  assert.deepEqual([source.power, ally.power], [5, 2]);
  assert.equal(source.testBonus, undefined);
  const newcomer = createUnit('newcomer', { power: 2, sidePower });
  match.players.human.board.surface.push(newcomer);
  refreshSidePower(match, 'human');
  assert.equal(newcomer.power, 2);
});

test('lock suppresses queued deploy, field and pile reactions, and neighbor effects', () => {
  const match = setup();
  const watcher = createUnit('watcher', { deploy: selfBoost, fieldEvents: { play: { ability: selfBoost } },
    pileEvents: { play: { ability: selfBoost } }, neighborEvents: { consume: selfBoost } });
  const victim = createUnit('victim');
  const eater = createUnit('eater');
  match.players.human.board.surface.push(watcher, victim, eater);
  enqueueCardEffect(match, 'human', watcher, 'deploy');
  match.effects.push(...emit(match, { type: 'play', side: 'bot' }));
  lock(match, watcher.id);
  consume(match, findUnit(match, victim.id), findUnit(match, eater.id));
  resolve(match);
  assert.equal(watcher.power, 5);
  assert.equal(eater.power, 10);
  match.players.human.hand.push(restoreCard(watcher));
  assert.deepEqual(emit(match, { type: 'play', side: 'bot' }), []);
});

test('all bot difficulties prefer a live enemy Order, Fee, timer or aura over an ally or inert enemy', () => {
  for (const traits of [{ order: selfBoost }, { fee: { coins: 1, ...selfBoost } }, { timer: 2 }, { sidePowerAura: 1 }]) {
    const match = setup('bot');
    match.players.bot.board.surface.push(createUnit('friendly', { order: selfBoost }));
    match.players.human.board.surface.push(createUnit('inert', { power: 20 }),
      createUnit('already-locked', { order: selfBoost }), createUnit('priority', traits));
    lock(match, 'already-locked');
    const pending = play(match, 'suppressor');
    for (const difficulty of [2, 4, 6]) {
      assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'priority' });
    }
  }
});

test('neither the Suppressor nor the lock status can target scenarios and artifacts', () => {
  const match = setup();
  const cards = [NEUTRAL_CARDS.find(({ id }) => id === 'storm-eye'), AWAKENING];
  match.players.bot.board.surface = cards.map((definition) => createCard(definition.id, definition));
  const pending = play(match, 'suppressor');
  for (const { id } of cards) {
    assert.ok(!pending.pending.options.includes(id));
    assert.strictEqual(applyAction(pending, 'human', { type: 'target', cardId: id }), pending);
    lock(pending, id);
    assert.equal(statusCount(findUnit(pending, id).card, 'lock'), 0);
  }
});
