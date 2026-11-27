import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { ANNIHILATION, FACTIONS, FIRST_SIGNAL, NEUTRAL } from '../../docs/game/cards/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { unit } from '../helpers/battle-helpers.js';

const spell = () => createCard('spell', ANNIHILATION);
const cast = { type: 'play', cardId: 'spell' };

function fixture() {
  const match = confirmMulligan(createMatch({ random: () => 0, rules: { leaderCharges: 0 } }));
  for (const player of Object.values(match.players)) player.leader.charges = 0;
  const { human, bot } = match.players;
  human.board.surface = [];
  human.hand = [spell(), unit('spare', 3)];
  bot.hand = [unit('opponent-spare', 3)];
  return match;
}

test('Annihilation is a neutral gold Effect, with one copy in each faction deck', () => {
  assert.equal(ANNIHILATION.faction, NEUTRAL);
  assert.equal(ANNIHILATION.type, 'effect');
  assert.equal(ANNIHILATION.rarity, 'gold');
  assert.equal(ANNIHILATION.provision, 12);
  for (const { deck } of Object.values(FACTIONS)) {
    assert.ok(deck.length >= 25);
    assert.deepEqual(deck.filter(({ id }) => id === ANNIHILATION.id), [ANNIHILATION]);
  }
});

test('Annihilation kills the strongest unit on either side through armor and triggers its deathwish', () => {
  for (const side of ['human', 'bot']) {
    const match = fixture();
    const spores = FACTIONS.growth.deck.find(({ id }) => id === 'spore-sac');
    const target = createCard('strongest', { ...spores, power: 9, armor: 12 });
    const player = match.players[side];
    player.board.orbit = [unit('weaker', 8), target, createCard('artifact', { ...FIRST_SIGNAL, power: 30 })];
    const next = applyAction(match, 'human', cast);
    assert.equal(next.players[side].exile.length, 0);
    assert.equal(next.players[side].discard.find(({ id }) => id === target.id).armor, 12);
    assert.equal(next.players[side].board.orbit[1].definition.id, 'larva');
    assert.ok(!next.log.some(({ type }) => type === 'damage'));
    assert.equal(next.log.find(({ type, reason }) => type === 'death' && reason === 'destroy').visual, 'annihilation');
    assert.ok(next.players.human.discard.some(({ id }) => id === 'spell'));
    assert.equal(match.players.human.roundActed, false);
  }
});

test('Initiative snapshots all strongest units, including ties within one row and across sides', () => {
  const match = fixture();
  match.players.human.board.orbit = [unit('friendly-one', 8), unit('friendly-two', 8), unit('weak', 7)];
  match.players.bot.board.surface = [unit('enemy', 8)];
  const next = applyAction(match, 'human', cast, { random: () => assert.fail('Initiative does not draw a target') });
  assert.deepEqual(next.players.human.discard.filter(({ id }) => id !== 'spell').map(({ id }) => id), ['friendly-one', 'friendly-two']);
  assert.deepEqual(next.players.bot.discard.filter(({ id }) => id !== 'spell').map(({ id }) => id), ['enemy']);
  assert.equal(next.players.human.board.orbit[0].id, 'weak');
  assert.equal(next.players.human.roundActed, true);
  assert.equal(next.players.bot.roundActed, false);
});

test('a regular cast randomly destroys exactly one tied unit, even when it is friendly', () => {
  for (const [roll, side] of [[0, 'human'], [.99, 'bot']]) {
    const match = fixture();
    match.players.human.roundActed = true;
    match.players.human.board.orbit = [unit('friendly', 8)];
    match.players.bot.board.surface = [unit('enemy', 8)];
    const next = applyAction(match, 'human', cast, { random: () => roll });
    assert.equal(next.players[side].discard.filter(({ id }) => id !== 'spell').length, 1);
    assert.equal(next.log.filter(({ type, reason }) => type === 'death' && reason === 'destroy').length, 1);
  }
});

