import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { applyStatus, cleanse, consume, createCard, findUnit, removeUnit, spawnCards, statusCount, transformUnit } from '../../docs/game/engine/board.js';
import { CAPTAIN_CARDS, HOUND, HOUND_CATEGORY, REINFORCED_HOUND } from '../../docs/game/cards/factions/captains.js';
import { KEYWORDS, NEUTRAL_CARDS } from '../../docs/game/cards/cards.js';
import { PRESETS } from '../../docs/game/cards/decks.js';
import { availableFees, availableOrders } from '../../docs/game/effects/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../../docs/game/engine/match.js';
import { createRewardProgress } from '../../docs/game/meta/rewards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';

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

test('all ten Hound cards are collectible and the Captains have a preset and booster', async () => {
  let saved = JSON.stringify({ startingGold: 100 });
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const economy = createRewardProgress(storage, undefined, { random: () => 0 });
  const hounds = CAPTAIN_CARDS.filter(({ categories }) => categories?.includes(HOUND_CATEGORY));
  assert.equal(hounds.length, 10);
  for (const { id, faction } of hounds) {
    assert.equal(faction, 'captains');
    assert.ok(economy.inventory().owned[id] > 0);
  }
  for (const keyword of ['Прибыль', 'Плата', 'Взнос']) assert.ok(KEYWORDS[keyword]);
  assert.deepEqual([HOUND.power, HOUND.provision, REINFORCED_HOUND.power, REINFORCED_HOUND.armor], [2, undefined, 3, 1]);
  const preset = PRESETS.find(({ factionId }) => factionId === 'captains');
  assert.equal(createDeckMatch(preset).players.human.factionId, 'captains');
  assert.equal(createDeckMatch({ factionId: 'captains', name: 'Гончие', cardIds: [] }), null);
  assert.equal(await economy.buyPack('captains'), 'done');
  assert.equal(await economy.openPack('captains'), 'done');
  const pack = economy.inventory().pendingPack;
  assert.equal(pack.faction, 'captains');
  assert.equal(pack.cards.length, 5);
  assert.ok(pack.cards.every((id) => byId.has(id)));
});

