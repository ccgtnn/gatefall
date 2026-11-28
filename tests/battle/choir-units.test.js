import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { announcePlay, applyStatus, createCard, damage, findUnit, setRowEffect, spawnCards, statusCount, weaken } from '../../docs/game/engine/board.js';
import { pickBotTarget } from '../../docs/game/bot/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { FACTIONS, KEYWORDS } from '../../docs/game/cards/cards.js';
import { AWAKENING, CHOIR_CARDS, CULTIST, FANATIC, LARGE_TENTACLE, PSIONICS, SLEEPER, TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { collection, copyLimit, inspectDeck, PRESETS } from '../../docs/game/cards/decks.js';
import { availableOrders, canUseLeader, enqueueEndTurn, enqueueStartTurn } from '../../docs/game/effects/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../../docs/game/engine/match.js';
import { createRewardProgress } from '../../docs/game/meta/rewards.js';
import { filterCatalog } from '../../docs/ui/catalog-cards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { drain as drainEffects, pick as pickTarget, play as playCard } from '../helpers/battle-helpers.js';

import { action, cards, drain, fixed, get, hit, human, pick, play, quiet, setup, unit } from '../helpers/choir.js';

test('Guardian gains two per tier once the last armor is lost, and retains bonuses as strength', () => {
  for (const [count, power] of [[2, 4], [3, 6], [6, 8], [9, 10], [12, 12]]) {
    const match = setup({ count, orbit: [cards.get('altar-guardian')] });
    hit(match, 'orbit-0', 1);
    assert.equal(get(match, 'orbit-0').power, 4);
    hit(match, 'orbit-0', 1);
    assert.equal(get(match, 'orbit-0').power, power);
    hit(match, 'orbit-0', 1);
    assert.equal(get(match, 'orbit-0').power, power - 1);
  }
});

test('Shepherd obeys all four capture ceilings, with no trigger below three and no increase past twelve', () => {
  for (const [count, cap] of [[2, 0], [3, 3], [6, 4], [9, 5], [12, 6], [15, 6]]) {
    const state = setup({ count, hand: [cards.get('abyss-shepherd')], enemies: [2, 3, 4, 5, 6, 7].map(unit) });
    const match = play(state);
    assert.deepEqual(match.pending?.options ?? [], Array.from({ length: cap ? cap - 1 : 0 }, (_, i) => `enemy-${i}`));
  }
});

test('Capture moves the exact card with its strength, armor, statuses and owner, and replays across sides', () => {
  const initial = setup({ count: 3, hand: [cards.get('abyss-shepherd')], enemies: [unit(3)] });
  const enemy = get(initial, 'enemy-0');
  enemy.armor = 3;
  enemy.statuses = { shield: 1, infection: 2, target: 1, lock: 1 };
  const choosing = play(initial);
  const match = pick(choosing, 'enemy-0');
  assert.equal(get(match, 'hand-0').basePower, 1);
  const captured = findUnit(match, enemy.id);
  assert.deepEqual([captured.side, captured.row, captured.card.power, captured.card.armor, captured.card.owner],
    ['human', 'orbit', 3, 3, 'bot']);
  assert.deepEqual(match.log.find(({ type }) => type === 'capture').card.statuses, enemy.statuses);
  const playback = createPlaybackState(choosing);
  for (const event of match.log.slice(choosing.log.length)) applyJournalEvent(playback, event);
  assert.deepEqual(findUnit(playback, enemy.id), captured);

  const full = Array(9).fill(unit(8));
  const fallback = setup({ count: 3, orbit: full, enemies: [unit(3)], hand: [cards.get('abyss-shepherd')] });
  assert.equal(findUnit(pick(play(fallback, 'surface'), 'enemy-0'), 'enemy-0').row, 'surface');
  const blocked = setup({ count: 3, orbit: full, surface: full.slice(1), enemies: [unit(3)], hand: [cards.get('abyss-shepherd')] });
  assert.equal(play(blocked, 'surface').pending, null);
  assert.equal(findUnit(play(blocked, 'surface'), 'enemy-0').side, 'bot');
});

test('a ready enemy order remains usable on the same turn after the Shepherd captures it', () => {
  const ordered = { ...unit(3), order: { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 2 }] } };
  const initial = setup({ count: 3, hand: [cards.get('abyss-shepherd')], enemies: [ordered] });
  initial.players.human.turns = 1;
  initial.players.bot.turns = 4;
  get(initial, 'enemy-0').readyAt = 4;
  const captured = pick(play(initial), 'enemy-0');
  assert.equal(captured.turn, 'human');
  assert.ok(availableOrders(captured, 'human').some(({ card }) => card.id === 'enemy-0'));
  const resolved = applyAction(captured, 'human', { type: 'order', cardId: 'enemy-0' });
  assert.equal(get(resolved, 'enemy-0').power, 5);
});

