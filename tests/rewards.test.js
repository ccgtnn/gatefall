import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOSTER_FACTIONS, craftPrice, dismantleValue, createRewardProgress, REWARD_SECTIONS, REWARD_STORAGE_KEY, rewardState } from '../docs/game/rewards.js';
import { copyLimit } from '../docs/game/decks.js';
import { NEUTRAL_CARDS, RARITY_LABELS } from '../docs/game/cards.js';

function localStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const chapters = REWARD_SECTIONS.flatMap((section) => section.chapters);

test('the book has two sections, five 21-node chapters and reachable rare rewards', () => {
  const storage = localStorage();
  assert.equal(createRewardProgress(storage).get().keys, 25);
  assert.deepEqual(REWARD_SECTIONS.map(({ chapters }) => chapters.length), [3, 2]);
  assert.deepEqual(BOOSTER_FACTIONS.map(({ id }) => id), ['protectorate', 'growth', 'neutral']);
  assert.equal(new Set(chapters.flatMap(({ nodes }) => nodes.map(({ id }) => id))).size, 105);
  const layouts = new Set();
  for (const { nodes } of chapters) {
    assert.equal(nodes.length, 21);
    const layout = nodes.map(({ x, y }) => [x, y]);
    assert.equal(new Set(layout.map(String)).size, nodes.length);
    layouts.add(JSON.stringify(layout));
    const costs = new Map();
    for (const { id, parents, cost } of [...nodes].sort((a, b) => a.x - b.x || a.y - b.y)) {
      assert.ok(parents.every((parent) => costs.has(parent)), 'the map runs from entry to finale');
      costs.set(id, cost + (parents.length ? Math.min(...parents.map((parent) => costs.get(parent))) : 0));
    }
    const terminals = nodes.filter(({ id }) => !nodes.some(({ parents }) => parents.includes(id)));
    assert.deepEqual(nodes.filter(({ finale }) => finale), terminals);
    assert.ok(terminals.every(({ id, kind }) => ['card-back', 'battlefield'].includes(kind) && costs.get(id) <= 25));
  }
  assert.equal(layouts.size, chapters.length);
  assert.deepEqual(chapters.map(({ nodes }) => nodes.filter(({ finale }) => finale).length), [2, 1, 2, 1, 2]);
});

test('spending needs an unlocked parent and persists across pages and reloads', async () => {
  const storage = localStorage();
  const first = createRewardProgress(storage);
  assert.equal(await first.unlock('protectorate:supply'), 'locked');
  assert.equal(await first.unlock('protectorate:signal'), 'opened');
  assert.equal(await first.unlock('protectorate:signal'), 'unlocked');
  assert.equal(await first.unlock('growth:signal'), 'opened');
  assert.equal(await first.unlock('protectorate:supply'), 'opened');

  const reloaded = createRewardProgress(storage);
  assert.deepEqual(reloaded.get(), { keys: 21, unlocked: new Set(['protectorate:signal', 'growth:signal', 'protectorate:supply']) });
  assert.equal(rewardState(chapters[0].nodes[2], reloaded.get()), 'available');
});

test('25 keys can reach a rare reward, then spending stops exactly at zero', async () => {
  const wallet = createRewardProgress(localStorage());
  const { nodes } = chapters[0];
  for (const node of nodes.slice(0, 7)) assert.equal(await wallet.unlock(node.id), 'opened');
  assert.equal(wallet.get().keys, 5);
  assert.equal(await wallet.unlock(nodes[7].id), 'opened');
  assert.equal(await wallet.unlock(nodes[8].id), 'opened');
  assert.equal(wallet.get().keys, 0);
  assert.equal(await wallet.unlock(nodes[9].id), 'unaffordable');
  assert.equal(await wallet.unlock('neutral:signal'), 'unaffordable');
});

test('duplicate and unknown saved nodes cannot spend keys twice', () => {
  const storage = localStorage();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: ['unknown', 'growth:upper-finish', 'growth:signal', 'growth:signal'] }));
  assert.deepEqual(createRewardProgress(storage).get(), { keys: 24, unlocked: new Set(['growth:signal']) });
});

test('a failing storage write leaves the balance and route unchanged', async () => {
  const storage = localStorage();
  storage.setItem = () => { throw new Error('storage is full'); };
  const wallet = createRewardProgress(storage);
  assert.equal(await wallet.unlock('growth:signal'), 'unavailable');
  assert.deepEqual(wallet.get(), { keys: 25, unlocked: new Set() });
});

