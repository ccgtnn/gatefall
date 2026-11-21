import assert from 'node:assert/strict';
import test from 'node:test';
import { craftPrice, createRewardProgress, REWARD_PAGES, REWARD_STORAGE_KEY, rewardState } from '../docs/game/rewards.js';
import { NEUTRAL_CARDS } from '../docs/game/cards.js';

function localStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('a new book has 25 keys, three pages and two rare ends on each page', () => {
  const storage = localStorage();
  assert.equal(createRewardProgress(storage).get().keys, 25);
  assert.deepEqual(REWARD_PAGES.map(({ id }) => id), ['protectorate', 'growth', 'neutral']);
  for (const { nodes } of REWARD_PAGES) {
    const terminals = nodes.filter(({ id }) => !nodes.some(({ parent }) => parent === id));
    assert.deepEqual(terminals.map(({ kind }) => kind), ['card-back', 'battlefield']);
  }
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
  assert.equal(rewardState(REWARD_PAGES[0].nodes[2], reloaded.get()), 'available');
});

test('25 keys can reach a rare reward, then spending stops exactly at zero', async () => {
  const wallet = createRewardProgress(localStorage());
  const { nodes } = REWARD_PAGES[0];
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
