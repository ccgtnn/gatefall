import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../docs/game/decks.js';
import {
  createLeague, DIAMOND, finishLeagueMatch, LEAGUES, leagueDivision, leagueOpponent,
  leagueSchedule, leagueStake, leagueTable, leagueTicket, leagueWeek,
  reserveLeagueMatch, resetLeagueWeek,
} from '../docs/game/league.js';
import { createDeckMatch } from '../docs/game/match.js';
import { createRewardProgress } from '../docs/game/rewards.js';
import { resetProgress } from '../docs/game/reset-progress.js';

const sunday = new Date(2026, 10, 22, 23, 59).getTime();
const monday = new Date(2026, 10, 23).getTime();
const fixed = () => .5;
const deck = PRESETS[0];

function play(league, result, difference, id = leagueTicket(league)) {
  assert.equal(reserveLeagueMatch(league, leagueTicket(league), id, 10000), 'done');
  return finishLeagueMatch(league, id, result, difference, fixed);
}

function storageStub() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index],
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('each league schedules all 28 unique pairings and all seven player opponents', () => {
  for (const [tier, { bots }] of LEAGUES.entries()) {
    const schedule = leagueSchedule(tier);
    assert.equal(bots.length, 7);
    assert.equal(schedule.length, 7);
    assert.equal(new Set(schedule.flat().map((pair) => [...pair].sort().join('/'))).size, 28);
    assert.equal(new Set(schedule.map((round) => round[0][1])).size, 7);
    for (const round of schedule) assert.equal(new Set(round.flat()).size, 8);
  }
});

test('a reserved match advances all four pairings once on settlement', () => {
  const league = createLeague(sunday);
  const opponent = leagueOpponent(league.season).id;
  assert.equal(reserveLeagueMatch(league, leagueTicket(league), 'match', 0), 'done');
  assert.equal(reserveLeagueMatch(league, leagueTicket(league), 'second-tab', 0), 'stale');
  assert.equal(league.season.round, 0);
  assert.equal(league.season.scores.human.points, 0);
  assert.equal(finishLeagueMatch(league, 'second-tab', 'win', 2, fixed), null);
  let rolls = 0;
  finishLeagueMatch(league, 'match', 'win', 2, () => { rolls += 1; return .5; });
  assert.equal(rolls, 24);
  assert.equal(league.season.round, 1);
  const { scores } = league.season;
  assert.equal(scores.human.points, 3);
  assert.equal(scores.human.difference, 2);
  assert.equal(scores[opponent].difference, -2);
  for (const row of Object.values(scores)) assert.equal(row.wins + row.losses + row.draws, 1);
  assert.equal(Object.values(scores).reduce((total, row) => total + row.difference, 0), 0);
  assert.equal(finishLeagueMatch(league, 'match', 'win', 2, fixed), null);
  assert.equal(league.season.round, 1);
});

test('standings sort by points, then wins, then round difference', () => {
  const row = (id, points, wins, difference) => ({ id, points, wins, difference });
  const scores = [
    row('a', 6, 0, 0), row('b', 7, 2, -1),
    row('c', 7, 2, 1), row('d', 7, 1, 4),
  ];
  assert.deepEqual(leagueTable({ scores }).map(({ id }) => id), ['c', 'b', 'd', 'a']);
  const league = createLeague(sunday);
  play(league, 'draw', 0);
  assert.equal(league.season.scores.human.points, 1);
});

test('promotion is decided on tour seven and diamond seasons repeat', () => {
  const league = createLeague(sunday);
  for (let tier = 0; tier <= DIAMOND; tier += 1) {
    for (let round = 0; round < 6; round += 1) play(league, 'win', 2);
    assert.equal(league.season.tier, tier);
    assert.equal(league.season.round, 6);
    play(league, 'win', 2);
    assert.equal(league.season.tier, Math.min(tier + 1, DIAMOND));
    assert.equal(league.season.round, 0);
    assert.equal(league.lastSeason.place, 1);
  }
  const bronze = createLeague(sunday);
  for (let round = 0; round < 7; round += 1) play(bronze, 'loss', -2);
  assert.equal(bronze.season.tier, 0);
  assert.equal(bronze.season.number, 2);
  assert.equal(bronze.lastSeason.place, 8);
});

