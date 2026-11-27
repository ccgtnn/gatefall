import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { createCard, damage, findUnit, restoreCard, transformUnit } from '../../docs/game/board.js';
import { LARVA } from '../../docs/game/cards.js';
import { availableOrders, runEffect } from '../../docs/game/effects.js';
import { applyAction, ROW_LIMIT } from '../../docs/game/match.js';
import { drain } from '../helpers/battle-helpers.js';
import { basic, board, events, fixture, hand, play, target, unit } from '../helpers/effects-fixture.js';

test('leaders spend configurable charges once per turn without ending it', () => {
  let match = fixture({ charges: 2 });
  board(match, 'human', 'surface', unit('left', 'shieldbearer'), unit('center', 'infantry'), unit('right', 'warden'));
  match = target(applyAction(match, 'human', { type: 'leader' }), 'center');
  assert.strictEqual(applyAction(match, 'human', { type: 'leader' }), match);
  assert.equal(match.players.human.leader.charges, 1);
  hand(match, createCard('plain', basic));
  match.players.bot.passed = true;
  match = play(match, 'plain', 0, 'human', 'orbit');
  match = target(applyAction(match, 'human', { type: 'leader' }), 'center');
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [8, 8, 9]);
  assert.equal(match.turn, 'human');
  assert.equal(match.players.human.leader.charges, 0);
  assert.strictEqual(applyAction(match, 'human', { type: 'leader' }), match);

  match = fixture({ faction: 'growth', charges: 1 });
  board(match, 'human', 'surface', unit('left', 'predator'), unit('cocoon', 'cocoon', { power: 3 }), unit('right', 'colossus'));
  match = target(applyAction(match, 'human', { type: 'leader' }), 'cocoon');
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [4, 3, 1, 1, 5]);
  assert.equal(match.players.human.leader.charges, 2);
  assert.equal(match.turn, 'human');
});

test('order costs 2 armor and recharges after two following owner turns', () => {
  let match = fixture();
  hand(match, ...Array.from({ length: 4 }, (_, i) => createCard(`plain-${i}`, basic)));
  board(match, 'human', 'surface', unit('commander', 'commander'), unit('payer', 'bastion'));
  board(match, 'bot', 'surface', unit('enemy', 'warden'));
  const order = { type: 'order', cardId: 'commander' };
  const issue = (match) => applyAction(match, 'human', order);

  match = target(target(issue(match), 'payer'), 'enemy');
  assert.equal(match.turn, 'human');
  assert.equal(match.players.human.board.surface[1].armor, 4);
  assert.equal(match.players.bot.board.surface[0].armor, 0);
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-0', 2);
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-1', 3);
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-2', 4);
  assert.ok(issue(match).pending);
});

test('the bot targets lethal damage through armor before a stronger opponent', () => {
  const match = fixture();
  board(match, 'human', 'surface',
    unit('shield', 'shieldbearer'),
    unit('killable', 'infantry', { armor: 0 }),
    unit('strong', 'bastion', { power: 110 }));
  match.pending = { side: 'bot', kind: 'damage', amount: 3, options: ['shield', 'killable', 'strong'] };
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'killable' });
  match.pending.options = ['shield', 'strong'];
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'strong' });
});

test('vine infects up to three distinct enemies across both rows without requesting a target', () => {
  for (const count of [2, 4]) {
    let match = fixture({ faction: 'growth' });
    hand(match, unit('ravager', 'ravager'));
    const vine = unit('vine', 'vine');
    vine.growth = 2;
    board(match, 'human', 'orbit', vine);
    board(match, 'bot', 'orbit', unit('orbit', 'warden'));
    board(match, 'bot', 'surface', ...Array.from({ length: count - 1 }, (_, index) => unit('enemy-' + index, 'warden')));
    match = target(target(play(match, 'ravager'), 'vine'), 'orbit');
    assert.equal(match.pending, null);
    const infected = events(match, 'status').filter(({ status }) => status === 'infection').map(({ cardId }) => cardId);
    assert.equal(infected.length, Math.min(3, count));
    assert.equal(new Set(infected).size, infected.length);
    assert.ok(infected.includes('orbit'));
    assert.deepEqual(events(match, 'damage').map(({ amount }) => amount), [2]);
  }
});

