import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard, findUnit, removeUnit, statusCount } from '../docs/game/board.js';
import { CAPTAIN_CARDS, HOUND, HOUND_CATEGORY, REINFORCED_HOUND } from '../docs/game/captains.js';
import { KEYWORDS } from '../docs/game/cards.js';
import { PRESETS } from '../docs/game/decks.js';
import { availableFees, availableOrders } from '../docs/game/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../docs/game/match.js';
import { createRewardProgress } from '../docs/game/rewards.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

const byId = new Map(CAPTAIN_CARDS.map((card) => [card.id, card]));
const ordinary = { id: 'ordinary', name: 'Отряд вне банды', type: 'unit', power: 5 };
const field = (cards) => cards.map((card, index) => createCard('foe-' + index, card));
const pile = (cards, prefix) => cards.map((card, index) => createCard(prefix + (index + 1), card));

function setup({ hand = [], coins = 0, orbit = [], surface = [], foes = [], enemySurface = [], deck = [], rules } = {}) {
  const match = createMatch({ decks: { human: [], bot: [] }, random: () => 0, rules });
  match.phase = 'playing';
  match.turn = 'human';
  match.players.human.coins = coins;
  match.players.human.hand = pile([...hand, ordinary], 'hand-');
  match.players.human.deck = pile(deck, 'deck-');
  match.players.human.board = { orbit: pile(orbit, 'orbit-'), surface: pile(surface, 'surface-') };
  match.players.bot.hand = pile([ordinary], 'bot-hand-');
  match.players.bot.board = { orbit: field(foes), surface: pile(enemySurface, 'foe-surface-') };
  return match;
}

const human = (match) => match.players.human;
const play = (match, row = 'surface') => applyAction(match, 'human', {
  type: 'play', cardId: 'hand-1', row, position: human(match).board[row].length,
});
const target = (match, cardId) => applyAction(match, 'human', { type: 'target', cardId });
const fee = (match, cardId) => applyAction(match, 'human', { type: 'fee', cardId });
const order = (match, cardId) => applyAction(match, 'human', { type: 'order', cardId });
const pass = (match, side = 'human') => applyAction(match, side, { type: 'pass' });

test('all ten Hound cards are in the collection but their faction has no preset or booster', async () => {
  const economy = createRewardProgress();
  assert.equal(CAPTAIN_CARDS.length, 10);
  for (const { id, faction, categories } of CAPTAIN_CARDS) {
    assert.equal(faction, 'captains');
    assert.ok(categories.includes(HOUND_CATEGORY));
    assert.ok(economy.inventory().owned[id] > 0);
  }
  for (const keyword of ['Прибыль', 'Плата', 'Взнос']) assert.ok(KEYWORDS[keyword]);
  assert.deepEqual([HOUND.power, HOUND.provision, REINFORCED_HOUND.power, REINFORCED_HOUND.armor], [2, undefined, 3, 1]);
  assert.ok(!PRESETS.some(({ factionId }) => factionId === 'captains'));
  assert.equal(createDeckMatch({ factionId: 'captains', name: 'Гончие', cardIds: [] }), null);
  assert.equal(await economy.buyPack('captains'), 'unknown');
  assert.equal(await economy.openPack('captains'), 'unknown');
});

test('all ten Hound cards use their own WebP and any focused crop exists', async () => {
  for (const { id, art, artCrop } of CAPTAIN_CARDS) {
    assert.equal(art, `${id}.webp`);
    await access(new URL(`../docs/art/${art}`, import.meta.url));
    if (artCrop) {
      assert.equal(artCrop, `${id}-crop.webp`);
      await access(new URL(`../docs/art/${artCrop}`, import.meta.url));
    }
  }
});

test('Удачное дельце grants five coins up to nine, separately for each side', () => {
  const deal = byId.get('hound-good-deal');
  for (const [start, end, credited] of [[0, 5, 5], [7, 9, 2], [9, 9, 0]]) {
    const match = setup({ hand: [deal], coins: start });
    const next = play(match);
    assert.equal(human(next).coins, end);
    assert.equal(next.players.bot.coins, 0);
    assert.equal(next.log.find(({ type }) => type === 'coins')?.amount ?? 0, credited);
  }
});

