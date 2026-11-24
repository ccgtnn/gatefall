import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { announcePlay, applyStatus, createCard, damage, findUnit, removeUnit, spawnCards, statusCount, weaken } from '../docs/game/board.js';
import { chooseBotTurn, pickBotTarget } from '../docs/game/bot.js';
import { KEYWORDS } from '../docs/game/cards.js';
import { AWAKENING, CHOIR_CARDS, CULTIST, FANATIC, LARGE_TENTACLE, PSIONICS, SLEEPER, TENTACLE } from '../docs/game/choir.js';
import { collection, copyLimit, inspectDeck, PRESETS } from '../docs/game/decks.js';
import { availableOrders, canUseLeader, enqueueEndTurn, runEffect } from '../docs/game/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../docs/game/match.js';
import { createRewardProgress } from '../docs/game/rewards.js';
import { filterCatalog } from '../docs/ui/catalog-cards.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

const cards = new Map(CHOIR_CARDS.map((definition) => [definition.id, definition]));
const unit = (power) => ({ id: `unit-${power}`, name: `Отряд ${power}`, type: 'unit', power });
const quiet = { id: 'psionic-test', name: 'Псионика', type: 'effect', categories: [PSIONICS], deploy: { steps: [] } };
const fixed = () => 0;

function setup({ count = 0, hand = [], deck = [], orbit = [], surface = [], enemies = [] } = {}) {
  const match = createMatch({ decks: { human: Array(count).fill(quiet), bot: [] },
    humanFaction: 'choir', botFaction: 'protectorate', random: fixed });
  match.phase = 'playing';
  match.turn = 'human';
  const pile = (items, label) => items.map((definition, i) => createCard(`${label}-${i}`, definition));
  Object.assign(match.players.human, {
    hand: pile([...hand, unit(3)], 'hand'),
    deck: pile(deck, 'deck'),
    board: { orbit: pile(orbit, 'orbit'), surface: pile(surface, 'surface') },
  });
  match.players.bot.hand = pile([unit(3)], 'enemy-hand');
  match.players.bot.board.orbit = pile(enemies, 'enemy');
  return match;
}
const human = (match) => match.players.human;
const get = (match, id) => findUnit(match, id)?.card;
const action = (match, type, parameters) => applyAction(match, 'human', { type, ...parameters }, { random: fixed });
const play = (match, row = 'orbit', position = human(match).board[row].length) =>
  action(match, 'play', { cardId: 'hand-0', row, position });
const pick = (match, cardId) => action(match, 'target', { cardId });
function drain(match) {
  while (!match.pending && match.effects.length) {
    const job = match.effects.shift();
    if (job.discard) match.players[job.side].discard.push(job.discard);
    else runEffect(match, job, fixed);
  }
  return match;
}
function hit(match, id, amount) {
  damage(match, findUnit(match, id), amount);
  return drain(match);
}

test('Choir collectible cards are owned by default and can start a match', async () => {
  assert.equal(filterCatalog(CHOIR_CARDS, { faction: 'choir' }).length, 15);
  assert.equal(filterCatalog(CHOIR_CARDS, { faction: 'choir', category: PSIONICS }).length, 8);
  assert.ok(collection('choir').every(({ token }) => !token));
  const economy = createRewardProgress();
  const { owned } = economy.inventory();
  for (const card of CHOIR_CARDS) {
    assert.equal(owned[card.id], card.token ? undefined : copyLimit(card));
  }
  const deck = PRESETS.find(({ factionId }) => factionId === 'choir');
  assert.equal(inspectDeck(deck, owned).valid, true);
  assert.equal(inspectDeck({ ...deck, cardIds: [...deck.cardIds, TENTACLE.id] }, owned).issues.foreign, true);
  const match = createDeckMatch(deck, { random: fixed });
  assert.equal(match.players.human.factionId, 'choir');
  assert.equal(match.players.human.startingCategories[PSIONICS], 8);
  assert.equal(canUseLeader(match, 'human'), false);
  assert.equal(await economy.buyPack('choir'), 'unknown');
  for (const word of [PSIONICS, CULTIST, 'Щупальце', 'Одержимость', 'Захват', 'Сотворение']) assert.ok(KEYWORDS[word]);
});