test('orbital salvo hits either row, ignores artifacts, and goes directly to the discard', () => {
  for (const [row, damage] of [['orbit', 3], ['surface', 5]]) {
    let match = fixture();
    hand(match, unit('salvo', 'orbital-salvo'));
    board(match, 'bot', row, unit('enemy', 'warden', { armor: 0, power: 6 }), unit('artifact', 'incubator'));
    for (const line of ['orbit', 'surface']) {
      board(match, 'human', line, ...Array.from({ length: ROW_LIMIT }, (_, i) =>
        unit(`${line}-${i}`, 'shield-generator')));
    }

    match = play(match, 'salvo');
    assert.deepEqual(match.pending.options, ['enemy']);
    assert.equal(match.players.human.discard.length, 0);
    match = target(match, 'enemy');
    assert.equal(events(match, 'damage').at(-1).amount, damage);
    assert.equal(match.players.bot.board[row][0].power, 6 - damage);
    assert.equal(match.players.human.discard[0].id, 'salvo');
    assert.ok(Object.values(match.players.human.board).every((row) => row.length === ROW_LIMIT));
  }
});

test('the bot prefers a Surface target for Orbital Salvo and casts Effects without a board position', () => {
  let match = fixture({ faction: 'growth' });
  match.turn = 'bot';
  match.round = 3;
  match.players.bot.lives = match.players.human.lives = 1;
  match.players.bot.hand = [unit('salvo', 'orbital-salvo')];
  match.players.bot.leader = null;
  match.players.human.passed = true;
  board(match, 'bot', 'orbit', createCard('lead', { ...basic, power: 5 }));
  board(match, 'human', 'orbit', unit('weak', 'spore-sac'));
  board(match, 'human', 'surface', unit('strong', 'colossus', { power: 7 }));
  assert.deepEqual(chooseBotTurn(match), { type: 'play', cardId: 'salvo' });
  match = applyAction(match, 'bot', chooseBotTurn(match));
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'strong' });
});

test('a new Order can declare a condition and work without the Commander’s armor or enemy requirements', () => {
  let match = fixture();
  const self = { scope: 'source' };
  const ability = { cooldown: 1, when: { targets: { ...self, powerAtLeast: 5 } },
    steps: [{ action: 'boost', target: self, amount: 3 }] };
  board(match, 'human', 'surface', createCard('new-order', { ...basic, order: ability }));
  const order = { type: 'order', cardId: 'new-order' };
  assert.strictEqual(applyAction(match, 'human', order), match);
  match.players.human.board.surface[0].power = 5;
  match = applyAction(match, 'human', order);
  assert.equal(match.players.human.board.surface[0].power, 8);
  assert.equal(match.turn, 'human');
});

test('the Shield Generator spends one charge per turn, then stays on the field', () => {
  let match = fixture();
  hand(match, unit('generator', 'shield-generator'), unit('spare-two', 'frigate'), unit('spare-three', 'frigate'));
  board(match, 'human', 'surface', unit('ally', 'frigate'));
  board(match, 'bot', 'surface', unit('enemy', 'frigate'));
  const order = { type: 'order', cardId: 'generator' };
  match = play(match, 'generator', 1);
  assert.equal(findUnit(match, 'generator').card.orderCharges, 3);
  assert.equal(match.turn, 'bot');
  assert.strictEqual(applyAction(match, 'human', order), match);
  match = applyAction(match, 'bot', { type: 'pass' });
  for (const [charge, armor] of [[2, 2], [1, 4], [0, 6]]) {
    match = applyAction(match, 'human', order);
    assert.ok(match.pending.options.includes('ally'));
    assert.ok(!match.pending.options.includes('generator') && !match.pending.options.includes('enemy'));
    match = target(match, 'ally');
    const { card } = findUnit(match, 'generator');
    assert.equal(card.orderCharges, charge);
    assert.equal(restoreCard(card).orderCharges, charge);
    assert.equal(findUnit(match, 'ally').card.armor, armor);
    assert.strictEqual(applyAction(match, 'human', order), match);
    if (charge > 0) {
      runEffect(match, { side: 'human', sourceId: card.id, ability: {
        steps: [{ action: 'ready-order', target: { scope: 'source' } }],
      } }, () => 0);
      assert.strictEqual(applyAction(match, 'human', order), match);
      drain(match, () => 0);
      match = play(match, charge === 2 ? 'spare-two' : 'spare-three', 0);
    }
  }
  assert.deepEqual(events(match, 'order').map(({ orderCharges }) => orderCharges), [2, 1, 0]);
  assert.ok(!availableOrders(match, 'human').length);
});

