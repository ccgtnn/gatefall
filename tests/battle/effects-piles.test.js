import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../../docs/game/board.js';
import { pendingEffectSource } from '../../docs/game/effect-queries.js';
import { applyAction, playableCards, ROW_LIMIT } from '../../docs/game/match.js';
import { board, events, fixture, hand, play, target, unit } from '../helpers/effects-fixture.js';

test('Reinforcements offers random eligible physical copies, then plays one in the chosen position with deploy', () => {
  let match = fixture();
  hand(match, unit('offer', 'reinforcements'));
  const original = [unit('a', 'assault'), unit('b', 'warden'), unit('c', 'infantry'), unit('d', 'standard'),
    unit('effect', 'orbital-salvo'), unit('gold', 'bastion')];
  match.players.human.deck = original;
  board(match, 'human', 'surface', unit('left', 'frigate'), unit('right', 'frigate'));
  match = applyAction(match, 'human', { type: 'play', cardId: 'offer' }, { random: () => .6 });
  assert.equal(match.pending.kind, 'deck-card');
  assert.deepEqual(match.pending.options, ['c', 'b', 'd']);
  assert.strictEqual(target(match, 'a'), match);
  assert.strictEqual(target(match, 'c', 'bot'), match);
  match = target(match, 'c');
  assert.equal(match.pending.kind, 'deck-placement');
  const place = (position) => applyAction(match, 'human', { type: 'place', row: 'surface', position });
  assert.strictEqual(place(3), match);
  const next = place(1);
  assert.deepEqual(next.players.human.board.surface.map(({ id, armor }) => [id, armor]), [['left', 2], ['c', 2], ['right', 2]]);
  assert.deepEqual(next.players.human.deck.map(({ id }) => id), ['a', 'b', 'd', 'effect', 'gold']);
  assert.deepEqual(next.players.human.discard.map(({ id }) => id), ['offer']);
  assert.deepEqual(events(next, 'play').map(({ from }) => from), [undefined, 'deck']);
});

test('Reinforcements offers all eligible units when fewer than three and is unavailable with no room or units', () => {
  const match = fixture();
  hand(match, unit('offer', 'reinforcements'));
  match.players.human.deck = [unit('captain', 'bastion')];
  assert.ok(!playableCards(match, 'human').some(({ id }) => id === 'offer'));
  match.players.human.deck.push(unit('a', 'warden'), unit('b', 'warden'));
  assert.deepEqual(play(match, 'offer').pending.options, ['a', 'b']);
  for (const row of ['orbit', 'surface']) {
    match.players.human.board[row] = Array.from({ length: ROW_LIMIT }, (_, index) => unit(row + index, 'frigate'));
  }
  assert.ok(!playableCards(match, 'human').some(({ id }) => id === 'offer'));
});

test('Swarm Call can play a four-power Growth bronze and spawns beside a unit after its deploy effect', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('call', 'swarm-call'));
  const cocoon = unit('cocoon', 'cocoon');
  cocoon.power = 8;
  match.players.human.deck = [unit('foreign', 'infantry'), unit('strong', 'predator'), unit('gold', 'nest'),
    unit('artifact', 'incubator'), cocoon];
  board(match, 'human', 'surface', unit('neighbor', 'frigate'));
  const strong = play(match, 'call');
  assert.equal(strong.pending.kind, 'deck-placement');
  assert.equal(strong.pending.cardId, 'strong');
  match = applyAction(match, 'human', { type: 'play', cardId: 'call' }, { random: () => .99 });
  assert.equal(match.pending.cardId, 'cocoon');
  match = applyAction(match, 'human', { type: 'place', row: 'surface', position: 1 });
  assert.deepEqual(match.players.human.board.surface.map(({ definition }) => definition.id),
    ['frigate', 'larva', 'cocoon', 'larva', 'larva']);
  assert.deepEqual(events(match, 'spawn').map(({ position }) => position), [1, 3, 3]);
});

test('pending effect source prefers the queued discard and falls back to the previous hand', () => {
  const queued = createCard('spell', { id: 'queued', name: 'Queued' });
  const held = createCard('spell', { id: 'held', name: 'Held' });
  const match = { pending: { side: 'human', job: { sourceId: 'spell' } }, effects: [{ discard: queued }] };
  const before = { players: { human: { hand: [held], discard: [], deck: [] } } };
  assert.deepEqual(pendingEffectSource(match, { before, cardId: 'other' }), { sourceId: 'spell', card: queued });
  const waiting = { ...match, pending: { side: 'human', job: {} }, effects: [] };
  assert.deepEqual(pendingEffectSource(waiting, { before, cardId: 'spell' }), { sourceId: 'spell', card: held });
  assert.equal(pendingEffectSource({ ...match, pending: null }), undefined);
});
