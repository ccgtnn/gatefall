import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, cleanse, findUnit, heal } from '../../docs/game/engine/board.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { effectOperations } from '../../docs/game/effects/effect-operations.js';
import { chooseSubset } from '../../docs/game/effects/effect-queries.js';
import { applyAction, canEndTurn, canPlayCard } from '../../docs/game/engine/match.js';
import { plain, position, standard } from '../helpers/bot-strategy.js';

const card = (id, faction) => standard(id, FACTIONS[faction].pool.find((def) => def.id === id));
const act = (match, side, action) => applyAction(match, side, action, { random: () => 0 });
const play = (match, id, side = 'human') => act(match, side, { type: 'play', cardId: id, row: 'orbit', position: 0 });
const end = { type: 'end-turn' };
const marker = { scope: 'source' };

test('a passed player ticks Infection, Rot, counters and growth once per opposing turn', () => {
  let match = position();
  const { bot, human } = match.players;
  const infected = plain('infected', 12);
  infected.statuses = { infection: 4 };
  bot.board.orbit = [infected, card('stolen-goods-fence', 'captains'), card('boil', 'growth')];
  bot.board.surface = [plain('rot-target', 10)];
  bot.rowEffects.surface = { type: 'rot', remaining: 3, attacker: 'human' };
  human.hand = [plain('first', 2), plain('second', 2), plain('later', 2)];
  match = act(match, 'bot', { type: 'pass' });
  const before = match;
  match.players.bot.board.surface.push(standard('order', {
    id: 'order', power: 1, order: { steps: [{ action: 'boost', target: marker, amount: 1 }] },
  }));
  assert.strictEqual(act(match, 'bot', { type: 'order', cardId: 'order' }), match);
  match = play(play(match, 'first'), 'second');
  assert.equal(match.turn, 'human');
  assert.equal(match.players.bot.turns, before.players.bot.turns + 2);
  assert.equal(match.players.bot.rowEffects.surface.remaining, 1);
  assert.equal(findUnit(match, 'infected').card.statuses.infection, findUnit(before, 'infected').card.statuses.infection - 2);
  assert.equal(findUnit(match, 'stolen-goods-fence').card.counter, findUnit(before, 'stolen-goods-fence').card.counter - 2);
  assert.equal(findUnit(match, 'boil').card.power, findUnit(before, 'boil').card.power + 2);
  assert.equal(match.log.slice(before.log.length).filter(({ type, cardId }) => type === 'boost' && cardId === 'boil').length, 2);
});

test('empty turn resolves mandatory effects in order without taking a passed player action', () => {
  let match = position();
  const { bot, human } = match.players;
  const growth = standard('growth', { id: 'growth', power: 2, startTurnGrowth: 1,
    endTurn: { steps: [
      { action: 'select-row', filter: 'space', ref: 'row' },
      { action: 'spawn', rowRef: 'row', card: plain('spawned', 1).definition, amount: 1 },
    ] } });
  bot.board.orbit = [growth];
  const active = standard('active', { id: 'active', power: 2,
    endTurn: { steps: [{ action: 'boost', target: marker, amount: 1 }] } });
  human.hand = [active, plain('later', 2)];
  match = act(match, 'bot', { type: 'pass' });
  assert.equal(match.pending, null);
  const before = match.log.length;
  match = play(match, 'active');
  assert.equal(match.pending, null);
  assert.equal(match.turn, 'human');
  const effects = match.log.slice(before).filter(({ type }) => ['boost', 'base-power', 'spawn'].includes(type));
  assert.deepEqual(effects.map(({ type, side }) => [type, side]), [
    ['boost', 'human'], ['base-power', 'bot'], ['spawn', 'bot'],
  ]);
});

function orderFixture() {
  const match = position();
  const { bot } = match.players;
  bot.hand = [];
  bot.board.surface = ['one', 'two'].map((id) => standard(id, {
    id, power: 1, order: { steps: [{ action: 'boost', target: marker, amount: 1 }] },
  }));
  return match;
}

