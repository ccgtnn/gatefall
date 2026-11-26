import assert from 'node:assert/strict';
import test from 'node:test';
import { COIN_LIMIT, ROW_LIMIT, createCard } from '../../docs/game/board.js';
import { CAPTAIN_CARDS, HOUND } from '../../docs/game/captains.js';
import { createBotView, pickBotTarget } from '../../docs/game/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { BOT_LEVELS, chooseBotTurn as decideAtLevel } from '../../docs/game/bot.js';
import { evaluatePosition } from '../../docs/game/bot-evaluation.js';
import { visibleSupply } from '../../docs/game/bot-rollouts.js';
import { readBotLevel } from '../../docs/game/bot-levels.js';
import { delayedCardValue, futureContext, remainingTurns } from '../../docs/game/bot-future-value.js';
import { publicMatch } from '../../docs/game/bot-strategy.js';
import { deckCardValue, effectSwing } from '../../docs/game/bot-effect-value.js';
import { AWAKENING, CHOIR_CARDS, TENTACLE } from '../../docs/game/choir.js';
import { FACTIONS, LARVA } from '../../docs/game/cards.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch } from '../../docs/game/match.js';

const standard = (id, definition) => createCard(id, definition);
const plain = (id, power) => standard(id, { id, name: id, type: 'unit', power });
const member = (id, faction, definition) =>
  standard(id, FACTIONS[faction].deck.find((card) => card.id === definition));
const pass = { type: 'pass' };

function position(round = 1, winner = null) {
  const match = confirmMulligan(createMatch({ random: () => .99 }));
  match.turn = 'bot';
  match.round = round;
  if (round === 2 && winner) match.players[winner === 'bot' ? 'human' : 'bot'].lives = 1;
  match.log = round === 1 ? [] : [{ type: 'round-end', round: 1, winner }];
  match.log.push({ type: 'round-start', round, side: 'bot' });
  for (const player of Object.values(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.hand = [plain('a', 3), plain('b', 4), plain('c', 5), plain('d', 6)];
    player.leader = null;
  }
  return match;
}

test('strategic bots keep playing with a narrow lead and can pass with a large lead', () => {
  const match = position();
  match.players.bot.board.orbit = [plain('lead', 4)];
  match.log.push({ type: 'play', side: 'bot' });
  assert.equal(chooseBotTurn(match, 4).type, 'play');
  assert.equal(chooseBotTurn(match, 2).type, 'play');

  match.log.push({ type: 'play', side: 'bot' });
  match.players.bot.board.orbit[0].power = 20;
  assert.deepEqual(chooseBotTurn(match, 4), pass);
  assert.deepEqual(chooseBotTurn(match, 6), pass);
});

test('level 4 spends its last removal in round two when a life is at stake', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.board.orbit = [plain('small-enemy', 2)];
  match.players.bot.hand = [member('salvo', 'protectorate', 'orbital-salvo')];
  assert.deepEqual(chooseBotTurn(match, 4), { type: 'play', cardId: 'salvo' });

  match.players.bot.lives = 2;
  assert.deepEqual(chooseBotTurn(match, 4), pass);
});

test('round one gives up expensive chases and respects the no-pass rule after an ability', () => {
  const match = position();
  match.players.human.board.orbit = [plain('ahead', 25)];
  assert.deepEqual(chooseBotTurn(match, 4), pass);
  match.players.bot.usedAbility = true;
  assert.equal(chooseBotTurn(match, 4).type, 'play');
});

test('round two can dry pass after winning round one and fights after losing it', () => {
  const won = position(2, 'bot');
  won.players.bot.hand = [plain('small', 2), plain('spare', 3)];
  won.players.human.board.orbit = [plain('lead', 22)];
  assert.deepEqual(chooseBotTurn(won, 4), pass);
  assert.deepEqual(chooseBotTurn(won, 6), pass);
  won.players.human.passed = true;
  won.players.human.board.orbit = [plain('passed-lead', 1)];
  assert.equal(chooseBotTurn(won, 4).type, 'play');

  const lost = position(2, 'human');
  lost.players.human.board.orbit = [plain('ahead', 18)];
  assert.equal(chooseBotTurn(lost, 4).type, 'play');
  assert.equal(chooseBotTurn(lost, 6).type, 'play');
});

