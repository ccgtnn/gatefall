import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardProgress, REWARD_PAGES, REWARD_STORAGE_KEY, rewardState } from '../docs/game/rewards.js';

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