test('Captain cards and both tokens use their own WebP and alternate art exists', async () => {
  for (const { id, art, artCrop, artStates } of [...CAPTAIN_CARDS, HOUND, REINFORCED_HOUND]) {
    assert.equal(art, `${id}.webp`);
    await access(new URL(`../../docs/art/${art}`, import.meta.url));
    if (artCrop) {
      assert.equal(artCrop, `${id}-crop.webp`);
      await access(new URL(`../../docs/art/${artCrop}`, import.meta.url));
    }
    for (const file of Object.values(artStates ?? {})) await access(new URL(`../../docs/art/${file}`, import.meta.url));
  }
  await access(new URL('../../docs/art/black-hounds-emblem.webp', import.meta.url));
  await access(new URL('../../docs/art/black-hounds-emblem-small.webp', import.meta.url));
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

test('half the coins carry to the next round, rounded down independently for each side', () => {
  const match = setup({ surface: [HOUND], coins: 7 });
  match.players.bot.coins = 1;
  const next = pass(pass(match), 'bot');
  assert.equal(next.round, 2);
  assert.equal(next.phase, 'mulligan');
  assert.equal(human(next).coins, 3);
  assert.equal(next.players.bot.coins, 0);
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

test('Капитан boosts himself and the Hounds already on his side once', () => {
  const captain = byId.get('hound-captain');
  const foreman = byId.get('hound-foreman');
  const before = setup({ hand: [captain], orbit: [HOUND], surface: [foreman, ordinary], foes: [HOUND], coins: 2 });
  let match = play(before);
  assert.equal(human(match).board.orbit[0].power, 3);
  assert.equal(human(match).board.surface.at(-1).power, 5);
  assert.equal(human(match).board.surface[1].power, ordinary.power);
  assert.equal(match.players.bot.board.orbit[0].power, 2);
  match = fee(match, 'surface-1');
  assert.equal(human(match).board.surface[1].power, 2);
  const token = human(match).board.surface[1].id;
  removeUnit(match, findUnit(match, 'hand-1'), 'destroy');
  assert.equal(findUnit(match, token).card.power, 2);
  assert.equal(human(match).board.orbit[0].power, 3);
  const playback = createPlaybackState(before);
  for (const event of match.log) applyJournalEvent(playback, event);
  assert.equal(findUnit(playback, token).card.power, 2);
  assert.equal(human(playback).board.orbit[0].power, 3);
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
  assert.equal(human(placed).board.orbit[0].power, 6);
  assert.equal(human(placed).coins, 9);
  const next = fee(placed, 'hand-1');
  assert.deepEqual(human(next).board.orbit.map(({ definition }) => definition.id), [ship.id, 'hound-claw']);
  assert.equal(human(next).coins, 5);
});

test('Коготь grows only on its own turn end with any Чёрная гончая or a Hound-only friendly field', () => {
  const claw = byId.get('hound-claw');
  const ship = byId.get('black-hound');
  for (const [allies, foes, expected] of [
    [[HOUND], [ordinary], 5],
    [[ordinary], [ship], 5],
    [[ordinary], [ordinary], 4],
    [[byId.get('stolen-goods-fence')], [], 4],
    [[{ ...ordinary, type: 'artifact' }], [], 4],
  ]) {
    const next = pass(setup({ orbit: [claw, ...allies], foes }));
    assert.equal(human(next).board.orbit[0].power, expected);
  }
  const opponentTurn = setup({ orbit: [claw] });
  opponentTurn.turn = 'bot';
  assert.equal(human(pass(opponentTurn, 'bot')).board.orbit[0].power, 4);
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
  assert.equal(human(match).discard[0].id, 'surface-1');
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
  assert.match(eyes.text, /Плата 1:/);
  const before = setup({ surface: [eyes, HOUND, ordinary], coins: 4 });
  const pending = fee(before, 'surface-1');
  assert.deepEqual(pending.pending.options, ['surface-2']);
  assert.equal(human(pending).coins, 4);
  const match = target(pending, 'surface-2');
  const transformed = findUnit(match, 'surface-2').card;
  assert.deepEqual([transformed.definition.id, transformed.power, transformed.armor], [REINFORCED_HOUND.id, 3, 1]);
  assert.equal(human(match).coins, 3);
  assert.equal(availableFees(match, 'human').length, 0);
});

const debtor = byId.get('debtor');
const pilot = byId.get('scrapped-pilot');
const turret = byId.get('broken-turret');
const lightShip = byId.get('hound-claw');
const heavyShip = byId.get('black-hound');

test('the three independent bronzes are collectible faction cards', () => {
  const economy = createRewardProgress();
  assert.equal(CAPTAIN_CARDS.length, 15);
  for (const card of [debtor, pilot, turret]) {
    assert.deepEqual([card.faction, card.rarity, card.provision, card.categories], ['captains', 'bronze', 4, undefined]);
    assert.ok(economy.inventory().owned[card.id] > 0);
    assert.ok(!NEUTRAL_CARDS.some(({ id }) => id === card.id));
  }
  assert.deepEqual([debtor.type, debtor.power, pilot.type, pilot.power, turret.type, turret.power],
    ['unit', 6, 'unit', 3, 'artifact', undefined]);
});

test('Hound ship deployments grant their listed Profit within the coin limit', () => {
  for (const [id, profit] of [['black-hound', 6], ['hound-eyes', 4], ['hound-right-fang', 2], ['hound-left-fang', 2]]) {
    const definition = byId.get(id);
    assert.ok(definition.text.startsWith(`Прибыль ${profit}.`));
    assert.ok(definition.keywords.includes('Прибыль'));
    for (const coins of [0, 8]) {
      assert.equal(human(play(setup({ hand: [definition], coins }), 'orbit')).coins, Math.min(9, coins + profit));
    }
  }
});

const fence = byId.get('stolen-goods-fence');

function playFence(coins = 0) {
  const match = setup({ hand: [fence, ordinary, ordinary], coins });
  match.players.bot.hand = pile([ordinary, ordinary, ordinary], 'bot-hand-');
  return play(match);
}

function playNextFenceTurn(match) {
  for (const side of ['bot', 'human']) {
    const { hand, board } = match.players[side];
    const action = { type: 'play', cardId: hand[0].id, row: 'orbit', position: board.orbit.length };
    const next = applyAction(match, side, action);
    assert.notStrictEqual(next, match);
    match = next;
  }
  return match;
}

test('the collectible Fence pays up to nine coins on its third owner turn', () => {
  assert.deepEqual([fence.faction, fence.rarity, fence.provision, fence.power, fence.categories],
    ['captains', 'epic', 8, 5, undefined]);
  assert.ok(createRewardProgress().inventory().owned[fence.id] > 0);
  assert.ok(!PRESETS.find(({ factionId }) => factionId === 'captains').cardIds.includes(fence.id));
  for (const coins of [0, 4]) {
    let match = playFence(coins);
    for (const remaining of [2, 1, 0]) {
      assert.equal(findUnit(match, 'hand-1').card.counter, remaining);
      assert.equal(human(match).coins, remaining > 0 ? coins : 9);
      if (remaining > 0) match = playNextFenceTurn(match);
    }
    assert.equal(match.log.find(({ type }) => type === 'coins').amount, 9 - coins);
  }
});

test('Lock pauses the Fence counter and destruction prevents payout', () => {
  for (const blocked of [true, false]) {
    let match = playFence(1);
    const unit = findUnit(match, 'hand-1');
    if (blocked) applyStatus(match, unit, 'lock', 1);
    else removeUnit(match, unit, 'destroy');
    match = playNextFenceTurn(playNextFenceTurn(match));
    assert.equal(findUnit(match, 'hand-1')?.card.counter, blocked ? 2 : undefined);
    assert.equal(human(match).coins, 1);
    assert.ok(!match.log.some(({ type }) => type === 'coins'));
  }
});

test('Debtor pays exactly two coins or loses three current power without paying', () => {
  for (const [coins, remaining, power] of [[0, 0, 3], [1, 1, 3], [2, 0, 6], [9, 7, 6]]) {
    const before = setup({ hand: [{ ...debtor, armor: 2, shield: true }], coins });
    const match = play(before);
    const { card } = findUnit(match, 'hand-1');
    assert.deepEqual([human(match).coins, card.power, card.basePower, card.armor, statusCount(card, 'shield')],
      [remaining, power, 6, 2, 1]);
    assert.equal(match.log.filter(({ type }) => type === 'coins').length, Number(coins >= 2));
    assert.equal(match.log.filter(({ type }) => type === 'weaken').length, Number(coins < 2));
    assert.equal(human(before).coins, coins);
  }
});

test('Scrapped Pilot can play in either row and counts only friendly ships there, once', () => {
  for (const row of ['orbit', 'surface']) {
    const otherRow = row === 'orbit' ? 'surface' : 'orbit';
    const before = setup({ hand: [pilot] });
    spawnCards(before, 'bot', row, 0, 1, lightShip);
    spawnCards(before, 'human', otherRow, 0, 1, lightShip);
    const match = play(before, row);
    const { card } = findUnit(match, 'hand-1');
    assert.equal(card.power, 3);
    const first = { ...lightShip };
    const second = row === 'orbit' ? heavyShip : lightShip;
    spawnCards(match, 'human', row, 0, 1, first);
    assert.equal(card.power, 6);
    spawnCards(match, 'human', row, 0, 1, second);
    assert.equal(card.power, 6);
    const [latest, earlier] = human(match).board[row];
    removeUnit(match, findUnit(match, latest.id), 'damage');
    assert.equal(card.power, 6);
    removeUnit(match, findUnit(match, earlier.id), 'destroy');
    assert.equal(card.power, 3);
  }
});

test('an existing heavy ship boosts the pilot and transform or lock updates its effect', () => {
  const match = play(setup({ hand: [pilot], orbit: [heavyShip] }), 'orbit');
  const { card } = findUnit(match, 'hand-1');
  assert.equal(card.power, 6);
  transformUnit(match, findUnit(match, 'orbit-1'), ordinary);
  assert.equal(card.power, 3);
  transformUnit(match, findUnit(match, 'orbit-1'), lightShip);
  assert.equal(card.power, 6);
  applyStatus(match, findUnit(match, card.id), 'lock', 1);
  assert.equal(card.shipRowBonus, undefined);
  removeUnit(match, findUnit(match, 'orbit-1'), 'damage');
  assert.equal(card.power, 6);
});

const turretShot = (event) => event.type === 'damage' && event.visual === 'turret';
const playBotSpare = (match, random) => applyAction(match, 'bot',
  { type: 'play', cardId: 'bot-hand-1', row: 'orbit', position: 0 }, { random });

test('Broken Turret repeats targets, retargets deaths and only fires at enemies on placement', () => {
  const before = setup({ hand: [turret], surface: [ordinary], foes: [{ ...ordinary, power: 2 }, ordinary] });
  const match = applyAction(before, 'human', { type: 'play', cardId: 'hand-1', row: 'surface', position: 1 }, { random: () => 0 });
  assert.equal(match.turn, 'bot');
  assert.deepEqual(match.log.filter(turretShot).map(({ cardId }) => cardId),
    ['foe-0', 'foe-0', 'foe-1', 'foe-1', 'foe-1']);
  assert.equal(findUnit(match, 'foe-1').card.power, 2);
  assert.equal(findUnit(match, 'surface-1').card.power, 5);
  assert.equal(findUnit(match, 'hand-1').card.timer, 0);
  assert.equal(findUnit(match, 'hand-1').card.artState, undefined);
});

test('on its next owner turn the turret shoots one random ally, changes art and stays inert until the round ends', () => {
  const deployed = play(setup({ hand: [turret], orbit: [ordinary], surface: [ordinary] }));
  assert.ok(!deployed.log.some(turretShot));
  const next = playBotSpare(deployed, () => .99);
  const events = next.log.slice(deployed.log.length);
  const art = events.findIndex(({ type }) => type === 'art-state');
  const shot = events.findIndex(turretShot);
  assert.ok(shot >= 0 && art > shot);
  assert.equal(events.filter(turretShot).length, 1);
  assert.deepEqual([events[shot].cardId, events[shot].side, events[shot].amount, events[shot].sourceId],
    ['surface-1', 'human', 1, 'hand-1']);
  const replay = createPlaybackState(deployed);
  events.slice(0, shot).forEach((event) => applyJournalEvent(replay, event));
  assert.equal(findUnit(replay, 'hand-1').card.artState, undefined);
  assert.equal(findUnit(replay, 'surface-1').card.power, 5);
  events.slice(shot).forEach((event) => applyJournalEvent(replay, event));
  assert.equal(findUnit(replay, 'surface-1').card.power, 4);
  assert.equal(findUnit(replay, 'hand-1').card.artState, 'failing');
  assert.equal(findUnit(next, 'orbit-1').card.power, 5);
  assert.equal(findUnit(next, 'hand-1').card.artState, 'failing');
  const played = applyAction(next, 'human', { type: 'play', cardId: 'hand-2', row: 'orbit', position: 1 });
  const later = pass(played, 'human');
  assert.equal(later.log.filter(turretShot).length, 1);
  assert.equal(findUnit(later, 'hand-1'), undefined);
  assert.ok(human(later).discard.some(({ id }) => id === 'hand-1'));
});

test('a turret with no allied target still breaks and one removed early cannot fire', () => {
  const deployed = play(setup({ hand: [turret] }));
  const noAlly = playBotSpare(deployed, () => 0);
  assert.ok(noAlly.log.some(({ type }) => type === 'art-state'));
  assert.ok(!noAlly.log.some(turretShot));
  assert.equal(findUnit(noAlly, 'hand-1').card.artState, 'failing');
  removeUnit(deployed, findUnit(deployed, 'hand-1'), 'destroy');
  const removed = playBotSpare(deployed, () => 0);
  assert.ok(!removed.log.some(({ type }) => type === 'art-state'));
});

test('a cleansed pilot gains the existing ship bonus and loses only that bonus when the ship is destroyed', () => {
  const match = setup({ orbit: [pilot] });
  const unit = findUnit(match, 'orbit-1');
  applyStatus(match, unit, 'lock', 1);
  spawnCards(match, 'human', 'orbit', 1, 1, lightShip);
  assert.equal(unit.card.power, 3);
  cleanse(match, unit);
  assert.deepEqual([unit.card.power, unit.card.shipRowBonus], [6, 3]);
  const ship = human(match).board.orbit[1];
  removeUnit(match, findUnit(match, ship.id), 'destroy');
  assert.equal(findUnit(match, unit.card.id).card.power, 3);
  assert.equal(unit.card.shipRowBonus, undefined);
});

test('consuming the only ship cannot boost a pilot killed by the loss of its aura', () => {
  const match = setup({ orbit: [pilot] });
  const pilotUnit = findUnit(match, 'orbit-1');
  spawnCards(match, 'human', 'orbit', 1, 1, lightShip);
  pilotUnit.card.power = 2;
  const ship = human(match).board.orbit[1];
  consume(match, findUnit(match, ship.id), pilotUnit);
  assert.equal(findUnit(match, pilotUnit.card.id), undefined);
  assert.equal(pilotUnit.card.power, 0);
  assert.ok(!match.log.some(({ type, cardId }) => type === 'boost' && cardId === pilotUnit.card.id));
});
