import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_PLOTS, buildingEffect, buildingPrice } from '../../docs/game/base.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../../docs/game/rewards.js';

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
  assert.deepEqual(wallet.base(), { materials: { steel: 200, energyCells: 100, gateShards: 5 }, buildings: {} });
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
  assert.deepEqual(wallet.base(), { materials: { steel: 200, energyCells: 100, gateShards: 5 }, buildings: {} });
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
  let saved = JSON.stringify({ startingGold: 1000 });
  const wallet = createRewardProgress({ getItem: () => saved, setItem: (_key, value) => { saved = value; } });
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
    let save = JSON.stringify({ startingGold: 1000 });
    const storage = { getItem: () => save, setItem: (_key, value) => { save = value; } };
    const wallet = createRewardProgress(storage);
    assert.equal(await wallet.grantMaterials({ steel: 50 }), 'done');
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

test('new building prices, levels, affordability and the level cap survive reloads', async () => {
  let saved = JSON.stringify({ startingGold: 1000 });
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const wallet = createRewardProgress(storage);
  assert.equal(await wallet.upgrade('warehouse', 1), 'stale');
  assert.equal(await wallet.build('warehouse', 'warehouse'), 'done');
  assert.deepEqual(buildingPrice('warehouse', 2), { gold: 94, steel: 120, energyCells: 38 });
  assert.deepEqual(buildingPrice('warehouse', 3), { gold: 141, steel: 180, energyCells: 57 });
  assert.equal(await wallet.upgrade('warehouse', 1), 'done');
  const again = createRewardProgress(storage);
  assert.equal(again.base().buildings.warehouse.level, 2);
  assert.equal(again.inventory().gold, 656);
  assert.deepEqual(again.base().materials, { steel: 0, energyCells: 37, gateShards: 5 });
  assert.equal(await again.upgrade('warehouse', 1), 'stale');
  assert.equal(await again.upgrade('warehouse', 2), 'unaffordable');
  const snapshot = JSON.parse(saved);
  snapshot.base.buildings.warehouse.level = 5;
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify(snapshot));
  assert.equal(buildingPrice('warehouse', 6), undefined);
  assert.equal(await again.upgrade('warehouse', 5), 'max-level');
  assert.match(buildingEffect('tavern', 4), /слотов: 4/);
});

test('existing bases keep material balances and building levels from before the grid', () => {
  const snapshot = {
    startingGold: 1000,
    goldSpent: 700,
    base: {
      materials: { steel: 750, energyCells: 900, gateShards: 1000 },
      buildings: { 2: { kind: 'mine', level: 1 }, 5: { kind: 'tavern', level: 3 } },
    },
  };
  const old = createRewardProgress({ getItem: () => JSON.stringify(snapshot) });
  assert.deepEqual(old.base(), snapshot.base);
  assert.equal(old.inventory().gold, 300);
});