test('All Choir cards have versioned full art and crops in the catalog', async () => {
  const artwork = new Map([
    ['ulmarin-fanatic', 'sleeper-fanatic'],
    ['ulmarin-tentacle', 'sleeper-tentacle'],
    ['ulmarin-large-tentacle', 'sleeper-great-tentacle'],
    ['ulmarin-sleeper', 'sleeper-under-gates'],
    ['ulmarin-awakening', 'sleeper-awakening'],
    ['depth-neophyte', 'depth-neophyte'],
    ['altar-guardian', 'altar-guardian'],
    ['forbidden-scroll-keeper', 'forbidden-scroll-keeper'],
    ['whisper-interpreter', 'whisper-interpreter'],
    ['cult-dreamer', 'cult-dreamer'],
    ['abyss-shepherd', 'abyss-shepherd'],
    ['alien-dream', 'stranger-dream'],
    ['sleeper-revelation', 'sleeper-revelation'],
    ['minor-offering', 'lesser-offering'],
    ['great-sacrifice', 'great-sacrifice'],
    ['call-of-the-deep', 'call-of-the-deep'],
    ['mind-strike', 'mind-strike'],
    ['sleeper-litany', 'sleeper-litany'],
  ]);
  for (const { id, art, artCrop } of CHOIR_CARDS) {
    const stem = artwork.get(id);
    assert.ok(stem, id);
    assert.equal(art?.split('?')[0], `${stem}.webp`, id);
    assert.equal(artCrop?.split('?')[0], `${stem}-crop.webp`, id);
    for (const file of [art, artCrop]) {
      const url = new URL(`../docs/art/${file}`, import.meta.url);
      assert.match(url.searchParams.get('v') ?? '', /^choir-art-\d+$/, id);
      await access(url);
    }
  }
});

test('The three bronze Psionic effects count toward starting-deck Obsession', () => {
  const definitions = [
    ['call-of-the-deep', 6], ['mind-strike', 5], ['sleeper-litany', 4],
  ].map(([id, provision]) => {
    const definition = cards.get(id);
    assert.equal(definition.type, 'effect');
    assert.equal(definition.rarity, 'bronze');
    assert.equal(definition.provision, provision);
    assert.equal(copyLimit(definition), 2);
    assert.deepEqual(definition.categories, [PSIONICS]);
    return definition;
  });
  const match = setup({ hand: [cards.get('depth-neophyte')] });
  const startingMatch = createMatch({ decks: { human: definitions, bot: [] }, random: fixed });
  human(match).startingCategories = human(startingMatch).startingCategories;
  assert.equal(human(match).startingCategories[PSIONICS], 3);
  assert.equal(get(play(match), 'hand-0').power, 5);
});

test('Call of the Deep transforms and boosts the selected unit in place on either side', () => {
  for (const [id, side, chapter] of [['orbit-1', 'human', 1], ['enemy-1', 'bot', 0]]) {
    const initial = setup({
      hand: [cards.get('call-of-the-deep')],
      orbit: [unit(3), unit(10), unit(8)], surface: [AWAKENING],
      enemies: [unit(3), unit(10), unit(8)],
    });
    const before = findUnit(initial, id);
    const choosing = play(initial);
    assert.ok(choosing.pending.options.includes('orbit-1'));
    assert.ok(choosing.pending.options.includes('enemy-1'));
    assert.ok(!choosing.pending.options.includes('surface-0'));
    const result = pick(choosing, id);
    const { card, side: boardSide, row, position } = findUnit(result, id);
    assert.deepEqual([boardSide, row, position], [side, before.row, before.position]);
    assert.equal(card.definition.id, TENTACLE.id);
    assert.equal(card.definition.token, true);
    assert.equal(card.power, TENTACLE.power + 4);
    const events = result.log.filter(({ cardId }) => cardId === id).map(({ type, card, amount }) =>
      [type, card?.power ?? amount]);
    assert.deepEqual(events, [['transform', TENTACLE.power], ['boost', 4]]);
    assert.equal(get(result, 'surface-0').chapter, chapter);
    assert.equal(get(result, 'surface-0').playedEffects, 1);
  }
});

test('A friendly Call of the Deep appearance can complete Awakening as the seventh Psionic effect', () => {
  const initial = setup({ hand: [cards.get('call-of-the-deep')], orbit: [unit(10)], surface: [AWAKENING] });
  get(initial, 'surface-0').chapter = 2;
  for (let i = 0; i < 6; i++) announcePlay(initial, 'human', createCard(`previous-${i}`, quiet));
  const result = pick(play(initial), 'orbit-0');
  assert.equal(get(result, 'surface-0').playedEffects, 7);
  assert.equal(get(result, 'surface-0').chapter, 3);
  assert.ok(human(result).board.surface.some(({ definition }) => definition.id === SLEEPER.id));
});

