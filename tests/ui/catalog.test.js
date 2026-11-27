import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { CAPTAIN_CARDS, HOUND, REINFORCED_HOUND } from '../../docs/game/cards/factions/captains.js';
import { CARD_DEFINITIONS, CATALOG_CARDS, cardsForFaction, findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { collection } from '../../docs/game/cards/decks.js';
import { filterCatalog, normalizeCardSearch } from '../../docs/ui/catalog-cards.js';
import { setCardRarity } from '../../docs/ui/dom.js';

const cards = CATALOG_CARDS;
const ids = (filters) => filterCatalog(cards, filters).map(({ id }) => id);

test('the shared registry resolves unique card IDs and preserves collection boundaries', () => {
  assert.equal(new Set(CARD_DEFINITIONS.map(({ id }) => id)).size, CARD_DEFINITIONS.length);
  assert.ok(CATALOG_CARDS.every((card) => !card.token && findCardDefinition(card.id) === card));
  assert.equal(findCardDefinition(HOUND.id), undefined);
  assert.equal(findCardDefinition(REINFORCED_HOUND.id), undefined);
  assert.deepEqual(cardsForFaction('captains'), CAPTAIN_CARDS);
  assert.deepEqual(collection('captains').filter(({ faction }) => faction === 'captains'), CAPTAIN_CARDS);
  assert.ok(collection('choir').includes(findCardDefinition('helper-robot')));
});

test('Hound tokens stay outside the catalog with or without inventory filters', () => {
  const entries = [...CAPTAIN_CARDS, HOUND, REINFORCED_HOUND];
  const owned = { [CAPTAIN_CARDS[0].id]: 1 };
  const select = (filters) => filterCatalog(entries, { faction: 'captains', category: 'Гончая', owned, ...filters });
  assert.deepEqual(select({}), filterCatalog(CAPTAIN_CARDS, { category: 'Гончая' }));
  assert.deepEqual(select({ availability: 'owned' }), [CAPTAIN_CARDS[0]]);
  assert.equal(select({ availability: 'missing' }).length, entries.filter(({ categories, token }) => !token && categories?.includes('Гончая')).length - 1);
  assert.ok(select({ provision: '5' }).every(({ provision }) => provision === 5));
});

test('catalog searches both name and card text, ignoring case and ё spelling', () => {
  assert.ok(ids({ query: '  АННИГИЛЯЦИЯ  ' }).includes('annihilation'));
  assert.deepEqual(ids({ query: 'Файлура призови 2 тени' }), ['falura']);
  assert.ok(ids({ query: 'пепел звезд' }).includes('falura'));
  assert.equal(cards.find(({ id }) => id === 'falura').name, 'Файлура, Пепел Звёзд');
  assert.deepEqual(ids({ query: 'неттакойкарты' }), []);
});

test('all collectible gold cards are included and catalog filters combine across factions', () => {
  assert.equal(ids({ rarity: 'gold' }).length, 32);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'artifact', category: 'Пустота', provision: '19' }),
    ['falura']);
  assert.deepEqual(ids({ faction: 'growth', rarity: 'gold', type: 'artifact', category: 'Пустота', provision: '19' }), []);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'effect', provision: '11' }), ['world-gates']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'effect', provision: '9' }), ['resurrection']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'artifact', provision: '10' }), ['forgotten-gates']);
  assert.equal(cards.find(({ id }) => id === 'world-gates').name, 'Врата Миров');
  assert.equal(cards.find(({ id }) => id === 'forgotten-gates').name, 'Врата Забвения');
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'bronze', type: 'artifact', category: 'Кристалл', provision: '5' }), ['storm-eye']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'epic', type: 'unit', category: 'Голем', provision: '9' }),
    ['fire-golem', 'sleeping-mountain', 'old-golem']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', category: 'Голем', provision: '10' }), ['mystic-golem']);
  assert.deepEqual(ids({ faction: 'protectorate', rarity: 'gold', category: 'Голем', provision: '10' }), ['imperial-golem']);
  assert.deepEqual(ids({ query: 'Статуя Императора' }), ['imperial-golem']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', category: 'Зверь', provision: '12' }), ['carrion-devourer']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'epic', type: 'unit', category: 'Робот', provision: '8' }), ['helper-robot']);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'bronze', type: 'effect', provision: '6', query: 'Расправа' }), ['armor-piercing-shot']);
});

