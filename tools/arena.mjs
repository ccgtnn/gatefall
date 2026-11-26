import { mirrorMatch, other } from './arena-position.mjs';
import { BOT_LEVELS, readBotLevel } from '../docs/game/bot-levels.js';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { summarizeCards, summarizeOverload, summarizePlagueEvents, summarizeNewNeutrals } from './arena-cards.mjs';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

function randomFrom(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function run({ root, trials, rolloutSamples, trace, collectCards, progress, newNeutrals }) {
  const { applyAction, confirmMulligan, createMatch, mulliganLimit, totalScore } = await import(root + '/docs/game/match.js');
  const { FACTIONS, NEUTRAL_CARDS } = await import(root + '/docs/game/cards.js');
  const { PRESETS, inspectDeck } = await import(root + '/docs/game/decks.js');
  const { chooseBotTurn, BOT_LEVELS: levelsSupported } = await import(root + '/docs/game/bot.js');
  const results = [];
  const additions = newNeutrals ? NEUTRAL_CARDS.filter(({ id }) => id === 'world-gates' || id === 'falura') : [];
  for (const { levels, faction, seed, starter, group, leaderPair, growth } of trials) {
    const random = randomFrom(seed);
    Math.random = randomFrom(seed ^ 0x124b62);
    const [humanLeader, botLeader] = leaderPair ?? [];
    const plague = growth === 'plague' ? inspectDeck(PRESETS.find(({ id }) => id === 'preset-growth-plague')) : null;
    if (plague && !plague.valid) throw new Error('Invalid Plague deck: ' + JSON.stringify(plague.issues));
    let decks = plague ? (faction === 'protectorate'
      ? { human: FACTIONS.protectorate.deck, bot: plague.cards }
      : { human: plague.cards, bot: FACTIONS.protectorate.deck }) : undefined;
    if (decks && newNeutrals) decks = Object.fromEntries(Object.entries(decks)
      .map(([side, cards]) => [side, [...cards, ...additions]]));
    let match = createMatch({ decks, humanFaction: faction, random, humanLeader:
      plague && faction === 'growth' ? plague.leader.id : FACTIONS[faction].leaders[humanLeader]?.id });
    if (botLeader !== undefined) {
      const player = match.players.bot;
      const leader = FACTIONS[player.factionId].leaders[botLeader];
      player.leader = { ...leader, charges: leader.charges ?? match.rules.leaderCharges };
    }
    if (plague && faction === 'protectorate') {
      match.players.bot.leader = { ...plague.leader, charges: plague.leader.charges ?? match.rules.leaderCharges };
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
          (a.power ?? a.definition.provision) - (b.power ?? b.definition.provision))
          .slice(0, mulliganLimit(match, 'human')).map(({ id }) => id);
        match = confirmMulligan(match, choices, { random });
        continue;
      }
      const side = match.pending?.side ?? match.turn;
      const options = { random: Math.random, rolloutSamples };
      if (trace && levels[side] === 4) {
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
      const level = levels[side];
      const skill = levelsSupported ? level : level <= 2 ? 'easy' : level <= 5 ? 'normal' : 'hard';
      const action = chooseBotTurn(side === 'bot' ? match : mirrorMatch(match), skill, options);
      if (levels[side] >= 6) hardTimings.push(performance.now() - choosing);
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
      leaderPair, growth, ...(collectCards && newNeutrals && { neutralEvents: match.log.filter((event) =>
        event.type === 'play' || (event.type === 'spawn' && event.cards[0]?.definition.id === 'shadow') ||
        (event.sourceDefinitionId === 'falura' && ['damage', 'armor', 'leader'].includes(event.type))) }), rounds: match.log.filter(({ type }) => type === 'round-end'), decisions, played,
      ...(collectCards && growth === 'plague' && { plagueEvents: match.log.flatMap((event) => {
        if (event.type === 'damage' || event.type === 'status' || event.type === 'boost' ||
            event.type === 'scenario-chapter' || event.type === 'row-effect' || event.type === 'play') {
          const { type, side, sourceDefinitionId, tick, lost, amount, status, chapter, effect, card } = event;
          return [{ type, side, sourceDefinitionId, tick, lost, amount, status, chapter,
            ...(type === 'row-effect' && effect && { effect }),
            ...(type === 'play' && card && { id: card.definition.id, baseGain: (card.basePower ?? 0) - (card.definition.power ?? 0) }) }];
        }
        return [];
      }) }) });
    if (progress) parentPort.postMessage({ completed: 1 });
  }
  return results;
}

