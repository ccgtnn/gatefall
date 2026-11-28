import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { collection, inspectDeck, PRESETS, REBIRTH_PRESET } from '../../docs/game/cards/decks.js';
import { createDeckMatch } from '../../docs/game/engine/match.js';

const [protectorate, growth] = PRESETS;
const shortDeck = { ...protectorate, cardIds: [] };

test('the immutable presets fit the provision cap and have enough units', () => {
  for (const [index, preset] of PRESETS.entries()) {
    const result = inspectDeck(preset);
    assert.equal(result.valid, true);
    assert.equal(result.cards.length, index === 1 ? 27 : 25);
    assert.ok(result.units >= 13);
    assert.equal(result.budget, 165);
    assert.equal(result.cost, ({
      'preset-protectorate': 154, 'preset-growth': 165, 'preset-growth-plague': 150,
      'preset-protectorate-orbital': 156, 'preset-growth-rebirth': 163, 'preset-choir': 160, 'preset-captains': 154,
    })[preset.id]);
    assert.ok(Object.isFrozen(preset.cardIds));
    assert.equal(collection(preset.factionId).length, { growth: 60, protectorate: 55, choir: 42, captains: 41 }[preset.factionId]);
    assert.equal(collection(preset.factionId).filter(({ faction }) => faction === 'neutral').length, 27);
  }
});

test('deck validation reports card, unit, copy, faction, leader, name and provision violations', () => {
  assert.equal(inspectDeck(shortDeck).issues.cards, true);
  assert.equal(inspectDeck(shortDeck).issues.units, true);
  assert.equal(inspectDeck({ ...protectorate, name: '' }).issues.name, true);
  assert.equal(inspectDeck({ ...protectorate, leaderId: growth.leaderId }).issues.leader, true);
  assert.equal(inspectDeck({ ...protectorate, cardIds: [...protectorate.cardIds, 'vine'] }).issues.foreign, true);
  const overspent = inspectDeck({ ...protectorate, cardIds: [...protectorate.cardIds, 'smuggler', 'world-gates'] });
  assert.equal(overspent.issues.provisions, true);
  assert.equal(overspent.issues.copies, false);
  const duplicates = inspectDeck({ ...shortDeck, cardIds: ['smuggler', 'smuggler', 'smuggler', 'annihilation', 'annihilation'] });
  assert.deepEqual([...duplicates.overLimit], ['smuggler', 'annihilation']);
  assert.equal(duplicates.issues.copies, true);
});

test('saved custom compositions and leaders are used to start a match against the opposing preset', () => {
  const deck = { ...protectorate, name: 'Custom', leaderId: 'fleet-admiral',
    cardIds: protectorate.cardIds.map((id) => id === 'smuggler' ? 'emp-grenade' : id) };
  const match = createDeckMatch(deck, { random: () => .99 });
  assert.ok(match);
  assert.equal(match.players.human.leader.id, 'fleet-admiral');
  assert.equal(match.players.human.factionId, 'protectorate');
  const ids = (player) => [...player.hand, ...player.deck].map(({ definition }) => definition.id).sort();
  assert.deepEqual(ids(match.players.human), deck.cardIds.toSorted());
  assert.deepEqual(ids(match.players.bot), REBIRTH_PRESET.cardIds.toSorted());
  assert.equal(match.players.bot.leader.id, 'devourer');
  const defaultMatch = createDeckMatch(deck, { random: () => 0 });
  assert.deepEqual(ids(defaultMatch.players.bot), FACTIONS.growth.deck.map(({ id }) => id).sort());
  assert.equal(createDeckMatch(shortDeck), null);
});

