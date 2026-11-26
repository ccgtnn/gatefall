import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotTurn } from '../../docs/game/bot.js';
import { capture, createCard, damage, findUnit, removeUnit, restoreCard } from '../../docs/game/board.js';
import { FACTIONS, FIRST_SIGNAL, NEUTRAL, NEUTRAL_CARDS, LARVA } from '../../docs/game/cards.js';
import { pendingEffectSource } from '../../docs/game/effect-queries.js';
import { availableOrders, runEffect } from '../../docs/game/effects.js';
import { applyAction, availableRows, canEndTurn, confirmMulligan, createMatch, playableCards, ROW_LIMIT } from '../../docs/game/match.js';

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
  if (!charges && started.players.human.leader) started.players.human.leader.charges = 0;
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

test('each selectable deck has unique instances and legal card quantities', () => {
  for (const [key, faction] of Object.entries(FACTIONS)) {
    const match = fixture({ faction: key, charges: 2 });
    const cards = [...match.players.human.hand, ...match.players.human.deck];
    assert.equal(cards.length, faction.deck.length);
    assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length);
    assert.equal(cards.filter(({ definition }) => definition.faction === NEUTRAL).length, { protectorate: 6, growth: 5, choir: 7, captains: 5 }[key]);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'gold').length, key === 'protectorate' ? 6 : 5);
    for (const { definition } of cards) {
      assert.equal('row' in definition, false);
      assert.ok(definition.provision >= 4);
      assert.ok(cards.filter((card) => card.definition.id === definition.id).length <=
        (definition.rarity === 'bronze' ? 2 : 1));
    }
    assert.equal(match.players.human.leader.name, faction.leader.name);
    assert.equal(match.players.human.leader.charges, faction.leader.ability ? (faction.leader.charges ?? 2) : 0);
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
  board(match, 'human', 'surface', unit('left', 'shieldbearer'), unit('right', 'infantry', { armor: 0 }));
  hand(match, unit('standard', 'standard'), unit('line', 'infantry'));
  match = play(match, 'standard', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [5, 3, 3]);
  match = applyAction(match, 'bot', { type: 'pass' });
  match = play(match, 'line', 2);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [5, 3, 3, 3]);
  assert.deepEqual(match.players.human.board.surface.map(({ armor }) => armor), [2, 2, 2, 2]);
});

test('damage spends armor first and sends a killed unit to discard, then resolves its deathwish', () => {
  let match = fixture();
  hand(match, unit('anvil', 'anvil'));
  board(match, 'human', 'surface', unit('payer', 'bastion'));
  board(match, 'bot', 'orbit', unit('sac', 'spore-sac', { armor: 2 }));
  match = target(target(play(match, 'anvil', 1), 'payer'), 'sac');

  assert.equal(match.players.human.board.surface[0].armor, 0);
  assert.equal(match.players.bot.discard[0].id, 'sac');
  assert.deepEqual(match.players.bot.board.orbit.map(({ power }) => power), [1]);
  assert.deepEqual(events(match, 'damage').map(({ absorbed, lost }) => [absorbed, lost]), [[2, 1]]);
  assert.equal(events(match, 'deathwish').length, 1);
  assert.ok(match.players.bot.board.orbit.every(({ definition }) => definition.doomed));
});

test('Xylaris Bloom destroys Spore Sac and triggers its Larva deathwish', () => {
  const match = fixture();
  board(match, 'human', 'orbit', createCard('bloom', FACTIONS.growth.pool.find(({ id }) => id === 'xylaris-bloom')));
  board(match, 'bot', 'orbit', unit('sac', 'spore-sac'), unit('other', 'cocoon'));
  damage(match, findUnit(match, 'bloom'), 4);
  while (match.effects.length) runEffect(match, match.effects.shift(), () => 0);
  assert.equal(match.players.bot.discard[0].id, 'sac');
  assert.deepEqual(match.players.bot.board.orbit.map(({ definition }) => definition.id), [LARVA.id, 'cocoon']);
  assert.equal(events(match, 'death').find(({ cardId }) => cardId === 'sac').reason, 'destroy');
});

test('doomed death exiles and still triggers deathwish', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('scavenger', 'scavenger'));
  board(match, 'human', 'surface', unit('doomed-cocoon', 'cocoon', { doomed: true, power: 3 }));
  match = play(match, 'scavenger', 1);
  match = target(applyAction(match, 'human', { type: 'order', cardId: 'scavenger' }), 'doomed-cocoon');
  assert.equal(match.players.human.exile[0].id, 'doomed-cocoon');
  assert.equal(match.players.human.discard.length, 0);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [1, 1, 7]);
  assert.equal(events(match, 'deathwish').length, 1);
});

