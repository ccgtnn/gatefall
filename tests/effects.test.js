import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotTurn } from '../docs/game/bot.js';
import { createCard } from '../docs/game/board.js';
import { FACTIONS, FIRST_SIGNAL, NEUTRAL, LARVA } from '../docs/game/cards.js';
import { applyAction, availableRows, canEndTurn, confirmMulligan, createMatch, playableCards, ROW_LIMIT } from '../docs/game/match.js';

const definitions = new Map(Object.values(FACTIONS).flatMap(({ deck }) => deck.map((card) => [card.id, card])));
const basic = { id: 'basic', name: 'Обычная карта', type: 'unit', power: 4 };
definitions.set('shieldbearer', { ...basic, id: 'shieldbearer', name: 'Щитоносец', power: 3, armor: 2 });
definitions.set('frigate', { ...basic, id: 'frigate', name: 'Патрульный фрегат' });
definitions.set('relay', { ...basic, id: 'relay', name: 'Наводчик щитов', power: 3,
  deploy: {
    select: [{ ref: 'ally', targets: { scope: 'ally', type: 'unit', row: 'surface' }, kind: 'armor' }],
    steps: [{ action: 'armor', target: { scope: 'ref', ref: 'ally' }, amount: 2 }],
  },
});
definitions.set('nursery', { ...basic, id: 'nursery', name: 'Рассадник', power: 3 });

function unit(id, definitionId, overrides = {}) {
  return createCard(id, { ...definitions.get(definitionId), ...overrides });
}

function fixture({ faction = 'protectorate', charges = 0 } = {}) {
  const match = createMatch({ humanFaction: faction, random: () => 0.999, rules: { leaderCharges: charges } });
  match.starter = 'human';
  const started = confirmMulligan(match, []);
  // Isolate the card under test from the opening stratagem.
  const surface = started.players.human.board.surface;
  assert.equal(surface.pop().id, FIRST_SIGNAL.id);
  return started;
}

function board(match, side, row, ...cards) {
  match.players[side].board[row] = cards;
}

function hand(match, ...cards) {
  match.players.human.hand = [...cards, createCard('spare', basic)];
}

function play(match, id, position = 0, side = 'human', row = ['relay', 'nest'].includes(id) ? 'orbit' : 'surface') {
  return applyAction(match, side, { type: 'play', cardId: id, row, position }, { random: () => 0 });
}

function target(match, id, side = match.pending.side) {
  return applyAction(match, side, { type: 'target', cardId: id }, { random: () => 0 });
}

function events(match, type) {
  return match.log.filter((event) => event.type === type);
}

