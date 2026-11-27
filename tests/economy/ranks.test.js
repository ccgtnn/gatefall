import assert from 'node:assert/strict';
import test from 'node:test';
import { MONTHLY_RANKS, rankRewards, rankStanding, wonRounds } from '../../docs/game/meta/ranks.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../../docs/game/meta/rewards.js';
import { resetProgress } from '../../docs/game/meta/reset-progress.js';
import { leagueTicket } from '../../docs/game/meta/league.js';
import { PRESETS } from '../../docs/game/cards/decks.js';

const december = Date.UTC(2026, 11, 1, 12);
const november = Date.UTC(2026, 10, 30, 12);
const decemberReset = new Date(december);
decemberReset.setHours(0, 0, 0, 0);

function setup() {
  let saved = null;
  let time = november;
  let fail = false;
  const storage = {
    get length() { return saved === null ? 0 : 1; },
    key: () => REWARD_STORAGE_KEY,
    getItem: () => saved,
    setItem: (_key, value) => {
      if (fail) throw Error('storage full');
      saved = value;
    },
    removeItem: () => { saved = null; },
  };
  const reopen = () => createRewardProgress(storage, null, { now: () => time, random: () => .5 });
  return { wallet: reopen(), reopen, storage, setTime: (value) => { time = value; }, failWrites: (value) => { fail = value; } };
}

test('all 26 ranks follow the approved thresholds and reward totals', () => {
  assert.equal(MONTHLY_RANKS.length, 26);
  assert.deepEqual([10, 15, 20, 25].map((rank) => MONTHLY_RANKS[rank].rounds), [10, 25, 55, 105]);
  assert.deepEqual(MONTHLY_RANKS.filter((rank) => rank.keys === 5).map(({ rank }) => rank), [5, 10, 15, 20, 25]);
  assert.equal(MONTHLY_RANKS[1].steel, 2);
  assert.equal(MONTHLY_RANKS[9].energyCells, 0);
  assert.equal(MONTHLY_RANKS[10].energyCells, 2);
  assert.deepEqual(MONTHLY_RANKS[25], { rank: 25, rounds: 105, keys: 5, steel: 100, energyCells: 50, gateShards: 5 });
  assert.deepEqual(rankRewards(0, 105), { keys: 61, steel: 975, energyCells: 348, gateShards: 11 });
  assert.equal(rankStanding(104).rank, 24);
  assert.equal(rankStanding(200).rank, 25);
  assert.deepEqual(rankRewards(105, 110), { keys: 0, steel: 0, energyCells: 0, gateShards: 0 });
});

test('a round counts only when won by the player, including in a lost match', async () => {
  const { wallet, reopen } = setup();
  const log = [
    { type: 'round-end', winner: 'human' }, { type: 'round-end', winner: null },
    { type: 'round-end', winner: 'bot' }, { type: 'play', winner: 'human' },
  ];
  const initial = wallet.inventory();
  const base = wallet.base().materials;
  assert.equal(await wallet.rewardMatch('lost', 'loss', 'growth', wonRounds(log)), 'done');
  assert.equal(await reopen().rewardMatch('lost', 'loss', 'growth', 1), 'claimed');
  assert.equal(wallet.ranks().rounds, 1);
  assert.equal(wallet.inventory().keys, initial.keys + 1);
  assert.equal(wallet.inventory().gold, initial.gold);
  assert.equal(wallet.inventory().packCount, initial.packCount);
  assert.equal(wallet.base().materials.steel, base.steel + 2);
});

test('one game can grant multiple ranks, with a failed save granting nothing until retry', async () => {
  const { wallet, reopen, failWrites } = setup();
  for (let index = 0; index < 4; index += 1) await wallet.rewardMatch('lost-' + index, 'loss', 'growth', 1);
  const before = wallet.inventory();
  const steel = wallet.base().materials.steel;
  failWrites(true);
  assert.equal(await wallet.rewardMatch('won', 'win', 'growth', 2), 'unavailable');
  assert.equal(reopen().ranks().rounds, 4);
  assert.equal(reopen().inventory().keys, before.keys);
  failWrites(false);
  assert.equal(await reopen().rewardMatch('won', 'win', 'growth', 2), 'done');
  assert.equal(wallet.ranks().rounds, 6);
  assert.equal(wallet.inventory().keys, before.keys + 6);
  assert.equal(wallet.base().materials.steel, steel + 22);
});

test('finished league games share rank progress and forfeits do not add rounds', async () => {
  const { wallet } = setup();
  await wallet.checkpointLeague();
  await wallet.beginLeagueMatch(leagueTicket(wallet.league()), 'league-forfeit', PRESETS[0]);
  assert.equal(await wallet.settleLeagueMatch('league-forfeit', 'loss', -2), 'done');
  assert.equal(wallet.ranks().rounds, 0);
  await wallet.beginLeagueMatch(leagueTicket(wallet.league()), 'league-finished', PRESETS[0]);
  assert.equal(await wallet.settleLeagueMatch('league-finished', 'loss', -1, 'growth', 1), 'done');
  assert.equal(await wallet.settleLeagueMatch('league-finished', 'loss', -1, 'growth', 1), 'stale');
  assert.equal(wallet.ranks().rounds, 1);
});

test('a local month reset keeps rewards and cannot be repeated by reversing the clock', async () => {
  const { wallet, reopen, setTime, storage } = setup();
  assert.equal(await wallet.rewardMatch('last-month', 'loss', 'growth', 1), 'done');
  const oldKeys = wallet.inventory().keys;
  const oldSteel = wallet.base().materials.steel;
  assert.equal(wallet.ranks().resetAt, decemberReset.getTime());
  setTime(december);
  assert.equal(await reopen().checkpointRanks(), 'done');
  assert.equal(wallet.ranks().rounds, 0);
  assert.equal(wallet.inventory().keys, oldKeys);
  assert.equal(wallet.base().materials.steel, oldSteel);
  assert.equal(await wallet.rewardMatch('last-month', 'loss', 'growth', 1), 'claimed');
  await wallet.rewardMatch('new-month', 'loss', 'growth', 1);
  setTime(november);
  assert.equal(await reopen().checkpointRanks(), 'current');
  assert.equal(reopen().ranks().rounds, 1);
  setTime(december);
  assert.equal(await reopen().checkpointRanks(), 'current');
  assert.equal(reopen().ranks().rounds, 1);
  await resetProgress(storage);
  assert.equal(reopen().ranks().rounds, 0);
});
