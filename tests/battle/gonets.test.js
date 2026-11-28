import assert from 'node:assert/strict';
import test from 'node:test';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { availableRows, createCard, findUnit, statusCount } from '../../docs/game/engine/board.js';
import { availableOrders } from '../../docs/game/effects/effects.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';

const pool = FACTIONS.protectorate.pool;
const card = (id, instance = id) => createCard(instance, pool.find((definition) => definition.id === id));
const unit = (id) => createCard(id, { id, name: id, type: 'unit', power: 20 });
const random = () => 0;
const fixture = () => {
  const match = confirmMulligan(createMatch({ decks: { human: [unit('seed').definition], bot: [unit('seed').definition] }, random }));
  match.turn = 'human';
  for (const player of Object.values(match.players)) {
    player.board = { surface: [], orbit: [] };
    player.leader = null;
    player.deck = [];
  }
  match.players.human.hand = [card('gonets'), card('spotter'), card('imperial-golem')];
  match.players.bot.hand = [unit('reserve')];
  return match;
};
const act = (match, type, cardId, row) => applyAction(match, match.turn, {
  type, cardId, row, position: row ? match.players[match.turn].board[row].length : undefined,
}, { random });
const order = (match) => act(match, 'order', 'gonets');
const ready = (match) => availableOrders(match, 'human').some(({ card }) => card.id === 'gonets');

test('Gonets is a 5-power, 11-provision epic light ship and works in both rows', () => {
  const { definition } = card('gonets');
  assert.deepEqual([definition.faction, definition.type, definition.rarity, definition.power, definition.provision],
    ['protectorate', 'unit', 'epic', 5, 11]);
  assert.deepEqual(definition.categories, ['Лёгкий корабль']);
  assert.equal(definition.shipClass, 'Лёгкий корабль');
  assert.equal(definition.order.cooldown, 5);

  for (const row of ['surface', 'orbit']) {
    const match = fixture();
    match.players.human.board.orbit = [card('aggressor'), card('shield-generator')];
    match.players.bot.board.surface = [unit('victim')];
    assert.deepEqual(availableRows(match.players.human, card('gonets')).sort(), ['orbit', 'surface']);
    const next = act(match, 'play', 'gonets', row);
    assert.equal(findUnit(next, 'gonets').row, row);
    assert.equal(findUnit(next, 'victim').card.power, 19);
    assert.ok(next.log.some(({ type, sourceDefinitionId }) => type === 'damage' && sourceDefinitionId === 'aggressor'));
    assert.equal(next.turn, 'human');
    assert.equal(ready(next), false);
    assert.equal(order(next), next);
    const ownTurn = act(act(next, 'end-turn'), 'pass');
    assert.equal(ownTurn.turn, 'human');
    assert.equal(ready(ownTurn), true);
  }
});

test('Gonets cannot use its Order without a playable bronze card', () => {
  const match = fixture();
  match.players.human.board.surface = [card('gonets')];
  match.players.human.hand = [card('imperial-golem')];
  assert.equal(ready(match), false);
  assert.equal(order(match), match);

  match.players.human.hand.push(card('orbital-salvo'));
  assert.equal(ready(match), false);
  assert.equal(order(match), match);
  match.players.bot.board.surface = [unit('victim')];
  assert.equal(ready(match), true);
});

test('Gonets plays a chosen bronze unit with its placement and deploy before drawing', () => {
  const match = fixture();
  match.players.human.board.surface = [match.players.human.hand.shift()];
  match.players.human.hand.push(card('orbital-salvo'));
  match.players.human.deck = [unit('drawn')];
  match.players.bot.board.surface = [unit('victim')];

  const choosing = order(match);
  assert.equal(choosing.pending.pile, 'hand');
  assert.deepEqual(choosing.pending.options, ['spotter', 'orbital-salvo']);
  const placing = act(choosing, 'target', 'spotter');
  assert.equal(placing.pending.kind, 'deck-placement');
  const deploying = act(placing, 'place', undefined, 'orbit');
  assert.equal(findUnit(deploying, 'spotter').row, 'orbit');
  assert.deepEqual(deploying.pending.options, ['victim']);
  assert.equal(deploying.players.human.deck.length, 1);
  const finished = act(deploying, 'target', 'victim');
  assert.equal(statusCount(findUnit(finished, 'victim').card, 'target'), 1);
  assert.ok(finished.log.some(({ type, cardId, from }) => type === 'play' && cardId === 'spotter' && from === 'hand'));
  assert.deepEqual(finished.players.human.hand.map(({ id }) => id), ['imperial-golem', 'orbital-salvo', 'drawn']);
  assert.equal(finished.playedCard, false);
  assert.ok(findUnit(act(finished, 'play', 'drawn', 'surface'), 'drawn'));
});

test('Gonets can play a bronze special after the normal play with an empty deck', () => {
  const match = fixture();
  match.players.human.board.surface = [card('gonets')];
  match.players.human.hand = [card('orbital-salvo'), card('imperial-golem'), unit('normal')];
  match.players.bot.board.surface = [unit('victim')];
  const played = act(match, 'play', 'normal', 'surface');
  assert.equal(played.playedCard, true);
  const choosing = act(order(played), 'target', 'orbital-salvo');
  assert.deepEqual(choosing.pending.options, ['victim']);
  const finished = act(choosing, 'target', 'victim');
  assert.equal(findUnit(finished, 'victim').card.power, 15);
  assert.deepEqual(finished.players.human.discard.map(({ id }) => id), ['orbital-salvo']);
  assert.ok(!finished.log.slice(played.log.length).some(({ type }) => type === 'draw'));
});

test('Gonets waits five full own turns between uses, including across rounds', () => {
  const match = fixture();
  const transport = match.players.human.hand.shift();
  transport.resilient = true;
  match.players.human.board.orbit = [transport];
  match.players.human.hand = [card('infantry'), ...Array.from({ length: 8 }, (_, i) => card('infantry', 'reserve-' + i))];
  const used = act(act(order(match), 'target', 'infantry'), 'place', undefined, 'orbit');
  const usedTurn = used.players.human.turns;
  assert.equal(findUnit(used, 'gonets').card.readyAt, usedTurn + 6);
  assert.equal(ready(used), false);

  const enemyTurn = act(used, 'play', 'reserve-0', 'orbit');
  assert.equal(enemyTurn.turn, 'bot');
  const ownTurn = act(enemyTurn, 'pass');
  assert.equal(ownTurn.players.human.turns, usedTurn + 1);
  const mulligan = act(ownTurn, 'pass');
  assert.equal(mulligan.round, 2);
  assert.equal(findUnit(mulligan, 'gonets').card.readyAt, usedTurn + 6);

  let next = confirmMulligan(mulligan, [], { random });
  if (next.turn === 'bot') next = act(next, 'pass');
  for (let i = 2; i <= 5; i += 1) {
    assert.equal(next.turn, 'human');
    assert.equal(next.players.human.turns, usedTurn + i);
    assert.equal(ready(next), false);
    next = act(next, 'play', 'reserve-' + i, 'surface');
    if (next.turn === 'bot') next = act(next, 'pass');
  }
  assert.equal(next.players.human.turns, usedTurn + 6);
  assert.equal(ready(next), true);
});