test('a deathwish owner chooses even during the other side’s turn', () => {
  let match = fixture();
  hand(match, unit('anvil', 'anvil'));
  board(match, 'human', 'surface', unit('payer', 'warden'));
  const enemy = { scope: 'enemy', type: 'unit' };
  board(match, 'bot', 'orbit', unit('acid', 'acid-gland', {
    deathwish: { select: [{ ref: 'enemy', targets: enemy }],
      steps: [{ action: 'damage', target: { scope: 'ref', ref: 'enemy' }, amount: 4 }] },
  }));
  match = target(target(play(match, 'anvil', 1), 'payer'), 'acid');
  assert.equal(match.turn, 'human');
  assert.equal(match.pending.side, 'bot');
  assert.equal(events(match, 'deathwish').length, 1);
  assert.strictEqual(target(match, 'payer', 'human'), match);
  match = target(match, 'payer', 'bot');
  assert.equal(match.players.human.board.surface[0].power, 1);
  assert.equal(events(match, 'deathwish').length, 1);
  assert.equal(match.turn, 'bot');
});

test('consume transfers current power and fires Cocoon’s two-larva Deathwish', () => {
  let match = fixture({ faction: 'growth' });
  board(match, 'human', 'surface', unit('predator', 'predator'), unit('cocoon', 'cocoon', { power: 4, armor: 3 }));
  hand(match, unit('scavenger', 'scavenger'));
  match = play(match, 'scavenger', 2);
  match = target(applyAction(match, 'human', { type: 'order', cardId: 'scavenger' }), 'cocoon');
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [4, 1, 1, 8]);
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
  assert.equal(match.players.bot.board.surface[0].power, 2);
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

test('larvae are doomed on death from consumption and never enter the discard', () => {
  let match = fixture({ faction: 'growth' });
  const larva = createCard('larva', { ...LARVA, row: 'surface' });
  board(match, 'human', 'surface', larva);
  hand(match, unit('gulper', 'gulper'));
  match = play(match, 'gulper', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ power }) => power), [5]);
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
        assert.equal(cards.filter(({ definition }) => !definition.token).length, FACTIONS[field.factionId].deck.length);
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

test('the same unit can enter either row and target only its printed row', () => {
  for (const row of ['orbit', 'surface']) {
    let match = fixture();
    hand(match, unit('relay', 'relay'));
    board(match, 'human', 'surface', unit('surface-target', 'warden'));
    board(match, 'human', 'orbit', unit('orbit-target', 'warden'));
    match = play(match, 'relay', 1, 'human', row);
    assert.equal(match.players.human.board[row][1].id, 'relay');
    assert.deepEqual(match.pending.options, row === 'orbit' ? ['surface-target'] : ['surface-target', 'relay']);
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
  assert.equal(match.players.human.board.orbit.at(-2).armor, 3);
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
  assert.equal(match.players.bot.discard[0].id, 'inc');
  assert.equal(events(match, 'death')[0].reason, 'destroy');
});

test('Incubator spawns from deployment and persists beyond three owner turns', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('inc', 'incubator'), createCard('plain', basic), createCard('next', basic), createCard('fourth', basic));
  match = play(match, 'inc', 0, 'human', 'orbit');
  assert.equal(match.players.human.board.orbit[0].timer, undefined);
  assert.equal(events(match, 'spawn').length, 1);
  match = applyAction(match, 'bot', { type: 'pass' });
  assert.equal(events(match, 'spawn').length, 1);
  for (const [index, id] of ['plain', 'next', 'fourth'].entries()) {
    match = play(match, id, index);
    match = applyAction(match, 'human', { type: 'end-turn' });
  }
  assert.equal(match.players.human.board.orbit[0].id, 'inc');
  assert.equal(match.players.human.board.orbit.filter(({ definition }) => definition.token).length, 4);
  assert.equal(events(match, 'tick').length, 0);
  assert.equal(events(match, 'death').length, 0);
});

test('Feast spawns four larvae in one chosen allied row and fills only the slots available', () => {
  for (const occupied of [0, 7, ROW_LIMIT]) {
    let match = fixture({ faction: 'growth' });
    hand(match, unit('feast', 'feast'));
    board(match, 'human', 'surface', ...Array.from({ length: ROW_LIMIT }, (_, i) => createCard('surface-' + i, basic)));
    board(match, 'human', 'orbit', ...Array.from({ length: occupied }, (_, i) => createCard('orbit-' + i, basic)));
    const pending = play(match, 'feast');
    if (occupied === ROW_LIMIT) {
      assert.strictEqual(pending, match);
      continue;
    }
    assert.equal(pending.pending.selectionSide, 'human');
    assert.deepEqual(pending.pending.options, ['orbit']);
    match = target(pending, 'orbit');
    assert.equal(match.players.human.board.orbit.filter(({ definition }) => definition.id === LARVA.id).length,
      Math.min(4, ROW_LIMIT - occupied));
    assert.equal(match.players.bot.board.orbit.length, 0);
    assert.equal(match.players.human.discard[0].id, 'feast');
  }
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
      while (match.effects.length) runEffect(match, match.effects.shift(), () => 0);
      match = play(match, charge === 2 ? 'spare-two' : 'spare-three', 0);
    }
  }
  assert.deepEqual(events(match, 'order').map(({ orderCharges }) => orderCharges), [2, 1, 0]);
  assert.ok(!availableOrders(match, 'human').length);
});

