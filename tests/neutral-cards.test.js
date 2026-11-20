import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { chooseBotTurn } from '../docs/game/bot.js';
import { FACTIONS, FIRST_SIGNAL, NEUTRAL_CARDS } from '../docs/game/cards.js';
import { availableOrders } from '../docs/game/effects.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';

const card = (id) => createCard(id, NEUTRAL_CARDS.find((definition) => definition.id === id));
const unit = (id, power = 3, extra) => createCard(id, { id, name: id, power, ...extra });
const count = (match, type) => match.log.filter((event) => event.type === type).length;
const play = (match, cardId, row = 'orbit', position = match.players[match.turn].board[row].length) =>
  applyAction(match, match.turn, { type: 'play', cardId, row, position });
const pick = (match, cardId) => applyAction(match, match.pending.side, { type: 'target', cardId });

function scenario(id) {
  const match = confirmMulligan(createMatch({ random: () => 0, rules: { leaderCharges: 0 } }));
  const { human, bot } = match.players;
  human.board.surface = [];
  human.hand = [card(id), unit('spare')];
  bot.hand = [unit('bot-spare')];
  return match;
}

test('all eleven neutrals are in the catalog and the temporary playtest additions are distinct', () => {
  assert.equal(NEUTRAL_CARDS.length, 11);
  assert.equal(new Set(NEUTRAL_CARDS.map(({ id }) => id)).size, 11);
  const ids = ({ deck }) => deck.filter(({ faction }) => faction === 'neutral').map(({ id }) => id).sort();
  assert.deepEqual(ids(FACTIONS.protectorate),
    ['annihilation', 'emp-grenade', 'gate-guardian', 'gate-relic', 'recon-drone']);
  assert.deepEqual(ids(FACTIONS.growth),
    ['annihilation', 'field-medic', 'gravity-pulse', 'liaison', 'veteran-mercenary']);
});

test('Veteran Mercenary damages a chosen ally and boosts itself, including self-targeting', () => {
  for (const target of ['ally', 'veteran-mercenary']) {
    const match = scenario('veteran-mercenary');
    match.players.human.board.surface = [unit('ally', 3)];
    match.players.bot.board.surface = [unit('enemy')];
    const pending = play(match, 'veteran-mercenary');
    assert.deepEqual(new Set(pending.pending.options), new Set(['ally', 'veteran-mercenary']));
    const next = pick(pending, target);
    assert.equal(next.players.human.board.orbit[0].power, target === 'ally' ? 6 : 4);
    assert.equal(next.players.human.board.surface[0].power, target === 'ally' ? 1 : 3);
  }
});

test('Smuggler gains three strength only with Initiative', () => {
  for (const acted of [false, true]) {
    const match = scenario('smuggler');
    match.players.human.roundActed = acted;
    assert.equal(play(match, 'smuggler').players.human.board.orbit[0].power, acted ? 3 : 6);
  }
});

test('Recon Drone moves only the selected card to top and an empty deck needs no target', () => {
  const match = scenario('recon-drone');
  match.players.human.deck = ['first', 'second', 'chosen', 'last'].map((id) => unit(id));
  const pending = play(match, 'recon-drone');
  assert.equal(pending.pending.kind, 'deck-top');
  assert.deepEqual(pending.pending.options, ['first', 'second', 'chosen', 'last']);
  assert.strictEqual(pick(pending, 'missing'), pending);
  assert.deepEqual(pick(pending, 'chosen').players.human.deck.map(({ id }) => id),
    ['chosen', 'first', 'second', 'last']);
  assert.equal(match.players.human.deck[0].id, 'first');
  match.players.human.deck.length = 0;
  assert.equal(play(match, 'recon-drone').pending, null);
});

test('EMP removes armor before dealing base damage plus all the armor removed', () => {
  for (const armor of [0, 4]) {
    const match = scenario('emp-grenade');
    match.players.bot.board.surface = [unit('target', 9, { armor })];
    const next = pick(play(match, 'emp-grenade'), 'target');
    assert.equal(next.players.bot.board.surface[0].armor, 0);
    assert.equal(next.players.bot.board.surface[0].power, 9 - 2 - armor);
  }
});

test('Gravity Pulse damages every unit in the selected opposing row only', () => {
  const match = scenario('gravity-pulse');
  match.players.human.board.surface = [unit('ally')];
  match.players.bot.board.surface = [unit('plain'), unit('shielded', 3, { armor: 1 }),
    createCard('artifact', FIRST_SIGNAL)];
  match.players.bot.board.orbit = [unit('elsewhere')];
  const pending = play(match, 'gravity-pulse');
  assert.equal(pending.pending.selectionSide, 'bot');
  const next = pick(pending, 'surface');
  assert.deepEqual(next.players.bot.board.surface.map(({ power, armor }) => [power, armor]),
    [[2, 0], [3, 0], [undefined, undefined]]);
  assert.equal(next.players.bot.board.orbit[0].power, 3);
  assert.equal(next.players.human.board.surface[0].power, 3);
});

test('Liaison counts its entry turn and draws only once on the fourth end of turn', () => {
  let match = scenario('liaison');
  match.players.human.hand.push(...['a', 'b', 'c', 'd', 'e'].map((id) => unit(id)));
  match.players.human.deck = [unit('top'), unit('next')];
  match.players.bot.passed = true;
  match = play(match, 'liaison');
  assert.equal(match.players.human.board.orbit[0].counter, 3);
  for (const [id, remaining] of [['a', 2], ['b', 1], ['c', 0], ['d', 0]]) {
    match = play(match, id);
    assert.equal(match.players.human.board.orbit[0].counter, remaining);
  }
  assert.equal(count(match, 'counter'), 4);
  assert.equal(count(match, 'draw'), 1);
  assert.ok(match.players.human.hand.some(({ id }) => id === 'top'));
  assert.equal(match.players.human.deck[0].id, 'next');
});

