import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chooseBotTurn } from '../../docs/game/bot/bot.js';
import { restoreBotPosition } from '../../docs/game/bot/bot-position.js';
import { createMatch, confirmMulligan } from '../../docs/game/engine/match.js';
import { createTestMatchFeedback } from '../../docs/ui/test-match-feedback.js';
import { createTestMatchReport, reportJson, reportFilename } from '../../docs/ui/test-match-report.js';
import { TestNode } from '../helpers/test-node.js';

function fixture(limit = Infinity) {
  const files = new Map();
  const storage = {
    getItem: (key) => files.get(key) ?? null,
    setItem(key, value) {
      if (value.length > limit) throw new DOMException('Full', 'QuotaExceededError');
      files.set(key, value);
    },
  };
  const match = confirmMulligan(createMatch({ random: () => .9 }), [], { random: () => .9 });
  const now = () => new Date(2026, 10, 28, 11, 7);
  const report = createTestMatchReport({ storage, now, buildVersion: 'pages-hash' });
  report.start(match, { id: 'match', level: 2 });
  const record = () => {
    const action = { type: 'pass' };
    const trace = { action, reason: 'Тест поиска', candidates: [] };
    report.record(match, [{ type: 'pass', side: 'bot', reason: 'manual' }], { side: 'bot', action, level: 2, trace });
    return report.latestBot;
  };
  return { storage, match, now, report, record };
}

test('report records the initial deck lists, actions and round results and is restored from storage', () => {
  const { storage, match, now, report, record } = fixture();
  const played = record();
  assert.equal(report.rate(played.index, 0, ''), false);
  assert.equal(report.rate(played.index, 11, ''), false);
  assert.equal(report.rate(played.index, 1.5, ''), false);
  assert.equal(report.rate(played.index, 10, 'Десять'), true);
  assert.equal(report.rate(played.index, 4, ' Исправлено '), true);
  record();
  const restored = createTestMatchReport({ storage });
  assert.equal(restored.active, undefined);
  assert.equal(restored.previous().meta.result, null);
  const round = { type: 'round-end', round: 1, winner: 'bot', scores: { human: 2, bot: 4 } };
  report.finish({ log: [round], result: 'loss' });
  const saved = createTestMatchReport({ storage }).previous();
  const json = JSON.parse(reportJson(saved));
  assert.equal(json.meta.startedAt, now().toISOString());
  assert.equal(json.meta.buildVersion, 'pages-hash');
  assert.equal(json.meta.level, 2);
  assert.equal(json.meta.starter, 'bot');
  for (const [side, { leader, startingDeck }] of Object.entries(match.players)) {
    assert.equal(json.meta.decks[side].leaderId, leader.id);
    assert.deepEqual(json.meta.decks[side].cardIds, startingDeck.map(({ definition }) => definition.id));
  }
  assert.equal(json.meta.result.winner, 'bot');
  assert.deepEqual(json.meta.result.score, { human: 0, bot: 1, draws: 0 });
  assert.deepEqual(json.meta.result.rounds[0].scores, round.scores);
  assert.deepEqual(json.summary, {
    botMoves: 2, ratedMoves: 1, averageStars: 4, lowRatedMoves: [1], omittedSnapshots: 0,
  });
  assert.deepEqual(json.timeline[0].rating, { index: 1, stars: 4, comment: 'Исправлено', at: now().toISOString() });
  assert.equal(json.timeline[0].events[0].text, 'Бот: пас.');
  assert.equal(json.timeline[0].trace.reason, 'Тест поиска');
  assert.equal(restoreBotPosition(json.timeline[0].position).state.players.bot.passed, false);
  assert.equal(reportFilename(json), 'gatefall-test-2026-11-28-1107.json');
});

test('size reduction preserves rated positions and localStorage quota falls back without any positions', () => {
  const { storage, report, record } = fixture(3000);
  const rated = record();
  report.rate(rated.index, 7, 'Оставить снимок');
  const unrated = record();
  const json = JSON.parse(reportJson(report.active, Buffer.byteLength(reportJson(report.active)) - 1));
  assert.equal(json.summary.omittedSnapshots, 1);
  assert.ok(json.timeline[0].position);
  assert.equal(json.timeline[1].position, undefined);
  assert.equal(json.timeline[1].positionOmitted, 'size');
  assert.ok(unrated.position);
  const saved = createTestMatchReport({ storage }).previous();
  assert.equal(saved.summary.omittedSnapshots, 2);
  assert.equal(saved.timeline[0].position, undefined);
  assert.equal(saved.timeline[0].positionOmitted, 'storage');
  assert.equal(saved.timeline[0].rating.stars, 7);
});