test('in the deciding round every bot keeps playing while a card is legal, even with a winning lead', () => {
  const match = position(3, 'human');
  const { bot, human } = match.players;
  bot.board.orbit = [plain('ahead', 10)];
  bot.hand = [standard('surface-only', { id: 'surface-only', power: 1, requiredRow: 'surface' })];
  human.board.orbit = [plain('enemy', 5)];
  human.hand = [];
  for (const opponentPassed of [true, false]) {
    human.passed = opponentPassed;
    for (const difficulty of [2, 4, 6]) {
      const action = chooseBotTurn(match, difficulty);
      assert.equal(action.type, 'play', difficulty);
      assert.notStrictEqual(applyAction(match, 'bot', action), match, difficulty);
    }
  }

  bot.board.surface = Array.from({ length: ROW_LIMIT }, (_, i) => plain('filled-' + i, 1));
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), pass, difficulty);
  }
});

test('the level 2 bot evaluates deathwish sacrifices and skips the leader when there are no legal victims', () => {
  const match = position();
  const { bot } = match.players;
  bot.leader = { ...FACTIONS.growth.leaders.find(({ id }) => id === 'devourer'), charges: 1 };
  bot.board.orbit = [member('spores', 'growth', 'spore-sac'), plain('neighbor', 4)];
  assert.equal(chooseBotTurn(match, 2).type, 'leader');
  bot.board.orbit = [];
  assert.equal(chooseBotTurn(match, 2).type, 'play');
});

test('the strategic bot inserts between two armored allies for the double boost', () => {
  const match = position(3);
  match.players.bot.hand = [member('standard', 'protectorate', 'standard')];
  match.players.bot.board.surface = [member('left', 'protectorate', 'assault'), member('right', 'protectorate', 'warden')];
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty),
      { type: 'play', cardId: 'standard', row: 'surface', position: 1 });
  }
});

test('strategic bot uses a zealous Scavenger order to trigger a deathwish across rows', () => {
  const match = position(3);
  match.players.bot.hand = [member('eater', 'growth', 'scavenger')];
  match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon'), standard('larva', LARVA)];
  const played = applyAction(match, 'bot', { type: 'play', cardId: 'eater', row: 'orbit', position: 0 });
  for (const difficulty of [4, 6]) {
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
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), chooseBotTurn(hidden, difficulty));
  }
});

test('the bot cashes in its armored row for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('overload', 'protectorate', 'shield-overload'), plain('ordinary', 1)];
  match.players.bot.board.orbit = [member('small-shield', 'protectorate', 'assault')];
  match.players.bot.board.surface = [member('big-shield', 'protectorate', 'bastion')];
  match.players.human.board.orbit = [plain('enemy', 15)];
  // Isolate the armor payoff from the hidden cards sampled by hard mode.
  match.players.human.hand = [];
  match.players.human.passed = true;
  match.players.human.deck = [];
  for (const difficulty of [2, 4, 6]) {
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'overload' });
    if (difficulty !== 2) assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'play', cardId: 'overload' });
    const ownRow = chooseBotTurn(pending, difficulty);
    assert.deepEqual(ownRow, { type: 'target', cardId: 'surface' });
    const enemy = applyAction(pending, 'bot', ownRow);
    assert.deepEqual(chooseBotTurn(enemy, difficulty), { type: 'target', cardId: 'orbit' });
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
  for (const difficulty of [4, 6]) {
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
  for (const difficulty of [4, 6]) {
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
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'spores' });
  }
});

test('level 6 anticipates a visible Surface-only reply without reading the enemy hand', () => {
  const match = position(3);
  match.players.bot.hand = [plain('ship', 6), plain('spare', 1)];
  match.players.bot.board.surface = [standard('armor-aura', {
    type: 'artifact', endTurn: { steps: [{ action: 'armor', target: { scope: 'neighbors' }, amount: 1 }] },
  })];
  match.players.human.leader = { name: 'Surface battery', charges: 1, ability: {
    select: [{ ref: 'enemy', targets: { scope: 'enemy', type: 'unit', row: 'surface' } }],
    steps: [{ action: 'damage', target: { scope: 'ref', ref: 'enemy' }, amount: 6 }],
  } };
  assert.equal(chooseBotTurn(match, 2).row, 'surface');
  assert.equal(chooseBotTurn(match, 6, { rolloutSamples: 0 }).row, 'orbit');
});

