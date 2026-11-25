import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOSTER_FACTIONS, craftPrice, dismantleValue, createRewardProgress, drawBoosterCards, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';
import { REWARD_SECTIONS, rewardState } from '../docs/game/reward-book.js';
import { copyLimit } from '../docs/game/decks.js';
import { FACTIONS, NEUTRAL_CARDS, RARITY_LABELS } from '../docs/game/cards.js';

function localStorage(snapshot) {
  const values = new Map(snapshot ? [[REWARD_STORAGE_KEY, JSON.stringify(snapshot)]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const chapters = REWARD_SECTIONS.flatMap((section) => section.chapters);

test('the book has two sections, five chapters and reachable rare rewards', () => {
  const storage = localStorage();
  assert.equal(createRewardProgress(storage).get().keys, 0);
  assert.deepEqual(REWARD_SECTIONS.map(({ chapters }) => chapters.length), [3, 2]);
  assert.deepEqual(BOOSTER_FACTIONS.map(({ id }) => id), ['protectorate', 'growth', 'neutral']);
  assert.equal(new Set(chapters.flatMap(({ nodes }) => nodes.map(({ id }) => id))).size, 120);
  const layouts = new Set();
  assert.deepEqual(chapters.map(({ nodes }) => nodes.length), [21, 21, 21, 29, 28]);
  for (const { nodes, tall } of chapters) {
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
    assert.ok(terminals.every(({ id, kind }) => ['card-back', 'battlefield'].includes(kind) && (tall || costs.get(id) <= 25)));
  }
  assert.equal(layouts.size, chapters.length);
  assert.deepEqual(chapters.map(({ nodes }) => nodes.filter(({ finale }) => finale).length), [2, 1, 2, 1, 2]);
});

test('every frontier route is eighteen stops long and a funded wallet can reach each finale', async () => {
  for (const { nodes } of REWARD_SECTIONS[1].chapters) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    function routes(node) {
      if (!node.parents.length) return [[node]];
      return node.parents.flatMap((id) => routes(byId.get(id)).map((prefix) => [...prefix, node]));
    }
    for (const finale of nodes.filter(({ finale }) => finale)) {
      for (const route of routes(finale)) {
        assert.equal(route.length, 18);
        const storage = localStorage({ startingKeys: 120 });
        const wallet = createRewardProgress(storage);
        let keys = wallet.get().keys;
        for (const node of route) {
          assert.equal(await wallet.unlock(node.id), 'opened', node.id);
          keys += (node.keyReward ?? 0) - node.cost;
          assert.equal(wallet.get().keys, keys);
        }
        const reloaded = createRewardProgress(storage);
        assert.equal(await reloaded.unlock(finale.id), 'unlocked');
        assert.deepEqual(reloaded.get(), { keys, unlocked: new Set(route.map(({ id }) => id)) });
      }
    }
  }
});

test('previous frontier saves retain purchases and balances through changed links', async () => {
  const cases = [
    ['debris-belt', ['signal', 'supply', 'junction', 'upper-cache', 'upper-relay', 'upper-vault', 'upper-finish', 'upper-watch'], 3, 'drift-cache', 8],
    ['border-station', ['signal', 'lower-cache', 'lower-relay', 'lower-vault', 'lower-finish', 'upper-conduit'], 8, 'recon-cache', 8],
  ];
  for (const [chapter, stops, keys, bonus, keyReward] of cases) {
    const storage = localStorage();
    const ids = stops.map((stop) => chapter + ':' + stop);
    storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: ids }));
    const wallet = createRewardProgress(storage);
    assert.deepEqual(wallet.get(), { keys, unlocked: new Set(ids) });
    assert.equal(await wallet.unlock(chapter + ':' + bonus), 'opened');
    const reloaded = createRewardProgress(storage);
    assert.deepEqual(reloaded.get(), { keys: keys - 1 + keyReward, unlocked: new Set([...ids, chapter + ':' + bonus]) });
  }
});

test('spending needs an unlocked parent and persists across pages and reloads', async () => {
  const storage = localStorage({ startingKeys: 25 });
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

test('a legacy wallet with 25 keys can reach a rare reward, then spending stops at zero', async () => {
  const storage = localStorage();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: [] }));
  const wallet = createRewardProgress(storage);
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
  const storage = localStorage({ startingKeys: 25 });
  storage.setItem = () => { throw new Error('storage is full'); };
  const wallet = createRewardProgress(storage);
  assert.equal(await wallet.unlock('growth:signal'), 'unavailable');
  assert.deepEqual(wallet.get(), { keys: 25, unlocked: new Set() });
});

