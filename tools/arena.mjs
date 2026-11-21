import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { summarizeCards, summarizeOverload } from './arena-cards.mjs';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

function randomFrom(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const other = (side) => side === 'bot' ? 'human' : 'bot';
const swap = (side) => side == null ? side : other(side);
const reverseSides = ({ bot, human }) => ({ human: bot, bot: human });
const mirrorEvent = (event) => ({
  ...event, side: swap(event.side), winner: swap(event.winner), attacker: swap(event.attacker),
  ...(event.scores && { scores: reverseSides(event.scores) }),
});
function mirror(match) {
  return {
    ...match,
    turn: swap(match.turn), starter: swap(match.starter),
    players: reverseSides(match.players),
    log: match.log.map(mirrorEvent),
    effects: match.effects.map(mirrorEvent),
    pending: match.pending && {
      ...mirrorEvent(match.pending), selectionSide: swap(match.pending.selectionSide),
      job: mirrorEvent(match.pending.job),
    },
  };
}

async function run({ root, trials, rolloutSamples, trace, collectCards }) {
  const { applyAction, confirmMulligan, createMatch, mulliganLimit, totalScore } = await import(root + '/docs/game/match.js');
  const { FACTIONS } = await import(root + '/docs/game/cards.js');
  const { chooseBotTurn } = await import(root + '/docs/game/bot.js');
  const results = [];
  for (const { levels, faction, seed, starter, group, leaderPair } of trials) {
    const random = randomFrom(seed);
    Math.random = randomFrom(seed ^ 0x124b62);
    const [humanLeader, botLeader] = leaderPair ?? [];
    let match = createMatch({ humanFaction: faction, humanLeader: FACTIONS[faction].leaders[humanLeader]?.id, random });
    if (botLeader !== undefined) {
      const player = match.players.bot;
      player.leader = { ...FACTIONS[player.factionId].leaders[botLeader], charges: match.rules.leaderCharges };
    }
    match.starter = starter;
    const start = performance.now();
    const hardTimings = [];
    const decisions = [];
    const played = [];
    let play;
    const leadFor = (side) => totalScore(match.players[side]) - totalScore(match.players[other(side)]);
    for (let step = 0; match.phase !== 'finished'; step++) {
      if (step > 300) throw new Error('Unfinished match: ' + JSON.stringify({ faction, seed, levels, round: match.round }));
      if (match.phase === 'mulligan') {
        const choices = match.players.human.hand.toSorted((a, b) =>
          (a.definition.power ?? a.definition.provision) - (b.definition.power ?? b.definition.provision))
          .slice(0, mulliganLimit(match, 'human')).map(({ id }) => id);
        match = confirmMulligan(match, choices, { random });
        continue;
      }
      const side = match.pending?.side ?? match.turn;
      const options = { random: Math.random, rolloutSamples };
      if (trace && levels[side] === 'normal') {
        const player = match.players[side];
        options.onDecision = (decision) => {
          const label = (action) => player.hand.find(({ id }) => id === action.cardId)?.definition.name ?? action.cardId;
          decisions.push({
            side, round: match.round, lead: leadFor(side), hand: player.hand.length,
            enemyHand: match.players[other(side)].hand.length, enemyPassed: match.players[other(side)].passed,
            ...decision, name: label(decision.action),
            candidates: decision.candidates.map((candidate) => ({ ...candidate, name: label(candidate.action) })),
          });
        };
      }
      const choosing = performance.now();
      const action = chooseBotTurn(side === 'bot' ? match : mirror(match), levels[side], options);
      if (levels[side] === 'hard') hardTimings.push(performance.now() - choosing);
      const next = applyAction(match, side, action, { random });
      if (collectCards && action.type === 'play') {
        const { definition } = match.players[side].hand.find(({ id }) => id === action.cardId);
        play = { id: definition.id, name: definition.name, side, round: match.round, row: action.row,
          lead: leadFor(side), at: step, damage: 0 };
      }
      if (play) {
        const events = next.log.slice(match.log.length);
        const scores = events.find(({ type }) => type === 'round-end')?.scores;
        if (play.id === 'shield-overload') {
          if (match.pending?.kind === 'armor-row') play.row = action.cardId;
          play.damage += events.filter((event) => event.type === 'damage' && event.sourceDefinitionId === play.id)
            .reduce((sum, event) => sum + event.lost, 0);
        }
        if (!next.pending) {
          const owner = play.side;
          const lead = scores ? scores[owner] - scores[other(owner)]
            : totalScore(next.players[owner]) - totalScore(next.players[other(owner)]);
          played.push({ ...play, points: lead - play.lead });
          play = undefined;
        }
      }
      if (next === match) throw new Error('Illegal action: ' + JSON.stringify({ faction, seed, levels, action, side }));
      match = next;
    }
    results.push({ group, result: match.result, ms: performance.now() - start, hardTimings, faction, seed, starter,
      leaderPair, rounds: match.log.filter(({ type }) => type === 'round-end'), decisions, played });
  }
  return results;
}

if (isMainThread) {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
  const games = Number(options.games ?? 200);
  const root = resolve(options.root ?? '.');
  const trials = [];
  const matchups = (options.matchups ?? 'hard-normal,normal-easy').split(',');
  if (!Number.isSafeInteger(games) || games < 2 || games % 2) throw new Error('--games must be a positive even number');
  for (const matchup of matchups) {
    const [first, second] = matchup.split('-');
    if (![first, second].every((level) => ['hard', 'normal', 'easy'].includes(level))) throw new Error('Invalid matchup: ' + matchup);
    for (const faction of first === second ? ['protectorate'] : ['protectorate', 'growth']) {
      for (let i = 0; i < games; i++) {
        const pair = Math.floor(i / 2);
        const leaderPair = first === second ? [pair % 3, Math.floor(pair / 3) % 3] : undefined;
        trials.push({
          group: first + '-' + second + '/' + faction, faction,
          levels: { human: first, bot: second }, seed: Number(options.seed ?? 1729) + Math.floor(i / 2),
          starter: i % 2 ? 'bot' : 'human', leaderPair,
        });
      }
    }
  }
  const workers = Math.min(trials.length, Number(options.workers ?? Math.min(8, availableParallelism())));
  const batches = await Promise.all(Array.from({ length: workers }, (_, index) => new Promise((done, fail) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { root, trace: Boolean(options.trace), collectCards: Boolean(options.cards), rolloutSamples: options.samples === undefined ? undefined : Number(options.samples),
        trials: trials.filter((_, i) => i % workers === index) },
    });
    worker.on('message', done);
    worker.on('error', fail);
    worker.on('exit', (code) => { if (code) fail(new Error('Arena worker exited: ' + code)); });
  })));
  const summary = {};
  const hardTimings = batches.flat().flatMap((result) => result.hardTimings).sort((a, b) => a - b);
  for (const { group, result, ms } of batches.flat()) {
    for (const key of [group, group.split('/')[0]]) {
      const record = summary[key] ??= { win: 0, loss: 0, draw: 0, games: 0, processMs: 0 };
      record[result]++;
      record.games++;
      record.processMs += ms;
    }
  }
  for (const record of Object.values(summary)) {
    record.winRate = Number((100 * record.win / record.games).toFixed(2));
    record.processMs = Math.round(record.processMs);
  }
  if (hardTimings.length) summary.hardDecisionMs = {
    median: Math.round(hardTimings[Math.floor(hardTimings.length * .5)]),
    p95: Math.round(hardTimings[Math.floor(hardTimings.length * .95)]),
    max: Math.round(hardTimings.at(-1)),
  };
  const matches = batches.flat();
  for (const group of new Set(matches.map((match) => match.group))) {
    if (!group.startsWith('hard-hard/')) continue;
    summary[group].byStarter = Object.fromEntries(['human', 'bot'].map((starter) => {
      const subset = matches.filter((match) => match.group === group && match.starter === starter);
      return [starter, Object.fromEntries(['win', 'loss', 'draw'].map((result) => [result, subset.filter((match) => match.result === result).length]))];
    }));
  }
  if (options.trace) writeFileSync(options.trace, JSON.stringify(matches.filter((match) => match.decisions.length > 0)));
  if (options.cards) {
    const mirrorMatches = matches.filter(({ group }) => group.startsWith('hard-hard/'));
    writeFileSync(options.cards, JSON.stringify({ cards: summarizeCards(mirrorMatches), overload: summarizeOverload(mirrorMatches) }, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
} else {
  parentPort.postMessage(await run(workerData));
}
