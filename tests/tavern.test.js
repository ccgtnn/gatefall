import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardProgress, REWARD_STORAGE_KEY } from '../docs/game/rewards.js';
import { resetProgress } from '../docs/game/reset-progress.js';
import { FACTIONS, LARVA, NEUTRAL_CARDS } from '../docs/game/cards.js';
import { announcePlay, applyStatus, createCard, damage, spawnCards, tickInfection } from '../docs/game/board.js';
import { createMatch } from '../docs/game/match.js';
import { leagueTicket } from '../docs/game/league.js';
import { PRESETS } from '../docs/game/decks.js';
import { TAVERN_QUESTS, tavernEventAmounts } from '../docs/game/tavern.js';

const midnight = new Date(2026, 10, 24).getTime();
const previousDay = midnight - 2 * 3_600_000;

function setup(quest = 'wins', snapshot = {
  startingGold: 3000, base: { materials: { steel: 2000, energyCells: 800, gateShards: 7 } },
}) {
  let saved = JSON.stringify(snapshot);
  let time = previousDay;
  let roll = (TAVERN_QUESTS.findIndex(({ id }) => id === quest) + .1) / TAVERN_QUESTS.length;
  const storage = {
    get length() { return saved ? 1 : 0; },
    key: () => REWARD_STORAGE_KEY,
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; },
    removeItem: () => { saved = null; },
  };
  const reopen = () => createRewardProgress(storage, null, { now: () => time, random: () => roll });
  return { wallet: reopen(), reopen, storage, setTime: (next) => { time = next; }, setRoll: (next) => { roll = next; } };
}

test('Tavern construction and each upgrade fill one new slot while retaining existing quests', async () => {
  const { wallet, reopen } = setup();
  await wallet.checkpointTavern();
  assert.equal(wallet.tavern(), null);
  assert.equal(await wallet.build('5', 'tavern'), 'done');
  const first = wallet.tavern().slots[0];
  assert.equal(first.id, 'wins');
  assert.equal(wallet.tavern().resetAt, midnight);
  for (let level = 1; level <= 5; level += 1) {
    const { slots } = reopen().tavern();
    assert.equal(slots.length, level);
    assert.equal(new Set(slots.map(({ id }) => id)).size, level);
    assert.deepEqual(slots[0], first);
    if (level < 5) assert.equal(await wallet.upgrade('tavern', level), 'done');
  }
});

test('real match journal distinguishes human plays, damage, enemy marks and larvae', () => {
  const game = createMatch();
  const first = createCard('p1', FACTIONS.protectorate.pool.find(({ id }) => id === 'infantry'));
  const growth = createCard('p2', FACTIONS.growth.pool[0]);
  const neutral = createCard('p3', NEUTRAL_CARDS[0]);
  const enemy = { side: 'bot', row: 'surface', card: createCard('b1', { ...first.definition, power: 10, armor: 1 }) };
  const friend = { side: 'human', row: 'surface', card: createCard('p4', first.definition) };
  game.players.bot.board.surface.push(enemy.card);
  game.players.human.board.surface.push(friend.card);
  for (const card of [first, growth, neutral]) announcePlay(game, 'human', card);
  announcePlay(game, 'bot', first);
  damage(game, enemy, 3, first.definition.id, { attacker: 'human' });
  damage(game, friend, 1, first.definition.id, { attacker: 'bot' });
  applyStatus(game, enemy, 'target', 1, { attacker: 'human' });
  applyStatus(game, enemy, 'target', 1, { attacker: 'human' });
  applyStatus(game, friend, 'target', 1, { attacker: 'bot' });
  applyStatus(game, enemy, 'infection', 1, { attacker: 'human', sourceDefinitionId: growth.definition.id });
  tickInfection(game, enemy);
  spawnCards(game, 'human', 'orbit', 0, 3, LARVA);
  spawnCards(game, 'bot', 'orbit', 0, 3, LARVA);
  assert.deepEqual(tavernEventAmounts(game.log), {
    'cards-protectorate': 1, 'cards-growth': 1, 'cards-neutral': 1, damage: 4, targets: 1, larvae: 3,
  });
});

test('event progress is saved immediately and an overlapping journal batch counts only new events', async () => {
  const { wallet, reopen } = setup('damage');
  await wallet.build('5', 'tavern');
  const hit = { type: 'damage', side: 'bot', attacker: 'human', lost: 5, absorbed: 1 };
  await wallet.recordTavernEvents('match-1', 10, [hit, hit]);
  assert.equal(reopen().tavern().slots[0].progress, 12);
  await reopen().recordTavernEvents('match-1', 11, [hit, hit]);
  await wallet.recordTavernEvents('match-1', 11, [hit, hit]);
  assert.equal(wallet.tavern().slots[0].progress, 18);
});

