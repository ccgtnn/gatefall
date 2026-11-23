import { LEAGUE_CHARACTERS } from './league-characters.js?v=league-avatars-2';
import { leagueDeckFor } from './league-decks.js?v=league-characters-1';

export const LEAGUE_RULES = Object.freeze({
  rounds: 7, promotionPlaces: 2, winPoints: 3, drawPoints: 1,
  minimumStake: 100, stakeStep: 25, bonusStep: 50, bonusStreakLimit: 4,
  firstPlaceMultiplier: 1.5,
  simulationSwing: 9, simulationDrawMargin: .55, simulationSweepMargin: 3,
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
  { upperRank: 7, lower: 'hard', upper: 'hard' },
  { upperRank: 7, lower: 'hard', upper: 'hard' },
]);

export function leagueDifficulty(tier, strength) {
  const { upperRank, lower, upper } = LEAGUE_DIFFICULTIES[tier];
  return strength <= upperRank ? lower : upper;
}

export const LEAGUES = leagueRewards.map(([name, reward], tier) => ({
  name, reward,
  bots: LEAGUE_CHARACTERS.filter((character) => character.tier === tier).map((character) => ({
    ...character,
    deck: leagueDeckFor(character),
    difficulty: leagueDifficulty(tier, character.strength),
  })),
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

function entrants(tier) {
  return [HUMAN, ...LEAGUES[tier].bots.map(({ id }) => id)];
}

export function leagueSchedule(tier) {
  const order = entrants(tier);
  return Array.from({ length: LEAGUE_RULES.rounds }, () => {
    const pairs = order.slice(0, order.length / 2).map((id, index) => [id, order.at(-1 - index)]);
    order.splice(1, 0, order.pop());
    return pairs;
  });
}

function newSeason(tier, number = 1) {
  const scores = Object.fromEntries(entrants(tier).map((id) => [id, {
    id, points: 0, wins: 0, draws: 0, losses: 0, difference: 0,
  }]));
  return { tier, number, round: 0, scores };
}

export function createLeague(time) {
  return {
    ...leagueWeek(time), season: newSeason(0), best: { tier: 0, place: null }, played: false,
    diamond: { wins: 0, losses: 0, streak: 0 }, active: null, lastReward: null,
  };
}

export function leagueTable(season) {
  return Object.values(season.scores).sort((a, b) => b.points - a.points ||
    b.wins - a.wins || b.difference - a.difference ||
    Number(a.id === HUMAN) - Number(b.id === HUMAN));
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
  const [, opponent] = leagueSchedule(season.tier)[season.round][0];
  return LEAGUES[season.tier].bots.find((bot) => bot.id === opponent);
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

function scorePair(scores, first, second, result, difference) {
  const a = scores[first];
  const b = scores[second];
  a.difference += difference;
  b.difference -= difference;
  if (result === 'draw') {
    a.points += LEAGUE_RULES.drawPoints;
    b.points += LEAGUE_RULES.drawPoints;
    a.draws += 1;
    b.draws += 1;
    return;
  }
  const [winner, loser] = result === 'win' ? [a, b] : [b, a];
  winner.points += LEAGUE_RULES.winPoints;
  winner.wins += 1;
  loser.losses += 1;
}

function simulatePair(bots, first, second, random) {
  const { simulationSwing, simulationDrawMargin, simulationSweepMargin } = LEAGUE_RULES;
  const margin = bots.get(first).strength - bots.get(second).strength + (random() - random()) * simulationSwing;
  if (Math.abs(margin) < simulationDrawMargin) return { result: 'draw', difference: 0 };
  return {
    result: margin > 0 ? 'win' : 'loss',
    difference: Math.sign(margin) * (Math.abs(margin) >= simulationSweepMargin ? 2 : 1),
  };
}

export function finishLeagueMatch(league, id, result, difference, random = Math.random) {
  if (!league.active || league.active.id !== id) return null;
  const { season } = league;
  const { tier, round, scores } = season;
  const { stake } = league.active;
  const [[, opponent], ...botPairs] = leagueSchedule(tier)[round];
  scorePair(scores, HUMAN, opponent, result, difference);
  const bots = new Map(LEAGUES[tier].bots.map((bot) => [bot.id, bot]));
  for (const [first, second] of botPairs) {
    const simulated = simulatePair(bots, first, second, random);
    scorePair(scores, first, second, simulated.result, simulated.difference);
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
  if (season.round === LEAGUE_RULES.rounds) {
    const place = humanPlace(season);
    recordBest(league, tier, place);
    const nextTier = place <= LEAGUE_RULES.promotionPlaces ? Math.min(tier + 1, DIAMOND) : tier;
    league.lastSeason = { tier, place };
    if (nextTier > tier) recordBest(league, nextTier, null);
    league.season = newSeason(nextTier, season.number + 1);
  }
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
  if (league.played) {
    const { tier, place } = league.best;
    const multiplier = place === 1 ? LEAGUE_RULES.firstPlaceMultiplier : 1;
    const bundle = Object.fromEntries(Object.entries(LEAGUES[tier].reward)
      .map(([resource, amount]) => [resource, Math.floor(amount * multiplier)]));
    next.lastReward = { tier, place, ...bundle };
  }
  return next;
}