test('Fanatic transforms at two power or less in place, but not on lethal damage or while locked', () => {
  const match = setup({ surface: [unit(9), FANATIC, unit(9)] });
  hit(match, 'surface-1', 1);
  assert.equal(get(match, 'surface-1').definition.id, FANATIC.id);
  hit(match, 'surface-1', 1);
  assert.deepEqual(human(match).board.surface.map(({ definition, power }) => [definition.id, power]),
    [['unit-9', 9], [TENTACLE.id, 3], ['unit-9', 9]]);

  const lethal = setup({ orbit: [FANATIC] });
  hit(lethal, 'orbit-0', 4);
  assert.equal(get(lethal, 'orbit-0'), undefined);
  assert.ok(!lethal.log.some(({ type }) => type === 'transform'));

  const locked = setup({ orbit: [FANATIC] });
  applyStatus(locked, findUnit(locked, 'orbit-0'), 'lock', 1);
  hit(locked, 'orbit-0', 2);
  assert.equal(get(locked, 'orbit-0').definition.id, FANATIC.id);

  const reduced = setup({ orbit: [FANATIC] });
  weaken(reduced, findUnit(reduced, 'orbit-0'), 3);
  drain(reduced);
  assert.equal(get(reduced, 'orbit-0').definition.id, TENTACLE.id);
});

test('Both tentacles only hit the immediate unit to their right and grow on surviving allied damage', () => {
  for (const [definition, dealt] of [[TENTACLE, 1], [LARGE_TENTACLE, 2]]) {
    const match = setup({ orbit: [unit(9), definition, unit(9)], enemies: [unit(9)] });
    enqueueEndTurn(match, 'human');
    drain(match);
    assert.equal(get(match, 'orbit-0').power, 9);
    assert.equal(get(match, 'orbit-2').power, 9 - dealt);
    assert.equal(get(match, 'enemy-0').power, 9);
    applyStatus(match, findUnit(match, 'orbit-1'), 'shield', 1);
    const wound = (attacker) => {
      damage(match, findUnit(match, 'orbit-1'), 1, 'test-source', { attacker });
      drain(match);
    };
    wound('human');
    assert.equal(get(match, 'orbit-1').power, definition.power);
    wound('bot');
    assert.equal(get(match, 'orbit-1').power, definition.power - 1);
    wound('human');
    assert.equal(get(match, 'orbit-1').power, definition.power);
    assert.equal(get(hit(match, 'orbit-1', 20), 'orbit-1'), undefined);
  }
});

test('enemy weather and infection ticks preserve attribution and never strengthen a tentacle', () => {
  const match = setup({ orbit: [LARGE_TENTACLE] });
  const source = { sourceDefinitionId: 'enemy-card', attacker: 'bot' };
  setRowEffect(match, 'human', 'orbit', { type: 'firestorm', remaining: 1, ...source });
  enqueueStartTurn(match, 'human');
  drain(match);
  assert.equal(get(match, 'orbit-0').power, 5);

  setRowEffect(match, 'human', 'orbit', { type: 'rot', remaining: 2, ...source });
  enqueueStartTurn(match, 'human');
  drain(match);
  enqueueStartTurn(match, 'human');
  drain(match);
  assert.equal(get(match, 'orbit-0').power, 3);
  enqueueEndTurn(match, 'human');
  drain(match);
  assert.equal(get(match, 'orbit-0').power, 2);
  assert.ok(match.log.filter(({ type }) => type === 'damage').every(({ attacker }) => attacker === 'bot'));
  assert.equal(match.log.find(({ tick }) => tick).attacker, 'bot');
  assert.ok(!match.log.some(({ type }) => type === 'boost'));
});

