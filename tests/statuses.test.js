import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, createCard, findUnit, removeUnit, statusCount } from '../docs/game/board.js';
import { infectionGain } from '../docs/game/bot-effect-value.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';

const unit = (id, power = 4) => createCard(id, { id, name: id, type: 'unit', power, armor: 3 });

function fixture() {
  const match = confirmMulligan(createMatch({ random: () => 0 }), []);
  match.players.human.board = { surface: [unit('infected')], orbit: [] };
  match.players.bot.board = { surface: [unit('enemy')], orbit: [] };
  match.players.bot.passed = true;
  return match;
}

test('status mutations go through the registry and armor keeps its previous depletion contract', () => {
  const match = fixture();
  const target = findUnit(match, 'infected');
  assert.equal(applyStatus(match, target, 'armor', -5), 3);
  assert.equal(statusCount(target.card, 'armor'), 0);
  applyStatus(match, target, 'doomed', 1);
  removeUnit(match, target, 'damage');
  assert.ok(match.players.human.exile.includes(target.card));
});

test('infection adds duration, ticks only at owner end and expires without consuming armor', () => {
  let match = fixture();
  applyStatus(match, findUnit(match, 'infected'), 'infection', 2);
  applyStatus(match, findUnit(match, 'infected'), 'infection', 1);
  assert.equal(statusCount(findUnit(match, 'infected').card, 'infection'), 3);
  applyStatus(match, findUnit(match, 'enemy'), 'infection', 3);
  for (const remaining of [2, 1, 0]) {
    match.playedCard = true;
    match = applyAction(match, 'human', { type: 'end-turn' });
    const { card } = findUnit(match, 'infected');
    assert.equal(statusCount(card, 'infection'), remaining);
    assert.equal(card.power, remaining + 1);
    assert.equal(card.armor, 3);
    assert.equal(findUnit(match, 'enemy').card.power, 4);
  }
});

test('lethal infection emits death and triggers deathwish on a pass', () => {
  const match = fixture();
  const { card } = findUnit(match, 'infected');
  card.power = 1;
  card.definition = { ...card.definition, deathwish: { steps: [] } };
  match.players.bot.passed = false;
  applyStatus(match, findUnit(match, 'infected'), 'infection', 3);
  const next = applyAction(match, 'human', { type: 'pass' });
  assert.equal(findUnit(next, 'infected'), undefined);
  assert.deepEqual(next.log.slice(-4).map(({ type }) => type), ['pass', 'status', 'death', 'deathwish']);
  assert.equal(next.players.human.discard.find(({ id }) => id === 'infected').armor, 3);
});

test('a shield blocks one infection tick, leaving armor intact and subsequent ticks active', () => {
  let match = fixture();
  applyStatus(match, findUnit(match, 'infected'), 'shield', 1);
  const { card } = findUnit(match, 'infected');
  assert.equal(infectionGain(card, 1), 0);
  assert.equal(infectionGain(card, 2), 1);

  applyStatus(match, findUnit(match, 'infected'), 'infection', 2);
  for (const remaining of [1, 0]) {
    match.playedCard = true;
    match = applyAction(match, 'human', { type: 'end-turn' });
    const { card: infected } = findUnit(match, 'infected');
    assert.equal(statusCount(infected, 'shield'), 0);
    assert.equal(statusCount(infected, 'infection'), remaining);
    assert.equal(infected.power, 3 + remaining);
    assert.equal(infected.armor, 3);
  }
  assert.deepEqual(match.log.filter(({ tick }) => tick).map(({ blocked, power }) => [blocked, power]),
    [[true, 4], [false, 3]]);
});