test('the deciding round refuses to pass with legal cards when behind or the opponent can still reply', () => {
  for (const difficulty of [2, 4, 6]) {
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

test('level 6 defends a passed second-round bleed with a cheap win', () => {
  const match = position(2, 'human');
  match.players.bot.lives = 1;
  match.players.human.passed = true;
  match.players.human.board.orbit = [plain('bleed', 4)];
  match.players.bot.hand = [member('finisher', 'growth', 'colossus'), plain('cheap', 5)];
  assert.equal(chooseBotTurn(match, 6).cardId, 'cheap');
});

test('level 6 places Gate Guardian outside the row it is building for Shield Overload', () => {
  const match = position(3);
  match.players.bot.hand = [member('guard', 'protectorate', 'gate-guardian'),
    member('overload', 'protectorate', 'shield-overload')];
  match.players.bot.board.orbit = [member('bastion', 'protectorate', 'bastion')];
  const action = chooseBotTurn(match, 6);
  assert.equal(action.cardId, 'guard');
  assert.equal(action.row, 'surface');
});

test('level 6 reports ranked public decisions and scores from completed rollouts without mutating the match', () => {
  const match = position(3);
  const before = structuredClone(match);
  let trace;
  const action = chooseBotTurn(match, 6, {
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
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'fresh' });
  }
});

test('all difficulties use Skara at low coins and save her charge near the cap', () => {
  for (const mode of [2, 4, 6]) {
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
  for (const mode of [2, 4, 6]) {
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

    for (const difficulty of [2, 4, 6]) {
      const action = chooseBotTurn(pending, difficulty);
      assert.deepEqual(action, { type: 'target', cardId: cost });
      const resolved = applyAction(pending, 'bot', action);
      assert.equal(resolved.players.bot.coins, coins - Number(cost));
      assert.equal(resolved.players.bot.board.surface.filter(({ definition }) => definition.id === HOUND.id).length, hounds);
    }
  }
});

test('the bot completes Right Fang’s order by moving its least valuable hand card to the bottom', () => {
  const match = position(3);
  match.players.human.passed = true;
  match.players.human.hand = [];
  match.players.human.deck = [];
  match.players.bot.board.orbit = [member('fang', 'captains', 'hound-right-fang'), standard('hound', HOUND)];
  match.players.bot.hand = [plain('strong', 8), plain('weak', 2)];
  match.players.bot.deck = [plain('drawn', 5), plain('already-in-deck', 4)];
  const order = applyAction(match, 'bot', { type: 'order', cardId: 'fang' });
  const pending = applyAction(order, 'bot', { type: 'target', cardId: 'hound' });
  assert.equal(pending.pending.kind, 'hand-bottom');
  assert.ok(pending.pending.options.includes('drawn'));

  for (const difficulty of [2, 4, 6]) {
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
    member('eyes', 'captains', 'hound-eyes'),
    standard('strong-hound', HOUND),
  ];
  bot.board.orbit[2].power = 6;
  const first = { type: 'order', cardId: 'order' };
  const next = applyAction(match, 'bot', first);
  assert.equal(next.players.bot.usedAbility, true);
  assert.equal(canPass(next, 'bot'), false);
  assert.equal(canEndTurn(next, 'bot'), true);
  for (const difficulty of [2, 4, 6]) {
    const action = chooseBotTurn(next, difficulty);
    assert.deepEqual(action, { type: 'end-turn' });
    assert.notStrictEqual(applyAction(next, 'bot', action), next);
  }
});


test('the position evaluation counts the Fence payout only while coins can fit', () => {
  const fence = CAPTAIN_CARDS.find(({ id }) => id === 'stolen-goods-fence');
  const control = { ...fence, id: 'plain-fence', counter: undefined };
  const match = position();
  match.players.bot.deck = [];
  match.players.bot.hand = [plain('spare-a', 3), plain('spare-b', 3), plain('spare-c', 3)];
  const rating = (definition) => {
    match.players.bot.board.orbit = [standard('producer', definition)];
    return evaluatePosition(match, 'bot');
  };
  assert.ok(rating(fence) > rating(control));
  match.players.bot.coins = COIN_LIMIT;
  assert.equal(rating(fence), rating(control));
});

test('all bots can spend a Generator charge on armor synergy', () => {
  const match = position(3);
  match.players.bot.hand = [member('formation', 'protectorate', 'standard')];
  const commander = member('commander', 'protectorate', 'commander');
  commander.readyAt = 10;
  match.players.bot.board.surface = [member('generator', 'protectorate', 'shield-generator'), commander, plain('large', 9)];
  match.players.human.board.surface = [plain('enemy', 20)];
  match.playedCard = true;
  const order = { type: 'order', cardId: 'generator' };
  const pending = applyAction(match, 'bot', order);
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'commander' });
  }
  const result = applyAction(pending, 'bot', chooseBotTurn(pending));
  assert.equal(result.players.bot.board.surface[1].armor, 2);
  assert.equal(result.players.bot.board.surface[0].orderCharges, 2);
});