test('ratings can be saved, cancelled and edited from the field and journal', async (t) => {
  const previousDocument = globalThis.document;
  const body = new TestNode('body');
  const makeNode = (tag) => Object.assign(new TestNode(tag), {
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    remove() { this.parent?.replaceChildren(...this.parent.children.filter((child) => child !== this)); },
  });
  globalThis.document = { body, createElement: makeNode, querySelectorAll: (selector) => body.querySelectorAll(selector) };
  t.after(() => { globalThis.document = previousDocument; });
  const { logView } = await import('../../docs/ui/menu.js');
  const { report, match, record } = fixture();
  const feedback = createTestMatchFeedback(report);
  assert.equal(feedback.fieldControls().querySelector('.field-test-feedback'), null);
  const move = record();
  match.log.push({ type: 'bot-thought', chosen: 'Пас', reason: move.trace.reason, candidates: [] });
  const control = feedback.fieldControls();
  const journal = logView(match, false, feedback);
  body.append(control, journal);
  assert.equal(journal.querySelector('.bot-thought'), null);
  assert.ok(logView(match, true, feedback).querySelector('.bot-thought'));
  const trigger = control.querySelector('.field-test-feedback');
  const journalTrigger = journal.querySelector('.test-feedback');
  assert.equal(trigger.textContent, '💬');
  assert.equal(journalTrigger.textContent, '💬');
  function open(triggerButton, stars, comment, cancel = false) {
    triggerButton.dispatchEvent(new Event('click'));
    const dialog = body.querySelector('.test-rating-dialog');
    const star = dialog.querySelectorAll('.test-rating-star')[stars - 1];
    dialog.querySelector('textarea').value = comment;
    assert.equal(dialog.querySelectorAll('.test-rating-star').length, 10);
    star.dispatchEvent(new Event('click'));
    if (cancel) dialog.querySelector('.finish-actions').children[1].dispatchEvent(new Event('click'));
    else dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  }
  open(trigger, 1, 'Первый комментарий');
  assert.equal(trigger.textContent, '1★');
  assert.equal(journalTrigger.textContent, '1★');
  open(journalTrigger, 10, 'Не сохраняем', true);
  assert.equal(move.rating.comment, 'Первый комментарий');
  open(journalTrigger, 10, 'Новый комментарий');
  assert.equal(move.rating.stars, 10);
  assert.equal(move.rating.comment, 'Новый комментарий');
  assert.equal(journalTrigger.textContent, '10★');
  report.clearLatestBot();
  assert.equal(feedback.fieldControls().querySelector('.field-test-feedback'), null);
  assert.equal(logView(match, false, feedback).querySelector('.test-feedback').textContent, '10★');
});

test('reviewer CLI sorts rated moves and emits a position accepted by the puzzle loader', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'gatefall-test-report-'));
  t.after(() => rmSync(folder, { recursive: true }));
  const filename = join(folder, 'report.json');
  const cli = fileURLToPath(new URL('../../tools/report-to-puzzle.mjs', import.meta.url));
  const { report, record } = fixture();
  report.rate(record().index, 9, '');
  report.rate(record().index, 2, 'Ранний пас');
  record();
  writeFileSync(filename, reportJson(report.active));
  const output = (...args) => execFileSync(process.execPath, [cli, filename, ...args], { encoding: 'utf8' });
  assert.match(output(), /^№2 · 2★ · Ранний пас · Пас\n№1 · 9★/);
  const puzzle = JSON.parse(output('2'));
  assert.equal(puzzle.name, 'Пас · 2/10');
  assert.equal(puzzle.description, 'Ранний пас');
  assert.deepEqual(puzzle.expect, {});
  const { state, level } = restoreBotPosition(puzzle);
  assert.equal(level, 2);
  assert.equal(state.turn, 'bot');
  assert.ok(chooseBotTurn(state, level, { random: () => .99, rolloutSamples: 0 }).type);
  assert.equal(spawnSync(process.execPath, [cli, filename, '3']).status, 1);
});
