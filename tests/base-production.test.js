import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingEffect, buildingPrice, productionHours } from '../docs/game/base.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';
import { resetProgress } from '../docs/game/reset-progress.js';

const HOUR = 3_600_000;
function setup(snapshot = null) {
  let saved = snapshot && JSON.stringify(snapshot);
  const storage = {
    get length() { return saved === null ? 0 : 1; },
    key: () => REWARD_STORAGE_KEY,
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; },
    removeItem: () => { saved = null; },
  };
  let time = 10 * HOUR;
  const reopen = (locks) => createRewardProgress(storage, locks, { now: () => time });
  return { wallet: reopen(), reopen, storage, tick: (hours) => { time += hours * HOUR; } };
}

test('offline production credits only whole resources at collection and retains the fraction', async () => {
  const { wallet, tick, reopen } = setup();
  assert.equal(await wallet.build('2', 'mine'), 'done');
  assert.equal(await wallet.build('power', 'power'), 'done');
  tick(1.25);
  const after = reopen();
  assert.deepEqual(after.production().mine.outputs, { steel: { stored: 25, capacity: 160 }, gold: { stored: 12, capacity: 80 } });
  assert.equal(after.inventory().gold, 250);
  assert.equal(await after.collect('mine'), 'done');
  assert.equal(after.inventory().gold, 262);
  assert.equal(after.base().materials.steel, 50);
  assert.equal(after.production().power.outputs.energyCells.stored, 12);
  tick(.0625);
  assert.equal(await reopen().collect(), 'done');
  assert.equal(wallet.inventory().gold, 263);
  assert.equal(wallet.base().materials.energyCells, 38);
  assert.equal(wallet.base().materials.steel, 51);
  assert.equal(await wallet.collect(), 'empty');
});

test('the warehouse raises the cap and upgrades settle time at the previous rate and capacity', async () => {
  const { wallet, tick } = setup();
  assert.equal(await wallet.build('2', 'mine'), 'done');
  tick(20);
  assert.equal(wallet.production().mine.full, true);
  assert.deepEqual(wallet.production().mine.outputs.steel, { stored: 160, capacity: 160 });
  assert.equal(await wallet.build('warehouse', 'warehouse'), 'done');
  assert.deepEqual(wallet.production().mine.outputs.steel, { stored: 160, capacity: 240 });
  tick(50);
  assert.equal(wallet.production().mine.full, true);
  assert.deepEqual(wallet.production().mine.outputs.steel, { stored: 240, capacity: 240 });
  assert.equal(await wallet.collect('mine'), 'done');
  tick(1);
  assert.equal(await wallet.grantMaterials({ energyCells: 50 }), 'done');
  assert.equal(await wallet.upgrade('mine', 1), 'done');
  tick(1);
  assert.deepEqual(wallet.production().mine.outputs.steel, { stored: 50, capacity: 360 });
  assert.deepEqual(wallet.production().mine.outputs.gold, { stored: 25, capacity: 180 });
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(productionHours), [8, 12, 18, 24, 30, 36]);
});

test('clock rollback freezes production across reads, collection, and reopening', async () => {
  const { wallet, tick, reopen } = setup();
  assert.equal(await wallet.build('2', 'mine'), 'done');
  tick(2);
  assert.equal(wallet.production().mine.outputs.steel.stored, 40);
  assert.equal(await wallet.checkpointProduction(), 'done');
  tick(-1);
  const after = reopen();
  assert.equal(after.production().mine.outputs.steel.stored, 40);
  assert.equal(await after.collect('mine'), 'done');
  tick(.5);
  assert.equal(reopen().production().mine.outputs.steel.stored, 0);
  tick(1);
  assert.equal(reopen().production().mine.outputs.steel.stored, 10);
});

test('building upgrades require exactly the new tier shard price and respect it at purchase', async () => {
  const { wallet } = setup({
    startingGold: 10000,
    base: { materials: { steel: 10000, energyCells: 10000, gateShards: 6 }, buildings: { gate: { kind: 'gate', level: 3 } } },
  });
  assert.equal(buildingPrice('gate', 1).gateShards, 5);
  assert.equal(buildingPrice('gate', 2).gateShards, undefined);
  assert.equal(buildingPrice('gate', 3).gateShards, undefined);
  assert.equal(buildingPrice('gate', 4).gateShards, 2);
  assert.equal(buildingPrice('gate', 5).gateShards, 5);
  assert.equal(await wallet.upgrade('gate', 3), 'done');
  const before = wallet.base();
  assert.equal(before.materials.gateShards, 4);
  assert.equal(await wallet.upgrade('gate', 4), 'unaffordable');
  assert.deepEqual(wallet.base(), before);
  assert.match(buildingEffect('gate', 1), /неделю: 1/);
  assert.match(buildingEffect('gate', 3), /неделю: 2/);
  assert.match(buildingEffect('gate', 5), /бонусные модификаторы и награды/);
});

test('legacy buildings start producing at the first checkpoint and reset clears stored production and gold', async () => {
  const { wallet, storage, reopen, tick } = setup({
    startingGold: 1000, base: { buildings: { 2: { kind: 'mine', level: 1 } } },
  });
  assert.equal(await wallet.checkpointProduction(), 'done');
  tick(3);
  const after = reopen();
  assert.equal(after.production().mine.outputs.steel.stored, 60);
  assert.equal(await after.collect(), 'done');
  tick(1);
  assert.equal(await after.checkpointProduction(), 'done');
  assert.equal(reopen().inventory().gold, 1030);
  await resetProgress(storage);
  assert.deepEqual(reopen().production(), {});
  assert.equal(reopen().inventory().gold, 1000);
});