test('each selectable deck has 31 instances, including five distinct neutrals', () => {
  for (const [key, faction] of Object.entries(FACTIONS)) {
    const match = fixture({ faction: key, charges: 2 });
    const cards = [...match.players.human.hand, ...match.players.human.deck];
    assert.equal(cards.length, 31);
    assert.equal(new Set(cards.map(({ id }) => id)).size, 31);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'bronze').length, 24);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'gold').length, 7);
    for (const { definition } of cards) {
      assert.equal('row' in definition, false);
      assert.ok(definition.provision >= 4);
      assert.equal(cards.filter((card) => card.definition.id === definition.id).length,
        definition.rarity === 'bronze' && definition.faction !== NEUTRAL ? 2 : 1);
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
  hand(match, createCard('destroy', { ...basic, deploy: {
    select: [{ ref: 'enemy', targets: { scope: 'enemy' } }],
    steps: [{ action: 'destroy', target: { scope: 'ref', ref: 'enemy' } }],
  } }));
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
  assert.deepEqual(match.players.human.exile.filter(({ definition }) => definition.id === LARVA.id)
    .map(({ definition }) => definition.id), Array(4).fill('larva'));
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
    for (let step = 0; step < 250 && match.phase !== 'finished'; step += 1) {
      if (match.phase === 'mulligan') {
        match = confirmMulligan(match, [], { random });
        continue;
      }
      const side = match.pending?.side ?? match.turn;
      const player = match.players[side];
      const [card] = playableCards(match, side);
      let action;
      if (side === 'bot') action = chooseBotTurn(match);
      else if (match.pending?.kind === 'deck-placement') {
        const row = match.pending.options[0];
        action = { type: 'place', row, position: player.board[row].length };
      } else if (match.pending) action = { type: 'target', cardId: match.pending.options[0] };
      else if (canEndTurn(match, side)) action = { type: 'end-turn' };
      else if (!card || random() < 0.12) action = { type: 'pass' };
      else {
        const row = availableRows(player)[0];
        action = { type: 'play', cardId: card.id, row, position: row ? player.board[row].length : 0 };
      }
      const next = applyAction(match, side, action, { random });
      assert.notStrictEqual(next, match, `seed ${seed}, step ${step}, ${JSON.stringify(action)}`);
      match = next;
      for (const field of Object.values(match.players)) {
        for (const row of Object.values(field.board)) assert.ok(row.length <= ROW_LIMIT);
        const resolving = match.effects.filter(({ discard }) => discard && match.players[match.turn] === field)
          .map(({ discard }) => discard);
        const cards = [...field.hand, ...field.deck, ...field.discard, ...field.exile, ...Object.values(field.board).flat(), ...resolving];
        assert.equal(cards.filter(({ definition }) => !definition.token).length, 31);
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

test('the same unit can enter either row, and an explicit row effect still uses its printed target row', () => {
  for (const row of ['orbit', 'surface']) {
    let match = fixture();
    hand(match, unit('relay', 'relay'));
    board(match, 'human', 'surface', unit('surface-target', 'warden'));
    board(match, 'human', 'orbit', unit('orbit-target', 'warden'));
    match = play(match, 'relay', 1, 'human', row);
    assert.equal(match.players.human.board[row][1].id, 'relay');
    assert.deepEqual(match.pending.options, row === 'orbit' ? ['surface-target'] : ['surface-target', 'relay']);
  }

  let match = fixture({ faction: 'growth' });
  hand(match, unit('vine', 'vine'));
  board(match, 'human', 'orbit', unit('existing', 'spore-sac'));
  match = play(match, 'vine');
  assert.deepEqual(match.players.human.board.orbit.map(({ definition }) => definition.id), ['spore-sac', 'larva']);
  assert.equal(match.players.human.board.surface[0].id, 'vine');
});

test('orbital salvo hits either row, ignores artifacts, and goes directly to the discard', () => {
  for (const [row, damage] of [['orbit', 3], ['surface', 5]]) {
    let match = fixture();
    hand(match, unit('salvo', 'orbital-salvo'));
    board(match, 'bot', row, unit('enemy', 'warden', { armor: 0 }), unit('artifact', 'incubator'));
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
  match.players.bot.hand = [unit('salvo', 'orbital-salvo')];
  board(match, 'human', 'orbit', unit('weak', 'spore-sac'));
  board(match, 'human', 'surface', unit('strong', 'colossus', { power: 7 }));
  assert.deepEqual(chooseBotTurn(match), { type: 'play', cardId: 'salvo' });
  match = applyAction(match, 'bot', chooseBotTurn(match));
  assert.deepEqual(chooseBotTurn(match), { type: 'target', cardId: 'strong' });
});

test('artifacts count toward the row cap and have no power or armor; Destroy can remove them', () => {
  let match = fixture();
  const artifact = unit('generator', 'shield-generator');
  assert.equal('power' in artifact, false);
  assert.equal('armor' in artifact, false);
  hand(match, artifact, unit('warden', 'warden'));
  board(match, 'human', 'orbit', ...Array.from({ length: 8 }, (_, i) => unit(`orb-${i}`, 'warden')));
  match = play(match, 'generator', 8, 'human', 'orbit');
  assert.equal(match.players.human.board.orbit.length, 9);
  assert.equal(match.players.human.board.orbit.at(-2).armor, 5);
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.strictEqual(play(match, 'warden', 9, 'human', 'orbit'), match);
  assert.notStrictEqual(play(match, 'warden'), match);

  match = fixture();
  const allEnemies = { scope: 'enemy' };
  hand(match, createCard('removal', { name: 'Уничтожение', type: 'effect', deploy: {
    steps: [{ action: 'destroy', target: allEnemies }],
  } }));
  board(match, 'bot', 'orbit', unit('inc', 'incubator'));
  match = play(match, 'removal');
  assert.equal(match.players.bot.board.orbit.length, 0);
  assert.equal(match.players.bot.exile[0].id, 'inc');
  assert.equal(events(match, 'death').length, 0);
});

test('Incubator counts its own turn ends from deployment, spawns before dying, and does not tick on enemy turns', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('inc', 'incubator'), createCard('plain', basic), createCard('next', basic));
  match = play(match, 'inc', 0, 'human', 'orbit');
  assert.equal(match.players.human.board.orbit[0].timer, 2);
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.equal(match.players.human.board.orbit[0].timer, 2);
  match = play(match, 'plain');
  assert.equal(match.players.human.board.orbit[0].timer, 1);
  match = play(match, 'next', 1);
  assert.equal(match.players.human.board.orbit.length, 3);
  assert.ok(match.players.human.board.orbit.every(({ definition }) => definition.token));
  assert.equal(match.players.human.discard[0].id, 'inc');
  assert.deepEqual(match.log.filter(({ type }) => type === 'spawn' || type === 'death').map(({ type }) => type),
    ['spawn', 'spawn', 'spawn', 'death']);
});

test('Feast selects a different larva across rows, boosts the recipient and keeps uncastable effects in hand', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('feast', 'feast'));
  board(match, 'human', 'surface', unit('eater', 'gulper'));
  const larva = createCard('larva', LARVA);
  assert.strictEqual(play(match, 'feast'), match);
  board(match, 'human', 'orbit', larva, unit('structure', 'incubator'));
  match = play(match, 'feast');
  assert.deepEqual(match.pending.options, ['eater']);
  match = target(match, 'eater');
  assert.deepEqual(match.pending.options, ['larva']);
  match = target(match, 'larva');
  assert.equal(match.players.human.board.surface[0].power, 6);
  assert.equal(match.players.human.discard[0].id, 'feast');
  assert.equal(match.players.human.exile[0].id, 'larva');
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

test('artifact immunity holds even for an effect that selects all board cards', () => {
  let match = fixture();
  hand(match, createCard('wide', { name: 'Общее воздействие', type: 'effect', deploy: { steps: [
    { action: 'damage', target: { scope: 'enemy' }, amount: 7 },
    { action: 'boost', target: { scope: 'enemy' }, amount: 5 },
    { action: 'armor', target: { scope: 'enemy' }, amount: 9 },
  ] } }));
  board(match, 'bot', 'orbit', unit('structure', 'incubator'));
  match = play(match, 'wide');
  const [structure] = match.players.bot.board.orbit;
  assert.equal(structure.id, 'structure');
  assert.equal('power' in structure, false);
  assert.equal('armor' in structure, false);
  assert.equal(events(match, 'damage').length, 0);
});

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
  assert.deepEqual(next.players.human.board.surface.map(({ id, armor }) => [id, armor]), [['left', 1], ['c', 0], ['right', 1]]);
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

test('Swarm Call filters by printed power and faction, then spawns beside the played unit after deploy', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('call', 'swarm-call'));
  const cocoon = unit('cocoon', 'cocoon');
  cocoon.power = 8;
  match.players.human.deck = [unit('foreign', 'infantry'), unit('strong', 'predator'), unit('gold', 'nest'),
    unit('artifact', 'incubator'), cocoon];
  board(match, 'human', 'surface', unit('neighbor', 'frigate'));
  match = play(match, 'call');
  assert.equal(match.pending.kind, 'deck-placement');
  assert.equal(match.pending.cardId, 'cocoon');
  match = applyAction(match, 'human', { type: 'place', row: 'surface', position: 1 });
  assert.deepEqual(match.players.human.board.surface.map(({ definition }) => definition.id),
    ['frigate', 'larva', 'cocoon', 'larva', 'larva']);
  assert.deepEqual(events(match, 'spawn').map(({ position }) => position), [1, 3, 3]);
});

