import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_PLOTS, STARTING_MATERIALS } from '../docs/game/base.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';

function storageWithGold() {
  let saved = JSON.stringify({ unlocked: [
    'protectorate:signal', 'protectorate:supply', 'protectorate:junction',
    'protectorate:upper-cache', 'protectorate:upper-relay', 'protectorate:upper-vault',
  ] });
  return { getItem: () => saved, setItem(key, value) {
    assert.equal(key, REWARD_STORAGE_KEY);
    saved = value;
  } };
}

test('Tavern construction on any free plot spends from the shared wallet and persists', async () => {
  for (const plot of BASE_PLOTS) {
    const storage = storageWithGold();
    const wallet = createRewardProgress(storage);
    assert.deepEqual(wallet.base(), { materials: STARTING_MATERIALS, buildings: {} });
    assert.equal(wallet.inventory().gold, 365);
    assert.equal(await wallet.build(plot, 'tavern'), 'done');
    const reopened = createRewardProgress(storage);
    assert.equal(reopened.inventory().gold, 65);
    assert.deepEqual(reopened.base(), {
      materials: { steel: 50, energyCells: 50, gateShards: 5 },
      buildings: { [plot]: { kind: 'tavern', level: 1 } },
    });
    assert.equal(await reopened.buyPack('protectorate'), 'unaffordable');
  }
});

test('concurrent construction only spends once on an occupied plot', async () => {
  const storage = storageWithGold();
  let queue = Promise.resolve();
  const locks = { request: (_key, run) => (queue = queue.then(run)) };
  const a = createRewardProgress(storage, locks);
  const b = createRewardProgress(storage, locks);
  assert.deepEqual(await Promise.all([a.build('1', 'tavern'), b.build('1', 'tavern')]), ['done', 'occupied']);
  assert.equal(b.inventory().gold, 65);
  assert.equal(b.base().materials.steel, 50);
});

test('failed and unaffordable builds keep their materials, and material grants persist', async () => {
  const wallet = createRewardProgress({ getItem: () => '{"unlocked":[]}' });
  assert.equal(await wallet.build('5', 'tavern'), 'unaffordable');
  assert.equal(await wallet.build('7', 'tavern'), 'unknown');
  assert.deepEqual(wallet.base(), { materials: STARTING_MATERIALS, buildings: {} });
  const storage = storageWithGold();
  const funded = createRewardProgress(storage);
  assert.equal(await funded.grantMaterials({ steel: 25, gateShards: 2 }), 'done');
  const reopened = createRewardProgress(storage);
  const before = reopened.base();
  assert.deepEqual(before.materials, { steel: 225, energyCells: 100, gateShards: 7 });
  assert.equal(await reopened.grantMaterials({ steel: -100 }), 'unknown');
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(await reopened.build('1', 'tavern'), 'unavailable');
  assert.deepEqual(reopened.base(), before);
  assert.equal(reopened.inventory().gold, 365);
});
