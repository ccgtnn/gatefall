import assert from 'node:assert/strict';
import test from 'node:test';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { chooseBotTurn, createBotView } from '../../docs/game/bot/bot.js';
import { effectSwing } from '../../docs/game/bot/bot-effect-value.js';
import { canUseLeader } from '../../docs/game/effects/effects.js';
import { createCard, ROW_LIMIT } from '../../docs/game/engine/board.js';
import { applyAction, createMatch } from '../../docs/game/engine/match.js';
import { unit } from '../helpers/battle-helpers.js';

const random = () => 0.99;
const choose = (match) => chooseBotTurn(match, 2, { random });
const act = (match, action) => applyAction(match, 'bot', action, { random });

function setup(id) {
  const match = createMatch({ random });
  match.phase = 'playing';
  match.turn = 'bot';
  for (const [side, player] of Object.entries(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.leader = null;
    player.hand = [unit(side + '-spare', 5), unit(side + '-next', 5)];
  }
  match.players.bot.hand = [createCard(id, findCardDefinition(id))];
  match.players.human.board.orbit = [unit('armored', 4, { armor: 8, shield: true })];
  match.players.human.board.surface = ['a', 'b', 'c'].map((cardId) => unit(cardId, 1, { token: true }));
  return match;
}

test('Firestorm aims for unarmored tokens and changes rows when a new storm would replace more existing value', () => {
  const cast = act(setup('firestorm'), { type: 'play', cardId: 'firestorm' });
  assert.deepEqual(choose(cast), { type: 'target', cardId: 'surface' });
  cast.players.human.rowEffects.surface = { type: 'firestorm', remaining: 3, attacker: 'bot' };
  cast.players.human.board.orbit = [unit('exposed', 6)];
  assert.deepEqual(choose(cast), { type: 'target', cardId: 'orbit' });
});

test('bot plays the Emperor’s Hand in orbit, Brander on surface, and uses Brander before ending its play turn', () => {
  for (const [id, row, other] of [['emperors-hand', 'orbit', 'surface'], ['brander', 'surface', 'orbit']]) {
    const match = setup(id);
    match.players.bot.usedAbility = true;
    const play = choose(match);
    assert.deepEqual(play, { type: 'play', cardId: id, row, position: 0 });
    const after = act(match, play);
    if (id === 'brander') {
      assert.equal(after.turn, 'bot');
      const order = choose(after);
      assert.deepEqual(order, { type: 'order', cardId: id });
      assert.deepEqual(choose(act(after, order)), { type: 'target', cardId: 'surface' });
    }
    match.players.bot.board[row] = Array.from({ length: ROW_LIMIT }, (_, i) => unit('filler-' + i, 1));
    match.players.bot.usedAbility = true;
    assert.equal(choose(match).row, other);
  }
});

test('bot marks a vulnerable unit with surviving neighbors and saves charges against a lone unit', () => {
  const match = setup('emperors-hand');
  match.players.bot.board.orbit = [match.players.bot.hand.pop()];
  match.players.bot.hand.push(unit('bot-spare', 3));
  match.players.human.board.surface = [unit('strong', 6), unit('weak', 1)];
  const pending = act(match, { type: 'order', cardId: 'emperors-hand' });
  assert.deepEqual(choose(pending), { type: 'target', cardId: 'weak' });
  match.players.human.board.surface = [unit('alone', 1)];
  assert.equal(choose(match).type, 'play');
});


test('bot plays Salfurion into both rows and uses its order once recharged against vulnerable units', () => {
  const match = setup('salfurion');
  const { human, bot } = match.players;
  match.round = 3;
  for (const row of ['orbit', 'surface']) {
    human.board[row] = Array.from({ length: 6 }, (_, i) => unit(row + i, 1, { token: true }));
  }
  bot.hand.push(unit('backup', 2));
  bot.usedAbility = true;
  const oldLeader = createMatch({ humanLeader: 'fleet-admiral', random }).players.human.leader;
  bot.leader = oldLeader;
  const chargedValue = effectSwing(match, 'bot', bot.hand[0]);
  bot.leader = { ...oldLeader, charges: 0 };
  assert.ok(effectSwing(match, 'bot', bot.hand[0]) > chargedValue);
  const play = choose(match);
  assert.deepEqual(play, { type: 'play', cardId: 'salfurion' });
  const cast = act(match, play);
  assert.equal(cast.turn, 'human');
  const [reply] = cast.players.human.hand;
  const ready = applyAction(cast, 'human', { type: 'play', cardId: reply.id, row: 'surface', position: cast.players.human.board.surface.length }, { random });
  // Once the deployment's ticks end, new units in both rows make the next order worthwhile.
  ready.players.human.rowEffects = {};
  ready.players.human.board.orbit = [unit('new-orbit', 4)];
  ready.players.human.board.surface = [unit('new-surface', 4)];
  const action = choose(ready);
  const beforeOrder = action.type === 'leader' ? ready : act(ready, action);
  assert.deepEqual(choose(beforeOrder), { type: 'leader' });
  const ordered = act(beforeOrder, { type: 'leader' });
  assert.equal(canUseLeader(ordered, 'bot'), false);

  ordered.turn = 'bot';
  ordered.playedCard = true;
  ordered.players.bot.turns = beforeOrder.players.bot.turns + 4;
  ordered.players.human.rowEffects = {};
  ordered.players.human.hand = [unit('last-enemy-card', 1)];
  for (const row of ['orbit', 'surface']) {
    ordered.players.human.board[row] = [unit('protected-' + row, 4, { armor: 2, shield: true })];
  }
  assert.equal(canUseLeader(ordered, 'bot'), true);
  assert.equal(choose(ordered).type, 'end-turn');
  ordered.players.human.board.surface = [unit('exposed', 4, { armor: 1, shield: true })];
  assert.deepEqual(choose(ordered), { type: 'leader' });
});

test('bot values Flame Inquisitor with active storms and values new storms with an Inquisitor on board', () => {
  const match = setup('flame-inquisitor');
  const { human, bot } = match.players;
  human.board.surface = [unit('victim', 20)];
  human.board.orbit = [unit('armored', 20, { armor: 3, shield: true })];
  const swing = () => {
    const [card] = createBotView(match).cards;
    return card.swing ?? card.power;
  };
  assert.equal(swing(), 2);
  human.rowEffects.orbit = { type: 'firestorm', remaining: 1, attacker: 'bot' };
  assert.equal(swing(), 2);
  human.rowEffects.surface = { type: 'firestorm', remaining: 1, attacker: 'bot' };
  assert.equal(swing(), 5);
  human.board.orbit = [unit('second', 20)];
  assert.equal(swing(), 7);
  human.rowEffects = {};
  const storm = createCard('firestorm', findCardDefinition('firestorm'));
  const alone = effectSwing(match, 'bot', storm);
  bot.board.orbit.push(bot.hand.shift());
  assert.ok(effectSwing(match, 'bot', storm) > alone);
});

test('bot plays Assault Tank on Surface and chooses a kill, then a shield', () => {
  const match = setup('assault-tank');
  match.players.bot.usedAbility = true;
  assert.deepEqual(choose(match), { type: 'play', cardId: 'assault-tank', row: 'surface', position: 0 });
  match.players.bot.board.surface = [match.players.bot.hand.shift()];
  match.players.bot.hand.push(unit('spare', 5));
  match.players.human.board.surface = [unit('strong', 10), unit('weak', 1)];
  const order = choose(match);
  assert.deepEqual(order, { type: 'order', cardId: 'assault-tank' });
  const pending = act(match, order);
  assert.deepEqual(choose(pending), { type: 'target', cardId: 'weak' });
  const resolved = act(pending, choose(pending));
  assert.ok(!resolved.players.human.board.surface.some(({ id }) => id === 'weak'));
  match.players.human.board.orbit = [];
  match.players.human.board.surface = [unit('strong', 10), unit('shield', 3, { shield: true })];
  assert.deepEqual(choose(act(match, order)), { type: 'target', cardId: 'shield' });
});
