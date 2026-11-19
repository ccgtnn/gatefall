import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotTurn } from '../docs/game/bot.js';
import { createCard } from '../docs/game/board.js';
import { FACTIONS, LARVA, ROWS } from '../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch, playableCards, ROW_LIMIT } from '../docs/game/match.js';

const definitions = new Map(Object.values(FACTIONS).flatMap(({ deck }) => deck.map((card) => [card.id, card])));
const basic = { id: 'basic', name: 'Обычная карта', row: 'surface', power: 4 };

function unit(id, definitionId, overrides = {}) {
  return createCard(id, { ...definitions.get(definitionId), ...overrides });
}

function fixture({ faction = 'protectorate', charges = 0 } = {}) {
  const match = createMatch({ humanFaction: faction, random: () => 0.999, rules: { leaderCharges: charges } });
  match.starter = 'human';
  return confirmMulligan(match, []);
}

function board(match, side, row, ...cards) {
  match.players[side].board[row] = cards;
}

function hand(match, ...cards) {
  match.players.human.hand = [...cards, createCard('spare', basic)];
}

function play(match, id, position = 0, side = 'human') {
  return applyAction(match, side, { type: 'play', cardId: id, position }, { random: () => 0 });
}

function target(match, id, side = match.pending.side) {
  return applyAction(match, side, { type: 'target', cardId: id }, { random: () => 0 });
}

function events(match, type) {
  return match.log.filter((event) => event.type === type);
}

test('each selectable deck has 25 instances, two of each bronze and one of each gold', () => {
  for (const [key, faction] of Object.entries(FACTIONS)) {
    const match = fixture({ faction: key, charges: 2 });
    const cards = [...match.players.human.hand, ...match.players.human.deck];
    assert.equal(cards.length, 25);
    assert.equal(new Set(cards.map(({ id }) => id)).size, 25);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'bronze').length, 22);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'gold').length, 3);
    for (const { definition } of cards) {
      assert.ok(ROWS.includes(definition.row));
      assert.ok(definition.provision >= 4);
      assert.equal(cards.filter((card) => card.definition.id === definition.id).length,
        definition.rarity === 'bronze' ? 2 : 1);
    }
    assert.equal(match.players.human.leader.name, faction.leader.name);
    assert.equal(match.players.human.leader.charges, 2);
    assert.notEqual(match.players.bot.faction, match.players.human.faction);
  }
});

test('target selection offers only legal cards and holds the turn until resolved', () => {
  let match = fixture();
  hand(match, unit('relay', 'relay'));
  board(match, 'human', 'surface', unit('shield', 'shieldbearer'));
  board(match, 'human', 'orbit', unit('ship', 'frigate'));
  match = play(match, 'relay', 1);
  assert.deepEqual(match.pending.options, ['shield']);
  assert.equal(match.turn, 'human');
  assert.strictEqual(target(match, 'ship'), match);
  assert.strictEqual(target(match, 'shield', 'bot'), match);
  assert.strictEqual(applyAction(match, 'human', { type: 'pass' }), match);
  match = target(match, 'shield');
  assert.equal(match.players.human.board.surface[0].armor, 4);
  assert.equal(match.turn, 'bot');
});

test('on-play adjacency runs once and only boosts the armored neighbors at placement', () => {
  let match = fixture();
  board(match, 'human', 'surface', unit('left', 'shieldbearer'), unit('right', 'infantry'));
  hand(match, unit('standard', 'standard'), unit('line', 'infantry'));
  match = play(match, 'standard', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [5, 4, 2]);
  match = applyAction(match, 'bot', { type: 'pass' });
  match = play(match, 'line', 2);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [5, 4, 2, 2]);
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [2, 1, 0, 1]);
});

test('damage spends armor first and sends a killed unit to discard, then resolves its deathwish', () => {
  let match = fixture();
  hand(match, unit('anvil', 'anvil'));
  board(match, 'human', 'surface', unit('payer', 'warden'));
  board(match, 'bot', 'orbit', unit('sac', 'spore-sac', { armor: 2 }));
  match = target(target(play(match, 'anvil', 1), 'payer'), 'sac');

  assert.equal(match.players.human.board.surface[0].armor, 0);
  assert.equal(match.players.bot.discard[0].id, 'sac');
  assert.deepEqual(match.players.bot.board.orbit.map(({ power }) => power), [1, 1, 1]);
  assert.deepEqual(events(match, 'damage').map(({ absorbed, lost }) => [absorbed, lost]), [[2, 2]]);
  assert.equal(events(match, 'deathwish').length, 1);
  assert.ok(match.players.bot.board.orbit.every(({ definition }) => definition.doomed));
});

