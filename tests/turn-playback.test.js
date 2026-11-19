import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { FACTIONS } from '../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState, motionDuration, playJournal } from '../docs/turn-playback.js';

function card(id, faction, definitionId) {
  return createCard(id, FACTIONS[faction].deck.find(({ id }) => id === definitionId));
}

test('the journal replays a play, armor and spawn at their original positions with immutable snapshots', () => {
  const setup = createMatch({ humanFaction: 'growth', random: () => 0 });
  const before = confirmMulligan(setup, []);
  const human = before.players.human;
  human.board.orbit = [card('left', 'growth', 'vine'), card('right', 'growth', 'vine')];
  human.hand.unshift(card('middle', 'growth', 'cocoon'));
  const next = applyAction(before, 'human', { type: 'play', cardId: 'middle', row: 'orbit', position: 1 });
  const events = next.log.slice(before.log.length);
  const visual = createPlaybackState(before);
  assert.deepEqual(events.map(({ type }) => type), ['play', 'spawn', 'spawn']);
  events.forEach((event) => applyJournalEvent(visual, event));
  assert.deepEqual(visual.players.human.board, next.players.human.board);
  assert.deepEqual(before.players.human.board.orbit.map(({ id }) => id), ['left', 'right']);
  assert.equal(events[0].card.id, 'middle');
  assert.equal(events[1].cards[0].power, 1);
});

test('damage and death are separate frames and damage resolves against the exact card instance', () => {
  const setup = createMatch({ humanFaction: 'protectorate', random: () => 0 });
  let match = confirmMulligan(setup, []);
  match.players.human.hand.unshift(card('shot', 'protectorate', 'orbital-salvo'));
  match.players.bot.board.surface = [card('first', 'growth', 'vine'), card('second', 'growth', 'vine')];
  match = applyAction(match, 'human', { type: 'play', cardId: 'shot' });
  const next = applyAction(match, 'human', { type: 'target', cardId: 'second' });
  const visual = createPlaybackState(match);
  const events = next.log.slice(match.log.length);
  assert.equal(events[0].type, 'damage');
  applyJournalEvent(visual, events[0]);
  assert.deepEqual(visual.players.bot.board.surface.map(({ power }) => power), [2, 0]);
  applyJournalEvent(visual, events[1]);
  assert.deepEqual(visual.players.bot.board.surface.map(({ id }) => id), ['first']);
  assert.equal(events[2].type, 'deathwish');
});

test('the next turn remains blocked until even the final animation finishes', async () => {
  const previous = createMatch({ random: () => 0 });
  const flight = Promise.withResolvers();
  const effects = Promise.withResolvers();
  const marks = [];
  const steps = [{ type: 'play' }, { type: 'deathwish' }];
  const sequence = playJournal(previous, steps, async ({ type }, commit) => {
    commit();
    marks.push(type);
    await (type === 'play' ? flight.promise : effects.promise);
  }).then(() => marks.push('next turn'));
  assert.deepEqual(marks, ['play']);
  flight.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(marks, ['play', 'deathwish']);
  effects.resolve();
  await sequence;
  assert.deepEqual(marks, ['play', 'deathwish', 'next turn']);
});

test('system animation mode honors reduced motion, with an explicit in-game override', () => {
  assert.equal(motionDuration('system', false), 320);
  assert.equal(motionDuration('system', true), 0);
  assert.equal(motionDuration('normal', false), 320);
  assert.equal(motionDuration('fast', false), 200);
  assert.equal(motionDuration('normal', true), 320);
  assert.equal(motionDuration('fast', true), 200);
});
