import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingEffect, buildingPrice, productionHours } from '../docs/game/base.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';
import { resetProgress } from '../docs/game/reset-progress.js';

const HOUR = 3_600_000;
function setup(snapshot = { startingGold: 1000, startingKeys: 1000 }) {
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
  assert.equal(reopen().inventory().gold, 10000);
});

test('the Outpost produces a key in eight hours and collection feeds the reward book', async () => {
  const { wallet, tick, reopen } = setup();
  assert.equal(await wallet.build('outpost', 'outpost'), 'done');
  tick(7);
  assert.equal(reopen().production().outpost.outputs.keys.stored, 0);
  tick(20);
  const after = reopen();
  assert.deepEqual(after.production().outpost.outputs.keys, { stored: 1, capacity: 1 });
  assert.equal(after.production().outpost.full, true);
  assert.equal(after.inventory().keys, 1000);
  assert.equal(await after.collect(), 'done');
  assert.equal(await reopen().unlock('growth:signal'), 'opened');
  assert.equal(reopen().inventory().keys, 1000);
});

test('Outpost upgrades speed up key production and use the warehouse capacity', async () => {
  const { wallet, tick, reopen } = setup({
    base: { buildings: { outpost: { kind: 'outpost', level: 2 }, warehouse: { kind: 'warehouse', level: 1 } } },
  });
  await wallet.checkpointProduction();
  tick(6);
  assert.deepEqual(reopen().production().outpost.outputs.keys, { stored: 1, capacity: 2.25 });
  tick(12);
  assert.equal(await reopen().collect('outpost'), 'done');
  assert.equal(reopen().inventory().keys, 27);
  tick(4);
  assert.equal(reopen().production().outpost.outputs.keys.stored, 1);
});

test('only victories earn gold, including five percent per Outpost level, once per match', async () => {
  const starter = setup();
  assert.equal(await starter.wallet.rewardMatch('regular-win', 'win'), 'done');
  assert.equal(starter.wallet.inventory().gold, 1020);
  const { wallet, reopen } = setup({
    startingGold: 1000, base: { buildings: { outpost: { kind: 'outpost', level: 3 } } },
  });
  assert.equal(await wallet.rewardMatch('lost', 'loss'), 'empty');
  assert.equal(await wallet.rewardMatch('drawn', 'draw'), 'empty');
  assert.equal(wallet.inventory().gold, 1000);
  let queue = Promise.resolve();
  const locks = { request: (_, commit) => (queue = queue.then(commit)) };
  const results = await Promise.all([reopen(locks).rewardMatch('won', 'win'), reopen(locks).rewardMatch('won', 'win')]);
  assert.deepEqual(results, ['done', 'claimed']);
  assert.equal(await reopen().rewardMatch('won', 'win'), 'claimed');
  assert.equal(reopen().inventory().gold, 1023);
});

test('the weekly bundle scales, survives reload, and cannot be claimed twice or after clock rollback', async () => {
  const { wallet, tick, reopen } = setup({
    startingGold: 1000, base: { buildings: { outpost: { kind: 'outpost', level: 2 } } },
  });
  assert.equal(await setup().wallet.claimOutpost(), 'empty');
  assert.deepEqual(wallet.weeklyOutpost(), { bundle: { gold: 200, steel: 100, energyCells: 100 }, remaining: 0 });
  await wallet.checkpointProduction();
  tick(-1);
  assert.equal(await reopen().claimOutpost(), 'cooldown');
  tick(1);
  let queue = Promise.resolve();
  const locks = { request: (_, commit) => (queue = queue.then(commit)) };
  const outcomes = await Promise.all([reopen(locks).claimOutpost(), reopen(locks).claimOutpost()]);
  assert.deepEqual(outcomes, ['done', 'cooldown']);
  assert.equal(reopen().inventory().gold, 1200);
  assert.deepEqual(reopen().base().materials, { steel: 300, energyCells: 200, gateShards: 5 });
  tick(167);
  assert.equal(await reopen().claimOutpost(), 'cooldown');
  tick(1);
  await reopen().checkpointProduction();
  tick(-.5);
  assert.equal(await reopen().claimOutpost(), 'cooldown');
  tick(.5);
  assert.equal(await reopen().claimOutpost(), 'done');
  assert.equal(await reopen().claimOutpost(), 'cooldown');
  assert.equal(reopen().inventory().gold, 1400);
});