if (isMainThread) {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [name, value] = arg.replace(/^--/, '').split('=');
    return [name, value ?? true];
  }));
  const games = Number(options.games ?? 200);
  const root = resolve(options.root ?? '.');
  const trials = [];
  const growthDecks = (options.growth ?? 'standard').split(',');
  if (growthDecks.some((name) => name !== 'standard' && name !== 'plague')) throw new Error('Unknown Growth deck');
  if (options['new-neutrals'] && growthDecks.some((name) => name !== 'plague')) {
    throw new Error('--new-neutrals requires --growth=plague');
  }
  const matchups = (options.matchups ?? '6-4,4-2').split(',');
  if (!Number.isSafeInteger(games) || games < 2 || games % 2) throw new Error('--games must be a positive even number');
  for (const matchup of matchups) {
    const [first, second] = matchup.split('-');
    if (![first, second].every((level) => Object.hasOwn(BOT_LEVELS, level) || ['hard', 'normal', 'easy'].includes(level))) throw new Error('Invalid matchup: ' + matchup);
    for (const faction of first === second ? ['protectorate'] : ['protectorate', 'growth']) {
      for (let i = 0; i < games; i++) {
        const pair = Math.floor(i / 2);
        const leaderPair = first === second ? [pair % 3, Math.floor(pair / 3) % 3] : undefined;
        for (const growth of growthDecks) trials.push({
          group: first + '-' + second + '/' + faction + (growth === 'plague' ? '/plague' : ''), faction, growth,
          levels: { human: readBotLevel(first), bot: readBotLevel(second) }, seed: Number(options.seed ?? 1729) + pair,
          starter: i % 2 ? 'bot' : 'human', leaderPair,
        });
      }
    }
  }
  const workers = Math.min(trials.length, Number(options.workers ?? Math.min(8, availableParallelism())));
  let completed = 0;
  const batches = await Promise.all(Array.from({ length: workers }, (_, index) => new Promise((done, fail) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { root, newNeutrals: Boolean(options['new-neutrals']), progress: Boolean(options.progress), trace: Boolean(options.trace), collectCards: Boolean(options.cards), rolloutSamples: options.samples === undefined ? undefined : Number(options.samples),
        trials: trials.filter((_, i) => i % workers === index) },
    });
    worker.on('message', (message) => {
      if (Array.isArray(message)) done(message);
      else {
        completed += message.completed;
        if (completed % 25 === 0 || completed === trials.length) console.error(`Arena: ${completed}/${trials.length}`);
      }
    });
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
    if (!/^(6-6|7-7|hard-hard)\//.test(group)) continue;
    summary[group].byStarter = Object.fromEntries(['human', 'bot'].map((starter) => {
      const subset = matches.filter((match) => match.group === group && match.starter === starter);
      return [starter, Object.fromEntries(['win', 'loss', 'draw'].map((result) => [result, subset.filter((match) => match.result === result).length]))];
    }));
  }
  if (options.trace) writeFileSync(options.trace, JSON.stringify(matches.filter((match) => match.decisions.length > 0)));
  if (options.cards) {
    const mirrorMatches = matches.filter(({ group }) => /^(6-6|7-7|hard-hard)\//.test(group));
    const standard = mirrorMatches.filter(({ growth }) => growth !== 'plague');
    const plague = mirrorMatches.filter(({ growth }) => growth === 'plague');
    writeFileSync(options.cards, JSON.stringify({ cards: summarizeCards(standard), overload: summarizeOverload(standard),
      ...(options['new-neutrals'] && { newNeutrals: summarizeNewNeutrals(plague) }),
      ...(plague.length && { plagueCards: summarizeCards(plague), plagueEvents: summarizePlagueEvents(plague) }) }, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
} else {
  parentPort.postMessage(await run(workerData));
}
