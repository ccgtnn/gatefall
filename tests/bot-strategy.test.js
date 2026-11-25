import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { HOUND } from '../docs/game/captains.js';
import { chooseBotTurn, createBotView } from '../docs/game/bot.js';
import { AWAKENING } from '../docs/game/choir.js';
import { FACTIONS, LARVA } from '../docs/game/cards.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch } from '../docs/game/match.js';

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

test('strategic bot uses a zealous Scavenger order to trigger a deathwish across rows', () => {
  const match = position(3);
  match.players.bot.hand = [member('eater', 'growth', 'scavenger')];
  match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon'), standard('larva', LARVA)];
  const played = applyAction(match, 'bot', { type: 'play', cardId: 'eater', row: 'orbit', position: 0 });
  for (const difficulty of ['normal', 'hard']) {
    const order = chooseBotTurn(played, difficulty);
    assert.deepEqual(order, { type: 'order', cardId: 'eater' });
    const pending = applyAction(played, 'bot', order);
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'cocoon' });
  }
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
  // Isolate the armor payoff from the hidden cards sampled by hard mode.
  match.players.human.hand = [];
  match.players.human.deck = [];
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
  // Compare the two row payoffs without sampling the opponent's hidden responses.
  match.players.human.hand = [];
  match.players.human.deck = [];
  match.players.human.board.orbit = [plain('enemy', 9)];
  for (const difficulty of ['normal', 'hard']) {
    const action = chooseBotTurn(match, difficulty);
    assert.equal(action.cardId, 'lord');
    assert.equal(action.row, 'surface');
  }

  const { definition } = match.players.bot.hand[0];
  match.players.bot.hand[0] = standard('lord', { ...definition, id: 'another-brood-finisher' });
  const [finisher] = createBotView(match).cards;
  assert.equal(finisher.preferredRow, 'surface');
  assert.equal(finisher.swing, finisher.power + 3);
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
  assert.equal(chooseBotTurn(match, 'hard', { rolloutSamples: 0 }).row, 'orbit');
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


test('the bot prioritizes new infection over refreshing an already infected enemy', () => {
  const match = position(3);
  match.players.bot.board.orbit = [member('spitter', 'growth', 'spitter')];
  const already = plain('infected', 8);
  already.armor = 10;
  already.statuses = { infection: 3 };
  const fresh = plain('fresh', 3);
  fresh.armor = 10;
  match.players.human.board.orbit = [already, fresh];
  const pending = applyAction(match, 'bot', { type: 'order', cardId: 'spitter' });
  for (const difficulty of ['easy', 'normal', 'hard']) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'fresh' });
  }
});

test('all difficulties use Skara at low coins and save her charge near the cap', () => {
  for (const mode of ['easy', 'normal', 'hard']) {
    const match = position(3);
    match.players.bot.leader = { ...FACTIONS.captains.leader, charges: 1 };
    match.players.bot.coins = 2;
    const action = chooseBotTurn(match, mode);
    assert.equal(action.type, 'leader');
    const pending = applyAction(match, 'bot', action);
    assert.ok(pending.pending.options.includes(chooseBotTurn(pending, mode).cardId));
    match.players.bot.coins = 8;
    assert.notEqual(chooseBotTurn(match, mode).type, 'leader');
  }
});

test('all difficulties prefer weak offerings and use the Priest to open an Awakening chapter', () => {
  for (const mode of ['easy', 'normal', 'hard']) {
    const match = position(3);
    match.players.bot.leader = { ...FACTIONS.choir.leader };
    match.players.bot.board.surface = [plain('strong', 6), plain('weak', 1)];
    const action = chooseBotTurn(match, mode);
    assert.equal(action.type, 'leader');
    const pending = applyAction(match, 'bot', action);
    assert.deepEqual(chooseBotTurn(pending, mode), { type: 'target', cardId: 'weak' });
    match.players.bot.board.surface.pop();
    assert.notEqual(chooseBotTurn(match, mode).type, 'leader');
    match.players.bot.board.orbit.push(createCard('scenario', AWAKENING));
    assert.equal(chooseBotTurn(match, mode).type, 'leader');
  }
});

test('the bot pays the highest affordable tribute for the Hound Recruiter', () => {
  for (const [coins, cost, hounds] of [[5, '3', 2], [6, '6', 4]]) {
    const match = position();
    match.players.bot.coins = coins;
    match.players.bot.hand.unshift(member('recruiter', 'captains', 'hound-recruiter'));
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'recruiter', row: 'surface', position: 0 });
    assert.equal(pending.pending.kind, 'tribute');

    for (const difficulty of ['easy', 'normal', 'hard']) {
      const action = chooseBotTurn(pending, difficulty);
      assert.deepEqual(action, { type: 'target', cardId: cost });
      const resolved = applyAction(pending, 'bot', action);
      assert.equal(resolved.players.bot.coins, coins - Number(cost));
      assert.equal(resolved.players.bot.board.surface.filter(({ definition }) => definition.id === HOUND.id).length, hounds);
    }
  }
});

test('the bot completes Right Fang’s order by moving its least valuable hand card to the bottom', () => {
  const match = position();
  match.players.bot.board.orbit = [member('fang', 'captains', 'hound-right-fang'), standard('hound', HOUND)];
  match.players.bot.hand = [plain('strong', 8), plain('weak', 2)];
  match.players.bot.deck = [plain('drawn', 5), plain('already-in-deck', 4)];
  const order = applyAction(match, 'bot', { type: 'order', cardId: 'fang' });
  const pending = applyAction(order, 'bot', { type: 'target', cardId: 'hound' });
  assert.equal(pending.pending.kind, 'hand-bottom');
  assert.ok(pending.pending.options.includes('drawn'));

  for (const difficulty of ['easy', 'normal', 'hard']) {
    const action = chooseBotTurn(pending, difficulty);
    assert.deepEqual(action, { type: 'target', cardId: 'weak' });
    const resolved = applyAction(pending, 'bot', action);
    assert.deepEqual(resolved.players.bot.deck.map(({ id }) => id), ['already-in-deck', 'weak']);
    assert.ok(!resolved.players.bot.hand.some(({ id }) => id === 'weak'));
  }
});

test('all bots end a turn with an empty hand after already using an order', () => {
  const match = position(3);
  const bot = match.players.bot;
  bot.hand = [];
  bot.coins = 2;
  bot.board.orbit = [
    standard('order', { id: 'order', name: 'Order', power: 4, zeal: true, order: {
      steps: [{ action: 'boost', target: { scope: 'source' }, amount: 1 }],
    } }),
    member('foreman', 'captains', 'hound-foreman'),
  ];
  const first = chooseBotTurn(match, 'easy');
  assert.deepEqual(first, { type: 'order', cardId: 'order' });
  const next = applyAction(match, 'bot', first);
  assert.equal(next.players.bot.usedAbility, true);
  assert.equal(canPass(next, 'bot'), false);
  assert.equal(canEndTurn(next, 'bot'), true);
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const action = chooseBotTurn(next, difficulty);
    assert.deepEqual(action, { type: 'end-turn' });
    assert.notStrictEqual(applyAction(next, 'bot', action), next);
  }
});
