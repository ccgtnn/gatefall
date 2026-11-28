import assert from 'node:assert/strict';
import test from 'node:test';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { cleanse, createCard, damage, findUnit, removeUnit, setRowEffect, statusCount } from '../../docs/game/engine/board.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { progress } from '../../docs/game/engine/match-rounds.js';
import { availableOrders, canUseLeader, enqueueStartTurn, leaderCooldown, runEffect } from '../../docs/game/effects/effects.js';
import { eventText } from '../../docs/ui/match-log.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { unit } from '../helpers/battle-helpers.js';

const rng = () => 0;
const card = (id) => createCard(id, findCardDefinition(id));
const play = (cardId, row = 'orbit', position = 0) => ({ type: 'play', cardId, row, position });
const order = (cardId) => ({ type: 'order', cardId });
const pick = (cardId) => ({ type: 'target', cardId });
const step = (match, action, random = rng) => applyAction(match, match.pending?.side ?? match.turn, action, { random });
const hitEvents = (match) => match.log.filter((event) => event.visual === 'firestorm' &&
  (event.type === 'damage' || event.blockedDamage));
const weather = (type, remaining, attacker = 'human') => ({ type, remaining, attacker, sourceDefinitionId: attacker });

function setup(...cards) {
  const match = createMatch({ random: rng });
  match.phase = 'playing';
  match.turn = 'human';
  for (const [side, player] of Object.entries(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.leader = null;
    player.hand = Array.from({ length: 5 }, (_, index) => unit(side + '-spare-' + index, 3));
    player.deck = [];
  }
  match.players.human.hand.unshift(...cards.map(card));
  return match;
}

function start(match, side, random = rng) {
  enqueueStartTurn(match, side);
  while (match.effects.length) runEffect(match, match.effects.shift(), random);
}

function nextHumanTurn(match) {
  if (match.turn === 'human') match = step(match, { type: 'end-turn' });
  const [{ id }] = match.players.bot.hand;
  match = step(match, play(id, 'surface', match.players.bot.board.surface.length));
  return match.turn === 'bot' ? step(match, { type: 'end-turn' }) : match;
}

test('weather stacks matching durations using the latest source and replaces different types in either direction', () => {
  const match = setup();
  const { bot } = match.players;
  for (const type of ['rot', 'firestorm', 'rot']) {
    setRowEffect(match, 'bot', 'orbit', weather(type, 2));
    assert.deepEqual(bot.rowEffects.orbit, weather(type, 2));
    setRowEffect(match, 'bot', 'orbit', weather(type, 3, 'bot'));
    assert.deepEqual(bot.rowEffects.orbit, weather(type, 5, 'bot'));
    assert.deepEqual(match.log.at(-1).effect, bot.rowEffects.orbit);
  }
});

test('one unit takes three separate hits on each of three owner turns, including a passed empty turn', () => {
  let match = setup('firestorm');
  match.players.bot.board.orbit = [unit('victim', 12)];
  match.players.bot.passed = true;
  match = step(step(match, play('firestorm')), pick('orbit'));
  const applied = match.log.findIndex(({ type }) => type === 'row-effect');
  const firstHit = match.log.findIndex(({ type, visual }) => type === 'damage' && visual === 'firestorm');
  assert.equal(match.log[applied].effect.remaining, 3);
  assert.ok(firstHit > match.log.findIndex(({ type }) => type === 'turn-start'));
  assert.ok(match.log.some((event) => event.type === 'turn-start' && event.side === 'bot' && event.empty));
  assert.equal(findUnit(match, 'victim').card.power, 9);
  assert.equal(match.players.bot.rowEffects.orbit.remaining, 2);
  for (const index of [0, 1]) {
    match = step(match, play('human-spare-' + index, 'surface', index));
  }
  assert.equal(match.players.bot.rowEffects.orbit, undefined);
  assert.equal(findUnit(match, 'victim').card.power, 3);
  assert.equal(hitEvents(match).length, 9);
  assert.ok(hitEvents(match).every(({ amount, attacker, sourceDefinitionId }) =>
    amount === 1 && attacker === 'human' && sourceDefinitionId === 'firestorm'));
});

test('shield and armor absorb separate strikes and dead units leave the random target pool', () => {
  const match = setup();
  const { bot } = match.players;
  bot.board.orbit = [unit('shielded', 3, { armor: 1, shield: true })];
  bot.board.surface = [unit('fragile', 1), unit('survivor', 5)];
  for (const row of ['orbit', 'surface']) setRowEffect(match, 'bot', row, weather('firestorm', 1));
  start(match, 'bot');
  assert.equal(statusCount(findUnit(match, 'shielded').card, 'shield'), 0);
  assert.equal(findUnit(match, 'shielded').card.armor, 0);
  assert.equal(findUnit(match, 'shielded').card.power, 2);
  assert.deepEqual(hitEvents(match).map(({ cardId, lost }) => [cardId, lost]),
    [['shielded', undefined], ['shielded', 0], ['shielded', 1], ['fragile', 1], ['survivor', 1], ['survivor', 1]]);
});

test('storm uses the supplied seeded RNG, skips empty rows, and is cleared at round end', () => {
  const run = (seed) => {
    const match = setup();
    match.players.bot.board.orbit = ['a', 'b', 'c'].map((id) => unit(id, 6));
    setRowEffect(match, 'bot', 'orbit', weather('firestorm', 3));
    setRowEffect(match, 'bot', 'surface', weather('firestorm', 3));
    start(match, 'bot', () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32));
    assert.equal(match.players.bot.rowEffects.surface.remaining, 2);
    const targets = hitEvents(match).map(({ cardId }) => cardId);
    assert.equal(targets.length, 3);
    const next = step(step(match, { type: 'pass' }), { type: 'pass' });
    assert.deepEqual(next.players.bot.rowEffects, {});
    return targets;
  };
  assert.deepEqual(run(1), run(1));
  assert.notDeepEqual(run(1), run(2));
});