test('match wins advance once and a hard reward credits keys, gold and steel atomically', async () => {
  const { wallet, reopen } = setup();
  await wallet.build('5', 'tavern');
  const { key } = wallet.tavern().slots[0];
  assert.equal(await wallet.claimTavernQuest(key), 'stale');
  await wallet.rewardMatch('lost', 'loss', 'growth');
  await wallet.rewardMatch('won-1', 'win', 'growth');
  assert.equal(await reopen().rewardMatch('won-1', 'win', 'growth'), 'claimed');
  assert.equal(wallet.tavern().slots[0].progress, 1);
  await wallet.rewardMatch('won-2', 'win', 'protectorate');
  const before = wallet.inventory();
  const steel = wallet.base().materials.steel;
  assert.equal(await reopen().claimTavernQuest(key), 'done');
  assert.equal(await wallet.claimTavernQuest(key), 'stale');
  assert.equal(wallet.inventory().keys, before.keys + 3);
  assert.equal(wallet.inventory().gold, before.gold + 150);
  assert.equal(wallet.base().materials.steel, steel + 50);
  assert.equal(wallet.tavern().slots[0].claimed, true);
});

test('refresh expires incomplete quests at midnight but carries over completed unclaimed rewards', async () => {
  const { wallet, reopen, setTime, setRoll } = setup('booster');
  await wallet.build('5', 'tavern');
  await wallet.upgrade('tavern', 1);
  const before = wallet.tavern();
  await wallet.buyPack('neutral');
  await wallet.openPack('neutral');
  assert.equal(wallet.tavern().slots[0].progress, 1);
  setTime(midnight - 1);
  assert.equal(await reopen().checkpointTavern(), 'current');
  setTime(midnight);
  setRoll(0);
  assert.equal(await reopen().checkpointTavern(), 'done');
  const next = wallet.tavern();
  assert.equal(next.slots.length, 2);
  assert.deepEqual(next.slots.map(({ progress }) => progress), [0, 0]);
  assert.deepEqual(next.pending.map(({ key }) => key), [before.slots[0].key]);
  assert.equal(await wallet.claimTavernQuest(before.slots[1].key), 'stale');
  const balances = wallet.inventory();
  assert.equal(await wallet.claimTavernQuest(before.slots[0].key), 'done');
  assert.equal(wallet.inventory().keys, balances.keys + 2);
  assert.equal(wallet.inventory().gold, balances.gold + 100);
  assert.deepEqual(wallet.tavern().pending, []);
});

test('replacement is available once per local day and a clock rollback cannot restore it', async () => {
  const { wallet, reopen, setTime, storage } = setup();
  await wallet.build('5', 'tavern');
  await wallet.upgrade('tavern', 1);
  const original = wallet.tavern().slots;
  assert.equal(await wallet.changeTavernQuest(original[0].key), 'done');
  const replacement = wallet.tavern().slots[0];
  assert.ok(!original.some(({ id }) => id === replacement.id));
  assert.equal(await reopen().changeTavernQuest(original[1].key), 'stale');
  setTime(midnight);
  await wallet.checkpointTavern();
  const today = wallet.tavern().slots;
  assert.equal(await wallet.changeTavernQuest(today[0].key), 'done');
  const stable = wallet.tavern();
  setTime(previousDay);
  assert.equal(await reopen().checkpointTavern(), 'current');
  assert.equal(await reopen().changeTavernQuest(today[1].key), 'stale');
  setTime(midnight);
  assert.equal(await reopen().checkpointTavern(), 'current');
  assert.deepEqual(reopen().tavern(), stable);
  await resetProgress(storage);
  assert.equal(reopen().tavern(), null);
});

test('only actual collections and finished league matches advance their quests', async () => {
  const gathering = setup('collect');
  await gathering.wallet.build('5', 'tavern');
  await gathering.wallet.build('2', 'mine');
  assert.equal(await gathering.wallet.collect(), 'empty');
  assert.equal(gathering.wallet.tavern().slots[0].progress, 0);
  gathering.setTime(previousDay + 3_600_000);
  assert.equal(await gathering.wallet.collect(), 'done');
  assert.equal(gathering.wallet.tavern().slots[0].progress, 1);

  const { wallet } = setup('league');
  await wallet.build('5', 'tavern');
  await wallet.checkpointLeague();
  await wallet.rewardMatch('regular', 'win', 'growth');
  await wallet.beginLeagueMatch(leagueTicket(wallet.league()), 'abandoned', PRESETS[0]);
  await wallet.settleLeagueMatch('abandoned', 'loss', -2);
  assert.equal(wallet.tavern().slots[0].progress, 0);
  await wallet.beginLeagueMatch(leagueTicket(wallet.league()), 'played', PRESETS[0]);
  await wallet.settleLeagueMatch('played', 'draw', 0, 'protectorate');
  assert.equal(wallet.tavern().slots[0].progress, 1);
});
