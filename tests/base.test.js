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

test('the Tavern only builds on the right-front plot and spends once', async () => {
  const storage = storageWithGold();
  const wallet = createRewardProgress(storage);
  for (const plot of BASE_PLOTS.filter((plot) => plot !== '5')) {
    assert.equal(await wallet.build(plot, 'tavern'), 'unknown');
  }
  assert.deepEqual(wallet.base(), { materials: STARTING_MATERIALS, buildings: {} });
  assert.equal(wallet.inventory().gold, 365);
  assert.equal(await wallet.build('5', 'tavern'), 'done');
  const reopened = createRewardProgress(storage);
  assert.equal(reopened.inventory().gold, 65);
  assert.deepEqual(reopened.base(), {
    materials: { steel: 50, energyCells: 50, gateShards: 5 },
    buildings: { 5: { kind: 'tavern', level: 1 } },
  });
  assert.equal(await reopened.buyPack('protectorate'), 'unaffordable');
});

test('legacy Taverns move to the right-front plot without any change to the wallet', async () => {
  const storage = storageWithGold();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({
    ...JSON.parse(storage.getItem(REWARD_STORAGE_KEY)),
    goldSpent: 300,
    base: {
      materials: { steel: 50, energyCells: 50, gateShards: 5 },
      buildings: { 4: { kind: 'tavern', level: 3 }, 5: { kind: 'tavern', level: 1 } },
    },
  }));
  const wallet = createRewardProgress(storage);
  assert.deepEqual(wallet.base(), {
    materials: { steel: 50, energyCells: 50, gateShards: 5 },
    buildings: { 5: { kind: 'tavern', level: 3 } },
  });
  assert.equal(wallet.inventory().gold, 65);
  assert.equal(await wallet.build('5', 'tavern'), 'occupied');
  await wallet.grantMaterials({ gateShards: 1 });
  assert.deepEqual(JSON.parse(storage.getItem(REWARD_STORAGE_KEY)).base.buildings,
    { 5: { kind: 'tavern', level: 3 } });
});

test('concurrent construction only spends once on an occupied plot', async () => {
  const storage = storageWithGold();
  let queue = Promise.resolve();
  const locks = { request: (_key, run) => (queue = queue.then(run)) };
  const a = createRewardProgress(storage, locks);
  const b = createRewardProgress(storage, locks);
  assert.deepEqual(await Promise.all([a.build('5', 'tavern'), b.build('5', 'tavern')]), ['done', 'occupied']);
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
  assert.equal(await reopened.build('5', 'tavern'), 'unavailable');
  assert.deepEqual(reopened.base(), before);
  assert.equal(reopened.inventory().gold, 365);
});

test('the Mine builds only on the right-middle plot and deducts its price', async () => {
  const wallet = createRewardProgress();
  for (const plot of BASE_PLOTS.filter((plot) => plot !== '2')) {
    assert.equal(await wallet.build(plot, 'mine'), 'unknown');
  }
  assert.equal(await wallet.build('2', 'mine'), 'done');
  assert.equal(wallet.inventory().gold, 600);
  assert.deepEqual(wallet.base(), {
    materials: { steel: 100, energyCells: 50, gateShards: 5 },
    buildings: { 2: { kind: 'mine', level: 1 } },
  });
  assert.equal(await wallet.build('2', 'mine'), 'occupied');
  assert.equal(await wallet.build('5', 'tavern'), 'unaffordable');
});

test('the Mine and the Tavern persist in back-to-front order regardless of construction order', async () => {
  for (const order of [['mine', 'tavern'], ['tavern', 'mine']]) {
    let save = null;
    const storage = { getItem: () => save, setItem: (_key, value) => { save = value; } };
    const wallet = createRewardProgress(storage);
    await wallet.grantMaterials({ steel: 50 });
    for (const kind of order) {
      assert.equal(await wallet.build(kind === 'mine' ? '2' : '5', kind), 'done');
    }

    const reopened = createRewardProgress(storage);
    const scene = reopened.base();
    assert.deepEqual(scene.materials, { steel: 0, energyCells: 0, gateShards: 5 });
    assert.equal(reopened.inventory().gold, 300);
    assert.deepEqual(BASE_PLOTS.flatMap((id) => scene.buildings[id]?.kind ?? []), ['mine', 'tavern']);
    assert.equal(scene.buildings['2'].level, 1);
    assert.equal(scene.buildings['5'].level, 1);
  }
});