test('catalog sorts by increasing provision, alphabetically, or by decreasing printed power', () => {
  const byProvision = filterCatalog(cards).map(({ provision }) => provision);
  assert.deepEqual(byProvision, byProvision.toSorted((a, b) => a - b));
  const byName = filterCatalog(cards, { sort: 'name' }).map(({ name }) => name);
  assert.deepEqual(byName, byName.toSorted((a, b) => a.localeCompare(b, 'ru')));
  const byPower = filterCatalog(cards, { sort: 'power' }).map(({ power }) => power ?? -Infinity);
  assert.deepEqual(byPower, byPower.toSorted((a, b) => b - a));
});

test('a reused card container drops the previous rarity for cards without one', () => {
  const container = { dataset: {} };
  setCardRarity(container, 'gold');
  assert.equal(container.dataset.rarity, 'gold');
  setCardRarity(container, 'bronze');
  assert.equal(container.dataset.rarity, 'bronze');
  setCardRarity(container, undefined);
  assert.ok(!('rarity' in container.dataset));
});

test('availability filters compose with other filters and distinguish one copy from zero', () => {
  const owned = { 'resurrection': 0, 'world-gates': 1 };
  const options = { faction: 'neutral', type: 'effect', rarity: 'gold', owned };
  assert.ok(ids(options).includes('resurrection'));
  assert.deepEqual(ids({ ...options, availability: 'owned' }), ['world-gates']);
  const unavailable = ids({ ...options, availability: 'missing' });
  assert.ok(unavailable.includes('resurrection'));
  assert.ok(!unavailable.includes('world-gates'));
  assert.ok(!unavailable.includes('falura'));
});

test('each playable faction defines all four palette tokens in CSS', async () => {
  const palettes = await Promise.all(['cards.css', 'deck-screens.css']
    .map((file) => readFile(new URL(`../../docs/${file}`, import.meta.url), 'utf8')));
  for (const id of Object.keys(FACTIONS)) {
    const selector = new RegExp(`\\[data-faction="${id}"\\]\\s*\\{([^}]+)\\}`, 'g');
    const rules = [...palettes.join('\n').matchAll(selector)].map(([, declarations]) => declarations).join('\n');
    for (const key of ['edge', 'light', 'face', 'second']) assert.match(rules, new RegExp(`--faction-${key}:`), id);
  }
});

test('each faction uses its own WebP at 360 by 540', async () => {
  for (const [faction, { cardBack }] of Object.entries(FACTIONS)) {
    assert.equal(cardBack, `back-${faction}.webp`);
    const bytes = await readFile(new URL(`../../docs/art/${cardBack}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 8, 16), 'WEBPVP8 ');
    assert.equal(bytes.readUInt16LE(26) & 0x3fff, 360);
    assert.equal(bytes.readUInt16LE(28) & 0x3fff, 540);
  }
});

test('deck search normalizes е and ё the same way as the catalog', () => {
  const name = 'Тяжёлый штурмовик';
  assert.ok(normalizeCardSearch(name).includes(normalizeCardSearch('тяжелый')));
});

test('collection screens use their own fixed WebP backgrounds', async () => {
  const [css, app] = await Promise.all(['deck-screens.css', 'app.js']
    .map((file) => readFile(new URL(`../../docs/${file}`, import.meta.url), 'utf8')));
  for (const [state, screen, asset] of [
    ['is-catalog', 'card-catalog', 'collection-table.webp'],
    ['is-all-decks', 'all-decks', 'war-table.webp'],
  ]) {
    assert.ok(css.includes(`#app.${state}`));
    assert.ok(css.includes(`url('./art/backgrounds/${asset}')`));
    assert.match(app, new RegExp(`classList\\.toggle\\('${state}', [^\\n]+classList\\.contains\\('${screen}'\\)`));
    const bytes = await readFile(new URL(`../../docs/art/backgrounds/${asset}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 8, 16), 'WEBPVP8 ');
    assert.equal(bytes.readUInt16LE(26) & 0x3fff, 1920);
    assert.ok(bytes.length <= 250_000, `${asset} is ${bytes.length} bytes`);
  }
});
