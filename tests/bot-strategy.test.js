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

test('strategic bots do not bank a one-card lead and can pass with a large lead', () => {
  const match = position();
  match.players.bot.board.orbit = [plain('lead', 7)];
  match.log.push({ type: 'play', side: 'bot' });
  assert.equal(chooseBotTurn(match, 'normal').type, 'play');
  assert.equal(chooseBotTurn(match, 'hard').type, 'play');
  assert.equal(chooseBotTurn(match, 'easy').type, 'play');

  match.log.push({ type: 'play', side: 'bot' });
  match.players.bot.board.orbit[0].power = 20;
  assert.deepEqual(chooseBotTurn(match, 'normal'), pass);
  assert.deepEqual(chooseBotTurn(match, 'hard'), pass);
});

test('normal spends its last removal in round two when a life is at stake', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.board.orbit = [plain('small-enemy', 2)];
  match.players.bot.hand = [member('salvo', 'protectorate', 'orbital-salvo')];
  assert.deepEqual(chooseBotTurn(match, 'normal'), { type: 'play', cardId: 'salvo' });

  match.players.bot.lives = 2;
  assert.deepEqual(chooseBotTurn(match, 'normal'), pass);
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

test('changing the opponent’s hidden cards or either deck order cannot change a decision', () => {
  const match = position(3);
  const hidden = structuredClone(match);
  hidden.players.human.hand = hidden.players.human.hand.map(({ id }) => plain(id, 1000));
  hidden.players.human.deck = hidden.players.human.deck.toReversed().map(({ id }) => plain(id, 1000));
  hidden.players.bot.deck.reverse();
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

test('hard anticipates a visible Surface-only reply without reading the enemy hand', () => {
  const match = position(3);
  match.players.bot.hand = [plain('ship', 6)];
  match.players.bot.board.surface = [member('generator', 'protectorate', 'shield-generator')];
  match.players.human.leader = { ...FACTIONS.protectorate.leaders.find(({ id }) => id === 'fleet-admiral'), charges: 1 };
  assert.equal(chooseBotTurn(match, 'normal').row, 'surface');
  assert.equal(chooseBotTurn(match, 'hard').row, 'orbit');
});

test('the deciding round refuses to pass with legal cards when behind or the opponent can still reply', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const match = position(3);
    match.players.bot.hand = [plain('one', 1), plain('two', 2)];
    match.players.bot.board.orbit = [plain('ahead', 20)];
    assert.notEqual(chooseBotTurn(match, difficulty).type, 'pass');

    match.players.bot.board.orbit = [];
    match.players.human.board.orbit = [plain('enemy', 20)];
    match.players.human.passed = true;
    assert.equal(chooseBotTurn(match, difficulty).type, 'play');
  }
});

test('hard defends a passed second-round bleed with a cheap win', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.passed = true;
  match.players.human.board.orbit = [plain('bleed', 4)];
  match.players.bot.hand = [member('finisher', 'growth', 'colossus'), plain('cheap', 5)];
  assert.equal(chooseBotTurn(match, 'hard').cardId, 'cheap');
});

test('hard places Gate Guardian outside the row it is building for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('guard', 'protectorate', 'gate-guardian'),
    member('overload', 'protectorate', 'shield-overload')];
  match.players.bot.board.orbit = [member('bastion', 'protectorate', 'bastion')];
  const action = chooseBotTurn(match, 'hard');
  assert.equal(action.cardId, 'guard');
  assert.equal(action.row, 'surface');
});

test('hard reports ranked public decisions and scores from completed rollouts without mutating the match', () => {
  const match = position(3);
  const before = structuredClone(match);
  let trace;
  const action = chooseBotTurn(match, 'hard', {
    rolloutSamples: 2, onDecision: (report) => { trace = report; },
  });
  assert.deepEqual(match, before);
  assert.deepEqual(trace.action, action);
  assert.equal(trace.candidates.length, 3);
  assert.deepEqual(trace.candidates[0].action, action);
  assert.ok(trace.candidates.every(({ score, samples }) => Number.isFinite(score) && samples === 2));
  assert.ok(trace.candidates[0].score >= trace.candidates[1].score);
});
