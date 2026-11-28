import assert from 'node:assert/strict';
import test from 'node:test';
import { capture, createCard, damage, findUnit, removeUnit, cardType, placementSide } from '../../docs/game/engine/board.js';
import { FACTIONS, NEUTRAL, NEUTRAL_CARDS, LARVA } from '../../docs/game/cards/cards.js';
import { applyAction, availableRows, canEndTurn, confirmMulligan, createMatch, playableCards, ROW_LIMIT } from '../../docs/game/engine/match.js';
import { drain } from '../helpers/battle-helpers.js';
import { board, events, fixture, hand, play, target, unit } from '../helpers/effects-fixture.js';

test('each selectable deck has unique instances and legal card quantities', () => {
  for (const [key, faction] of Object.entries(FACTIONS)) {
    const match = fixture({ faction: key, charges: 2 });
    const cards = [...match.players.human.hand, ...match.players.human.deck];
    assert.equal(cards.length, faction.deck.length);
    assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length);
    assert.equal(cards.filter(({ definition }) => definition.faction === NEUTRAL).length, { protectorate: 6, growth: 5, choir: 7, captains: 5 }[key]);
    assert.equal(cards.filter(({ definition }) => definition.rarity === 'gold').length, { protectorate: 6, growth: 4, choir: 5, captains: 5 }[key]);
    for (const { definition } of cards) {
      assert.equal('row' in definition, false);
      assert.ok(definition.provision >= 4);
      assert.ok(cards.filter((card) => card.definition.id === definition.id).length <=
        (definition.rarity === 'bronze' ? 2 : 1));
    }
    assert.equal(match.players.human.leader.name, faction.leader.name);
    assert.equal(match.players.human.leader.charges, faction.leader.ability ? Math.max(2, faction.leader.charges ?? 0) : 0);
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

test('live faction matches resolve all choices, keep card identities unique, and finish within three rounds', () => {
  const factions = Object.keys(FACTIONS);
  const pairings = factions.flatMap((humanFaction) =>
    factions.filter((faction) => faction !== humanFaction).map((botFaction) => ({ humanFaction, botFaction })));
  const allCards = (state) => [
    ...Object.values(state.players).flatMap(({ hand, deck, discard, exile, board }) =>
      [...hand, ...deck, ...discard, ...exile, ...Object.values(board).flat()]),
    ...state.effects.flatMap(({ discard }) => discard ? [discard] : []),
  ];
  for (let seed = 1; seed <= 48; seed += 1) {
    let value = seed;
    const random = () => {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
    let match = confirmMulligan(createMatch({ ...pairings[(seed - 1) % pairings.length], random }), [], { random });
    const originalIds = allCards(match).filter(({ definition }) => !definition.token).map(({ id }) => id);
    for (let step = 0; step < 250 && match.phase !== 'finished'; step += 1) {
      if (match.phase === 'mulligan') {
        match = confirmMulligan(match, [], { random });
        continue;
      }
      const side = match.pending?.side ?? match.turn;
      const player = match.players[side];
      const [card] = playableCards(match, side);
      let action;
      if (match.pending?.kind === 'deck-placement') {
        const row = match.pending.options[0];
        action = { type: 'place', row, position: player.board[row].length };
      } else if (match.pending) action = { type: 'target', cardId: match.pending.options[0] };
      else if (canEndTurn(match, side)) action = { type: 'end-turn' };
      else if (!card || random() < 0.12) action = { type: 'pass' };
      else if (cardType(card) === 'effect') action = { type: 'play', cardId: card.id };
      else {
        const recipient = match.players[placementSide(side, card)];
        const [row] = availableRows(recipient, card);
        action = { type: 'play', cardId: card.id, row, position: recipient.board[row].length };
      }
      const next = applyAction(match, side, action, { random });
      assert.notStrictEqual(next, match, `seed ${seed}, step ${step}, ${JSON.stringify(action)}`);
      match = next;
      for (const field of Object.values(match.players)) {
        for (const row of Object.values(field.board)) assert.ok(row.length <= ROW_LIMIT);
        assert.ok(field.discard.every(({ definition }) => !definition.doomed));
      }
      const cards = allCards(match);
      const ids = new Set(cards.map(({ id }) => id));
      assert.equal(ids.size, cards.length);
      assert.ok(originalIds.every((id) => ids.has(id)));
    }
    assert.equal(match.phase, 'finished');
    assert.ok(match.round <= 3);
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
  drain(match, () => 0);
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
  drain(match, () => 0);
  assert.equal(findUnit(match, 'ally').card.power, 6);
  assert.equal(findUnit(match, 'enemy').card.power, 4);
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
