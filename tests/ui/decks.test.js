import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTIONS } from '../../docs/game/cards.js';
import { collection, inspectDeck, PRESETS, REBIRTH_PRESET } from '../../docs/game/decks.js';
import { createDeckMatch } from '../../docs/game/match.js';

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
    assert.equal(collection(preset.factionId).length, { growth: 55, protectorate: 49, choir: 40, captains: 39 }[preset.factionId]);
    assert.equal(collection(preset.factionId).filter(({ faction }) => faction === 'neutral').length, 25);
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
});
