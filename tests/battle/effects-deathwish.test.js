import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, damage, findUnit } from '../../docs/game/engine/board.js';
import { FACTIONS, LARVA } from '../../docs/game/cards/cards.js';
import { applyAction, ROW_LIMIT } from '../../docs/game/engine/match.js';
import { drain } from '../helpers/battle-helpers.js';
import { basic, board, events, fixture, hand, play, target, unit } from '../helpers/effects-fixture.js';

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
  drain(match, () => 0);
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