test('wallet instances share a lock and both openings survive concurrent writes', async () => {
  const storage = localStorage({ startingKeys: 25 });
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

test('a fresh wallet starts at zero, keeps earned gold and saves zero starting balances', async () => {
  const storage = localStorage();
  const wallet = createRewardProgress(storage);
  assert.equal(wallet.inventory().gold, 0);
  assert.equal(await wallet.buyPack('growth'), 'unaffordable');
  assert.equal(await wallet.rewardMatch('first-win', 'win', 'growth'), 'done');
  const { gold, keys, essence } = createRewardProgress(storage).inventory();
  assert.deepEqual({ gold, keys, essence }, { gold: 20, keys: 0, essence: 0 });
});

test('inventory snapshots stay isolated and see saves from another wallet before refresh', async () => {
  const storage = localStorage({ startingKeys: 25, startingGold: 300 });
  const first = createRewardProgress(storage, undefined, { random: () => 0 });
  const second = createRewardProgress(storage, undefined, { random: () => 0 });
  assert.equal(first.inventory().keys, 25);
  assert.equal(await second.unlock('neutral:signal'), 'opened');
  assert.equal(first.inventory().keys, 24);
  assert.equal(await second.buyPack('neutral'), 'done');
  assert.equal(await second.openPack('neutral'), 'done');

  const expected = second.inventory();
  const localView = first.inventory();
  assert.deepEqual(localView, expected);
  const [id] = localView.pendingPack.cards;
  localView.owned[id] = 100;
  localView.boosters.neutral = 100;
  localView.pendingPack.cards[0] = 'changed';
  localView.pendingPack.essenceByCard[id] = 100;
  assert.deepEqual(first.inventory(), expected);

  assert.equal(await first.revealPack(expected.pendingPack.id, id), 'done');
  assert.deepEqual(second.inventory().pendingPack.revealed, [id]);
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

test('weighted booster slots preserve rarity odds, distinct cards and the rare guarantee', () => {
  for (const pool of [NEUTRAL_CARDS, FACTIONS.protectorate.pool, FACTIONS.growth.pool]) {
    let seed = 35491;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const firstSlots = { bronze: 0, epic: 0, gold: 0 };
    const packs = 20000;
    for (let i = 0; i < packs; i++) {
      const cards = drawBoosterCards(pool, random);
      assert.equal(cards.length, 5);
      assert.equal(new Set(cards.map(({ id }) => id)).size, 5);
      assert.ok(cards.some(({ rarity }) => rarity !== 'bronze'));
      for (const { rarity } of cards.slice(0, 4)) firstSlots[rarity]++;
    }
    const odds = [0.75, 0.20, 0.05];
    Object.values(firstSlots).forEach((total, index) => {
      assert.ok(Math.abs(total / (packs * 4) - odds[index]) < 0.012);
    });
  }
});

test('last slot upgrades an all-common draw, and exhausted rarities fall back to available cards', () => {
  const commons = NEUTRAL_CARDS.filter(({ rarity }) => rarity === 'bronze');
  const epic = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'epic');
  const gold = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'gold');
  assert.deepEqual(drawBoosterCards([...commons, epic, gold], () => 0), [...commons.slice(0, 4), epic]);
  assert.deepEqual(drawBoosterCards([...commons, gold], () => 0), [...commons.slice(0, 4), gold]);
  const odds = [0.8, 0, 0.8, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(drawBoosterCards([...commons, epic], () => odds.shift()), [epic, ...commons.slice(0, 4)]);
});

test('opening consumes one booster and grants five distinct faction cards before the reveal', async () => {
  const storage = localStorage({ startingKeys: 10 });
  const wallet = createRewardProgress(storage, undefined, { random: () => 0 });
  const before = wallet.inventory();
  assert.equal(await wallet.openPack('growth'), 'empty');
  await wallet.unlock('neutral:signal');
  await wallet.unlock('neutral:supply');
  assert.equal(await wallet.openPack('neutral'), 'done');
  const reloaded = createRewardProgress(storage);
  const { pendingPack, boosters, owned } = reloaded.inventory();
  assert.equal(pendingPack.faction, 'neutral');
  const expected = drawBoosterCards(NEUTRAL_CARDS, () => 0);
  assert.deepEqual(pendingPack.cards, expected.map(({ id }) => id));
  for (const card of expected) {
    const extra = before.owned[card.id] >= copyLimit(card);
    assert.equal(owned[card.id], before.owned[card.id] + Number(!extra));
    assert.equal(pendingPack.essenceByCard[card.id], extra ? dismantleValue(card) : 0);
  }
  assert.equal(boosters.neutral, 0);
  assert.equal(await reloaded.openPack('neutral'), 'pending');
  assert.equal(await reloaded.finishPack(pendingPack.id), 'done');
  assert.equal(createRewardProgress(storage).inventory().pendingPack, null);
  assert.equal(await wallet.finishPack(pendingPack.id), 'unknown');
});

test('all cards unlock at their copy limits and can be crafted again after dismantling', async () => {
  const storage = localStorage();
  const gold = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'gold');
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ startingEssence: 600 }));
  const wallet = createRewardProgress(storage);
  for (const card of [...NEUTRAL_CARDS, ...Object.values(FACTIONS).flatMap(({ pool }) => pool)]) {
    assert.equal(wallet.inventory().owned[card.id], copyLimit(card));
  }
  assert.equal(await wallet.craft(gold.id), 'owned');
  assert.equal(await wallet.dismantle(gold.id), 'done');
  const reloaded = createRewardProgress(storage);
  assert.equal(reloaded.inventory().owned[gold.id], 0);
  assert.equal(await reloaded.craft(gold.id), 'done');
  assert.equal(reloaded.inventory().essence, 0);
  assert.equal(reloaded.inventory().owned[gold.id], 1);
});

