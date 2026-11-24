import { LEAGUE_CHARACTERS } from './league-characters.js?v=hounds-tokens-1';
import { leagueDeckFor } from './league-decks.js?v=ulmarin-1';

export const LEAGUE_RULES = Object.freeze({
  rounds: 7, promotionPlaces: 2, relegationPlaces: 2, roundPoints: 1, winBonus: 1,
  minimumStake: 100, stakeStep: 25, bonusStep: 50, bonusStreakLimit: 4,
  firstPlaceMultiplier: 1.5,
  simulationTierStep: 2, simulationSwing: 9, simulationDrawMargin: .55, simulationSweepMargin: 3,
});

const leagueRewards = [
  ['Бронзовая', { gold: 100 }],
  ['Серебряная', { gold: 250, boosters: 1 }],
  ['Золотая', { gold: 500, boosters: 2 }],
  ['Алмазная', { gold: 1000, boosters: 3, gateShards: 5 }],
];

export const LEAGUE_DIFFICULTIES = Object.freeze([
  { upperRank: 4, lower: 'easy', upper: 'normal' },
  { upperRank: 4, lower: 'normal', upper: 'hard' },
  { upperRank: 8, lower: 'hard', upper: 'hard' },
  { upperRank: 8, lower: 'hard', upper: 'hard' },
]);

export function leagueDifficulty(tier, strength) {
  const { upperRank, lower, upper } = LEAGUE_DIFFICULTIES[tier];
  return strength <= upperRank ? lower : upper;
}

export const LEAGUE_BOTS = new Map(LEAGUE_CHARACTERS.map((character) => {
  const { tier, strength } = character;
  return [character.id, {
    ...character,
    deck: leagueDeckFor(character),
    difficulty: leagueDifficulty(tier, strength),
    strengthScale: LEAGUE_CHARACTERS.filter((bot) => bot.tier === tier).length,
    simulationStrength: strength + tier * LEAGUE_RULES.simulationTierStep,
  }];
}));

export const LEAGUES = leagueRewards.map(([name, reward], tier) => ({
  name, reward,
  bots: [...LEAGUE_BOTS.values()].filter((bot) => bot.tier === tier),
}));

export const DIAMOND = LEAGUES.length - 1;
const HUMAN = 'human';