test('each bot uses Incubator each turn with space and targets the available row', () => {
  for (const difficulty of [2, 4, 6]) {
    let match = position(3);
    const { bot, human } = match.players;
    bot.board.orbit = [member('incubator', 'growth', 'incubator'),
      ...Array.from({ length: 8 }, (_, i) => plain('blocked-' + i, 1))];
    bot.hand = [plain('keep', 2), plain('spare', 2)];
    human.board.orbit = [plain('enemy', 20)];
    const order = { type: 'order', cardId: 'incubator' };
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
    match = applyAction(match, 'bot', order);
    assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'target', cardId: 'surface' });
    match = applyAction(match, 'bot', chooseBotTurn(match, difficulty));
    assert.equal(match.players.bot.board.surface.length, 2);
    assert.notDeepEqual(chooseBotTurn(match, difficulty), order);
    match = applyAction(match, 'bot', { type: 'play', cardId: 'keep', row: 'surface', position: 2 });
    match = applyAction(match, 'human', { type: 'pass' });
    assert.deepEqual(chooseBotTurn(match, difficulty), order);
  }
});

test('Predator lets every bot choose a friendly Deathwish rather than an enemy', () => {
  for (const difficulty of [2, 4, 6]) {
    const match = position(3);
    match.players.bot.hand = [member('predator', 'growth', 'predator')];
    match.players.bot.board.surface = [member('cocoon', 'growth', 'cocoon')];
    match.players.human.board.surface = [plain('enemy', 12)];
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'predator', row: 'surface', position: 1 });
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'cocoon' });
    const next = applyAction(pending, 'bot', chooseBotTurn(pending, difficulty));
    assert.deepEqual(next.players.bot.board.surface.map(({ power }) => power), [1, 1, 7]);
  }
});

test('all bots hold Genome Keeper with an empty discard and play it with three useful Deathwishes', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const card = (id) => standard(id, FACTIONS.growth.pool.find((definition) => definition.id === id));
  bot.hand = [card('genome-keeper'), plain('alternative', 4), card('predator')];
  human.board.surface = [plain('foe', 10), plain('another', 7)];
  const modes = [2, 4, 6];
  for (const mode of modes) assert.notEqual(chooseBotTurn(match, mode, { rolloutSamples: 0 }).cardId, 'genome-keeper');
  bot.discard = ['acid-capsule', 'cocoon', 'spore-sac'].map(card);
  for (const mode of modes) assert.equal(chooseBotTurn(match, mode, { rolloutSamples: 0 }).cardId, 'genome-keeper', mode);
});

test('all bots prefer a Deathwish or Larva over consuming an equally strong plain unit', () => {
  for (const sacrifice of [standard('larva', LARVA), member('cocoon', 'growth', 'cocoon')]) {
    const match = position(3);
    const { bot } = match.players;
    bot.hand = [member('predator', 'growth', 'predator'), plain('alternate', 3)];
    bot.board.surface = [plain('blank', sacrifice.power), sacrifice];
    const pending = applyAction(match, 'bot', { type: 'play', cardId: 'predator', row: 'surface', position: 2 });
    for (const mode of [2, 4, 6]) {
      assert.equal(chooseBotTurn(pending, mode, { rolloutSamples: 0 }).cardId, sacrifice.id, mode);
    }
  }
});

test('Vine and Spore Sac gain forecast value as they mature, and Fence needs time to pay out', () => {
  const match = position(3);
  match.players.human.board.surface = ['a', 'b', 'c'].map((id) => plain(id, 8));
  match.players.bot.hand.push(member('predator', 'growth', 'predator'));
  const context = futureContext(match, 'bot');
  for (const id of ['vine', 'spore-sac']) {
    const card = member(id, 'growth', id);
    const before = delayedCardValue(context, card, 'surface');
    assert.ok(delayedCardValue(context, { ...card, growth: 2 }, 'surface') > before);
  }
  const fence = standard('fence', CAPTAIN_CARDS.find(({ id }) => id === 'stolen-goods-fence'));
  assert.ok(delayedCardValue(context, fence, 'surface') > 0);
  match.players.bot.hand = [plain('last', 4)];
  assert.equal(delayedCardValue(futureContext(match, 'bot'), fence, 'surface'), 0);
});

