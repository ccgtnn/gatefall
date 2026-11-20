import { availableParallelism } from 'node:os';
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

async function run({ root, trials, rolloutSamples }) {
  const { applyAction, confirmMulligan, createMatch, mulliganLimit } = await import(root + '/docs/game/match.js');
  const { chooseBotTurn } = await import(root + '/docs/game/bot.js');
  const results = [];
  for (const { levels, faction, seed, starter, group } of trials) {
    const random = randomFrom(seed);
    Math.random = randomFrom(seed ^ 0x124b62);
    let match = createMatch({ humanFaction: faction, random });
    match.starter = starter;
    const start = performance.now();
    const hardTimings = [];
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
      const choosing = performance.now();
      const action = chooseBotTurn(side === 'bot' ? match : mirror(match), levels[side], options);
      if (levels[side] === 'hard') hardTimings.push(performance.now() - choosing);
      const next = applyAction(match, side, action, { random });
      if (next === match) throw new Error('Illegal action: ' + JSON.stringify({ faction, seed, levels, action, side }));
      match = next;
    }
    results.push({ group, result: match.result, ms: performance.now() - start, hardTimings });
  }
  return results;
}

if (isMainThread) {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
  const games = Number(options.games ?? 200);
  const root = resolve(options.root ?? '.');
  const trials = [];
  for (const [first, second] of [['hard', 'normal'], ['normal', 'easy']]) {
    for (const faction of ['protectorate', 'growth']) {
      for (let i = 0; i < games; i++) {
        trials.push({
          group: first + '-' + second + '/' + faction, faction,
          levels: { human: first, bot: second }, seed: Number(options.seed ?? 1729) + Math.floor(i / 2),
          starter: i % 2 ? 'bot' : 'human',
        });
      }
    }
  }
  const workers = Math.min(trials.length, Number(options.workers ?? Math.min(8, availableParallelism())));
  const batches = await Promise.all(Array.from({ length: workers }, (_, index) => new Promise((done, fail) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { root, rolloutSamples: options.samples === undefined ? undefined : Number(options.samples),
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
  summary.hardDecisionMs = {
    median: Math.round(hardTimings[Math.floor(hardTimings.length * .5)]),
    p95: Math.round(hardTimings[Math.floor(hardTimings.length * .95)]),
    max: Math.round(hardTimings.at(-1)),
  };
  console.log(JSON.stringify(summary, null, 2));
} else {
  parentPort.postMessage(await run(workerData));
}