test('saved drafts reload independently of presets and of the editor object', async () => {
  const { createDeckStorage } = await import('../../docs/ui/deck-storage.js');
  const storage = {
    value: 'invalid JSON',
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
  const decks = createDeckStorage(storage);
  assert.deepEqual(decks.list(), []);
  assert.equal(decks.save(protectorate), false);
  const draft = { ...shortDeck, id: 'draft', cardIds: ['smuggler'] };
  assert.equal(decks.save(draft), true);
  draft.cardIds.push('smuggler');
  assert.deepEqual(createDeckStorage(storage).list()[0].cardIds, ['smuggler']);
  assert.equal(decks.save(draft), true);
  assert.deepEqual(createDeckStorage(storage).list()[0].cardIds, ['smuggler', 'smuggler']);
});

test('ownership validation blocks a two-copy deck even when one copy still exists', () => {
  const { counts } = inspectDeck(protectorate);
  const owned = Object.fromEntries(counts);
  const id = [...counts].find(([, quantity]) => quantity === 2)[0];
  assert.equal(inspectDeck(protectorate, owned).valid, true);
  owned[id] -= 1;
  const short = inspectDeck(protectorate, owned);
  assert.equal(short.valid, false);
  assert.equal(short.issues.ownership, true);
  assert.equal(short.issues.copies, false);
  assert.equal(short.missing.get(id), 1);
  delete owned[id];
  assert.equal(inspectDeck(protectorate, owned).missing.get(id), 2);
  assert.equal(inspectDeck(protectorate).valid, true);
});

test('remove deletes saved decks, recent entries, drafts and the primary marker but not presets', async () => {
  const { createDeckStorage, PRIMARY_DECK_KEY, RECENT_DECKS_KEY } = await import('../../docs/ui/deck-storage.js');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = createDeckStorage(storage);
  const first = { ...protectorate, id: 'first' };
  const second = { ...growth, id: 'second' };
  store.save(first);
  store.save(second);
  store.recordPlay(first.id, 1);
  store.recordPlay(second.id, 2);
  store.setPrimary(first.id);
  store.stageDraft({ ...first, id: 'draft' });

  assert.equal(store.remove(protectorate.id), false);
  assert.equal(store.remove(first.id), true);
  assert.deepEqual(store.list(), [second]);
  assert.equal(store.get(first.id), undefined);
  assert.deepEqual(store.recent(), [second]);
  assert.deepEqual(JSON.parse(values.get(RECENT_DECKS_KEY)), [{ id: second.id, at: 2 }]);
  assert.equal(values.has(PRIMARY_DECK_KEY), false);
  assert.equal(store.primary(), undefined);
  assert.deepEqual(createDeckStorage(storage).list(), [second]);
  assert.equal(store.remove('draft'), true);
  assert.equal(store.get('draft'), undefined);
});

test('primary decks may be presets, move between decks and reset when invalid or missing', async () => {
  const { createDeckStorage, PRIMARY_DECK_KEY } = await import('../../docs/ui/deck-storage.js');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = createDeckStorage(storage);
  const custom = { ...protectorate, id: 'custom' };
  store.save(custom);
  assert.equal(store.setPrimary(growth.id), true);
  assert.equal(store.primary().id, growth.id);
  assert.equal(store.setPrimary(custom.id), true);
  assert.equal(store.primary().id, custom.id);
  store.save({ ...custom, cardIds: [] });
  assert.equal(store.primary(), undefined);
  assert.equal(values.has(PRIMARY_DECK_KEY), false);
  values.set(PRIMARY_DECK_KEY, 'missing');
  assert.equal(store.primary(), undefined);
  assert.equal(values.has(PRIMARY_DECK_KEY), false);
});

test('refresh loads another tab’s decks and merges a subsequent local save', async () => {
  const { createDeckStorage } = await import('../../docs/ui/deck-storage.js');
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const first = createDeckStorage(storage);
  const second = createDeckStorage(storage);
  const deck = { id: 'shared', name: 'Shared', factionId: 'growth', leaderId: 'devourer', cardIds: [] };
  first.save(deck);
  second.refresh();
  assert.deepEqual(second.get(deck.id), deck);
  second.save({ ...deck, id: 'local' });
  first.save({ ...deck, name: 'New title' });
  second.refresh();
  assert.equal(second.get(deck.id).name, 'New title');
  assert.deepEqual(second.list().map(({ id }) => id), ['shared', 'local']);
  first.remove(deck.id);
  second.refresh();
  assert.deepEqual(second.list().map(({ id }) => id), ['local']);
});