test('coins persist by default or are cleared for both sides between rounds when disabled', () => {
  for (const setting of [undefined, false]) {
    const match = setup({ surface: [HOUND], coins: 4, rules: setting === undefined ? undefined : { coinsPersistBetweenRounds: setting } });
    match.players.bot.coins = 5;
    const next = pass(pass(match), 'bot');
    assert.equal(next.round, 2);
    assert.equal(next.phase, 'mulligan');
    assert.equal(human(next).coins, setting === false ? 0 : 4);
    assert.equal(next.players.bot.coins, setting === false ? 0 : 5);
  }
});

test('Бригадир can spawn repeatedly in the same turn and rejects insufficient coins or a full row', () => {
  const foreman = byId.get('hound-foreman');
  let match = setup({ surface: [foreman], coins: 5 });
  match = fee(match, 'surface-1');
  match = fee(match, 'surface-1');
  assert.equal(match.turn, 'human');
  assert.deepEqual(human(match).board.surface.map(({ definition }) => definition.id), [foreman.id, HOUND.id, HOUND.id]);
  assert.equal(human(match).coins, 1);
  assert.equal(fee(match, 'surface-1'), match);
  const full = setup({ surface: [foreman, ...Array(8).fill(HOUND)], coins: 9 });
  assert.equal(fee(full, 'surface-1'), full);
});

test('Капитан buffs existing and new friendly Hounds and removes the aura when gone', () => {
  const captain = byId.get('hound-captain');
  const foreman = byId.get('hound-foreman');
  const before = setup({ hand: [captain], orbit: [HOUND], surface: [foreman, ordinary], foes: [HOUND], coins: 2 });
  let match = play(before);
  assert.equal(human(match).board.orbit[0].power, 3);
  assert.equal(human(match).board.surface.at(-1).power, 5);
  assert.equal(human(match).board.surface[1].power, ordinary.power);
  assert.equal(match.players.bot.board.orbit[0].power, 2);
  match = fee(match, 'surface-1');
  assert.equal(human(match).board.surface[1].power, 3);
  const token = human(match).board.surface[1].id;
  removeUnit(match, findUnit(match, 'hand-1'), 'destroy');
  assert.equal(findUnit(match, token).card.power, 2);
  assert.equal(human(match).board.orbit[0].power, 2);
  const playback = createPlaybackState(before);
  for (const event of match.log) applyJournalEvent(playback, event);
  assert.equal(findUnit(playback, token).card.power, 2);
  assert.equal(human(playback).coins, 0);
});

test('Вербовщик offers only affordable tribute tiers and can skip payment', () => {
  const recruiter = byId.get('hound-recruiter');
  for (const [coins, options, choice, summons] of [[3, ['0', '3'], '3', 2], [6, ['0', '3', '6'], '6', 4], [9, ['0', '3', '6'], '0', 0]]) {
    const pending = play(setup({ hand: [recruiter], coins }));
    assert.equal(pending.pending.kind, 'tribute');
    assert.deepEqual(pending.pending.options, options);
    assert.equal(target(pending, '9'), pending);
    const match = target(pending, choice);
    assert.equal(human(match).coins, coins - Number(choice));
    assert.equal(human(match).board.surface.filter(({ definition }) => definition.id === HOUND.id).length, summons);
  }
  const broke = play(setup({ hand: [recruiter], coins: 2 }));
  assert.equal(broke.pending, null);
  assert.equal(human(broke).coins, 2);
});

test('Стая spawns three Hounds in the chosen own row', () => {
  const pending = play(setup({ hand: [byId.get('hound-pack')] }));
  assert.equal(pending.pending.selectionSide, 'human');
  assert.deepEqual(pending.pending.options, ['orbit', 'surface']);
  const match = target(pending, 'orbit');
  assert.equal(human(match).board.surface.length, 0);
  assert.deepEqual(human(match).board.orbit.map(({ definition }) => definition.id), Array(3).fill(HOUND.id));
});