test('destroy exiles without firing deathwish, while doomed death exiles and still triggers it', () => {
  let match = fixture();
  hand(match, createCard('destroy', { ...basic, deploy: 'destroy' }));
  board(match, 'bot', 'orbit', unit('sac', 'spore-sac'));
  match = target(play(match, 'destroy'), 'sac');
  assert.equal(match.players.bot.exile[0].id, 'sac');
  assert.equal(match.players.bot.discard.length, 0);
  assert.equal(events(match, 'deathwish').length, 0);
  assert.equal(events(match, 'destroy').length, 1);

  match = fixture({ faction: 'growth' });
  hand(match, unit('scavenger', 'scavenger'));
  board(match, 'human', 'surface', unit('doomed-cocoon', 'cocoon', { doomed: true, power: 3 }));
  match = target(play(match, 'scavenger', 1), 'doomed-cocoon');
  assert.equal(match.players.human.exile[0].id, 'doomed-cocoon');
  assert.equal(match.players.human.discard.length, 0);
  assert.equal(match.players.human.board.surface[0].power, 7);
  assert.equal(events(match, 'deathwish').length, 1);
});

test('a deathwish owner chooses even during the other side’s turn', () => {
  let match = fixture();
  hand(match, unit('anvil', 'anvil'));
  board(match, 'human', 'surface', unit('payer', 'warden'));
  board(match, 'bot', 'orbit', unit('acid', 'acid-gland'));
  match = target(target(play(match, 'anvil', 1), 'payer'), 'acid');
  assert.equal(match.turn, 'human');
  assert.equal(match.pending.side, 'bot');
  assert.equal(events(match, 'deathwish').length, 1);
  assert.strictEqual(target(match, 'payer', 'human'), match);
  match = target(match, 'payer', 'bot');
  assert.equal(match.players.human.board.surface[0].power, 2);
  assert.equal(events(match, 'deathwish').length, 1);
  assert.equal(match.turn, 'bot');
});

test('consume transfers current power and neighboring predator reacts before another turn', () => {
  let match = fixture({ faction: 'growth' });
  board(match, 'human', 'surface', unit('predator', 'predator'), unit('cocoon', 'cocoon', { power: 4, armor: 3 }));
  hand(match, unit('scavenger', 'scavenger'));
  match = target(play(match, 'scavenger', 2), 'cocoon');
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [6, 8]);
  assert.equal(match.players.human.discard[0].id, 'cocoon');
  assert.equal(events(match, 'consume').length, 1);
  assert.equal(events(match, 'deathwish').length, 1);
});

test('ravager redirects the sacrifice’s current power to damage, without a base boost', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('ravager', 'ravager'));
  board(match, 'human', 'orbit', unit('sacrifice', 'nursery', { power: 6 }));
  board(match, 'bot', 'surface', unit('enemy', 'warden'));
  match = target(target(play(match, 'ravager'), 'sacrifice'), 'enemy');
  assert.equal(match.players.human.board.surface[0].power, 4);
  assert.equal(match.players.bot.board.surface[0].power, 4);
  assert.equal(match.players.bot.board.surface[0].armor, 0);
});

test('cocoon and deathwish spawning respect row limits and preserve neighboring positions', () => {
  let match = fixture({ faction: 'growth' });
  const neighbors = Array.from({ length: 7 }, (_, i) => createCard(`regular-${i}`, basic));
  board(match, 'human', 'surface', ...neighbors);
  hand(match, unit('cocoon', 'cocoon'));
  match = play(match, 'cocoon', 1);
  const row = match.players.human.board.surface;
  assert.equal(row.length, ROW_LIMIT);
  assert.deepEqual(row.slice(0, 4).map(({ definition }) => definition.id), ['basic', 'larva', 'cocoon', 'basic']);
  assert.equal(events(match, 'spawn').reduce((n, event) => n + event.count, 0), 1);

  match = fixture({ faction: 'growth' });
  hand(match, unit('cocoon', 'cocoon'));
  board(match, 'human', 'surface', createCard('existing', basic));
  match = play(match, 'cocoon', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ definition }) => definition.id),
    ['basic', 'larva', 'cocoon', 'larva']);
});

test('end-of-turn effects run on play and pass, with no deathwish on round cleanup', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('nest', 'nest'));
  board(match, 'human', 'orbit', unit('sac', 'spore-sac'));
  match = play(match, 'nest', 1);
  assert.equal(events(match, 'spawn').length, 2);
  match = applyAction(match, 'bot', { type: 'pass' });
  match = applyAction(match, 'human', { type: 'pass' });
  assert.equal(events(match, 'spawn').length, 4);
  assert.equal(events(match, 'deathwish').length, 0);
  assert.deepEqual(match.players.human.exile.map(({ definition }) => definition.id), Array(4).fill('larva'));
  assert.ok(match.players.human.discard.some(({ id }) => id === 'sac'));
});