test('Mind Strike deals five damage to one selected unit on either side', () => {
  const armored = { ...unit(8), armor: 2 };
  const effect = cards.get('mind-strike');
  const choosing = play(setup({ hand: [effect], orbit: [armored], surface: [AWAKENING], enemies: [armored] }));
  assert.deepEqual(choosing.pending.options.sort(), ['enemy-0', 'orbit-0']);
  for (const [target, other] of [['enemy-0', 'orbit-0'], ['orbit-0', 'enemy-0']]) {
    const result = pick(choosing, target);
    assert.deepEqual([get(result, target).power, get(result, target).armor], [5, 0]);
    assert.deepEqual([get(result, other).power, get(result, other).armor], [8, 2]);
    assert.equal(get(result, 'surface-0').playedEffects, 1);
  }
});

test('Sleeper Litany boosts every friendly Cultist across rows and counts as a played Psionic effect', () => {
  const result = play(setup({
    hand: [cards.get('sleeper-litany')],
    orbit: [FANATIC, TENTACLE], surface: [AWAKENING, cards.get('depth-neophyte'), unit(8)], enemies: [FANATIC],
  }));
  assert.equal(get(result, 'orbit-0').power, FANATIC.power + 1);
  assert.equal(get(result, 'surface-1').power, cards.get('depth-neophyte').power + 1);
  assert.equal(get(result, 'orbit-1').power, TENTACLE.power);
  assert.equal(get(result, 'surface-2').power, 8);
  assert.equal(get(result, 'enemy-0').power, FANATIC.power);
  assert.equal(get(result, 'surface-0').playedEffects, 1);
});

test('The Sleeper names and Cultist glossary use the same text while card IDs stay stable', () => {
  assert.equal(CULTIST, 'Культист Спящего');
  assert.match(KEYWORDS[CULTIST], /Приказ Спящего/);
  for (const [id, name] of [
    ['ulmarin-fanatic', 'Фанатик Спящего'],
    ['ulmarin-tentacle', 'Щупальце Спящего'],
    ['ulmarin-large-tentacle', 'Большое щупальце Спящего'],
    ['ulmarin-awakening', 'Пробуждение Спящего'],
    ['ulmarin-sleeper', 'Спящий под Вратами'],
  ]) assert.equal(cards.get(id).name, name);
  assert.match(AWAKENING.text, /призови Спящего под Вратами/);
  assert.match(SLEEPER.text, /культистов Спящего/);
});

test('Obsession counts printed starting category including scenarios, unaffected by changing the deck', () => {
  for (const [count, expected] of [[0, 0], [2, 0], [3, 1], [5, 1], [6, 2], [9, 3], [12, 4]]) {
    const match = setup({ count, hand: [cards.get('depth-neophyte')], deck: [AWAKENING, AWAKENING] });
    assert.equal(get(play(match), 'hand-0').power, 4 + expected);
  }
  const match = createMatch({ decks: { human: [AWAKENING, AWAKENING, quiet], bot: [] }, random: fixed });
  assert.equal(human(match).startingCategories[PSIONICS], 3);
});

test('Dreamer returns exactly the number actually drawn, with choices and random insertion', () => {
  const initial = setup({ count: 12, hand: [cards.get('cult-dreamer'), ...Array(8).fill(unit(3))],
    deck: [unit(1), unit(2), unit(4)] });
  let match = play(initial);
  assert.equal(match.pending.kind, 'hand-return');
  assert.equal(human(match).hand.length, 10);
  match = pick(match, 'hand-1');
  const returned = match.log.filter(({ type }) => type === 'hand-return');
  assert.equal(returned.length, 1);
  assert.equal(human(match).deck[0].id, 'hand-1');
  assert.equal(human(match).hand.length, 9);
});

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

