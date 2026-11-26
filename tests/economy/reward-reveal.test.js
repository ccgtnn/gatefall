import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../../docs/game/rewards.js';
import { createRewardQueue, createRewardReveal, enqueueReward } from '../../docs/ui/reward-reveal.js';

function entry(source, reward) {
  return { source, title: source, reward };
}

function localStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('reward reveals keep their arrival order and track their position in the batch', () => {
  const queue = createRewardQueue();
  for (const source of ['Матч', 'Ранги', 'Таверна']) queue.enqueueReward(entry(source, { gold: 20 }));
  assert.equal(queue.total(), 3);
  for (const [index, source] of ['Матч', 'Ранги', 'Таверна'].entries()) {
    assert.equal(queue.position(), index + 1);
    assert.equal(queue.current().source, source);
    queue.collect();
  }
  assert.equal(queue.remaining(), 0);
  assert.equal(queue.current(), undefined);
});

test('collecting all clears the queue and resets the next batch', () => {
  const queue = createRewardQueue(() => 0);
  queue.enqueueReward(entry('Матч', { gold: 20 }));
  queue.enqueueReward(entry('Ранги', { keys: 2 }));
  queue.enqueueReward(entry('База', { steel: 50 }));
  queue.collectAll();
  assert.equal(queue.remaining(), 0);
  queue.enqueueReward(entry('База', { steel: 2 }));
  assert.equal(queue.position(), 1);
  assert.equal(queue.total(), 1);
  assert.deepEqual(queue.current().reward, { steel: 2 });
});

test('consecutive rewards merge while visible or within 1.5 seconds, without crossing another source', () => {
  let time = 0;
  const queue = createRewardQueue(() => time);
  queue.enqueueReward(entry('База', { gold: 10, steel: 5 }));
  time += 1499;
  queue.enqueueReward(entry('База', { gold: 6, energyCells: 3 }));
  assert.equal(queue.remaining(), 1);
  assert.deepEqual(queue.current().reward, { gold: 16, steel: 5, energyCells: 3 });

  time += 1600;
  queue.enqueueReward(entry('База', { gold: 1 }), true);
  assert.deepEqual(queue.current().reward, { gold: 17, steel: 5, energyCells: 3 });
  queue.enqueueReward(entry('Таверна', { keys: 1 }), true);
  queue.enqueueReward(entry('База', { gold: 10 }), true);
  assert.equal(queue.remaining(), 3);
  queue.collect();
  queue.collect();
  assert.deepEqual(queue.current().reward, { gold: 10 });

  time += 1501;
  queue.enqueueReward(entry('База', { gold: 3 }));
  assert.equal(queue.remaining(), 2);
});

test('a new reward from the same source excludes an already collected reward', () => {
  let time = 0;
  const queue = createRewardQueue(() => time);
  queue.enqueueReward({ title: 'Шахта', source: 'Сбор с базы', reward: { gold: 120 } });
  assert.deepEqual(queue.current().reward, { gold: 120 });
  queue.collect();
  assert.equal(queue.remaining(), 0);

  time += 500;
  queue.enqueueReward({ title: 'Энергостанция', source: 'Сбор с базы', reward: { gold: 80 } });
  assert.equal(queue.remaining(), 1);
  assert.deepEqual(queue.current().reward, { gold: 80 });
  assert.equal(queue.current().title, 'Энергостанция');
});

test('credits are committed before presentation and loading or retrying never credits them twice', async () => {
  const storage = localStorage();
  const reports = [];
  const enqueueReward = (reward) => {
    const saved = JSON.parse(storage.getItem(REWARD_STORAGE_KEY));
    assert.ok(saved.rewardedMatches.includes('same-result'));
    reports.push(reward);
  };
  const progress = createRewardProgress(storage, undefined, { enqueueReward });
  const original = progress.inventory();
  assert.equal(await progress.rewardMatch('same-result', 'win', 'protectorate', 2), 'done');
  assert.deepEqual(reports.map(({ source }) => source), ['Итоги матча', 'Месячные ранги']);
  const saved = progress.inventory();
  assert.equal(saved.gold, original.gold + reports[0].reward.gold);
  assert.equal(saved.keys, original.keys + reports[1].reward.keys);

  const reloaded = createRewardProgress(storage, undefined, { enqueueReward });
  assert.deepEqual(reloaded.inventory(), saved);
  assert.equal(await reloaded.rewardMatch('same-result', 'win', 'protectorate', 2), 'claimed');
  assert.equal(reports.length, 2);
  assert.deepEqual(reloaded.inventory(), saved);
});

test('a failed save publishes no rewards', async () => {
  const reports = [];
  const storage = { getItem: () => null, setItem: () => { throw new Error('disk full'); } };
  const progress = createRewardProgress(storage, undefined, { enqueueReward: (reward) => reports.push(reward) });
  assert.equal(await progress.rewardMatch('unsaved', 'win', 'protectorate', 2), 'unavailable');
  assert.deepEqual(reports, []);
});

test('the reward dialog waits for the results gate and lets the player collect all', async (t) => {
  const previousDocument = globalThis.document;
  t.after(() => { globalThis.document = previousDocument; });
  let focus;
  class Node extends EventTarget {
    children = [];
    dataset = {};
    open = false;
    classList = { remove() {} };
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { focus = this; }
  }
  const body = new Node();
  globalThis.document = { body, createElement: () => new Node(), createElementNS: () => new Node() };

  let resultsDismissed = false;
  const essenceGains = [];
  const reveal = createRewardReveal({
    motion: () => 0, canShow: () => resultsDismissed, showEssence: (amount) => essenceGains.push(amount),
  });
  const [dialog] = body.children;
  const [header, items, actions] = dialog.children;
  const [, title, counter] = header.children;
  const [receive, all] = actions.children;
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  enqueueReward(entry('Победа', { gold: 20 }));
  enqueueReward(entry('Ранги', { keys: 2 }));
  enqueueReward(entry('Лига', { gateShards: 1 }));
  enqueueReward(entry('Таверна', { steel: 40 }));
  await nextTick();
  assert.equal(dialog.open, false);

  resultsDismissed = true;
  reveal.refresh();
  await nextTick();
  assert.equal(dialog.open, true);
  assert.equal(focus, receive);
  assert.equal(title.textContent, 'Победа');
  assert.equal(counter.textContent, '1 из 4');
  assert.equal(items.children[0].children[1].textContent, '+20');

  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  assert.equal(dialog.open, true);
  assert.equal(title.textContent, 'Ранги');
  assert.equal(counter.textContent, '2 из 4');
  assert.equal(all.hidden, false);
  const idle = reveal.whenIdle();
  all.dispatchEvent(new Event('click'));
  await idle;
  assert.equal(dialog.open, false);
  assert.equal(reveal.hasPending(), false);

  enqueueReward(entry('Распыление', { essence: 20 }));
  await nextTick();
  assert.deepEqual(essenceGains, [20]);
  assert.equal(dialog.open, false);
  assert.equal(reveal.hasPending(), false);

  enqueueReward(entry('Книга наград', { essence: 50, keys: 2 }));
  await nextTick();
  assert.deepEqual(essenceGains, [20]);
  assert.equal(dialog.open, true);
  assert.deepEqual(items.children.map(({ dataset }) => dataset.resource), ['keys']);
  receive.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.deepEqual(essenceGains, [20, 50]);
});
