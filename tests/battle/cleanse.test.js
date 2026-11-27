import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import {
  applyStatus, cleanse, createCard, findUnit, refreshSidePower, statusCount,
} from '../../docs/game/engine/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { KEYWORDS, NEUTRAL_CARDS } from '../../docs/game/cards/cards.js';
import { availableOrders } from '../../docs/game/effects/effects.js';
import { deathwishDefinitions } from '../../docs/game/engine/events.js';
import { applyAction } from '../../docs/game/engine/match.js';
import { createRewardProgress } from '../../docs/game/meta/rewards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { unit as makeUnit, emptyPlayingMatch, pick, play as playCard } from '../helpers/battle-helpers.js';

const monk = NEUTRAL_CARDS.find(({ id }) => id === 'fugitive-monk');
const suppressor = NEUTRAL_CARDS.find(({ id }) => id === 'suppressor');
const unit = (id, traits) => makeUnit(id, 4, traits);
const selfBoost = { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 2 }] };
const random = () => .5;

function setup(side = 'human') {
  const match = emptyPlayingMatch({ side, random });
  for (const [name, player] of Object.entries(match.players)) player.hand.push(unit(name + '-spare'));
  match.players[side].hand.unshift(createCard(monk.id, monk));
  return match;
}

function play(match, cardId) {
  return playCard(match, cardId, { row: 'orbit', random });
}

function target(match, cardId) {
  return pick(match, cardId, { random });
}

test('the neutral bronze Monk appears in boosters and both cards have WebP art', async () => {
  assert.deepEqual([monk.faction, monk.rarity, monk.provision, monk.power], ['neutral', 'bronze', 5, 3]);
  assert.ok(KEYWORDS.Очищение.includes('выданный Силовой щит'));
  for (const card of [monk, suppressor]) {
    assert.equal(card.art, `${card.id}.webp`);
    await access(new URL(`../../docs/art/${card.art}`, import.meta.url));
  }
  const bronzes = NEUTRAL_CARDS.filter(({ rarity }) => rarity === 'bronze');
  const rolls = [0, (bronzes.indexOf(monk) + .5) / bronzes.length];
  const progress = createRewardProgress(undefined, null, { random: () => rolls.shift() ?? 0 });
  for (let win = 0; win < 5; win++) await progress.rewardMatch('win-' + win, 'win', 'growth');
  assert.equal(await progress.buyPack('neutral'), 'done');
  assert.equal(await progress.openPack('neutral'), 'done');
  assert.ok(progress.inventory().pendingPack.cards.includes(monk.id));
});

test('Cleansing clears each foreign status and gained Deathwish, keeping power, armor, and printed abilities', () => {
  const match = setup();
  const native = { armor: 4, deathwish: selfBoost, order: selfBoost, counter: { amount: 3, effect: selfBoost } };
  const card = unit('patient', native);
  Object.assign(card, { power: 9, counter: 2, readyAt: 6, statuses: { markedByAnotherEffect: 1 },
    inheritedDeathwishes: [{ deathwish: selfBoost }] });
  match.players.human.board.surface.push(card);
  const patient = findUnit(match, card.id);
  applyStatus(match, patient, 'infection', 3, { attacker: 'bot', sourceDefinitionId: 'carrier' });
  applyStatus(match, patient, 'target', 1, { attacker: 'bot' });
  applyStatus(match, patient, 'shield', 1);
  applyStatus(match, patient, 'doomed', 1);
  applyStatus(match, patient, 'lock', 1);
  const replay = createPlaybackState(match);
  const original = structuredClone(card);
  cleanse(match, patient);
  const event = match.log.at(-1);
  assert.equal(event.type, 'cleanse');
  assert.deepEqual(new Set(event.removed), new Set(['markedByAnotherEffect', 'infection', 'target', 'shield', 'doomed', 'lock']));
  assert.equal(event.inherited, true);
  assert.deepEqual([card.power, card.armor, card.basePower, card.readyAt, card.counter], [9, 4, 4, 6, 2]);
  assert.equal(card.definition.order, selfBoost);
  assert.deepEqual(deathwishDefinitions(card), [card.definition]);
  assert.equal(card.infectionSource, undefined);
  assert.equal(match.players.bot.marksPlaced, 1);
  const after = structuredClone(card);
  cleanse(match, patient);
  assert.deepEqual(card, after);
  assert.equal(match.log.filter(({ type }) => type === 'cleanse').length, 1);

  applyJournalEvent(replay, event);
  assert.deepEqual(findUnit(replay, card.id).card, after);
  assert.equal(original.statuses.infection, 3);
  assert.equal(original.inheritedDeathwishes.length, 1);
});

