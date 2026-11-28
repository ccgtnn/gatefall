import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTER_DECKS } from '../../docs/game/cards/decks.js';
import { createRewardProgress } from '../../docs/game/meta/rewards.js';
import { createDeckStorage } from '../../docs/ui/deck-storage.js';

test('home shows up to four playable decks in last-played order across reloads', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const { owned } = createRewardProgress(storage).inventory();
  const store = createDeckStorage(storage);
  assert.deepEqual(store.recent(owned), STARTER_DECKS.slice(0, 4));
  const custom = Array.from({ length: 6 }, (_, i) => ({
    ...STARTER_DECKS[0], id: `custom-${i}`, name: `Колода ${i}`,
  }));
  for (const [i, deck] of custom.entries()) {
    store.save(deck);
    store.recordPlay(deck.id, i + 10);
  }
  store.recordPlay(custom[0].id, 300);
  store.save({ ...custom[5], cardIds: [] });
  store.recordPlay('missing-deck', 500);
  assert.deepEqual(createDeckStorage(storage).recent(owned), [custom[0], custom[4], custom[3], custom[2]]);
  assert.deepEqual(createDeckStorage(storage).recent({}), []);
});