test('Shield Overload spends only the selected armor and scatters independent hits among surviving units', () => {
  let match = fixture();
  hand(match, unit('overload', 'shield-overload'));
  board(match, 'human', 'orbit', unit('reserve', 'shieldbearer'));
  board(match, 'human', 'surface', unit('one', 'shieldbearer'), unit('two', 'shieldbearer'));
  board(match, 'bot', 'surface', unit('fragile', 'frigate', { power: 1 }), unit('shield', 'shieldbearer'), unit('artifact', 'incubator'));
  match = play(match, 'overload');
  assert.deepEqual(match.pending.options, ['orbit', 'surface']);
  board(match, 'bot', 'orbit', unit('untouched', 'warden'));
  match = target(match, 'surface');
  assert.equal(match.pending.kind, 'enemy-row');
  assert.equal(match.pending.amount, 4);
  assert.deepEqual(match.pending.options, ['orbit', 'surface']);
  assert.equal(events(match, 'damage').length, 0);
  assert.equal(match.players.human.board.orbit[0].armor, 2);
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [0, 0]);
  match = target(match, 'surface');
  assert.equal(match.players.bot.board.orbit[0].armor, 3);
  assert.deepEqual(events(match, 'damage').map(({ cardId, amount, scattered }) => [cardId, amount, scattered]),
    [['fragile', 1, true], ['shield', 1, true], ['shield', 1, true], ['shield', 1, true]]);
  assert.equal(match.players.bot.board.surface[0].power, 2);
});

test('Acid Gland infects a single strongest enemy through armor and resolves a tie randomly', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('scavenger', 'scavenger'));
  board(match, 'human', 'surface', unit('gland', 'acid-gland'));
  board(match, 'bot', 'orbit', unit('small', 'infantry'), unit('first', 'warden'));
  board(match, 'bot', 'surface', unit('second', 'warden'));
  match = play(match, 'scavenger', 1);
  assert.equal(events(match, 'consume').length, 0);
  assert.deepEqual(availableOrders(match, 'human').map(({ card }) => card.id), ['scavenger']);
  const order = { type: 'order', cardId: 'scavenger' };
  const readyAt = match.players.human.turns + 3;
  match = applyAction(match, 'human', order);
  assert.deepEqual(match.pending.options, ['gland']);
  match = applyAction(match, 'human', { type: 'target', cardId: 'gland' }, { random: () => .99 });
  assert.equal(match.players.human.board.surface[0].readyAt, readyAt);
  assert.deepEqual(events(match, 'status').map(({ cardId, count }) => [cardId, count]), [['second', 4]]);
  assert.equal(match.players.bot.board.surface[0].armor, 3);
  assert.equal(match.players.bot.board.surface[0].power, 5);
  assert.equal(match.turn, 'bot');
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.equal(match.players.bot.board.surface[0].armor, 3);
  assert.equal(match.players.bot.board.surface[0].power, 4);
  assert.equal(match.players.bot.board.surface[0].statuses.infection, 3);
});