test('bot avoids breaking Boil armor when a safer damage or armor target exists', () => {
  const match = position(3);
  const definition = FACTIONS.growth.pool.find(({ id }) => id === 'boil');
  match.players.human.board.surface = [standard('enemy-boil', definition), plain('enemy-unit', 4)];
  match.pending = { side: 'bot', options: ['enemy-boil', 'enemy-unit'], kind: 'damage', amount: 3 };
  assert.equal(pickBotTarget(match).cardId, 'enemy-unit');
  match.players.bot.board.orbit = [standard('own-boil', definition), { ...plain('armored', 2), armor: 1 }];
  match.pending = { side: 'bot', options: ['own-boil', 'armored'], kind: 'spend-armor' };
  assert.equal(pickBotTarget(match).cardId, 'armored');
});

test('level 6 bot decisions including rollout scores repeat with the same seed', () => {
  const match = position(3);
  function decide() {
    let seed = 4831;
    let trace;
    const action = chooseBotTurn(structuredClone(match), 6, {
      random: () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
      rolloutSamples: 2,
      onDecision: (decision) => { trace = decision; },
    });
    return { action, trace };
  }
  const first = decide();
  assert.ok(first.trace.candidates.some(({ samples }) => samples > 0));
  assert.deepEqual(decide(), first);
});

test('public bot analysis forecasts the real number of human turns without reading hidden cards', () => {
  for (const count of [0, 1, 3, 6]) {
    const match = position();
    match.players.human.hand = Array.from({ length: count }, (_, i) => plain('hidden-' + i, 5));
    const state = publicMatch(match);
    assert.deepEqual(state.players.human.hand.map(({ id }) => id), count ? ['unknown-play'] : []);
    assert.equal(state.players.human.publicHandSize, count);
    assert.equal(remainingTurns(state, 'human'), Math.min(4, count));
  }
});

test('all difficulties pay to restore Left Fang when it can hit a packed enemy row', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const fang = member('fang', 'captains', 'hound-left-fang');
  fang.readyAt = bot.turns + 1;
  bot.coins = 5;
  bot.board.orbit = [fang, standard('token', HOUND)];
  bot.board.orbit[1].power = 1;
  human.board.surface = Array.from({ length: 8 }, (_, i) => plain('enemy-' + i, 1));
  human.passed = true;
  match.playedCard = true;
  const fee = { type: 'fee', cardId: 'fang' };
  for (const difficulty of [2, 4, 6]) {
    const options = { random: () => .5, rolloutSamples: 0 };
    assert.deepEqual(chooseBotTurn(match, difficulty, options), fee, difficulty);
    const ready = applyAction(match, 'bot', fee);
    assert.equal(ready.players.bot.coins, 0);
    assert.deepEqual(chooseBotTurn(ready, difficulty, options), { type: 'order', cardId: 'fang' }, difficulty);
  }
  human.board.surface = [];
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), { type: 'end-turn' }, difficulty);
  }
});

test('Fang Orders destroy a weak Hound, accounting for a useful Deathwish', () => {
  const match = position(3);
  const { bot, human } = match.players;
  const spores = member('spores', 'growth', 'spore-sac').definition;
  bot.board.orbit = [
    member('fang', 'captains', 'hound-left-fang'),
    standard('weak-token', HOUND),
    standard('useful-deathwish', { ...spores, categories: HOUND.categories, power: 3 }),
    standard('strong-hound', { ...HOUND, power: 7 }),
  ];
  human.board.surface = [plain('enemy', 5)];
  const pending = applyAction(match, 'bot', { type: 'order', cardId: 'fang' });
  // A grown Larva can repay more than the extra strength spent on the victim.
  pending.players.bot.board.orbit[2].growth = 3;
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'useful-deathwish' }, difficulty);
  }
  pending.players.bot.board.orbit[2].growth = 0;
  assert.deepEqual(pickBotTarget(pending), { type: 'target', cardId: 'weak-token' });
});

test('Call of the Deep prefers the weakest ally even with a stronger enemy on the field', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.hand.push(member('call', 'choir', 'call-of-the-deep'));
  bot.board.orbit = [plain('weak-ally', 2)];
  bot.board.surface = [plain('strong-ally', 9)];
  human.board.surface = [plain('enemy', 15)];
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'call' });
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(pending, difficulty), { type: 'target', cardId: 'weak-ally' }, difficulty);
  }
});