export function leagueWeek(time) {
  const monday = new Date(time);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const week = [monday.getFullYear(), monday.getMonth() + 1, monday.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
  monday.setDate(monday.getDate() + 7);
  return { week, resetAt: monday.getTime() };
}

function homeRosters() {
  return LEAGUES.map(({ bots }, tier) => [
    ...(tier === 0 ? [HUMAN] : []), ...bots.map(({ id }) => id),
  ]);
}

export function leagueSchedule(season) {
  const order = Object.keys(season.scores);
  const player = order.indexOf(HUMAN);
  if (player > 0) order.unshift(order.splice(player, 1)[0]);
  return Array.from({ length: LEAGUE_RULES.rounds }, () => {
    const pairs = order.slice(0, order.length / 2).map((id, index) => [id, order.at(-1 - index)]);
    order.splice(1, 0, order.pop());
    return pairs;
  });
}

function newSeason(tier, number, ids, arrivals = {}, roundScoring = true) {
  const scores = Object.fromEntries(ids.map((id) => [id, {
    id, points: 0, wins: 0, draws: 0, losses: 0, difference: 0,
    ...(roundScoring ? { roundsWon: 0, roundsLost: 0 } : {}),
  }]));
  return { tier, number, round: 0, scores, arrivals, roundScoring };
}

function setSeasons(league, seasons) {
  league.divisions = {};
  for (const season of seasons) {
    if (Object.hasOwn(season.scores, HUMAN)) league.season = season;
    else league.divisions[season.tier] = season;
  }
}

export function createLeague(time) {
  const league = {
    ...leagueWeek(time), format: 2, best: { tier: 0, place: null }, played: false,
    diamond: { wins: 0, losses: 0, streak: 0 }, encounters: {}, active: null, lastReward: null,
  };
  setSeasons(league, homeRosters().map((ids, tier) => newSeason(tier, 1, ids)));
  return league;
}

export function upgradeLeague(league) {
  if (!league || league.format === 2) return league;
  const { tier: playerTier, number, round } = league.season;
  const rosters = homeRosters();
  if (playerTier) {
    // Keep the old opponents and fixture order, including any reserved match.
    rosters[0][0] = rosters[playerTier].pop();
  }
  rosters[playerTier] = Object.keys(league.season.scores);
  const seasons = rosters.map((ids, tier) => {
    if (tier === playerTier) return { ...league.season, arrivals: {} };
    const season = newSeason(tier, number, ids, {}, false);
    const schedule = leagueSchedule(season);
    while (season.round < round) {
      recordPlaces(season);
      playBotPairs(season, schedule[season.round], () => .5);
      season.round += 1;
    }
    return season;
  });
  const upgraded = { ...league, format: 2 };
  setSeasons(upgraded, seasons);
  return upgraded;
}

export function leagueTable(season) {
  return Object.values(season.scores).sort((a, b) => {
    const wins = (b.wins ?? 0) - (a.wins ?? 0);
    const difference = (b.difference ?? 0) - (a.difference ?? 0);
    return b.points - a.points || (season.roundScoring ? difference || wins : wins || difference) ||
      Number(a.id === HUMAN) - Number(b.id === HUMAN);
  });
}

export function leagueDivision(league, tier) {
  if (tier === league.season.tier) return league.season;
  return league.divisions[tier];
}

function recordPlaces(season) {
  season.previousPlaces = Object.fromEntries(leagueTable(season).map(({ id }, index) => [id, index + 1]));
}

function humanPlace(season) {
  return leagueTable(season).findIndex(({ id }) => id === HUMAN) + 1;
}

function recordBest(league, tier, place) {
  const best = league.best;
  if (tier > best.tier || (tier === best.tier && place !== null && (best.place === null || place < best.place))) {
    league.best = { tier, place };
  }
}

export function leagueOpponent(season) {
  const [, opponent] = leagueSchedule(season)[season.round][0];
  return LEAGUE_BOTS.get(opponent);
}

export function leagueStake(league) {
  if (league.season.tier !== DIAMOND) return 0;
  const { minimumStake, stakeStep } = LEAGUE_RULES;
  return Math.max(minimumStake, minimumStake + stakeStep * (league.diamond.wins - league.diamond.losses));
}

export function leagueTicket(league) {
  return `${league.week}/${league.season.number}/${league.season.round + 1}`;
}

export function reserveLeagueMatch(league, ticket, id, gold) {
  if (league.active || ticket !== leagueTicket(league)) return 'stale';
  const stake = leagueStake(league);
  if (gold < stake) return 'unaffordable';
  league.active = { id, stake };
  return 'done';
}

function scorePair(season, first, second, result, difference, rounds) {
  const a = season.scores[first];
  const b = season.scores[second];
  a.difference = (a.difference ?? 0) + difference;
  b.difference = (b.difference ?? 0) - difference;
  // Saves without roundScoring finish the season under the original rules.
  if (season.roundScoring) {
    const opposingRounds = rounds - difference;
    a.roundsWon += rounds;
    a.roundsLost += opposingRounds;
    b.roundsWon += opposingRounds;
    b.roundsLost += rounds;
    a.points += rounds * LEAGUE_RULES.roundPoints;
    b.points += opposingRounds * LEAGUE_RULES.roundPoints;
  }
  if (result === 'draw') {
    if (!season.roundScoring) {
      a.points += 1;
      b.points += 1;
    }
    a.draws = (a.draws ?? 0) + 1;
    b.draws = (b.draws ?? 0) + 1;
    return;
  }
  const [winner, loser] = result === 'win' ? [a, b] : [b, a];
  winner.points += season.roundScoring ? LEAGUE_RULES.winBonus : 3;
  winner.wins = (winner.wins ?? 0) + 1;
  loser.losses = (loser.losses ?? 0) + 1;
}

function simulatedRounds(result, difference) {
  if (result === 'draw') return 1;
  return result === 'win' ? 2 : 2 + difference;
}

function simulatePair(first, second, random) {
  const { simulationSwing, simulationDrawMargin, simulationSweepMargin } = LEAGUE_RULES;
  const margin = LEAGUE_BOTS.get(first).simulationStrength - LEAGUE_BOTS.get(second).simulationStrength + (random() - random()) * simulationSwing;
  if (Math.abs(margin) < simulationDrawMargin) return { result: 'draw', difference: 0 };
  return {
    result: margin > 0 ? 'win' : 'loss',
    difference: Math.sign(margin) * (Math.abs(margin) >= simulationSweepMargin ? 2 : 1),
  };
}

function playBotPairs(season, pairs, random) {
  for (const [first, second] of pairs) {
    const { result, difference } = simulatePair(first, second, random);
    scorePair(season, first, second, result, difference, simulatedRounds(result, difference));
  }
}

function nextSeason(league) {
  const rosters = LEAGUES.map(() => []);
  const arrivals = LEAGUES.map(() => ({}));
  for (const [tier] of LEAGUES.entries()) {
    const division = leagueDivision(league, tier);
    const table = leagueTable(division);
    for (const [index, { id }] of table.entries()) {
      let destination = tier;
      if (index < LEAGUE_RULES.promotionPlaces && tier < DIAMOND) destination += 1;
      if (index >= table.length - LEAGUE_RULES.relegationPlaces && tier > 0) destination -= 1;
      rosters[destination].push(id);
      if (destination !== tier) arrivals[destination][id] = Math.sign(destination - tier);
    }
  }
  const { number, tier } = league.season;
  const place = humanPlace(league.season);
  recordBest(league, tier, place);
  league.lastSeason = { tier, place };
  setSeasons(league, rosters.map((ids, tier) => newSeason(tier, number + 1, ids, arrivals[tier])));
  recordBest(league, league.season.tier, null);
}

export function finishLeagueMatch(league, id, result, difference, random = Math.random,
  rounds = simulatedRounds(result, difference)) {
  if (!league.active || league.active.id !== id) return null;
  const { season } = league;
  const { tier, round } = season;
  const { stake } = league.active;
  const [[, opponent], ...botPairs] = leagueSchedule(season)[round];
  recordPlaces(season);
  const encounters = league.encounters ??= {};
  const record = encounters[opponent] ??= { wins: 0, draws: 0, losses: 0 };
  record[{ win: 'wins', draw: 'draws', loss: 'losses' }[result]] += 1;
  record.last = result;
  scorePair(season, HUMAN, opponent, result, difference, rounds);
  playBotPairs(season, botPairs, random);
  for (const division of Object.values(league.divisions)) {
    recordPlaces(division);
    playBotPairs(division, leagueSchedule(division)[round], random);
    division.round += 1;
  }

  league.played = true;
  league.active = null;
  season.round += 1;
  let payout = 0;
  if (tier === DIAMOND) {
    if (result === 'win') {
      league.diamond.wins += 1;
      league.diamond.streak += 1;
      payout = stake + LEAGUE_RULES.bonusStep * Math.max(0, LEAGUE_RULES.bonusStreakLimit - league.diamond.streak);
    } else {
      if (result === 'loss') league.diamond.losses += 1;
      else payout = stake;
      league.diamond.streak = 0;
    }
  }
  if (season.round === LEAGUE_RULES.rounds) nextSeason(league);
  return { tier, payout };
}

export function needsLeagueReset(league, time) {
  return leagueWeek(time).week > league.week;
}

export function resetLeagueWeek(league, time, random = Math.random) {
  if (!needsLeagueReset(league, time)) return null;
  if (league.active) finishLeagueMatch(league, league.active.id, 'loss', -2, random);
  const { season } = league;
  if (season.round) recordBest(league, season.tier, humanPlace(season));
  const next = createLeague(time);
  next.encounters = { ...league.encounters };
  if (league.played) {
    const { tier, place } = league.best;
    const multiplier = place === 1 ? LEAGUE_RULES.firstPlaceMultiplier : 1;
    const bundle = Object.fromEntries(Object.entries(LEAGUES[tier].reward)
      .map(([resource, amount]) => [resource, Math.floor(amount * multiplier)]));
    next.lastReward = { tier, place, ...bundle };
  }
  return next;
}