test('the counter resolves on pass and respects full hands or empty decks', () => {
  const match = scenario('liaison');
  const liaison = card('liaison');
  liaison.counter = 1;
  match.players.human.board.orbit = [liaison];
  const deckSize = match.players.human.deck.length;
  match.players.human.hand = Array.from({ length: 10 }, (_, index) => unit('hand-' + index));
  const next = applyAction(match, 'human', { type: 'pass' });
  assert.equal(next.players.human.board.orbit[0].counter, 0);
  assert.equal(next.players.human.deck.length, deckSize);
  assert.equal(count(next, 'draw'), 0);

  match.players.human.deck = [];
  match.players.human.hand = [];
  const empty = applyAction(match, 'human', { type: 'pass' });
  assert.equal(empty.players.human.board.orbit[0].counter, 0);
  assert.equal(count(empty, 'draw'), 0);
});

test('Field Medic restores a bronze unit from its own discard and resolves its deploy ability', () => {
  const match = scenario('field-medic');
  const recruit = unit('recruit', 3, { rarity: 'bronze', armor: 2, deploy: {
    steps: [{ action: 'boost', target: { scope: 'source' }, amount: 2 }],
  } });
  Object.assign(recruit, { power: 0, armor: 0, statuses: { infection: 3 } });
  match.players.human.discard = [recruit, card('gate-guardian'), card('emp-grenade')];
  match.players.bot.discard = [unit('enemy-dead', 3, { rarity: 'bronze' })];
  let pending = play(match, 'field-medic');
  assert.deepEqual(pending.pending.options, ['recruit']);
  assert.equal(pending.pending.pile, 'discard');
  pending = pick(pending, 'recruit');
  const next = applyAction(pending, 'human', { type: 'place', row: 'surface', position: 0 });
  assert.deepEqual(next.players.human.board.surface.map(({ id, power, armor, statuses }) =>
    [id, power, armor, statuses]), [['recruit', 5, 2, undefined]]);
  assert.deepEqual(next.players.human.discard.map(({ id }) => id), ['gate-guardian', 'emp-grenade']);
  assert.equal(next.log.find(({ cardId, type }) => type === 'play' && cardId === 'recruit').from, 'discard');

  match.players.human.discard = [];
  assert.equal(play(match, 'field-medic').pending, null);
});

test('Gate Relic can boost an allied unit and has two full intervening turns of cooldown', () => {
  let match = scenario('gate-relic');
  const player = match.players.human;
  player.board.surface = [unit('ally')];
  match.players.bot.passed = true;
  player.hand.push(...['a', 'b', 'c', 'd'].map((id) => unit(id)));
  match = play(match, 'gate-relic');
  assert.equal(availableOrders(match, 'human')[0].card.id, 'gate-relic');
  match = pick(applyAction(match, 'human', { type: 'order', cardId: 'gate-relic' }), 'ally');
  assert.equal(match.players.human.board.surface[0].power, 6);
  for (const id of ['a', 'b']) {
    match = play(match, id);
    assert.equal(availableOrders(match, 'human').length, 0);
  }
  match = play(match, 'c');
  assert.equal(availableOrders(match, 'human')[0].card.id, 'gate-relic');
});

test('Bounty Hunter is rewarded only when its hit kills', () => {
  for (const armor of [0, 2]) {
    const match = scenario('bounty-hunter');
    match.players.bot.board.surface = [unit('enemy', 5, { armor })];
    const next = pick(play(match, 'bounty-hunter'), 'enemy');
    assert.equal(next.players.human.board.orbit[0].power, armor ? 4 : 6);
    assert.equal(next.players.bot.discard.length, armor ? 0 : 1);
  }
});

test('Gate Guardian enters with five armor, stays after a partial loss and is discarded when it breaks', () => {
  let match = scenario('gate-guardian');
  match.players.bot.hand = [card('gravity-pulse'), card('emp-grenade'), unit('reserve')];
  match = play(match, 'gate-guardian');
  assert.equal(match.players.human.board.orbit[0].armor, 5);
  match = pick(play(match, 'gravity-pulse'), 'orbit');
  assert.equal(match.players.human.board.orbit[0].armor, 4);
  assert.equal(match.players.human.board.orbit[0].power, 12);
  match = play(match, 'spare', 'surface');
  match = pick(play(match, 'emp-grenade'), 'gate-guardian');
  assert.equal(match.players.human.board.orbit.length, 0);
  assert.equal(match.players.human.discard[0].id, 'gate-guardian');
  assert.equal(count(match, 'discard'), 1);
  assert.equal(count(match, 'death'), 0);
});

test('strategic bot sees revived units and can choose an enemy row by simulated damage', () => {
  const match = scenario('gravity-pulse');
  match.round = 3;
  match.turn = 'bot';
  match.players.bot.hand = [card('field-medic'), card('gravity-pulse'), unit('alternate', 5)];
  match.players.bot.discard = [unit('recruit', 6, { rarity: 'bronze' })];
  match.players.human.board.orbit = [unit('a'), unit('b'), unit('c')];
  match.players.human.board.surface = [unit('d')];
  for (const difficulty of ['normal', 'hard']) {
    assert.equal(chooseBotTurn(match, difficulty).cardId, 'field-medic');
    const pending = play(match, 'gravity-pulse');
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'orbit' });
  }
});
