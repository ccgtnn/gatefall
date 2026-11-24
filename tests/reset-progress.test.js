import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';
import { resetProgress } from '../docs/game/reset-progress.js';
import { createDeckStorage } from '../docs/ui/deck-storage.js';
import { createFactionStats } from '../docs/ui/stats.js';

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

const preferences = {
  'gatefall.bot-difficulty': 'hard',
  'gatefall.bot-thoughts': 'on',
  'gatefall.animation-speed': 'fast',
  'gatefall.sound-enabled': 'off',
  'gatefall.sound-volume': '73',
};

function boot(storage) {
  const decks = createDeckStorage(storage).list();
  const rewards = createRewardProgress(storage, undefined, { legacyDecks: decks });
  return {
    decks,
    progress: rewards.get(),
    base: rewards.base(),
    inventory: rewards.inventory(),
    stats: createFactionStats(['protectorate'], storage).get('protectorate'),
    preferences: Object.keys(preferences).map((key) => storage.getItem(key)),
  };
}

test('reset restores the first-launch inventory, rewards, decks, stats, and preferences', async () => {
  const storage = memoryStorage();
  const initial = boot(storage);
  const { gold, keys, essence, packCount } = initial.inventory;
  assert.deepEqual({ gold, keys, essence, packCount }, { gold: 0, keys: 0, essence: 0, packCount: 0 });
  assert.deepEqual(initial.base.materials, { steel: 0, energyCells: 0, gateShards: 0 });
  const deck = { id: 'custom', name: 'Проверка', factionId: 'protectorate', leaderId: 'marshal', cardIds: ['old-golem'] };
  const deckStorage = createDeckStorage(storage);
  assert.equal(deckStorage.save(deck), true);
  deckStorage.recordPlay(deck.id);
  createFactionStats(['protectorate'], storage).record('protectorate', 'win');
  for (const [key, value] of Object.entries(preferences)) storage.setItem(key, value);
  storage.setItem('other-game.save', 'keep');
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({
    startingKeys: 30, startingGold: 500, base: { materials: { steel: 300, energyCells: 150 } },
  }));
  const rewards = createRewardProgress(storage, undefined, { legacyDecks: [deck], random: () => 0 });
  assert.equal(await rewards.dismantle('mystic-golem'), 'done');
  for (const stop of ['signal', 'supply', 'junction', 'upper-cache']) {
    assert.equal(await rewards.unlock('neutral:' + stop), 'opened');
  }
  assert.equal(await rewards.buyPack('neutral'), 'done');
  assert.equal(await rewards.openPack('neutral'), 'done');
  for (const stop of ['signal', 'supply', 'junction', 'upper-cache', 'upper-relay', 'upper-vault']) {
    assert.equal(await rewards.unlock('protectorate:' + stop), 'opened');
  }
  assert.equal(await rewards.build('warehouse', 'warehouse'), 'done');
  assert.equal(await rewards.upgrade('warehouse', 1), 'done');
  assert.equal(await rewards.grantMaterials({ gateShards: 3 }), 'done');
  const before = boot(storage);
  assert.ok(before.inventory.pendingPack);
  assert.equal(before.inventory.packCount, 3);
  assert.notDeepEqual(before, initial);

  const locks = { request(key, action) {
    assert.equal(key, REWARD_STORAGE_KEY);
    return action();
  } };
  await resetProgress(storage, locks);
  assert.deepEqual(boot(storage), initial);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem('other-game.save'), 'keep');
  await resetProgress(storage);
  assert.deepEqual(boot(storage), initial);
});