test('second place is promoted too', () => {
  const league = createLeague(sunday);
  for (let round = 0; round < 6; round += 1) play(league, 'win', 2);
  const lastOpponent = leagueOpponent(league.season).id;
  Object.assign(league.season.scores[lastOpponent], { points: 18, wins: 6, difference: 5 });
  play(league, 'loss', -1);
  assert.equal(league.lastSeason.place, 2);
  assert.equal(league.season.tier, 1);
});

test('Monday resets the league exactly once and uses best league and place of the week', () => {
  const league = createLeague(sunday);
  assert.equal(leagueWeek(sunday).resetAt, monday);
  for (let round = 0; round < 28; round += 1) play(league, 'win', 2);
  assert.equal(resetLeagueWeek(league, sunday, fixed), null);
  const next = resetLeagueWeek(league, monday, fixed);
  assert.deepEqual(next.lastReward, { tier: DIAMOND, place: 1, gold: 1500, boosters: 4, gateShards: 7 });
  assert.equal(next.season.tier, 0);
  assert.equal(next.season.number, 1);
  assert.equal(next.season.round, 0);
  assert.deepEqual(next.diamond, { wins: 0, losses: 0, streak: 0 });
  assert.equal(resetLeagueWeek(next, sunday, fixed), null);
  assert.equal(resetLeagueWeek(next, monday, fixed), null);
});

test('diamond stake follows weekly wins and losses, and bonus follows the consecutive wins', () => {
  const league = createLeague(sunday);
  for (let round = 0; round < 21; round += 1) play(league, 'win', 2);
  assert.equal(leagueStake(league), 100);
  assert.equal(reserveLeagueMatch(league, leagueTicket(league), 'poor', 99), 'unaffordable');
  assert.equal(league.active, null);
  assert.equal(play(league, 'loss', -2).payout, 0);
  assert.equal(leagueStake(league), 100);
  assert.deepEqual(Array.from({ length: 4 }, () => {
    const stake = leagueStake(league);
    return play(league, 'win', 2).payout - stake;
  }), [150, 100, 50, 0]);
  assert.equal(leagueStake(league), 175);
  assert.equal(play(league, 'draw', 0).payout, 175);
  assert.equal(league.diamond.streak, 0);
  assert.equal(leagueStake(league), 175);
});

test('league state and rewards share the saved economy, survive reload, and reset together', async () => {
  const storage = storageStub();
  let time = sunday;
  const boot = () => createRewardProgress(storage, null, { now: () => time, random: fixed });
  let progress = boot();
  assert.equal(progress.league(), null);
  await progress.checkpointLeague();
  for (let round = 0; round < 21; round += 1) {
    const id = leagueTicket(progress.league());
    assert.equal(await progress.beginLeagueMatch(id, id, deck), 'done');
    assert.equal(await progress.settleLeagueMatch(id, 'win', 2), 'done');
  }
  const ticket = leagueTicket(progress.league());
  const startingGold = progress.inventory().gold;
  assert.equal(await progress.beginLeagueMatch(ticket, 'diamond', deck), 'done');
  progress = boot();
  assert.equal(progress.inventory().gold, startingGold - 100);
  assert.equal(progress.league().active.id, 'diamond');
  assert.equal(await progress.settleLeagueMatch('diamond', 'win', 2), 'done');
  assert.equal(await progress.settleLeagueMatch('diamond', 'win', 2), 'stale');
  assert.equal(progress.inventory().gold, startingGold + 150);

  time = monday;
  const beforeReward = progress.inventory();
  const shards = progress.base().materials.gateShards;
  assert.equal(await progress.checkpointLeague(), 'done');
  time = sunday;
  assert.equal(await boot().checkpointLeague(), 'current');
  time = monday;
  assert.equal(await boot().checkpointLeague(), 'current');
  assert.equal(boot().league().season.round, 0);
  assert.equal(boot().league().lastReward.place, 3);
  assert.equal(boot().inventory().gold, beforeReward.gold + 1000);
  assert.equal(boot().inventory().packCount, beforeReward.packCount + 3);
  assert.equal(boot().base().materials.gateShards, shards + 5);
  await resetProgress(storage);
  assert.equal(boot().league(), null);
});