test('an empty hand can use multiple orders before ending the turn', () => {
  let match = orderFixture();
  for (const cardId of ['one', 'two']) {
    match = act(match, 'bot', { type: 'order', cardId });
    assert.equal(match.turn, 'bot');
    assert.equal(findUnit(match, cardId).card.power, 2);
  }
  assert.ok(canEndTurn(match, 'bot'));
});

test('ending a turn with an empty hand after an order passes automatically', () => {
  const match = orderFixture();
  match.players.bot.board.surface.pop();
  const ordered = act(match, 'bot', { type: 'order', cardId: 'one' });
  const next = act(ordered, 'bot', end);
  assert.equal(next.players.bot.passed, true);
  assert.equal(next.log.filter(({ type, side }) => type === 'pass' && side === 'bot').length, 1);
});

test('a doomed played effect goes into exile', () => {
  const match = position();
  match.turn = 'human';
  const effect = standard('doomed-spell', { id: 'doomed-spell', type: 'effect', doomed: true,
    deploy: { steps: [{ action: 'coins', amount: 1 }] } });
  match.players.human.hand = [effect, plain('later', 2)];
  const next = play(match, effect.id);
  assert.deepEqual(next.players.human.exile.map(({ id }) => id), [effect.id]);
  assert.equal(next.players.human.discard.length, 0);
});

test('sampling targets keeps the input array in order', () => {
  const cards = [plain('a', 1), plain('b', 2), plain('c', 3)];
  assert.deepEqual(chooseSubset(cards, 2, () => .5), ['b', 'c']);
  assert.deepEqual(cards.map(({ id }) => id), ['a', 'b', 'c']);
});

test('create-play needs a positive offer and at least one playable candidate', () => {
  const match = position();
  const revelation = card('sleeper-revelation', 'choir');
  const dream = card('alien-dream', 'choir');
  match.players.bot.startingCategories = { 'Псионика': 2 };
  assert.equal(canPlayCard(match, 'bot', revelation), false);
  match.players.bot.startingCategories['Псионика'] = 3;
  assert.equal(canPlayCard(match, 'bot', revelation), true);
  match.players.human.factionId = undefined;
  assert.equal(canPlayCard(match, 'bot', dream), false);
  match.players.human.factionId = 'protectorate';
  assert.equal(canPlayCard(match, 'bot', dream), true);
  const unitOnly = { ...dream, definition: { ...dream.definition, deploy: { steps: [
    { ...dream.definition.deploy.steps[0], type: 'unit' },
  ] } } };
  for (const row of ['orbit', 'surface']) {
    match.players.bot.board[row] = Array.from({ length: 9 }, (_, i) => plain(row + i, 1));
  }
  assert.equal(canPlayCard(match, 'bot', unitOnly), false);
});

test('death spawns journal the actual position when the row has shortened', () => {
  const match = position();
  match.players.bot.board.orbit = [plain('remaining', 1)];
  effectOperations.spawn(match, { side: 'bot', row: 'orbit', position: 4, refs: {} }, {
    action: 'spawn', row: 'death', position: 'death', amount: 1, card: plain('spawned', 1).definition,
  });
  assert.equal(match.log.find(({ type }) => type === 'spawn').position, 1);
});

test('healing a locked pilot does not subtract the frozen aura again on cleanse', () => {
  const match = position();
  const pilot = card('scrapped-pilot', 'captains');
  const ship = card('black-hound', 'captains');
  match.players.bot.board.orbit = [pilot, ship];
  pilot.shipRowBonus = 3;
  pilot.power += 3;
  const unit = findUnit(match, pilot.id);
  applyStatus(match, unit, 'lock', 1);
  heal(match, unit);
  cleanse(match, unit);
  assert.equal(pilot.power, pilot.basePower + 3);
});
