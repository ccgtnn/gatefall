import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { chooseBotTurn } from '../docs/game/bot.js';
import { FACTIONS, LARVA } from '../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';

const standard = (id, definition) => createCard(id, definition);
const plain = (id, power) => standard(id, { id, name: id, type: 'unit', power });
const member = (id, faction, definition) =>
  standard(id, FACTIONS[faction].deck.find((card) => card.id === definition));
const pass = { type: 'pass' };

function position(round = 1, winner = null) {
  const match = confirmMulligan(createMatch({ random: () => .99 }));
  match.turn = 'bot';
  match.round = round;
  match.log = round === 1 ? [] : [{ type: 'round-end', round: 1, winner }];
  match.log.push({ type: 'round-start', round, side: 'bot' });
  for (const player of Object.values(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.hand = [plain('a', 3), plain('b', 4), plain('c', 5), plain('d', 6)];
    player.leader = null;
  }
  return match;
}

test('round one passes with a lead greater than average or on reaching its difficulty budget', () => {
  const match = position();
  match.players.bot.board.orbit = [plain('lead', 7)];
  assert.deepEqual(chooseBotTurn(match, 'normal'), pass);
  assert.deepEqual(chooseBotTurn(match, 'hard'), pass);
  assert.equal(chooseBotTurn(match, 'easy').type, 'play');

  match.players.bot.board.orbit = [];
  for (let i = 0; i < 3; i++) match.log.push({ type: 'play', side: 'bot', name: 'Earlier' });
  assert.deepEqual(chooseBotTurn(match, 'normal'), pass);
  assert.equal(chooseBotTurn(match, 'hard').type, 'play');
  match.log.push({ type: 'play', side: 'bot' });
  assert.deepEqual(chooseBotTurn(match, 'hard'), pass);
});

test('round one gives up expensive chases and respects the no-pass rule after an ability', () => {
  const match = position();
  match.players.human.board.orbit = [plain('ahead', 25)];
  assert.deepEqual(chooseBotTurn(match, 'normal'), pass);
  match.players.bot.usedAbility = true;
  assert.equal(chooseBotTurn(match, 'normal').type, 'play');
});

test('round two can dry pass after winning round one and fights after losing it', () => {
  const won = position(2, 'bot');
  assert.deepEqual(chooseBotTurn(won, 'normal'), pass);
  assert.deepEqual(chooseBotTurn(won, 'hard'), pass);
  won.players.human.passed = true;
  assert.equal(chooseBotTurn(won, 'normal').type, 'play');

  const lost = position(2, 'human');
  lost.players.bot.lives = 1;
  lost.players.human.board.orbit = [plain('ahead', 18)];
  assert.equal(chooseBotTurn(lost, 'normal').type, 'play');
  assert.equal(chooseBotTurn(lost, 'hard').type, 'play');
});

test('the deciding round uses a legal winning play and passes once the opponent is beaten', () => {
  const match = position(3, 'human');
  match.players.human.passed = true;
  match.players.human.board.orbit = [plain('enemy', 5)];
  const action = chooseBotTurn(match, 'hard');
  assert.equal(action.cardId, 'd');
  const after = applyAction(match, 'bot', action);
  assert.notStrictEqual(after, match);
  assert.deepEqual(chooseBotTurn(after, 'hard'), pass);
});

test('the strategic bot inserts between two armored allies for the double boost', () => {
  const match = position(3);
  match.players.bot.hand = [member('standard', 'protectorate', 'standard')];
  match.players.bot.board.surface = [member('left', 'protectorate', 'assault'), member('right', 'protectorate', 'warden')];
  for (const difficulty of ['normal', 'hard']) {
    assert.deepEqual(chooseBotTurn(match, difficulty),
      { type: 'play', cardId: 'standard', row: 'surface', position: 1 });
  }
});

test('Growth places a scavenger next to a larva and can trigger a valuable deathwish', () => {
  const match = position(3);
  match.players.bot.hand = [member('eater', 'growth', 'scavenger')];
  match.players.bot.board.surface = [member('predator', 'growth', 'predator'), standard('larva', LARVA)];
  const action = chooseBotTurn(match, 'normal');
  assert.equal(action.row, 'surface');
  const pending = applyAction(match, 'bot', action);
  assert.deepEqual(chooseBotTurn(pending, 'normal'), { type: 'target', cardId: 'larva' });

  match.players.bot.hand = [member('eater', 'growth', 'scavenger')];
  match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon'), standard('larva', LARVA)];
  const eating = applyAction(match, 'bot', { type: 'play', cardId: 'eater', row: 'surface', position: 1 });
  assert.deepEqual(chooseBotTurn(eating, 'hard'), { type: 'target', cardId: 'cocoon' });
});

test('changing hidden cards of either deck or the opponent hand cannot change a decision', () => {
  const match = position(3);
  const hidden = structuredClone(match);
  hidden.players.human.hand = hidden.players.human.hand.map(() => plain('secret', 1000));
  hidden.players.human.deck = [plain('secret-deck', 1000)];
  hidden.players.bot.deck = [plain('future-draw', 1000)];
  for (const difficulty of ['normal', 'hard']) {
    assert.deepEqual(chooseBotTurn(match, difficulty), chooseBotTurn(hidden, difficulty));
  }
});

test('the bot cashes in its armored row for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('overload', 'protectorate', 'shield-overload'), plain('ordinary', 4)];
  match.players.bot.board.orbit = [member('small-shield', 'protectorate', 'assault')];
  match.players.bot.board.surface = [member('big-shield', 'protectorate', 'bastion')];
  match.players.human.board.orbit = [plain('enemy', 15)];
  for (const difficulty of ['normal', 'hard']) {
    const action = chooseBotTurn(match, difficulty);
    assert.deepEqual(action, { type: 'play', cardId: 'overload' });
    const pending = applyAction(match, 'bot', action);
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'surface' });
  }
});

test('the bot plays Broodlord in the row with three larvae', () => {
  const match = position(3);
  match.players.bot.hand = [member('lord', 'growth', 'broodlord'), plain('ordinary', 5)];
  match.players.bot.board.orbit = [standard('spare-larva', LARVA)];
  match.players.bot.board.surface = ['a', 'b', 'c'].map((id) => standard(id, LARVA));
  for (const difficulty of ['normal', 'hard']) {
    const action = chooseBotTurn(match, difficulty);
    assert.equal(action.cardId, 'lord');
    assert.equal(action.row, 'surface');
  }
});

test('bot preserves finishers when their current payoff is weak', () => {
  for (const difficulty of ['normal', 'hard']) {
    const shields = position(3);
    shields.players.bot.hand = [member('overload', 'protectorate', 'shield-overload'), plain('ordinary', 4)];
    shields.players.bot.board.orbit = [member('small', 'protectorate', 'assault')];
    shields.players.human.board.orbit = [plain('enemy', 2)];
    assert.equal(chooseBotTurn(shields, difficulty).cardId, 'ordinary');

    const brood = position(3);
    brood.players.bot.hand = [member('lord', 'growth', 'broodlord'), plain('ordinary', 4)];
    assert.equal(chooseBotTurn(brood, difficulty).cardId, 'ordinary');
  }
});

test('both strategic bots explore multiple targets in one chain', () => {
  const match = position(3);
  match.players.bot.hand = [member('shot', 'growth', 'ravager')];
  match.players.bot.board.surface = [plain('costly', 8), member('spores', 'growth', 'spore-sac')];
  match.players.human.board.surface = [plain('small', 2), plain('large', 6)];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'shot', row: 'orbit', position: 0 });
  for (const difficulty of ['normal', 'hard']) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'spores' });
  }
});