test('Fanatic transforms at two power or less in place, but not on lethal damage or while locked', () => {
  const match = setup({ surface: [unit(9), FANATIC, unit(9)] });
  hit(match, 'surface-1', 1);
  assert.equal(get(match, 'surface-1').definition.id, FANATIC.id);
  hit(match, 'surface-1', 1);
  assert.deepEqual(human(match).board.surface.map(({ definition, power }) => [definition.id, power]),
    [['unit-9', 9], [TENTACLE.id, 2], ['unit-9', 9]]);

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

test('Both tentacles only hit the immediate unit to their right and grow on surviving real damage', () => {
  for (const [definition, dealt] of [[TENTACLE, 1], [LARGE_TENTACLE, 2]]) {
    const match = setup({ orbit: [unit(9), definition, unit(9)], enemies: [unit(9)] });
    enqueueEndTurn(match, 'human');
    drain(match);
    assert.equal(get(match, 'orbit-0').power, 9);
    assert.equal(get(match, 'orbit-2').power, 9 - dealt);
    assert.equal(get(match, 'enemy-0').power, 9);
    applyStatus(match, findUnit(match, 'orbit-1'), 'shield', 1);
    hit(match, 'orbit-1', 1);
    assert.equal(get(match, 'orbit-1').power, definition.power);
    hit(match, 'orbit-1', 1);
    assert.equal(get(match, 'orbit-1').power, definition.power + 1);
    assert.equal(get(hit(match, 'orbit-1', 20), 'orbit-1'), undefined);
  }
});

test('Scenario prologue surrounds the artifact and Fanatic transformation triggers chapter one', () => {
  const match = play(setup({ hand: [AWAKENING], orbit: [unit(9)], deck: [FANATIC, unit(4)] }), 'orbit', 0);
  const row = human(match).board.orbit;
  assert.deepEqual(row.map(({ definition }) => definition.id), [FANATIC.id, AWAKENING.id, FANATIC.id, 'unit-9']);
  assert.equal(row[0].definition.token, true);
  assert.equal(row[2].definition.token, true);
  assert.equal(get(match, 'hand-0').playedEffects, 0);
  const result = hit(match, row[0].id, 2);
  assert.equal(get(result, 'hand-0').chapter, 1);
  assert.deepEqual(human(result).deck.map(({ power, basePower }) => [power, basePower]), [[5, 5], [4, 4]]);
});

test('Chapter two watches one victim, ignores discard, and summons the large tentacle on destruction', () => {
  for (const reason of ['discard', 'damage', 'destroy']) {
    let match = setup({ orbit: [AWAKENING, unit(2), unit(9)] });
    spawnCards(match, 'bot', 'surface', 0, 1, TENTACLE);
    drain(match);
    assert.equal(get(match, 'orbit-0').chapter, 0);
    spawnCards(match, 'human', 'surface', 0, 2, TENTACLE);
    drain(match);
    assert.equal(get(match, 'orbit-0').chapter, 2);
    assert.deepEqual(pickBotTarget(match), { type: 'target', cardId: 'orbit-1' });
    match = pick(match, 'orbit-1');
    removeUnit(match, findUnit(match, 'orbit-2'), 'destroy');
    drain(match);
    assert.ok(!human(match).board.surface.some(({ definition }) => definition.id === LARGE_TENTACLE.id));
    removeUnit(match, findUnit(match, 'orbit-1'), reason);
    drain(match);
    assert.equal(human(match).board.surface.filter(({ definition }) => definition.id === LARGE_TENTACLE.id).length,
      reason === 'discard' ? 0 : 1);
  }
});

test('Final chapter needs a new appearance with seven played effects, completes once and summons in its own row', () => {
  const match = setup({ surface: [AWAKENING], orbit: [unit(5)] });
  const scenario = get(match, 'surface-0');
  scenario.chapter = 2;
  scenario.scenarioSacrifice = 'orbit-0';
  for (let index = 0; index < 6; index++) announcePlay(match, 'human', createCard(`spell-${index}`, quiet));
  announcePlay(match, 'human', createCard('scenario-inert', AWAKENING));
  announcePlay(match, 'bot', createCard('enemy-spell', quiet));
  spawnCards(match, 'human', 'surface', 1, 1, TENTACLE);
  drain(match);
  assert.equal(scenario.chapter, 2);
  assert.equal(scenario.playedEffects, 6);
  announcePlay(match, 'human', createCard('spell-7', quiet));
  drain(match);
  assert.equal(scenario.chapter, 2);
  removeUnit(match, findUnit(match, 'orbit-0'), 'destroy');
  drain(match);
  assert.equal(scenario.chapter, 3);
  assert.equal(scenario.playedEffects, 7);
  const sleeper = human(match).board.surface.find(({ definition }) => definition.id === SLEEPER.id);
  assert.ok(sleeper);
  assert.equal(findUnit(match, sleeper.id).row, 'surface');
  spawnCards(match, 'human', 'surface', 3, 1, TENTACLE);
  drain(match);
  assert.equal(human(match).board.surface.filter(({ definition }) => definition.id === SLEEPER.id).length, 1);
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

  const shielded = setup({ orbit: [SLEEPER, { ...unit(2), shield: true }] });
  get(shielded, 'orbit-0').readyAt = 2;
  enqueueEndTurn(shielded, 'human');
  drain(shielded);
  assert.equal(get(shielded, 'orbit-0').power, 8);
  assert.equal(get(shielded, 'orbit-0').readyAt, 2);
});

test('Hand and deck tutors offer Psionics and resolve the nested play before drawing', () => {
  const handTutor = cards.get('whisper-interpreter');
  const start = setup({ hand: [handTutor, quiet, AWAKENING], deck: [unit(8)] });
  const fromHand = play(start);
  assert.deepEqual(fromHand.pending.options, ['hand-1', 'hand-2']);
  assert.equal(fromHand.pending.pile, 'hand');
  assert.ok(fromHand.pending.options.includes(pickBotTarget(fromHand).cardId));
  const finished = pick(fromHand, 'hand-1');
  assert.equal(human(finished).effectCategoryPlays[PSIONICS], 1);
  assert.deepEqual(finished.log.filter(({ type }) => ['play', 'draw'].includes(type)).map(({ type, from }) => [type, from]),
    [['play', undefined], ['play', 'hand'], ['draw', undefined]]);

  const keeper = cards.get('forbidden-scroll-keeper');
  const deckChoice = play(setup({ hand: [keeper], deck: [unit(5), AWAKENING, quiet] }));
  assert.deepEqual(deckChoice.pending.options, ['deck-1', 'deck-2']);
  const placement = pick(deckChoice, 'deck-1');
  assert.equal(placement.pending.kind, 'deck-placement');
  const placed = action(placement, 'place', { row: 'surface', position: 0 });
  assert.deepEqual(human(placed).board.surface.map(({ definition }) => definition.id), [FANATIC.id, AWAKENING.id, FANATIC.id]);
});

test('Creation offers opposing bronze cards or tiered gold effects and plays the chosen copy', () => {
  const initial = setup({ hand: [cards.get('alien-dream')] });
  const choice = play(initial);
  assert.equal(choice.pending.options.length, 3);
  assert.ok(choice.pending.cards.every(({ definition }) => definition.faction === 'protectorate' && definition.rarity === 'bronze'));
  const created = choice.pending.cards.find(({ definition }) => definition.type === 'unit');
  const placement = pick(choice, created.id);
  const played = action(placement, 'place', { row: 'surface', position: 0 });
  assert.equal(get(played, created.id).definition.id, created.definition.id);
  assert.equal(played.log.find(({ cardId }) => cardId === created.id).from, 'created');

  for (const [count, offer] of [[2, 0], [3, 1], [6, 2], [9, 3], [12, 4], [15, 4]]) {
    const match = play(setup({ count, hand: [cards.get('sleeper-revelation')], orbit: [unit(6)], enemies: [unit(8)] }));
    assert.equal(match.pending?.options.length ?? 0, offer);
    assert.ok(match.pending?.cards.every(({ definition }) => definition.rarity === 'gold' && definition.type === 'effect') ?? true);
  }
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

test('Awakening survives one round and round cleanup does not count as a sacrifice', () => {
  const before = setup({ orbit: [AWAKENING, FANATIC] });
  const scenario = get(before, 'orbit-0');
  scenario.chapter = 2;
  scenario.scenarioSacrifice = 'orbit-1';
  const after = applyAction(action(before, 'pass'), 'bot', { type: 'pass' }, { random: fixed });
  const retained = get(after, 'orbit-0');
  assert.equal(after.round, 2);
  assert.equal(retained.chapter, 2);
  assert.equal(retained.resilient, false);
  assert.equal(retained.scenarioSacrifice, undefined);
  assert.equal(human(after).board.surface.length, 0);
});

test('The bot completes placement of a created unit at all difficulties', () => {
  const initial = setup({});
  initial.turn = 'bot';
  initial.players.human.factionId = 'protectorate';
  initial.players.bot.factionId = 'choir';
  initial.players.bot.leader = null;
  initial.players.bot.hand = [createCard('alien-dream', cards.get('alien-dream')), createCard('extra', unit(3))];
  const choosing = applyAction(initial, 'bot', { type: 'play', cardId: 'alien-dream' }, { random: fixed });
  const unitChoice = choosing.pending.cards.find(({ definition }) => definition.type === 'unit');
  const placing = applyAction(choosing, 'bot', { type: 'target', cardId: unitChoice.id }, { random: fixed });
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const move = chooseBotTurn(placing, difficulty);
    assert.equal(move.type, 'place');
    const played = applyAction(placing, 'bot', move, { random: fixed });
    assert.equal(findUnit(played, unitChoice.id).side, 'bot');
  }
});
