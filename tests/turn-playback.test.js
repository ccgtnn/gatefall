import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { FACTIONS } from '../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState, motionDuration, playJournal } from '../docs/ui/turn-playback.js';

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
  assert.equal(events[0].sourceDefinitionId, 'orbital-salvo');
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

test('round result can show the final board before cleanup and before the next round is presented', async () => {
  const previous = confirmMulligan(createMatch({ random: () => 0 }), []);
  previous.players.human.board.orbit = [card('ally', 'protectorate', 'infantry')];
  const banner = Promise.withResolvers();
  const seen = [];
  const events = [
    { type: 'boost', side: 'human', cardId: 'ally', power: 5 },
    { type: 'round-end', scores: { human: 5, bot: 0 }, winner: 'human' },
    { type: 'draw', side: 'human', count: 3 },
  ];
  const sequence = playJournal(previous, events, async ({ type }, commit, state) => {
    seen.push(type);
    if (type === 'round-end') {
      assert.equal(state.players.human.board.orbit[0].power, 5);
      assert.equal(state.log.at(-1).type, 'boost');
      await banner.promise;
    }
    const updated = commit();
    if (type === 'draw') assert.deepEqual(updated.players.human.board.orbit, []);
  });
  await Promise.resolve();
  assert.deepEqual(seen, ['boost', 'round-end']);
  banner.resolve();
  await sequence;
  assert.deepEqual(seen, ['boost', 'round-end', 'draw']);
  assert.equal(previous.players.human.board.orbit.length, 1);
});

test('system motion follows the preference and explicit speeds override it', () => {
  assert.equal(motionDuration('system', false), 320);
  assert.equal(motionDuration('system', true), 0);
  assert.equal(motionDuration('normal', false), 320);
  assert.equal(motionDuration('fast', false), 200);
  assert.equal(motionDuration('normal', true), 320);
  assert.equal(motionDuration('fast', true), 200);
});

test('deck plays keep the hand intact and grouped victims disappear together before individual deaths', () => {
  const before = confirmMulligan(createMatch({ random: () => 0 }), []);
  const human = before.players.human;
  const lord = card('lord', 'growth', 'broodlord');
  human.deck.push(lord);
  const visual = createPlaybackState(before);
  applyJournalEvent(visual, { type: 'play', side: 'human', row: 'orbit', cardId: 'lord',
    position: 0, card: lord, from: 'deck' });
  assert.deepEqual(visual.players.human.hand, human.hand);
  assert.ok(!visual.players.human.deck.some(({ id }) => id === 'lord'));
  assert.ok(human.deck.some(({ id }) => id === 'lord'));
  applyJournalEvent(visual, { type: 'consume-group', side: 'human', cardIds: ['a', 'b'], eaterId: 'lord' });
  assert.deepEqual([...visual.hiddenDuringPlayback], ['a', 'b']);
  applyJournalEvent(visual, { type: 'death', side: 'human', cardId: 'a' });
  assert.deepEqual([...visual.hiddenDuringPlayback], ['b']);
});

test('infection playback updates the badge and strength without changing the previous match', () => {
  const before = confirmMulligan(createMatch({ random: () => 0 }), []);
  const unit = card('target', 'protectorate', 'assault');
  unit.statuses = { infection: 1 };
  before.players.human.board.orbit = [unit];
  const visible = createPlaybackState(before);
  applyJournalEvent(visible, { type: 'status', status: 'infection', side: 'human',
    cardId: 'target', tick: true, count: 0, power: 4 });
  assert.equal(visible.players.human.board.orbit[0].power, 4);
  assert.equal(visible.players.human.board.orbit[0].statuses.infection, undefined);
  assert.equal(unit.statuses.infection, 1);
  assert.equal(unit.power, 5);
});

test('playback moves a revived card from discard and applies a counter draw exactly once', () => {
  const before = confirmMulligan(createMatch({ random: () => 0 }), []);
  const recruit = card('recruit', 'protectorate', 'assault');
  const drawn = before.players.human.deck[0];
  before.players.human.discard = [recruit];
  const visual = createPlaybackState(before);
  applyJournalEvent(visual, { type: 'play', side: 'human', cardId: recruit.id, card: recruit,
    from: 'discard', row: 'orbit', position: 0 });
  applyJournalEvent(visual, { type: 'counter', side: 'human', cardId: recruit.id, remaining: 0 });
  applyJournalEvent(visual, { type: 'draw', side: 'human', count: 1, cards: [drawn] });
  assert.deepEqual(visual.players.human.discard, []);
  assert.equal(before.players.human.discard.length, 1);
  assert.equal(visual.players.human.board.orbit[0].counter, 0);
  assert.equal(visual.players.human.hand.at(-1).id, drawn.id);
  assert.equal(visual.players.human.deck.some(({ id }) => id === drawn.id), false);
});
