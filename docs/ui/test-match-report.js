import { serializeBotPosition } from '../game/bot/bot-position.js';
import { describeMatchAction, eventText } from './match-log.js';

export const TEST_REPORT_KEY = 'gatefall.test-match-report';
export const TEST_REPORT_LIMIT = 3_000_000;

const bytes = new TextEncoder();

function parseReport(json) {
  try {
    const report = JSON.parse(json);
    if (report?.version === 1 && report.meta?.id && Array.isArray(report.timeline)) return report;
  } catch {}
}

function compactEvent(event) {
  const compact = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) compact[key] = value;
  }
  if (event.card?.definition?.id) compact.definitionId = event.card.definition.id;
  if (event.type === 'round-end') compact.scores = event.scores;
  if (event.type === 'row-effect' && event.effect) {
    const { type, remaining } = event.effect;
    compact.effect = { type, remaining };
  }
  const text = eventText(event);
  if (text) compact.text = text;
  return compact;
}

function withoutSnapshots(report, keepRated) {
  return { ...report, timeline: report.timeline.map((entry) => {
    if (!entry.position || (keepRated && (entry.rating?.stars || entry.rating?.comment))) return entry;
    const { position, ...rest } = entry;
    return { ...rest, positionOmitted: keepRated ? 'size' : 'storage' };
  }) };
}

function withSummary(report) {
  const bot = report.timeline.filter((entry) => entry.botMove);
  const rated = bot.filter(({ rating }) => rating);
  const sum = rated.reduce((total, { rating }) => total + rating.stars, 0);
  return {
    version: report.version,
    summary: {
      botMoves: bot.length,
      ratedMoves: rated.length,
      averageStars: rated.length ? Math.round(sum / rated.length * 100) / 100 : null,
      lowRatedMoves: rated.filter(({ rating }) => rating.stars <= 4).map(({ botMove }) => botMove),
      omittedSnapshots: bot.filter(({ positionOmitted }) => positionOmitted).length,
    },
    meta: report.meta,
    timeline: report.timeline,
  };
}

export function reportJson(report, limit = TEST_REPORT_LIMIT) {
  const json = JSON.stringify(withSummary(report));
  return bytes.encode(json).length <= limit ? json : JSON.stringify(withSummary(withoutSnapshots(report, true)));
}

export function reportFilename({ meta }) {
  const started = new Date(meta.startedAt);
  const pad = (value) => String(value).padStart(2, '0');
  return `gatefall-test-${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}-${pad(started.getHours())}${pad(started.getMinutes())}.json`;
}

export function createTestMatchReport({ storage, buildVersion, now = () => new Date() } = {}) {
  let active;
  let stored;
  try { stored = storage?.getItem(TEST_REPORT_KEY); } catch {}
  let previous = parseReport(stored);
  let latestBot;
  let botMoves = 0;

  function persist() {
    previous = active;
    try {
      const current = storage?.getItem(TEST_REPORT_KEY);
      if (current !== stored) {
        const saved = parseReport(current);
        if (saved && saved.meta.id !== active.meta.id) return;
      }
      const json = reportJson(active);
      try {
        storage?.setItem(TEST_REPORT_KEY, json);
        stored = json;
      } catch {
        const compact = reportJson(withoutSnapshots(active, false));
        storage?.setItem(TEST_REPORT_KEY, compact);
        stored = compact;
      }
    } catch {}
  }

  function start(match, { id, level }) {
    const decks = Object.fromEntries(Object.entries(match.players).map(([side, player]) => [side, {
      factionId: player.factionId, leaderId: player.leader?.id,
      cardIds: player.startingDeck.map(({ definition }) => definition.id),
    }]));
    active = { version: 1, meta: {
      id, startedAt: now().toISOString(), ...(buildVersion && { buildVersion }), level, decks, starter: match.starter, result: null,
    }, timeline: [] };
    botMoves = 0;
    latestBot = undefined;
    try { stored = storage?.getItem(TEST_REPORT_KEY); } catch {}
    persist();
  }

  function record(before, journal, { side, action, description, level, trace }) {
    if (!active) return;
    const bot = side === 'bot';
    const events = journal.filter(({ type }) => type !== 'bot-thought').map(compactEvent);
    const entry = {
      index: active.timeline.length + 1, side, round: before.round,
      action, description: description || describeMatchAction(before, action, side) ||
        events.find(({ text }) => text)?.text || action.type,
      logEnd: before.log.length + journal.length, events,
    };
    if (bot) {
      entry.botMove = ++botMoves;
      entry.position = JSON.parse(serializeBotPosition(before, level));
      entry.trace = trace ?? null;
      latestBot = entry;
    }
    active.timeline.push(entry);
    persist();
  }

  function finish(match, result = match.result) {
    if (!active || active.meta.result) return;
    const rounds = match.log.filter(({ type }) => type === 'round-end').map(({ round, winner, scores }) => ({ round, winner, scores }));
    active.meta.result = {
      outcome: result, winner: ({ win: 'human', loss: 'bot' })[result] ?? null,
      score: {
        human: rounds.filter(({ winner }) => winner === 'human').length,
        bot: rounds.filter(({ winner }) => winner === 'bot').length,
        draws: rounds.filter(({ winner }) => winner !== 'human' && winner !== 'bot').length,
      },
      rounds, endedAt: now().toISOString(),
    };
    persist();
  }

  function rate(index, stars, comment) {
    const entry = active?.timeline[index - 1];
    if (!entry?.botMove || !Number.isInteger(stars) || stars < 1 || stars > 10 || typeof comment !== 'string') return false;
    entry.rating = { index, stars, comment: comment.trim(), at: now().toISOString() };
    persist();
    return true;
  }

  return {
    get active() { return active; },
    get latestBot() { return latestBot; },
    previous: () => previous,
    start, record, finish, rate,
    clearLatestBot: () => { latestBot = undefined; },
    detach: () => { active = latestBot = undefined; },
  };
}