test('armor only triggers a damage reaction when a hit also removes power', () => {
  for (const [amount, power, boosted] of [[2, 3, false], [3, 4, true]]) {
    const match = setup({ orbit: [{ ...TENTACLE, armor: 2 }] });
    damage(match, findUnit(match, 'orbit-0'), amount, 'test-source', { attacker: 'human' });
    drain(match);
    assert.equal(get(match, 'orbit-0').power, power);
    assert.equal(get(match, 'orbit-0').armor, 0);
    assert.equal(match.log.find(({ type }) => type === 'damage').lost, amount - 2);
    assert.equal(match.log.some(({ type }) => type === 'boost'), boosted);
  }
});

test('Sleeper hits both adjacent units, gains actual damage and readies an order that targets only the strongest enemy', () => {
  const initial = setup({ orbit: [FANATIC, SLEEPER, TENTACLE], enemies: [unit(4), unit(6)] });
  get(initial, 'orbit-1').readyAt = 2;
  enqueueEndTurn(initial, 'human');
  drain(initial);
  const sleeper = get(initial, 'orbit-1');
  assert.equal(sleeper.power, 10);
  assert.equal(sleeper.readyAt, 0);
  assert.equal(availableOrders(initial, 'human')[0].card.id, sleeper.id);
  const ordered = action(initial, 'order', { cardId: sleeper.id });
  assert.equal(get(ordered, 'enemy-0').power, 4);
  assert.equal(get(ordered, 'enemy-1').power, 4);
  assert.equal(statusCount(get(ordered, sleeper.id), 'doomed'), 1);
  hit(ordered, sleeper.id, 20);
  assert.ok(human(ordered).exile.some(({ id }) => id === sleeper.id));
  assert.ok(!human(ordered).discard.some(({ id }) => id === sleeper.id));

  const armored = setup({ orbit: [SLEEPER, { ...unit(2), armor: 1 }] });
  get(armored, 'orbit-0').readyAt = 2;
  enqueueEndTurn(armored, 'human');
  drain(armored);
  assert.equal(get(armored, 'orbit-0').power, 8);
  assert.equal(get(armored, 'orbit-0').readyAt, 2);

  const shielded = setup({ orbit: [SLEEPER, { ...unit(2), shield: true }] });
  get(shielded, 'orbit-0').readyAt = 2;
  enqueueEndTurn(shielded, 'human');
  drain(shielded);
  assert.equal(get(shielded, 'orbit-0').power, 8);
  assert.equal(get(shielded, 'orbit-0').readyAt, 2);
});

test('Offerings spawn in the targets’ rows even on lethal hits and require distinct allies', () => {
  let match = play(setup({ hand: [cards.get('minor-offering')], surface: [unit(2)] }));
  match = pick(match, 'surface-0');
  assert.ok(!get(match, 'surface-0'));
  assert.equal(human(match).board.surface[0].definition.id, TENTACLE.id);

  match = play(setup({ hand: [cards.get('great-sacrifice')], orbit: [unit(2), unit(2)], surface: [unit(2)] }));
  match = pick(match, 'orbit-0');
  assert.ok(!match.pending.options.includes('orbit-0'));
  match = pick(match, 'orbit-1');
  assert.deepEqual(match.pending.options, ['surface-0']);
  match = pick(match, 'surface-0');
  assert.deepEqual(human(match).board.orbit.map(({ definition }) => definition.id), [TENTACLE.id, TENTACLE.id]);
  assert.equal(human(match).board.surface[0].definition.id, TENTACLE.id);
});