test('Hound Eyes transforms the Hound that gains the most power', () => {
  const match = position(3);
  const { bot } = match.players;
  bot.coins = 2;
  bot.board.orbit = [member('eyes', 'captains', 'hound-eyes'), standard('hound-a', HOUND), standard('hound-b', HOUND)];
  bot.board.orbit[1].power = 1;
  bot.board.orbit[2].power = 6;
  const pending = applyAction(match, 'bot', { type: 'fee', cardId: 'eyes' });
  assert.deepEqual(pickBotTarget(pending), { type: 'target', cardId: 'hound-a' });
});

test('a bot with a winning lead passes before using the Incubator', () => {
  const match = position();
  match.players.bot.board.surface = [member('incubator', 'growth', 'incubator'), plain('lead', 12)];
  match.players.human.passed = true;
  for (const difficulty of [2, 4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty), pass, difficulty);
  }
});

test('discard plays value the best restored legal card once, with or without anyType and chooseAll', () => {
  const match = position(3);
  const target = standard('target', { id: 'target', name: 'Target', rarity: 'bronze', power: 8 });
  target.power = 1;
  match.players.bot.discard = [target];
  const medic = member('medic', 'captains', 'field-medic');
  const expected = deckCardValue(match, 'bot', { ...target, power: target.basePower });
  assert.equal(effectSwing(match, 'bot', medic), expected);
  const medicine = medic.definition.deploy.steps[0];
  const versatile = standard('versatile', { ...medic.definition,
    deploy: { steps: [{ ...medicine, chooseAll: true, filter: { ...medicine.filter, anyType: true } }] },
  });
  assert.equal(effectSwing(match, 'bot', versatile), expected);
});

test('Great Sacrifice scores each tentacle once even when it can overflow', () => {
  const match = position();
  const definition = CHOIR_CARDS.find(({ id }) => id === 'great-sacrifice');
  match.players.bot.board.orbit = Array.from({ length: 3 }, (_, i) =>
    standard('armored-' + i, { id: 'armored', name: 'Armored', power: 5, armor: 2 }));
  assert.equal(effectSwing(match, 'bot', standard('sacrifice', definition)), 3 * TENTACLE.power);
});

test('deck-play estimates stay finite when the eligible card has no printed power', () => {
  const match = position();
  const effect = standard('effect', { id: 'effect', name: 'Effect', type: 'effect' });
  match.players.bot.deck = [effect];
  const tutor = standard('tutor', { id: 'tutor', name: 'Tutor', type: 'effect',
    deploy: { steps: [{ action: 'play-from-deck', filter: { anyType: true } }] } });
  assert.equal(effectSwing(match, 'bot', tutor), 0);
});

test('strategic placement respects a mandatory row even when the preferred row differs', () => {
  const match = position(3);
  const resident = standard('resident', { id: 'resident', name: 'Resident', power: 9,
    requiredRow: 'surface', preferredRow: 'orbit' });
  match.players.bot.hand = [plain('spare', 1), resident];
  match.players.human.passed = true;
  match.players.human.board.surface = [plain('lead', 6)];
  for (const difficulty of [4, 6]) {
    assert.deepEqual(chooseBotTurn(match, difficulty),
      { type: 'play', cardId: 'resident', row: 'surface', position: 0 });
  }
});

test('strategic tribute spends only for seats it can fill and keeps coins for useful Fees', () => {
  const match = position(3);
  const bot = match.players.bot;
  const recruiter = CAPTAIN_CARDS.find(({ id }) => id === 'hound-recruiter');
  const foreman = CAPTAIN_CARDS.find(({ id }) => id === 'hound-foreman');
  bot.coins = 6;
  bot.hand.unshift(standard('recruiter', recruiter));
  bot.board.orbit = [standard('fee', foreman)];
  bot.board.surface = Array.from({ length: ROW_LIMIT - 4 }, (_, i) => plain('filler-' + i, 3));
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'recruiter', row: 'surface', position: bot.board.surface.length });
  assert.equal(pending.pending.kind, 'tribute');
  for (const difficulty of [4, 6]) {
    assert.equal(chooseBotTurn(pending, difficulty).cardId, '3');
  }
  pending.players.bot.board.surface.splice(0, 2);
  assert.equal(chooseBotTurn(pending, 6).cardId, '6');
});