test('Spitter infects on deployment and its reusable Order bypasses armor when infection ticks', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('spitter', 'spitter'), ...Array.from({ length: 4 }, (_, i) => unit('plain-' + i, 'frigate')));
  board(match, 'human', 'orbit', createCard('larva', LARVA));
  board(match, 'bot', 'orbit', unit('first', 'warden'), unit('second', 'warden'));
  match = target(target(play(match, 'spitter'), 'larva'), 'first');
  assert.equal(match.players.human.board.surface[0].power, 4);
  assert.equal(match.players.human.exile[0].id, 'larva');
  assert.equal(match.players.bot.board.orbit[0].statuses.infection, 3);
  assert.equal(events(match, 'damage').length, 0);
  assert.equal(match.turn, 'bot');
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.equal(match.players.bot.board.orbit[0].power, 4);
  assert.equal(match.players.bot.board.orbit[0].armor, 3);

  const order = { type: 'order', cardId: 'spitter' };
  match = target(applyAction(match, 'human', order), 'second');
  assert.equal(match.players.bot.board.orbit[1].statuses.infection, 3);
  assert.equal(match.players.bot.board.orbit[1].power, 5);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(applyAction(match, 'human', order), match);
    match = play(match, 'plain-' + i, i + 1);
  }
  assert.ok(applyAction(match, 'human', order).pending);
});

test('a transformed unit gets normal order delay even if it has Zeal', () => {
  for (const zeal of [false, true]) {
    const match = fixture();
    const player = match.players.human;
    player.turns = 4;
    board(match, 'human', 'surface', unit('changed', 'frigate'));
    const order = { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 1 }] };
    transformUnit(match, findUnit(match, 'changed'), { ...basic, zeal, order });
    assert.equal(findUnit(match, 'changed').card.readyAt, 5);
    assert.equal(availableOrders(match, 'human').length, 0);
    player.turns += 1;
    assert.equal(availableOrders(match, 'human').length, 1);
  }
});

test('measured damage counts lost power and runs Slay only on a lethal hit', () => {
  for (const [amount, lost, kills] of [[2, 0, false], [3, 1, false], [6, 4, true]]) {
    const match = fixture();
    board(match, 'human', 'surface', unit('striker', 'frigate'));
    board(match, 'bot', 'surface', unit('defender', 'frigate', { armor: 2 }));
    match.effects.push({ side: 'human', sourceId: 'striker', ability: { steps: [
      { action: 'damage', target: { scope: 'enemy' }, amount, measureDamage: true, save: 'wounds',
        slay: { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 9 }] } },
      { action: 'boost', target: { scope: 'source' }, amount: { result: 'wounds' } },
    ] } });
    drain(match, () => 0);
    assert.equal(findUnit(match, 'defender') === undefined, kills);
    assert.equal(findUnit(match, 'striker').card.power, 4 + lost + (kills ? 9 : 0));
  }
});

test('grouped consumption without a live receiver leaves its victims untouched', () => {
  const match = fixture();
  board(match, 'human', 'surface', unit('survivor', 'frigate'));
  match.effects.push({ side: 'human', sourceId: 'dead-consumer', ability: { steps: [
    { action: 'consume', target: { scope: 'ally' }, receiver: { scope: 'source' }, grouped: true },
  ] } });
  drain(match, () => 0);
  assert.ok(findUnit(match, 'survivor'));
  assert.deepEqual(events(match, 'consume-group'), []);
});

test('countdown effects identify their source card in the journal', () => {
  const match = fixture();
  board(match, 'human', 'surface', unit('countdown', 'frigate', {
    counter: { amount: 1, effect: { steps: [{ action: 'boost', target: { scope: 'source' }, amount: 1 }] } },
  }));
  match.effects.push({ side: 'human', sourceId: 'countdown', ability: { steps: [
    { action: 'counter', target: { scope: 'source' } },
  ] } });
  drain(match, () => 0);
  assert.equal(events(match, 'boost')[0].sourceDefinitionId, 'frigate');
});

test('spawning with all rows and overflow fills orbit and then surface', () => {
  const match = fixture();
  board(match, 'human', 'orbit', ...Array.from({ length: ROW_LIMIT - 1 }, (_, i) => unit('filler-' + i, 'frigate')));
  match.effects.push({ side: 'human', ability: { steps: [
    { action: 'spawn', card: LARVA, row: 'all', overflow: true, amount: 2 },
  ] } });
  drain(match, () => 0);
  assert.deepEqual(events(match, 'spawn').map(({ row, count }) => [row, count]), [['orbit', 1], ['surface', 1]]);
});