test('wallet instances share a lock and both openings survive concurrent writes', async () => {
  const storage = localStorage();
  let queue = Promise.resolve();
  const locks = { request(name, commit) {
    assert.equal(name, REWARD_STORAGE_KEY);
    const next = queue.then(commit);
    queue = next;
    return next;
  } };
  const first = createRewardProgress(storage, locks);
  const second = createRewardProgress(storage, locks);
  assert.deepEqual(await Promise.all([first.unlock('growth:signal'), second.unlock('neutral:signal')]), ['opened', 'opened']);
  assert.deepEqual(first.get(), { keys: 23, unlocked: new Set(['growth:signal', 'neutral:signal']) });
});

test('already opened rewards fund the shop once and persist a faction booster purchase', async () => {
  const storage = localStorage();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: [
    'neutral:signal', 'neutral:supply', 'neutral:junction', 'neutral:upper-cache',
  ] }));
  const wallet = createRewardProgress(storage);
  assert.equal(wallet.inventory().gold, 130);
  assert.equal(wallet.inventory().essence, 835);
  assert.equal(wallet.inventory().boosters.neutral, 1);
  assert.equal(await wallet.buyPack('growth'), 'done');
  const reloaded = createRewardProgress(storage);
  assert.equal(reloaded.inventory().boosters.growth, 1);
  assert.equal(reloaded.inventory().gold, 30);
  assert.equal(await reloaded.buyPack('growth'), 'unaffordable');
  assert.equal(await reloaded.unlock('neutral:signal'), 'unlocked');
  assert.equal(reloaded.inventory().gold, 30);
});

test('opening consumes one booster and grants five distinct faction cards before the reveal', async () => {
  const storage = localStorage();
  const wallet = createRewardProgress(storage, undefined, { random: () => 0 });
  const before = wallet.inventory();
  assert.equal(await wallet.openPack('growth'), 'empty');
  await wallet.unlock('neutral:signal');
  await wallet.unlock('neutral:supply');
  assert.equal(await wallet.openPack('neutral'), 'done');
  const reloaded = createRewardProgress(storage);
  const { pendingPack, boosters, owned } = reloaded.inventory();
  assert.equal(pendingPack.faction, 'neutral');
  assert.deepEqual(pendingPack.cards, NEUTRAL_CARDS.slice(0, 5).map(({ id }) => id));
  for (const id of pendingPack.cards) assert.equal(owned[id], before.owned[id] + 1);
  assert.equal(boosters.neutral, 0);
  assert.equal(await reloaded.openPack('neutral'), 'pending');
  assert.equal(await reloaded.finishPack(pendingPack.id), 'done');
  assert.equal(createRewardProgress(storage).inventory().pendingPack, null);
  assert.equal(await wallet.finishPack(pendingPack.id), 'unknown');
});

test('crafting spends rarity price, caps usable copies and preserves previous decks', async () => {
  const storage = localStorage();
  const bronze = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'bronze');
  const wallet = createRewardProgress(storage, undefined, { legacyDecks: [{ cardIds: [bronze.id] }] });
  const { owned } = wallet.inventory();
  const [gold, otherGold] = NEUTRAL_CARDS.filter(({ rarity, id }) => rarity === 'gold' && !owned[id]);
  const initial = owned[bronze.id];
  assert.ok(initial >= 1);
  assert.equal(craftPrice(bronze), 100);
  assert.equal(craftPrice(gold), 800);
  assert.equal(await wallet.craft(gold.id), 'done');
  assert.equal(await wallet.craft(gold.id), 'owned');
  assert.equal(await wallet.craft(otherGold.id), 'unaffordable');
  const reloaded = createRewardProgress(storage);
  assert.equal(reloaded.inventory().essence, 0);
  assert.equal(reloaded.inventory().owned[gold.id], 1);
  assert.equal(reloaded.inventory().owned[bronze.id], initial);
});

test('concurrent pack opening charges once, and a failed craft leaves essence untouched', async () => {
  const storage = localStorage();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: ['growth:signal', 'growth:supply'] }));
  const locks = { request: async (_name, commit) => commit() };
  const first = createRewardProgress(storage, locks);
  const second = createRewardProgress(storage, locks);
  assert.deepEqual(await Promise.all([first.openPack('growth'), second.openPack('growth')]), ['done', 'pending']);
  assert.equal(first.inventory().boosters.growth, 0);
  const { essence } = first.inventory();
  storage.setItem = () => { throw new Error('quota'); };
  const target = NEUTRAL_CARDS.find(({ rarity, id }) => rarity === 'bronze' && first.inventory().owned[id] < 2);
  assert.equal(await first.craft(target.id), 'unavailable');
  assert.equal(first.inventory().essence, essence);
  assert.equal(first.inventory().owned[target.id], second.inventory().owned[target.id]);
});