test('the seven levels increase in depth, candidates, samples, memory and budget', () => {
  assert.deepEqual(Object.keys(BOT_LEVELS).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  const horizons = ['turn', 'reply', 'round', 'match'];
  for (let number = 2; number <= 7; number += 1) {
    const previous = BOT_LEVELS[number - 1];
    const level = BOT_LEVELS[number];
    assert.ok(level.errorRate < previous.errorRate);
    assert.ok(horizons.indexOf(level.horizon) >= horizons.indexOf(previous.horizon));
    assert.ok(level.candidates > previous.candidates && level.samples >= previous.samples);
    assert.ok(Number(level.memory) >= Number(previous.memory));
    assert.ok(level.budgetMs > previous.budgetMs);
  }
  assert.equal(BOT_LEVELS[7].errorRate, 0);
});

test('saved legacy bot settings migrate to levels 2, 4 and 6', () => {
  for (const [saved, level] of [['easy', 2], ['normal', 4], ['hard', 6], ['1', 1], ['7', 7], [6, 6]]) {
    assert.equal(readBotLevel(saved), level);
  }
  for (const invalid of [null, 'unknown', 8, 0, '3.5']) assert.equal(readBotLevel(invalid), 4);
});

test('a seed reproduces the decision and trace at levels 1, 4 and 7', () => {
  const match = position(3);
  match.players.bot.hand = [plain('strong', 9), plain('mid', 6), plain('weak', 3)];
  function decide(level) {
    let seed = 2468;
    let trace;
    const action = decideAtLevel(match, level, {
      random: () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
      onDecision: (value) => { trace = value; },
    });
    return { action, trace };
  }
  for (const level of [1, 4, 7]) {
    const result = decide(level);
    assert.deepEqual(decide(level), result);
    assert.equal(result.action.type, 'play');
    if (level > 1) assert.ok(result.trace.candidates[0].samples > 0);
  }
});

test('level 1 can select a weaker move or target and level 7 always uses the best rating', () => {
  const match = position(3);
  match.players.bot.hand = [plain('strong', 10), plain('mid', 7), plain('weak', 3)];
  match.players.human.deck = [];
  match.players.human.hand = [];
  match.players.human.board.orbit = [plain('enemy', 8)];
  match.players.human.passed = true;
  for (const level of [1, 7]) {
    assert.equal(decideAtLevel(match, level, { random: () => .99 }).cardId, 'strong');
    const alternative = decideAtLevel(match, level, { random: () => 0 }).cardId;
    if (level === 7) assert.equal(alternative, 'strong');
    else assert.notEqual(alternative, 'strong');
  }

  const { bot, human } = match.players;
  bot.hand = [standard('shot', { id: 'shot', name: 'Shot', type: 'effect', deploy: {
    select: [{ ref: 'victim', kind: 'damage', amount: 6, targets: { scope: 'enemy', type: 'unit' } }],
    steps: [{ action: 'damage', target: { scope: 'ref', ref: 'victim' }, amount: 6 }],
  } }), plain('spare', 1)];
  human.board.orbit = [plain('strong', 8), plain('mid', 5), plain('weak', 2)];
  human.passed = false;
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'shot' });
  assert.equal(decideAtLevel(pending, 1, { random: () => .99 }).cardId, 'strong');
  assert.equal(decideAtLevel(pending, 1, { random: () => 0 }).cardId, 'mid');
  assert.equal(decideAtLevel(pending, 7, { random: () => 0 }).cardId, 'strong');
});

test('the shared evaluation values a strong deploy effect above raw power at all seven levels', () => {
  const match = position(3);
  const { bot, human } = match.players;
  human.passed = true;
  human.board.surface = [plain('decisive-enemy', 16)];
  bot.hand = [plain('strength', 7), standard('deploy', {
    id: 'deploy', name: 'Deploy', power: 3,
    deploy: { steps: [{ action: 'damage', target: { scope: 'enemy' }, amount: 15 }] },
  })];
  for (const level of [1, 2, 3, 4, 5, 6, 7]) {
    assert.equal(chooseBotTurn(match, level).cardId, 'deploy', String(level));
  }
});