test('native shield remains intact or spent, and a replacement shield is removable', () => {
  const match = setup();
  const card = unit('golem', { shield: true, doomed: true });
  match.players.human.board.surface.push(card);
  const golem = findUnit(match, card.id);
  applyStatus(match, golem, 'infection', 2);
  cleanse(match, golem);
  assert.deepEqual([statusCount(card, 'shield'), statusCount(card, 'doomed'), statusCount(card, 'infection')], [1, 1, 0]);
  applyStatus(match, golem, 'shield', -1);
  applyStatus(match, golem, 'lock', 1);
  cleanse(match, golem);
  assert.equal(statusCount(card, 'shield'), 0);
  applyStatus(match, golem, 'shield', 1);
  assert.equal(statusCount(card, 'shield'), 1);
  cleanse(match, golem);
  assert.equal(statusCount(card, 'shield'), 0);
  assert.equal(statusCount(card, 'doomed'), 1);
});

test('the Monk undoes a real Suppressor lock and the unlocked Order is usable immediately', () => {
  const before = setup('bot');
  before.players.human.hand.push(createCard(monk.id, monk));
  before.players.bot.hand.push(createCard(suppressor.id, suppressor));
  const card = unit('commander', { order: selfBoost });
  before.players.human.board.surface.push(card);
  const locked = target(play(before, suppressor.id), card.id);
  assert.equal(locked.turn, 'human');
  assert.equal(statusCount(findUnit(locked, card.id).card, 'lock'), 1);
  assert.deepEqual(availableOrders(locked, 'human'), []);

  const choice = play(locked, monk.id);
  assert.equal(choice.pending.kind, 'cleanse');
  assert.ok(choice.pending.options.includes(card.id));
  assert.ok(choice.pending.options.includes(suppressor.id));
  const cleansed = target(choice, card.id);
  assert.equal(statusCount(findUnit(cleansed, card.id).card, 'lock'), 0);
  assert.deepEqual(availableOrders(cleansed, 'human').map(({ card }) => card.id), ['commander']);
  const used = applyAction(cleansed, 'human', { type: 'order', cardId: card.id });
  assert.equal(findUnit(used, card.id).card.power, 6);
});

test('Cleansing restores a locked continuous aura without changing the target strength', () => {
  const match = setup();
  const sidePower = { group: 'test-group', key: 'testBonus' };
  const aura = unit('aura', { power: 4, sidePower, sidePowerAura: 1 });
  const ally = unit('ally', { power: 2, sidePower });
  match.players.human.board.surface.push(aura, ally);
  refreshSidePower(match, 'human');
  const source = findUnit(match, aura.id);
  applyStatus(match, source, 'lock', 1);
  assert.deepEqual([aura.power, ally.power], [5, 2]);
  cleanse(match, source);
  assert.deepEqual([aura.power, ally.power], [5, 3]);
});

test('all bot difficulties cleanse allied Lock, Infection or Target and strip a granted enemy shield', () => {
  for (const [side, status] of [['bot', 'lock'], ['bot', 'infection'], ['bot', 'target'], ['human', 'shield']]) {
    const match = setup('bot');
    const preferred = unit('preferred');
    match.players[side].board.surface.push(preferred);
    const avoided = unit('avoided');
    const other = side === 'human' ? 'bot' : 'human';
    match.players[other].board.surface.push(avoided);
    applyStatus(match, findUnit(match, avoided.id), other === 'bot' ? 'shield' : 'infection', 2);
    applyStatus(match, findUnit(match, preferred.id), status, 1, { attacker: 'human' });
    const pending = play(match, monk.id);
    for (const difficulty of [2, 4, 6]) {
      assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: preferred.id });
    }
    const next = target(pending, preferred.id);
    assert.equal(statusCount(findUnit(next, preferred.id).card, status), 0);
  }
});

test('the Monk is a three-strength play without a target prompt when all targets are clean', () => {
  const before = setup('bot');
  before.players.human.board.surface.push(unit('native', { shield: true }));
  const next = play(before, monk.id);
  assert.equal(next.pending, null);
  assert.equal(findUnit(next, monk.id).card.power, 3);
  assert.equal(next.log.some(({ type }) => type === 'cleanse'), false);
  assert.equal(statusCount(findUnit(next, 'native').card, 'shield'), 1);
});

test('losing a side aura records zero rather than negative strength before death', () => {
  const match = setup();
  const sidePower = { group: 'test', key: 'testBonus' };
  const aura = unit('aura', { power: 4, sidePower, sidePowerAura: 3 });
  const ally = unit('ally', { power: 2, sidePower });
  match.players.human.board.surface.push(aura, ally);
  refreshSidePower(match, 'human');
  ally.power = 1;
  applyStatus(match, findUnit(match, aura.id), 'lock', 1);
  assert.equal(findUnit(match, ally.id), undefined);
  assert.equal(match.log.findLast(({ type, cardId }) => type === 'aura-power' && cardId === ally.id).power, 0);
});