function withEmperorsHand() {
  let match = setup('emperors-hand');
  match.players.bot.board.orbit = [unit('marked', 5), unit('other', 5)];
  match = step(match, play('emperors-hand'));
  assert.equal(match.pending.rowWeather, 'firestorm');
  assert.deepEqual(availableOrders(match, 'human'), []);
  match = step(match, pick('surface'));
  assert.equal(match.log.find(({ type }) => type === 'row-effect').effect.remaining, 3);
  return nextHumanTurn(match);
}

test('the Emperor’s Hand has two delayed orbit charges, with one use per turn', () => {
  let match = withEmperorsHand();
  match = step(step(match, order('emperors-hand')), pick('marked'));
  assert.equal(findUnit(match, 'emperors-hand').card.orderCharges, 1);
  assert.strictEqual(step(match, order('emperors-hand')), match);
  match = nextHumanTurn(step(match, play('human-spare-0', 'surface')));
  match = step(step(match, order('emperors-hand')), pick('other'));
  assert.equal(findUnit(match, 'emperors-hand').card.orderCharges, 0);
  assert.equal(findUnit(match, 'other').card.inheritedDeathwishes[0].grantedBy, 'human');

  const surface = step(setup('emperors-hand'), play('emperors-hand', 'surface'));
  assert.equal(surface.pending, null);
  assert.deepEqual(surface.players.bot.rowEffects, {});
  assert.deepEqual(availableOrders(nextHumanTurn(surface), 'human'), []);
});

test('a death mark applies storm to the row of death after the ship is gone and adds to existing storm', () => {
  for (const previous of [0, 1]) {
    const match = step(step(withEmperorsHand(), order('emperors-hand')), pick('marked'));
    const target = match.players.bot.board.orbit.shift();
    match.players.bot.board.surface.push(target);
    match.players.bot.rowEffects = {};
    if (previous) setRowEffect(match, 'bot', 'surface', weather('firestorm', previous, 'bot'));
    damage(match, findUnit(match, 'emperors-hand'), 99);
    damage(match, findUnit(match, 'marked'), 99);
    progress(match, rng);
    assert.deepEqual(match.players.bot.rowEffects.surface, {
      type: 'firestorm', remaining: previous + 2, attacker: 'human', sourceDefinitionId: 'emperors-hand',
    });
    assert.equal(match.players.bot.rowEffects.orbit, undefined);
  }
});

test('cleansing, banishment and manual Deathwish activation do not trigger the firestorm mark', () => {
  for (const removal of ['cleanse', 'banish', 'activate-deathwish']) {
    const match = step(step(withEmperorsHand(), order('emperors-hand')), pick('marked'));
    const unit = findUnit(match, 'marked');
    if (removal === 'cleanse') {
      cleanse(match, unit);
      assert.equal(unit.card.inheritedDeathwishes, undefined);
      damage(match, unit, 99);
    } else if (removal === 'banish') {
      removeUnit(match, unit, 'banish');
      assert.equal(match.players.bot.exile.at(-1).id, 'marked');
    } else {
      runEffect(match, { side: 'bot', sourceId: unit.card.id,
        ability: { steps: [{ action: removal, target: { scope: 'source' } }] } }, rng);
    }
    progress(match, rng);
    assert.equal(match.players.bot.rowEffects.orbit, undefined);
  }
});