test('captured orders, end-turn effects and start-turn growth follow the current side', () => {
  let match = fixture();
  const shot = { action: 'damage', target: { scope: 'enemy', type: 'unit' }, amount: 2, mode: 'random' };
  const boostAlly = { action: 'boost', target: { scope: 'ally', type: 'unit', exclude: 'source' }, amount: 1 };
  hand(match, unit('pass-card', 'frigate'));
  board(match, 'human', 'surface', unit('ally', 'frigate'));
  board(match, 'bot', 'surface', unit('enemy', 'frigate', { power: 10 }), unit('captured', 'frigate', {
    order: { steps: [shot] }, endTurn: { steps: [shot, boostAlly] }, startTurnGrowth: 1,
    deathwish: { steps: [boostAlly] },
  }));
  capture(match, 'human', findUnit(match, 'captured'));
  match = applyAction(match, 'human', { type: 'order', cardId: 'captured' }, { random: () => 0 });
  assert.equal(findUnit(match, 'enemy').card.power, 8);
  match = play(match, 'pass-card');
  assert.equal(findUnit(match, 'enemy').card.power, 6);
  assert.equal(findUnit(match, 'ally').card.power, 5);
  assert.equal(findUnit(match, 'captured').card.basePower, 4);
  match = applyAction(match, 'bot', { type: 'pass' }, { random: () => 0 });
  assert.equal(findUnit(match, 'captured').card.basePower, 5);
  removeUnit(match, findUnit(match, 'captured'), 'damage');
  assert.equal(match.players.bot.discard.at(-1).id, 'captured');
  while (match.effects.length) runEffect(match, match.effects.shift(), () => 0);
  assert.equal(findUnit(match, 'ally').card.power, 6);
});

test('capture changes the recipient of a previously queued field reaction', () => {
  const match = fixture();
  board(match, 'human', 'surface', unit('ally', 'frigate'));
  board(match, 'bot', 'surface', unit('enemy', 'frigate'), unit('captured', 'frigate'));
  match.effects.push({
    side: 'bot', sourceId: 'captured', requiredSource: true, cardAbility: true,
    ability: { steps: [{ action: 'boost', target: { scope: 'ally', type: 'unit', exclude: 'source' }, amount: 2 }] },
  });
  capture(match, 'human', findUnit(match, 'captured'));
  while (match.effects.length) runEffect(match, match.effects.shift(), () => 0);
  assert.equal(findUnit(match, 'ally').card.power, 6);
  assert.equal(findUnit(match, 'enemy').card.power, 4);
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

test('Broodlord groups only larvae in its row and doubles their current power', () => {
  let match = fixture({ faction: 'growth' });
  hand(match, unit('lord', 'broodlord'));
  const grown = createCard('grown', LARVA);
  grown.power = 3;
  board(match, 'human', 'surface', grown, createCard('small', LARVA), unit('predator', 'predator'));
  board(match, 'human', 'orbit', createCard('elsewhere', LARVA));
  match = play(match, 'lord', 1);
  assert.deepEqual(match.players.human.board.surface.map(({ id, power }) => [id, power]), [['lord', 12], ['predator', 4]]);
  assert.equal(match.players.human.board.orbit[0].id, 'elsewhere');
  assert.deepEqual(events(match, 'consume-group')[0].cardIds, ['grown', 'small']);
  assert.equal(events(match, 'consume').length, 2);
});


test('printed stats, titles and rarity match the approved balance', () => {
  const all = [...Object.values(FACTIONS).flatMap(({ pool }) => pool), ...NEUTRAL_CARDS];
  const expected = {
    smelter: { power: 2 }, warden: { power: 5, armor: 3, provision: 5 },
    'orbital-shield': { armor: 2 }, reinforcements: { provision: 5 }, standard: { provision: 4, power: 3 },
    'scout-frigate': { provision: 4, power: 2, shipClass: 'Лёгкий корабль' }, spotter: { power: 5 },
    'shield-generator': { provision: 4 }, 'imperial-golem': { provision: 10 }, aurelian: { provision: 12 },
    engineer: { provision: 4 }, infantry: { power: 3, armor: 2 }, 'orbital-salvo': { provision: 4 }, anvil: { rarity: 'epic', provision: 8 },
    colonel: { name: 'Октавиан Рейн', rarity: 'gold', provision: 10 },
    commander: { name: 'Кассия Фульмина', rarity: 'epic', provision: 8 },
    'shield-overload': { provision: 12 }, cocoon: { power: 3 }, 'spore-sac': { provision: 4, power: 1, armor: 1 },
    scavenger: { power: 4, zeal: true }, gulper: { power: 4 }, ravager: { provision: 9, power: 4, rarity: 'epic' },
    nest: { provision: 9, power: 3, rarity: 'epic' },
    colossus: { power: 5 }, 'recon-drone': { power: 4 }, 'gate-guardian': { armor: 4 },
    'gravity-pulse': { provision: 7 },
  };
  for (const [id, stats] of Object.entries(expected)) {
    const definition = all.find((card) => card.id === id);
    for (const [field, value] of Object.entries(stats)) assert.equal(definition[field], value, id + ' ' + field);
  }
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