test('an effect with no legal targets completes the move without a prompt', () => {
  let match = fixture();
  hand(match, unit('anvil', 'anvil'));
  match = play(match, 'anvil');
  assert.equal(match.pending, null);
  assert.equal(match.turn, 'bot');
});

test('leaders spend a configurable charge without ending the turn', () => {
  let match = fixture({ charges: 2 });
  board(match, 'human', 'surface', unit('left', 'shieldbearer'), unit('center', 'infantry'), unit('right', 'warden'));
  match = target(applyAction(match, 'human', { type: 'leader' }), 'center');
  match = target(applyAction(match, 'human', { type: 'leader' }), 'center');
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [8, 6, 10]);
  assert.equal(match.turn, 'human');
  assert.equal(match.players.human.leader.charges, 0);
  assert.strictEqual(applyAction(match, 'human', { type: 'leader' }), match);

  match = fixture({ faction: 'growth', charges: 1 });
  board(match, 'human', 'surface', unit('left', 'predator'), unit('cocoon', 'cocoon', { power: 3 }), unit('right', 'colossus'));
  match = target(target(applyAction(match, 'human', { type: 'leader' }), 'cocoon'), 'right');
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [6, 13]);
  assert.equal(match.players.human.leader.charges, 0);
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
  assert.equal(match.players.bot.board.surface[0].armor, 1);
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-0', 2);
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-1', 3);
  assert.strictEqual(issue(match), match);
  match = play(match, 'plain-2', 4);
  assert.ok(issue(match).pending);
});

test('larvae are doomed on death from consumption and never enter the discard', () => {
  let match = fixture({ faction: 'growth' });
  const larva = createCard('larva', { ...LARVA, row: 'surface' });
  board(match, 'human', 'surface', larva);
  hand(match, unit('gulper', 'gulper'));
  match = play(match, 'gulper', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [4]);
  assert.equal(match.players.human.exile[0].id, 'larva');
  assert.equal(match.players.human.discard.length, 0);
});

test('live faction matches resolve all choices, keep card identities unique, and finish within three rounds', () => {
  for (let seed = 1; seed <= 48; seed += 1) {
    let value = seed;
    const random = () => {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
    let match = confirmMulligan(createMatch({ humanFaction: seed % 2 ? 'growth' : 'protectorate', random }), []);
    for (let step = 0; step < 250 && match.phase === 'playing'; step += 1) {
      const side = match.pending?.side ?? match.turn;
      const player = match.players[side];
      const [card] = playableCards(player);
      let action;
      if (side === 'bot') action = chooseBotTurn(match);
      else if (match.pending) action = { type: 'target', cardId: match.pending.options[0] };
      else if (!card || random() < 0.12) action = { type: 'pass' };
      else action = { type: 'play', cardId: card.id, position: player.board[card.definition.row].length };
      const next = applyAction(match, side, action, { random });
      assert.notStrictEqual(next, match, `seed ${seed}, step ${step}, ${JSON.stringify(action)}`);
      match = next;
      for (const field of Object.values(match.players)) {
        for (const row of Object.values(field.board)) assert.ok(row.length <= ROW_LIMIT);
        const cards = [...field.hand, ...field.deck, ...field.discard, ...field.exile, ...Object.values(field.board).flat()];
        assert.equal(cards.filter(({ definition }) => !definition.token).length, 25);
        assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length);
        assert.ok(field.discard.every(({ definition }) => !definition.doomed));
      }
    }
    assert.equal(match.phase, 'finished');
    assert.ok(match.round <= 3);
  }
});

test('the bot targets lethal damage through armor before a stronger opponent', () => {
  const match = fixture();
  board(match, 'human', 'surface',
    unit('shield', 'shieldbearer'),
    unit('killable', 'infantry'),
    unit('strong', 'bastion', { power: 110 }));
  match.pending = { side: 'bot', kind: 'damage', amount: 3, options: ['shield', 'killable', 'strong'] };
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'killable' });
  match.pending.options = ['shield', 'strong'];
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'strong' });
});

test('a consumed vine deals its deathwish damage to a random opponent without requesting a target', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('ravager', 'ravager'));
  board(match, 'human', 'orbit', unit('vine', 'vine'));
  board(match, 'bot', 'surface', unit('first', 'warden'), unit('second', 'warden'));
  match = target(target(play(match, 'ravager'), 'vine'), 'second');
  assert.equal(match.pending, null);
  assert.deepEqual(match.players.bot.board.surface.map(({ armor }) => armor), [2, 2]);
  assert.deepEqual(events(match, 'damage').map(({ amount }) => amount), [2, 2]);
});