test('surface Brander has same-turn Zeal, spends one charge and triggers Aggressor as a light ship', () => {
  let match = setup('brander');
  match.players.human.board.orbit = [card('aggressor')];
  match.players.bot.board.orbit = [unit('victim', 5)];
  match = step(match, play('brander', 'surface'));
  assert.equal(findUnit(match, 'victim').card.power, 4);
  assert.equal(availableOrders(match, 'human')[0].card.id, 'brander');
  match = step(step(match, order('brander')), pick('orbit'));
  assert.deepEqual(match.log.find(({ type }) => type === 'row-effect').effect, {
    type: 'firestorm', remaining: 2, attacker: 'human', sourceDefinitionId: 'brander',
  });
  assert.equal(findUnit(match, 'brander').card.orderCharges, 0);
  assert.deepEqual(availableOrders(nextHumanTurn(match), 'human'), []);
  const orbit = step(setup('brander'), play('brander'));
  assert.deepEqual(availableOrders(nextHumanTurn(orbit), 'human'), []);
});


test('Salfurion casts on both rows, replaces the leader, and keeps its order across rounds', () => {
  const match = setup('salfurion');
  match.players.human.leader = createMatch({ humanLeader: 'fleet-admiral', random: rng }).players.human.leader;
  match.players.human.leader.lastUsedTurn = match.players.human.turns;
  assert.equal(match.players.human.leader.charges, 3);
  setRowEffect(match, 'bot', 'orbit', weather('firestorm', 2));
  setRowEffect(match, 'bot', 'surface', weather('rot', 6));
  const cast = step(match, play('salfurion'));
  const events = cast.log.slice(match.log.length);
  assert.deepEqual(events.filter(({ type }) => type === 'row-effect').slice(0, 2)
    .map(({ row, effect }) => [row, effect.type, effect.remaining]), [
    ['orbit', 'firestorm', 4], ['surface', 'firestorm', 2],
  ]);
  assert.equal(cast.players.human.discard.at(-1).definition.id, 'salfurion');
  assert.deepEqual(cast.players.human.board, { orbit: [], surface: [] });
  const { leader } = cast.players.human;
  assert.deepEqual([leader.id, leader.name, leader.art, leader.charges, leader.lastUsedTurn],
    ['salfurion', 'Салфурион', 'salfurion-portrait.webp', 0, undefined]);
  assert.equal(leader.order.cooldown, 3);
  assert.equal(leader.order.usesCharges, undefined);
  const journal = events.find(({ type }) => type === 'leader-replaced');
  assert.equal(eventText(journal), 'Ты: Салфурион занимает место лидера.');
  const playback = createPlaybackState(match);
  applyJournalEvent(playback, journal);
  assert.deepEqual(playback.players.human.leader, leader);
  assert.equal(canUseLeader(playback, 'human'), false);
  assert.equal(applyAction(cast, 'human', { type: 'leader' }, { random: rng }), cast);

  const next = nextHumanTurn(cast);
  assert.equal(next.players.human.turns, match.players.human.turns + 1);
  assert.equal(canUseLeader(next, 'human'), true);
  const ordered = step(next, { type: 'leader' });
  assert.equal(ordered.players.bot.rowEffects.orbit.remaining, 4);
  assert.equal(ordered.players.bot.rowEffects.surface.remaining, 2);
  assert.equal(leaderCooldown(ordered.players.human), 4);
  assert.equal(step(ordered, { type: 'leader' }), ordered);

  let after = ordered;
  for (let turn = 0; turn < 3; turn += 1) {
    after = nextHumanTurn(step(after, play('human-spare-' + turn, 'orbit', turn)));
    assert.equal(leaderCooldown(after.players.human), 3 - turn);
    assert.equal(canUseLeader(after, 'human'), false);
  }
  after = nextHumanTurn(step(after, play('human-spare-3', 'orbit', 3)));
  assert.equal(canUseLeader(after, 'human'), true);
  after = step(step(after, { type: 'pass' }), { type: 'pass' });
  assert.equal(after.round, 2);
  assert.deepEqual(after.players.bot.rowEffects, {});
  const roundTwo = confirmMulligan(after, [], { random: rng });
  assert.deepEqual(roundTwo.players.human.leader, after.players.human.leader);
  assert.equal(canUseLeader(roundTwo, 'human'), true);
});