test('Shield Overload spends only the selected armor and scatters independent hits among surviving units', () => {
  let match = fixture();
  hand(match, unit('overload', 'shield-overload'));
  board(match, 'human', 'orbit', unit('reserve', 'shieldbearer'));
  board(match, 'human', 'surface', unit('one', 'shieldbearer'), unit('two', 'shieldbearer'));
  board(match, 'bot', 'surface', unit('fragile', 'cocoon'), unit('shield', 'shieldbearer'), unit('artifact', 'incubator'));
  match = play(match, 'overload');
  assert.deepEqual(match.pending.options, ['orbit', 'surface']);
  match = target(match, 'surface');
  assert.equal(match.players.human.board.orbit[0].armor, 2);
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [0, 0]);
  assert.deepEqual(events(match, 'damage').map(({ cardId, amount, scattered }) => [cardId, amount, scattered]),
    [['fragile', 1, true], ['shield', 1, true], ['shield', 1, true], ['shield', 1, true]]);
  assert.equal(match.players.bot.board.surface[0].power, 2);
});

test('Broodlord groups only larvae in its row and doubles their current power', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('lord', 'broodlord'));
  const grown = createCard('grown', LARVA);
  grown.power = 3;
  board(match, 'human', 'surface', grown, createCard('small', LARVA), unit('predator', 'predator'));
  board(match, 'human', 'orbit', createCard('elsewhere', LARVA));
  match = play(match, 'lord', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ id, power }) => [id, power]), [['lord', 12], ['predator', 6]]);
  assert.equal(match.players.human.board.orbit[0].id, 'elsewhere');
  assert.deepEqual(events(match, 'consume-group')[0].cardIds, ['grown', 'small']);
  assert.equal(events(match, 'consume').length, 2);
});