test('Чёрная гончая enters orbit with a shield and creates Коготь immediately to its right', () => {
  const ship = byId.get('black-hound');
  const before = setup({ hand: [ship], coins: 4 });
  assert.equal(play(before), before);
  const placed = play(before, 'orbit');
  assert.equal(statusCount(human(placed).board.orbit[0], 'shield'), 1);
  const next = fee(placed, 'hand-1');
  assert.deepEqual(human(next).board.orbit.map(({ definition }) => definition.id), [ship.id, 'hound-claw']);
  assert.equal(human(next).coins, 0);
});

test('Коготь grows only on its own turn end with any Чёрная гончая or a Hound-only friendly field', () => {
  const claw = byId.get('hound-claw');
  const ship = byId.get('black-hound');
  for (const [allies, foes, expected] of [
    [[HOUND], [ordinary], 6],
    [[ordinary], [ship], 6],
    [[ordinary], [ordinary], 5],
    [[{ ...ordinary, type: 'artifact' }], [], 5],
  ]) {
    const next = pass(setup({ orbit: [claw, ...allies], foes }));
    assert.equal(human(next).board.orbit[0].power, expected);
  }
  const opponentTurn = setup({ orbit: [claw] });
  opponentTurn.turn = 'bot';
  assert.equal(human(pass(opponentTurn, 'bot')).board.orbit[0].power, 5);
});

test('Правый Клык destroys a chosen Hound, draws, bottoms a chosen card, and restores its order for five', () => {
  const fang = byId.get('hound-right-fang');
  let match = setup({ orbit: [fang], surface: [HOUND, HOUND, ordinary], deck: [HOUND, ordinary], coins: 5 });
  assert.equal(fee(match, 'orbit-1'), match);
  match = order(match, 'orbit-1');
  assert.equal(match.pending.kind, 'destroy');
  assert.ok(!match.pending.options.includes('surface-3'));
  match = target(match, 'surface-1');
  assert.equal(match.pending.kind, 'hand-bottom');
  assert.ok(match.pending.options.includes('deck-1'));
  match = target(match, 'hand-1');
  assert.equal(human(match).deck.at(-1).id, 'hand-1');
  assert.equal(human(match).exile[0].id, 'surface-1');
  assert.equal(availableOrders(match, 'human').length, 0);
  match = fee(match, 'orbit-1');
  assert.equal(human(match).coins, 0);
  assert.deepEqual(availableOrders(match, 'human').map(({ card }) => card.id), ['orbit-1']);
  assert.equal(order(match, 'orbit-1').pending.kind, 'destroy');
});

test('Левый Клык hits each unit in exactly one enemy row and can restore the order', () => {
  const fang = byId.get('hound-left-fang');
  const before = setup({ orbit: [fang], surface: [HOUND, HOUND], foes: [ordinary, { ...ordinary, armor: 1 }],
    enemySurface: [ordinary], coins: 5 });
  let match = target(order(before, 'orbit-1'), 'surface-1');
  assert.equal(match.pending.selectionSide, 'bot');
  match = target(match, 'orbit');
  assert.deepEqual(match.players.bot.board.orbit.map(({ power, armor }) => [power, armor]), [[4, 0], [5, 0]]);
  assert.equal(match.players.bot.board.surface[0].power, 5);
  match = fee(match, 'orbit-1');
  assert.equal(human(match).coins, 0);
  assert.equal(availableOrders(match, 'human')[0].card.id, 'orbit-1');
});

test('Глаза гончей transform a chosen basic token into a 3-power, 1-armor token', () => {
  const eyes = byId.get('hound-eyes');
  const before = setup({ surface: [eyes, HOUND, ordinary], coins: 4 });
  const pending = fee(before, 'surface-1');
  assert.deepEqual(pending.pending.options, ['surface-2']);
  assert.equal(human(pending).coins, 4);
  const match = target(pending, 'surface-2');
  const transformed = findUnit(match, 'surface-2').card;
  assert.deepEqual([transformed.definition.id, transformed.power, transformed.armor], [REINFORCED_HOUND.id, 3, 1]);
  assert.equal(human(match).coins, 2);
  assert.equal(availableFees(match, 'human').length, 0);
});