test('concurrent pack opening charges once, and a failed craft leaves essence untouched', async () => {
  const storage = localStorage();
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: ['growth:signal', 'growth:supply'] }));
  const locks = { request: async (_name, commit) => commit() };
  const first = createRewardProgress(storage, locks);
  const second = createRewardProgress(storage, locks);
  assert.deepEqual(await Promise.all([first.openPack('growth'), second.openPack('growth')]), ['done', 'pending']);
  assert.equal(first.inventory().boosters.growth, 0);
  const target = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'bronze');
  assert.equal(await first.dismantle(target.id), 'done');
  const { essence } = first.inventory();
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(await first.craft(target.id), 'unavailable');
  assert.equal(first.inventory().essence, essence);
  assert.equal(first.inventory().owned[target.id], second.inventory().owned[target.id]);
});

test('dismantling pays per copy, persists starter losses and supports crafting them back', async () => {
  const storage = localStorage({ startingEssence: 680 });
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

test('extra copies pay on reveal and close exactly once across reloads', async () => {
  const storage = localStorage({ startingKeys: 10 });
  const common = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'bronze');
  const epic = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'epic');
  const gold = NEUTRAL_CARDS.find(({ rarity }) => rarity === 'gold');
  const odds = [0, 0, 0.8, 0, 0.99, 0, 0, 0, 0, 0];
  const wallet = createRewardProgress(storage, undefined, {
    legacyDecks: [{ cardIds: [common.id, common.id, epic.id, gold.id] }],
    random: () => odds.shift(),
  });
  await wallet.unlock('neutral:signal');
  await wallet.unlock('neutral:supply');
  const before = wallet.inventory();
  assert.equal(await wallet.openPack('neutral'), 'done');
  const reloaded = createRewardProgress(storage);
  const after = reloaded.inventory();
  for (const [card, essence] of [[common, 20], [epic, 100], [gold, 200]]) {
    assert.equal(after.owned[card.id], before.owned[card.id]);
    assert.equal(after.pendingPack.essenceByCard[card.id], essence);
  }
  const paid = Object.values(after.pendingPack.essenceByCard).reduce((sum, value) => sum + value, 0);
  assert.equal(after.essence, before.essence);
  const id = after.pendingPack.id;
  assert.equal(await reloaded.openPack('neutral'), 'pending');
  assert.equal(await reloaded.revealPack(id, 'unknown-card'), 'unknown');
  assert.equal(await reloaded.revealPack(id, common.id), 'done');
  const resumed = createRewardProgress(storage);
  assert.deepEqual(resumed.inventory().pendingPack.revealed, [common.id]);
  assert.equal(resumed.inventory().essence, before.essence + 20);
  assert.equal(await resumed.revealPack(id, common.id), 'revealed');
  assert.equal(await resumed.finishPack(id), 'done');
  assert.equal(await reloaded.revealPack(id, epic.id), 'unknown');
  const finished = createRewardProgress(storage).inventory();
  assert.deepEqual(finished, { ...after, essence: before.essence + paid, pendingPack: null });
});

test('failed pack writes leave boosters, cards and auto-dismantle essence intact', async () => {
  const storage = localStorage({ startingKeys: 10 });
  const wallet = createRewardProgress(storage, undefined, { random: () => 0.99 });
  await wallet.unlock('neutral:signal');
  await wallet.unlock('neutral:supply');
  const before = wallet.inventory();
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(await wallet.openPack('neutral'), 'unavailable');
  assert.deepEqual(wallet.inventory(), before);
});

test('a pre-update pending pack keeps already granted cards and can finish without paying essence again', async () => {
  const storage = localStorage();
  const cards = NEUTRAL_CARDS.slice(0, 5).map(({ id }) => id);
  storage.setItem(REWARD_STORAGE_KEY, JSON.stringify({
    opened: { neutral: 1 },
    earnedCards: Object.fromEntries(cards.map((id) => [id, 1])),
    dismantlingEssence: 20,
    pendingPack: { id: 1, faction: 'neutral', cards, essenceByCard: { [cards[0]]: 20 } },
  }));
  const wallet = createRewardProgress(storage);
  const before = wallet.inventory();
  assert.deepEqual(before.pendingPack.cards, cards);
  assert.equal(before.pendingPack.essenceByCard[cards[0]], 20);
  assert.equal(await wallet.revealPack(1), 'done');
  assert.equal(wallet.inventory().essence, before.essence);
  assert.equal(await wallet.finishPack(1), 'done');
  assert.deepEqual(wallet.inventory(), { ...before, pendingPack: null });
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
  const storage = localStorage({ startingKeys: 10 });
  const wallet = createRewardProgress(storage, undefined, { random: () => 0 });
  for (const id of ['neutral:signal', 'neutral:supply', 'debris-belt:signal', 'debris-belt:drift-cache', 'debris-belt:supply']) {
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