test('memory removes both a played card and a visible copy from the hidden supply only once each', () => {
  const match = position();
  const card = member('used', 'protectorate', 'infantry');
  match.players.human.factionId = 'protectorate';
  match.players.human.board.orbit = [card];
  match.log.push({ type: 'play', side: 'human', cardId: card.id, card });
  const options = (memory) => visibleSupply(match, memory).filter(({ card }) => card.id === 'infantry').length;
  assert.equal(options(false), 2);
  assert.equal(options(true), 1);
  match.log.push({ type: 'play', side: 'human', cardId: 'other-copy', card });
  assert.equal(options(true), 0);
});

test('levels 5–7 compare pass with plays using the match position', () => {
  for (const level of [5, 6, 7]) {
    const ahead = position(1);
    ahead.players.bot.board.orbit = [plain('lead', 15)];
    assert.deepEqual(chooseBotTurn(ahead, level), pass, 'bank a large lead at level ' + level);

    const behind = position(1);
    behind.players.human.board.orbit = [plain('enemy-lead', 26)];
    behind.players.bot.hand.pop();
    assert.deepEqual(chooseBotTurn(behind, level), pass, 'give up the chase at level ' + level);

    const close = position(2, 'human');
    close.players.human.passed = true;
    close.players.human.board.orbit = [plain('target-score', 4)];
    close.players.bot.hand = [plain('enough', 5), plain('excess', 12), plain('short', 2)];
    assert.equal(chooseBotTurn(close, level).cardId, 'enough', 'spend just enough at level ' + level);

    const final = position(3);
    final.players.human.passed = true;
    final.players.bot.board.orbit = [plain('lead', 30)];
    assert.equal(chooseBotTurn(final, level).type, 'play', 'always play a legal card in round three');
  }
});

test('the shared evaluation prices life, early hand reserve and resilient strength', () => {
  const match = position(1);
  const neutral = evaluatePosition(match, 'bot');
  match.players.bot.hand.push(plain('extra', 6));
  const earlyCard = evaluatePosition(match, 'bot') - neutral;
  match.round = 3;
  const lateCard = evaluatePosition(match, 'bot');
  assert.ok(earlyCard > lateCard);
  assert.equal(evaluatePosition(match, 'human'), -lateCard);

  match.round = 2;
  match.players.human.lives = 1;
  const before = evaluatePosition(match, 'bot');
  const unit = plain('carry', 4);
  match.players.bot.board.orbit = [unit];
  const withoutResilience = evaluatePosition(match, 'bot');
  unit.resilient = true;
  assert.ok(evaluatePosition(match, 'bot') > withoutResilience && withoutResilience > before);
});

test('level 1 can choose far down its shortlist and pass at the wrong time, deterministically', () => {
  const match = position(1);
  match.players.bot.hand = [10, 8, 6, 4, 2, 1].map((power) => plain('unit-' + power, power));
  const normal = decideAtLevel(match, 1, { random: () => .99 });
  const replay = (...rolls) => decideAtLevel(match, 1, { random: () => rolls.shift() ?? .99 });
  assert.equal(normal.type, 'play');
  assert.equal(replay(0, 0).type, 'pass');
  const mistake = replay(0, .99, .99);
  assert.notDeepEqual(mistake, normal);
  assert.deepEqual(replay(0, .99, .99), mistake);
  const decisions = Array.from({ length: 20 }, (_, index) =>
    replay((index + .5) / 20, .99, .99));
  assert.equal(decisions.filter((action) => action.cardId !== normal.cardId).length, 8);
});

test('with a round in hand the bot pressures round two and stops once the chase is too costly', () => {
  const match = position(2, 'bot');
  match.players.bot.hand = [6, 7, 8, 9].map((power) => plain('pressure-' + power, power));
  match.players.human.hand = [3, 4, 5, 6].map((power) => plain('defense-' + power, power));
  for (const level of [5, 6, 7]) assert.equal(chooseBotTurn(match, level).type, 'play');

  match.players.human.hand.splice(2);
  match.players.human.board.orbit = [plain('paid-for-lead', 24)];
  match.players.bot.hand.pop();
  for (const level of [5, 6, 7]) assert.deepEqual(chooseBotTurn(match, level), pass);
});

test('once the opponent has passed, surplus points add no match value to a secured win', () => {
  const match = position(1);
  const { bot, human } = match.players;
  human.passed = true;
  human.board.orbit = [plain('opponent', 6)];
  const lead = plain('lead', 7);
  bot.board.orbit = [lead];
  const enough = evaluatePosition(match, 'bot');
  lead.power = 30;
  assert.equal(evaluatePosition(match, 'bot'), enough);
});