test('dismantling pays per copy, persists starter losses and supports crafting them back', async () => {
  const storage = localStorage();
  const wallet = createRewardProgress(storage);
  const base = wallet.inventory();
  const gold = 'annihilation';
  const bronze = 'rot-midge';
  assert.equal(base.owned[gold], 1);
  assert.equal(base.owned[bronze], 2);

  assert.equal(await wallet.dismantle('missing-id'), 'unknown');
  assert.equal(await wallet.dismantle(gold), 'done');
  assert.equal(await wallet.dismantle(gold), 'empty');
  assert.equal(await wallet.dismantle(bronze), 'done');
  const reloaded = createRewardProgress(storage, undefined, { legacyDecks: [{ cardIds: [gold, bronze, bronze] }] });
  assert.deepEqual([reloaded.inventory().owned[gold], reloaded.inventory().owned[bronze], reloaded.inventory().essence],
    [0, 1, base.essence + 220]);
  assert.equal(await reloaded.craft(gold), 'done');
  assert.equal(await reloaded.craft(bronze), 'done');
  assert.deepEqual([wallet.inventory().owned[gold], wallet.inventory().owned[bronze], wallet.inventory().essence],
    [1, 2, base.essence + 220 - 900]);
});

test('an extra booster copy can be dismantled and a failed save mutates neither cards nor essence', async () => {
  const storage = localStorage();
  const wallet = createRewardProgress(storage, undefined, { random: () => 0 });
  const first = NEUTRAL_CARDS[0].id;
  const base = wallet.inventory().owned[first];
  await wallet.unlock('neutral:signal');
  await wallet.unlock('neutral:supply');
  assert.equal(await wallet.openPack('neutral'), 'done');
  assert.equal(wallet.inventory().owned[first], base + 1);

  const beforeTrade = wallet.inventory();
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(await wallet.dismantle(first), 'unavailable');
  assert.deepEqual(wallet.inventory(), beforeTrade);
});

test('legacy rare rewards and balances survive the expanded book', async () => {
  const storage = localStorage();
  const oldRoute = ['signal', 'supply', 'junction', 'upper-cache', 'upper-relay', 'upper-vault', 'upper-finish']
    .map((stop) => 'protectorate:' + stop);
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: oldRoute }));
  const wallet = createRewardProgress(storage);
  assert.deepEqual(wallet.get(), { keys: 5, unlocked: new Set(oldRoute) });
  assert.equal(wallet.inventory().gold, 365);
  assert.equal(wallet.inventory().boosters.protectorate, 2);
  assert.equal(rewardState(chapters[0].nodes[15], wallet.get()), 'available');
  assert.equal(await wallet.unlock('protectorate:upper-conduit'), 'opened');
  assert.ok(wallet.get().unlocked.has('protectorate:upper-finish'));
  assert.equal(wallet.inventory().essence, 855);
  assert.equal(await createRewardProgress(storage).unlock('protectorate:upper-finish'), 'unlocked');
});

test('booster rewards in two chapters share the same faction inventory', async () => {
  const storage = localStorage();
  const wallet = createRewardProgress(storage, undefined, { random: () => 0 });
  for (const id of ['neutral:signal', 'neutral:supply', 'debris-belt:signal', 'debris-belt:supply']) {
    assert.equal(await wallet.unlock(id), 'opened');
  }
  assert.equal(wallet.inventory().boosters.neutral, 2);
  assert.equal(await wallet.openPack('neutral'), 'done');
  const copy = createRewardProgress(storage);
  assert.deepEqual(copy.inventory().boosters, { neutral: 1, protectorate: 0, growth: 0 });
  assert.equal(copy.inventory().pendingPack.faction, 'neutral');
});

test('all three rarities have their own names, essence prices and copy limits', () => {
  assert.deepEqual(Object.entries(RARITY_LABELS).map(([rarity, label]) =>
    [label, craftPrice({ rarity }), dismantleValue({ rarity }), copyLimit({ rarity })]), [
    ['Обычная', 100, 20, 2],
    ['Эпическая', 400, 100, 1],
    ['Легендарная', 800, 200, 1],
  ]);
});