test('a league match uses its scheduled rival preset, even for same-faction opponents', () => {
  const rival = LEAGUES[2].bots.find(({ deck }) => deck.id === 'league-orbit-gold');
  const match = createDeckMatch(deck, { botDeck: rival.deck, random: fixed });
  assert.equal(match.players.bot.factionId, deck.factionId);
  assert.equal(match.players.bot.leader.id, rival.deck.leaderId);
  assert.deepEqual([...match.players.bot.hand, ...match.players.bot.deck].map(({ definition }) =>
    definition.id).sort(), [...rival.deck.cardIds].sort());
});

test('place changes compare the previous table and encounters survive season and week turnover', () => {
  const league = createLeague(sunday);
  delete league.encounters;
  const openingOpponent = leagueOpponent(league.season).id;
  const openingTable = leagueTable(league.season).map(({ id }) => id);
  play(league, 'win', 2, 'opening');
  assert.deepEqual(league.season.previousPlaces,
    Object.fromEntries(openingTable.map((id, index) => [id, index + 1])));
  assert.deepEqual(league.encounters[openingOpponent], { wins: 1, draws: 0, losses: 0 });
  assert.equal(finishLeagueMatch(league, 'opening', 'win', 2, fixed), null);
  assert.equal(league.encounters[openingOpponent].wins, 1);

  for (let round = 1; round < 7; round += 1) play(league, 'win', 2);
  assert.equal(league.season.previousPlaces, undefined);
  assert.equal(league.encounters[openingOpponent].wins, 1);
  const next = resetLeagueWeek(JSON.parse(JSON.stringify(league)), monday, fixed);
  assert.deepEqual(next.encounters, league.encounters);
  play(next, 'draw', 0);
  assert.deepEqual(next.encounters[openingOpponent], { wins: 1, draws: 1, losses: 0 });
});

test('all four divisions advance on settlement, with an alternating bye in each foreign division', () => {
  const league = createLeague(sunday);
  delete league.divisions;
  for (let round = 0; round < 7; round += 1) {
    const ticket = leagueTicket(league);
    assert.equal(reserveLeagueMatch(league, ticket, ticket, 0), 'done');
    assert.equal(leagueDivision(league, 1).round, round);
    finishLeagueMatch(league, ticket, 'loss', -2, fixed);
    for (const tier of [1, 2, 3]) {
      const division = leagueDivision(league, tier);
      const scores = leagueTable(division);
      const bye = leagueSchedule(tier)[round][0][1];
      assert.equal(division.round, round + 1);
      assert.equal(scores.length, 7);
      assert.equal(scores.reduce((count, { wins, draws, losses }) => count + wins + draws + losses, 0), (round + 1) * 6);
      if (round === 0) assert.deepEqual(division.scores[bye], { id: bye, points: 0, wins: 0, draws: 0, losses: 0, difference: 0 });
    }
    assert.equal(finishLeagueMatch(league, ticket, 'loss', -2, fixed), null);
  }
  for (const score of leagueTable(leagueDivision(league, 1))) assert.equal(score.wins + score.draws + score.losses, 6);
});

test('promotion starts a clean player season and other division scores preserve their rounds up to the weekly reset', () => {
  const league = createLeague(sunday);
  for (let round = 0; round < 6; round += 1) play(league, 'win', 2);
  assert.ok(leagueTable(leagueDivision(league, 1)).some(({ points }) => points > 0));
  play(league, 'win', 2);
  assert.equal(league.season.tier, 1);
  assert.equal(league.season.round, 0);
  assert.equal(leagueDivision(league, 1), league.season);
  assert.ok(leagueTable(league.season).every(({ points }) => points === 0));
  assert.equal(leagueTable(leagueDivision(league, 0)).length, 7);
  assert.equal(leagueDivision(league, 0).round, 7);
  assert.equal(leagueDivision(league, 2).round, 7);
  play(league, 'win', 2);
  assert.equal(leagueDivision(league, 0).round, 8);
  assert.ok(leagueDivision(league, 0).previousPlaces);
  const next = resetLeagueWeek(JSON.parse(JSON.stringify(league)), monday, fixed);
  for (const [tier] of LEAGUES.entries()) {
    const division = leagueDivision(next, tier);
    assert.equal(division.round, 0);
    assert.equal(division.previousPlaces, undefined);
    assert.ok(leagueTable(division).every(({ points, wins, losses }) => points === 0 && wins === 0 && losses === 0));
  }
});
