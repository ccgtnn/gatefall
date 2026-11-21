import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTIONS } from '../docs/game/cards.js';
import { collection, inspectDeck, PRESETS } from '../docs/game/decks.js';
import { createDeckMatch } from '../docs/game/match.js';

const [protectorate, growth] = PRESETS;
const shortDeck = { ...protectorate, cardIds: [] };

test('the two immutable presets fit the provision cap and have enough units', () => {
  for (const [index, preset] of PRESETS.entries()) {
    const result = inspectDeck(preset);
    assert.equal(result.valid, true);
    assert.equal(result.cards.length, index === 0 ? 25 : 27);
    assert.ok(result.units >= 13);
    assert.equal(result.budget, 165);
    assert.equal(result.cost, index === 0 ? 165 : 164);
    assert.ok(Object.isFrozen(preset.cardIds));
    assert.equal(collection(preset.factionId).length, 26);
    assert.equal(collection(preset.factionId).filter(({ faction }) => faction === 'neutral').length, 11);
  }
});

test('deck validation reports card, unit, copy, faction, leader, name and provision violations', () => {
  assert.equal(inspectDeck(shortDeck).issues.cards, true);
  assert.equal(inspectDeck(shortDeck).issues.units, true);
  assert.equal(inspectDeck({ ...protectorate, name: '' }).issues.name, true);
  assert.equal(inspectDeck({ ...protectorate, leaderId: growth.leaderId }).issues.leader, true);
  assert.equal(inspectDeck({ ...protectorate, cardIds: [...protectorate.cardIds, 'vine'] }).issues.foreign, true);
  const overspent = inspectDeck({ ...protectorate, cardIds: [...protectorate.cardIds, 'smuggler'] });
  assert.equal(overspent.issues.provisions, true);
  assert.equal(overspent.issues.copies, false);
  const duplicates = inspectDeck({ ...shortDeck, cardIds: ['smuggler', 'smuggler', 'smuggler', 'annihilation', 'annihilation'] });
  assert.deepEqual([...duplicates.overLimit], ['smuggler', 'annihilation']);
  assert.equal(duplicates.issues.copies, true);
});

test('saved custom compositions and leaders are used to start a match against the opposing preset', () => {
  const deck = { ...protectorate, name: 'Custom', leaderId: 'fleet-admiral',
    cardIds: protectorate.cardIds.map((id) => id === 'recon-drone' ? 'smuggler' : id) };
  const match = createDeckMatch(deck, { random: () => .99 });
  assert.equal(match.players.human.leader.id, 'fleet-admiral');
  assert.equal(match.players.human.factionId, 'protectorate');
  const ids = (player) => [...player.hand, ...player.deck].map(({ definition }) => definition.id).sort();
  assert.deepEqual(ids(match.players.human), deck.cardIds.toSorted());
  assert.deepEqual(ids(match.players.bot), FACTIONS.growth.deck.map(({ id }) => id).sort());
  assert.equal(createDeckMatch(shortDeck), null);
});

test('saved drafts reload independently of presets and of the editor object', async () => {
  const { createDeckStorage } = await import('../docs/ui/deck-storage.js');
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