test('Flame Inquisitor grows from strength lost to Firestorm and journals each boost', () => {
  const match = setup();
  const inquisitor = card('flame-inquisitor');
  match.players.human.board.surface = [inquisitor];
  match.players.bot.board.orbit = ['a', 'b', 'c'].map((id) => unit(id, 5));
  setRowEffect(match, 'bot', 'orbit', { ...weather('firestorm', 1), sourceDefinitionId: 'brander' });
  const rolls = [0, .4, .8];
  start(match, 'bot', () => rolls.shift());
  assert.deepEqual(hitEvents(match).map(({ cardId }) => cardId), ['a', 'b', 'c']);
  assert.equal(inquisitor.power, 5);
  assert.deepEqual(match.log.filter(({ type }) => type === 'boost').map(({ cardId, amount }) => [cardId, amount]),
    Array.from({ length: 3 }, () => [inquisitor.id, 1]));
});

test('Flame Inquisitor ignores armor, shields, friendly losses and ordinary damage, and only grows on the field', () => {
  const match = setup('flame-inquisitor');
  const inHand = match.players.human.hand[0];
  const inquisitor = createCard('on-field', inHand.definition);
  match.players.human.board.surface = [inquisitor];
  match.players.bot.board.orbit = [unit('protected', 5, { armor: 1, shield: true })];
  setRowEffect(match, 'bot', 'orbit', weather('firestorm', 1));
  start(match, 'bot');
  assert.equal(inquisitor.power, 3);
  assert.equal(inHand.power, 2);
  damage(match, findUnit(match, 'protected'), 1, 'ordinary-damage');
  assert.equal(inquisitor.power, 3);
  setRowEffect(match, 'human', 'surface', weather('firestorm', 1, 'bot'));
  start(match, 'human');
  assert.equal(inquisitor.power, 0);
  assert.equal(match.log.filter(({ type }) => type === 'boost').length, 1);
});

test('two Flame Inquisitors each gain up to 5 across both rows on every enemy turn', () => {
  let match = setup();
  const definition = findCardDefinition('flame-inquisitor');
  match.players.human.board.orbit = [createCard('first', definition)];
  match.players.human.board.surface = [createCard('second', definition)];
  match.players.bot.board.orbit = [unit('orbit-target', 12)];
  match.players.bot.board.surface = [unit('surface-target', 12)];
  match.players.bot.passed = true;
  for (const row of ['orbit', 'surface']) setRowEffect(match, 'bot', row, weather('firestorm', 2));
  for (const [turn, expected] of [[0, 7], [1, 12]]) {
    match = step(match, play('human-spare-' + turn, 'surface', 1 + turn));
    assert.equal(findUnit(match, 'first').card.power, expected);
    assert.equal(findUnit(match, 'second').card.power, expected);
  }
  assert.equal(hitEvents(match).length, 12);
});

test('Assault Tank orders are Surface-only, ready the following turn and usable once per turn', () => {
  let match = setup('assault-tank');
  const definition = findCardDefinition('assault-tank');
  match.players.human.board.surface = [createCard('ready-tank', definition)];
  match.players.bot.board.orbit = [unit('target', 5)];
  const orbit = step(match, play('assault-tank'));
  assert.equal(findUnit(orbit, 'assault-tank').card.armor, 2);
  assert.deepEqual(definition.categories, ['Бронетехника']);
  assert.ok(!availableOrders(nextHumanTurn(orbit), 'human').some(({ card }) => card.id === 'assault-tank'));

  match = step(match, play('assault-tank', 'surface', 1));
  assert.equal(match.turn, 'human');
  assert.equal(step(match, order('assault-tank')), match);
  match = nextHumanTurn(match);
  for (const strength of [4, 3]) {
    match = step(step(match, order('assault-tank')), pick('target'));
    assert.equal(findUnit(match, 'target').card.power, strength);
    assert.equal(step(match, order('assault-tank')), match);
    match = nextHumanTurn(step(match, play(match.players.human.hand[0].id)));
  }
});

test('Heavy Assault: Armor 1, a single surface order for 3 damage from the next turn, none from orbit', () => {
  let match = setup('assault');
  match.players.bot.board.orbit = [unit('victim', 5)];
  match = step(match, play('assault', 'surface'));
  const assault = findUnit(match, 'assault').card;
  assert.deepEqual([assault.power, assault.armor], [4, 1]);
  assert.equal(step(match, order('assault')), match);
  match = nextHumanTurn(match);
  assert.equal(availableOrders(match, 'human')[0].card.id, 'assault');
  match = step(step(match, order('assault')), pick('victim'));
  assert.equal(findUnit(match, 'victim').card.power, 2);
  assert.equal(findUnit(match, 'assault').card.orderCharges, 0);
  assert.deepEqual(availableOrders(nextHumanTurn(match), 'human'), []);
  const orbit = step(setup('assault'), play('assault'));
  assert.deepEqual(availableOrders(nextHumanTurn(orbit), 'human'), []);
});
