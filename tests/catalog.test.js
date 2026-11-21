import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTIONS, NEUTRAL_CARDS } from '../docs/game/cards.js';
import { filterCatalog } from '../docs/ui/catalog-cards.js';
import { setCardRarity } from '../docs/ui/dom.js';

const cards = [...NEUTRAL_CARDS, ...Object.values(FACTIONS).flatMap(({ pool }) => pool)];
const ids = (filters) => filterCatalog(cards, filters).map(({ id }) => id);

test('catalog searches both name and card text, ignoring case and ё spelling', () => {
  assert.ok(ids({ query: '  АННИГИЛЯЦИЯ  ' }).includes('annihilation'));
  assert.deepEqual(ids({ query: 'Фалура породи 2 тени' }), ['falura']);
  assert.ok(ids({ query: 'звезд' }).length > 0);
  assert.deepEqual(ids({ query: 'неттакойкарты' }), []);
});

test('all 21 gold cards are included and catalog filters combine across factions', () => {
  assert.equal(ids({ rarity: 'gold' }).length, 21);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'artifact', category: 'Пустота', provision: '19' }),
    ['falura']);
  assert.deepEqual(ids({ faction: 'growth', rarity: 'gold', type: 'artifact', category: 'Пустота', provision: '19' }), []);
  assert.deepEqual(ids({ faction: 'neutral', rarity: 'gold', type: 'effect', provision: '11' }), ['world-gates']);
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