test('a leader or Order consumes Initiative, and the next round resets it', () => {
  for (const action of [{ type: 'leader' }, { type: 'order', cardId: 'order' }]) {
    const match = fixture();
    const noop = { steps: [] };
    match.players.human.leader = { name: 'Leader', charges: 1, ability: noop };
    match.players.human.board.orbit = [unit('order', 8, { order: noop })];
    match.players.bot.board.orbit = [unit('enemy', 8)];
    const activated = applyAction(match, 'human', action);
    assert.equal(activated.players.human.roundActed, true);
    assert.equal(applyAction(activated, 'human', cast, { random: () => .99 }).players.human.discard.filter(({ id }) => id !== 'spell').length, 0);
  }

  let match = fixture();
  match.players.human.roundActed = match.players.bot.roundActed = true;
  match = applyAction(match, 'human', { type: 'pass' });
  match = applyAction(match, 'bot', { type: 'pass' });
  const next = confirmMulligan(match);
  assert.ok(Object.values(next.players).every(({ roundActed }) => !roundActed));
});

test('an empty field or artifact-only field cannot consume Initiative', () => {
  const match = fixture();
  match.players.human.board.orbit = [createCard('artifact', FIRST_SIGNAL)];
  assert.strictEqual(applyAction(match, 'human', cast), match);
  assert.equal(match.players.human.roundActed, false);
});

test('both strategic bots value an Initiative sweep and avoid destroying their only strongest unit', () => {
  for (const difficulty of [4, 6]) {
    const match = fixture();
    match.round = 3;
    match.turn = 'bot';
    match.players.bot.hand = [spell(), unit('ordinary', 5)];
    match.players.bot.board.orbit = [unit('own', 4)];
    match.players.human.board.surface = Array.from({ length: 4 }, (_, i) => unit('enemy-' + i, 4));
    assert.deepEqual(chooseBotTurn(match, difficulty), cast, difficulty);
    match.players.bot.roundActed = true;
    assert.equal(chooseBotTurn(match, difficulty).cardId, 'ordinary', difficulty);

    match.players.bot.board.orbit[0].power = 9;
    assert.equal(chooseBotTurn(match, difficulty).cardId, 'ordinary', difficulty);
    match.players.bot.hand = [spell()];
    match.round = 2;
    assert.equal(chooseBotTurn(match, difficulty).type, 'pass', difficulty);
  }
});

test('a prior card play removes Initiative through the rest of the round for that player', () => {
  let match = fixture();
  match = applyAction(match, 'human', { type: 'play', cardId: 'spare', row: 'orbit', position: 0 });
  assert.equal(match.players.human.roundActed, true);
  assert.equal(match.players.bot.roundActed, false);
  match = applyAction(match, 'bot', { type: 'play', cardId: 'opponent-spare', row: 'surface', position: 0 });
  const next = applyAction(match, 'human', cast, { random: () => 0 });
  assert.deepEqual(next.players.human.discard.filter(({ id }) => id !== 'spell').map(({ id }) => id), ['spare']);
  assert.equal(next.players.bot.exile.length, 0);
});

test('hard reserves Annihilation against a lone enemy of strength five or less', () => {
  for (const power of [1, 3, 5]) {
    const match = fixture();
    match.turn = 'bot';
    match.players.bot.hand = [spell(), unit('alternative', 1)];
    match.players.human.board.surface = [unit('small', power)];
    assert.notEqual(chooseBotTurn(match, 6).cardId, 'spell');
    match.round = 3;
    assert.equal(chooseBotTurn(match, 6).cardId, 'alternative');
  }
});

test('hard uses an expensive removal when it kills enough strength or secures a passed round', () => {
  const match = fixture();
  match.turn = 'bot';
  match.round = 3;
  match.players.bot.hand = [spell(), unit('alternative', 2)];
  match.players.bot.board.surface = [unit('friendly', 1)];
  match.players.human.board.surface = [unit('large', 12)];
  assert.deepEqual(chooseBotTurn(match, 6), cast);
  match.players.human.board.surface[0].power = 5;
  match.players.human.passed = true;
  assert.deepEqual(chooseBotTurn(match, 6), cast);
});
