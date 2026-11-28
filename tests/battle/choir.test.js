import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { announcePlay, applyStatus, createCard, damage, findUnit, spawnCards, statusCount, weaken } from '../../docs/game/engine/board.js';
import { pickBotTarget } from '../../docs/game/bot/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { FACTIONS, KEYWORDS } from '../../docs/game/cards/cards.js';
import { AWAKENING, CHOIR_CARDS, CULTIST, FANATIC, LARGE_TENTACLE, PSIONICS, SLEEPER, TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { collection, copyLimit, inspectDeck, PRESETS } from '../../docs/game/cards/decks.js';
import { availableOrders, canUseLeader, enqueueEndTurn } from '../../docs/game/effects/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../../docs/game/engine/match.js';
import { createRewardProgress } from '../../docs/game/meta/rewards.js';
import { filterCatalog } from '../../docs/ui/catalog-cards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { drain as drainEffects, pick as pickTarget, play as playCard } from '../helpers/battle-helpers.js';

import { action, cards, drain, fixed, get, hit, human, pick, play, quiet, setup, unit } from '../helpers/choir.js';

test('Choir collectible cards are owned by default and can start a match', async () => {
  assert.equal(filterCatalog(CHOIR_CARDS, { faction: 'choir' }).length, 15);
  assert.equal(filterCatalog(CHOIR_CARDS, { faction: 'choir', category: PSIONICS }).length, 7);
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
  assert.equal(match.players.human.startingCategories[PSIONICS], 7);
  assert.equal(canUseLeader(match, 'human'), false);
  assert.equal(await economy.buyPack('choir'), 'unaffordable');
  for (const word of [PSIONICS, CULTIST, 'Щупальце', 'Одержимость', 'Захват', 'Сотворение']) assert.ok(KEYWORDS[word]);
});

test('All Choir cards have full art and crops in the catalog', async () => {
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
    assert.equal(art, `${stem}.webp`, id);
    assert.equal(artCrop, `${stem}-crop.webp`, id);
    for (const file of [art, artCrop]) {
      const url = new URL(`../../docs/art/${file}`, import.meta.url);
      await access(url);
    }
  }
});

test('The three bronze Psionic effects count toward starting-deck Obsession', () => {
  const definitions = [
    ['call-of-the-deep', 6], ['mind-strike', 5], ['sleeper-litany', 6],
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
    before.card.power = 7;
    const choosing = play(initial);
    assert.ok(choosing.pending.options.includes('orbit-1'));
    assert.ok(choosing.pending.options.includes('enemy-1'));
    assert.ok(!choosing.pending.options.includes('surface-0'));
    const result = pick(choosing, id);
    const { card, side: boardSide, row, position } = findUnit(result, id);
    assert.deepEqual([boardSide, row, position], [side, before.row, before.position]);
    assert.equal(card.definition.id, TENTACLE.id);
    assert.equal(card.definition.token, true);
    assert.equal(card.power, 11);
    assert.equal(card.basePower, 3);
    const events = result.log.filter(({ cardId }) => cardId === id).map(({ type, card, amount }) =>
      [type, card?.power ?? amount]);
    assert.deepEqual(events, [['transform', 7], ['boost', 4]]);
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

test('Sleeper Litany offers three Choir bronze units and plays one with an owner-turn counter', () => {
  const choosing = play(setup({ count: 6, hand: [cards.get('sleeper-litany')], surface: [AWAKENING] }));
  assert.equal(choosing.pending.pile, 'created');
  assert.equal(choosing.pending.options.length, 3);
  assert.equal(new Set(choosing.pending.cards.map(({ definition }) => definition.id)).size, 3);
  assert.ok(choosing.pending.cards.every(({ definition }) =>
    definition.faction === 'choir' && definition.rarity === 'bronze' && definition.type === 'unit' && !definition.token));
  const { id } = choosing.pending.cards.find(({ definition }) => definition.id === 'depth-neophyte');
  const result = action(pick(choosing, id), 'place', { row: 'orbit', position: 0 });
  assert.equal(get(result, id).definition.id, 'depth-neophyte');
  assert.equal(get(result, id).power, 6);
  assert.equal(get(result, id).counter, 3);
  assert.equal(result.log.find(({ type, cardId }) => type === 'play' && cardId === id).from, 'created');
  assert.equal(get(result, 'surface-0').playedEffects, 1);
  for (const remaining of [2, 1, 0]) {
    enqueueEndTurn(result, 'bot');
    drain(result);
    assert.equal(get(result, id).counter, remaining + 1);
    enqueueEndTurn(result, 'human');
    drain(result);
    assert.equal(result.log.findLast(({ type }) => type === 'counter').remaining, remaining);
  }
  assert.equal(get(result, id).definition.id, TENTACLE.id);
  assert.equal(get(result, id).power, 3);
  assert.equal(get(result, 'surface-0').chapter, 1);
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

test('Obsession counts printed starting Psionics (the scenario is not Psionics), unaffected by changing the deck', () => {
  for (const [count, expected] of [[0, 0], [2, 0], [3, 1], [5, 1], [6, 2], [9, 3], [12, 4]]) {
    const match = setup({ count, hand: [cards.get('depth-neophyte')], deck: [AWAKENING, AWAKENING] });
    assert.equal(get(play(match), 'hand-0').power, 4 + expected);
  }
  assert.deepEqual(AWAKENING.categories, []);
  const match = createMatch({ decks: { human: [AWAKENING, AWAKENING, quiet], bot: [] }, random: fixed });
  assert.equal(human(match).startingCategories[PSIONICS], 1);
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
