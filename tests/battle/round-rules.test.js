import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, createCard, findUnit, placeCards } from '../../docs/game/engine/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { FACTIONS, FIRST_SIGNAL } from '../../docs/game/cards/cards.js';
import { availableOrders } from '../../docs/game/effects/effects.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch, mulliganLimit, mulliganRemaining, replaceMulliganCard } from '../../docs/game/engine/match.js';

const pass = { type: 'pass' };
const definitions = new Map(Object.values(FACTIONS).flatMap(({ deck }) => deck.map((card) => [card.id, card])));
const unit = (id, name = 'infantry') => createCard(id, definitions.get(name));

function setup(starter = 'human') {
  const match = createMatch({ random: () => 0.99 });
  match.starter = starter;
  return match;
}

function action(match, type, cardId, side = match.turn, row = 'orbit') {
  return applyAction(match, side, { type, cardId, row, position: match.players[side].board[row].length });
}

test('in round three Salfurion can use his order and still play a card or pass', () => {
  for (const side of ['human', 'bot']) {
    const opponent = side === 'human' ? 'bot' : 'human';
    let match = confirmMulligan(setup(side), []);
    match.round = 3;
    match.players[side].leader = null;
    match.players[side].hand = [createCard('salfurion', findCardDefinition('salfurion')), unit('spare')];
    match = action(match, 'play', 'salfurion');
    match = action(match, 'play', match.players[opponent].hand[0].id);
    if (match.turn === opponent) match = action(match, 'end-turn');
    assert.equal(match.turn, side);

    const ordered = action(match, 'leader');
    assert.equal(ordered.turn, side);
    assert.equal(ordered.players[side].turns, match.players[side].turns);
    assert.equal(canPass(ordered, side), true);
    const played = action(ordered, 'play', 'spare');
    assert.ok(played.log.some((event) => event.type === 'play' && event.cardId === 'spare'));

    for (const type of ['pass', 'end-turn']) {
      const passed = action(ordered, type);
      assert.equal(passed.turn, opponent);
      assert.equal(passed.players[side].passed, true);
      assert.equal(passed.players[side].hand[0].id, 'spare');
      assert.ok(passed.log.some((event) => event.type === 'pass' && event.side === side));
    }
  }
});

test('an order cannot silently skip a turn with a nonempty but unplayable hand', () => {
  for (const side of ['human', 'bot']) {
    let match = confirmMulligan(setup(side), []);
    const player = match.players[side];
    player.board.orbit = [unit('ally')];
    player.leader = null;
    player.hand = [unit('cast', 'orbital-salvo')];
    match = action(action(match, 'order', FIRST_SIGNAL.id), 'target', 'ally');
    assert.equal(match.turn, side);
    assert.equal(match.players[side].passed, false);
    assert.equal(match.players[side].turns, 0);
    const finish = side === 'bot' ? chooseBotTurn(match) : { type: 'end-turn' };
    match = applyAction(match, side, finish);
    assert.notEqual(match.turn, side);
    assert.equal(match.players[side].passed, true);
    assert.equal(match.players[side].turns, 1);
    assert.ok(match.log.some((event) => event.type === 'pass' && event.side === side));
    assert.ok(!match.log.some((event) => event.type === 'turn-skip'));
  }
});

test('mulligan skips all copies of selected cards, preserves skipped deck order and clears the blacklist each round', () => {
  let match = setup();
  const player = match.players.human;
  player.hand = [unit('first', 'assault'), unit('second', 'infantry'), unit('kept', 'assault')];
  player.deck = [unit('assault-copy', 'assault'), unit('infantry-copy', 'infantry'),
    unit('valid-a', 'bastion'), unit('valid-b', 'cocoon'), unit('last', 'assault')];
  match = confirmMulligan(match, ['first', 'second'], { random: () => .99 });
  assert.deepEqual(match.players.human.hand.map(({ id }) => id), ['valid-a', 'valid-b', 'kept']);
  assert.deepEqual(match.players.human.deck.map(({ id }) => id), ['assault-copy', 'infantry-copy', 'last', 'first', 'second']);
  match.players.human.hand.push(...Array.from({ length: 7 }, (_, i) => unit('fill-' + i)));
  match = applyAction(applyAction(match, 'human', pass), 'bot', pass);
  assert.equal(match.round, 2);
  assert.equal(mulliganLimit(match, 'human'), 5);
  match = confirmMulligan(match, ['valid-a']);
  assert.equal(match.players.human.hand[0].id, 'assault-copy');
});

test('mulligan returns cards at a seeded position in both replacement paths', () => {
  const match = setup();
  match.players.human.hand = [unit('original', 'assault')];
  match.players.human.deck = [unit('draw', 'bastion'), unit('keep-a'), unit('keep-b'), unit('keep-c')];
  const options = { random: () => .3 };
  for (const next of [replaceMulliganCard(match, 'original', options), confirmMulligan(match, ['original'], options)]) {
    assert.equal(next.players.human.hand[0].id, 'draw');
    assert.deepEqual(next.players.human.deck.map(({ id }) => id), ['keep-a', 'original', 'keep-b', 'keep-c']);
  }
});

test('the bot uses the same blacklist and an impossible replacement keeps the original hand', () => {
  const match = setup();
  for (const player of Object.values(match.players)) {
    const prefix = player === match.players.human ? 'h' : 'b';
    player.hand = Array.from({ length: 4 }, (_, i) => unit(prefix + i));
    player.deck = [unit(prefix + '-copy')];
  }
  const next = confirmMulligan(match, ['h0', 'h1', 'h2']);
  assert.deepEqual(next.players.human.hand, match.players.human.hand);
  assert.deepEqual(next.players.bot.hand, match.players.bot.hand);
  assert.deepEqual(next.log.filter(({ type }) => type === 'mulligan').map(({ count }) => count), [0, 0]);
});

test('instant mulligan replaces the same slot repeatedly and keeps excluded copies out until the next round', () => {
  const setupMatch = setup();
  const { human } = setupMatch.players;
  human.hand = [unit('left'), unit('original', 'assault'), unit('right')];
  human.deck = [
    unit('original-copy', 'assault'), unit('replacement', 'bastion'), unit('replacement-copy', 'bastion'),
    unit('second', 'cocoon'), unit('last', 'spitter'),
  ];
  assert.strictEqual(replaceMulliganCard(setupMatch, 'missing'), setupMatch);
  let match = replaceMulliganCard(setupMatch, 'original', { random: () => .99 });
  assert.deepEqual(match.players.human.hand.map(({ id }) => id), ['left', 'replacement', 'right']);
  assert.equal(human.hand[1].id, 'original');
  assert.equal(mulliganRemaining(match), 2);

  match = replaceMulliganCard(match, 'replacement', { random: () => .99 });
  assert.equal(match.players.human.hand[1].id, 'second');
  assert.equal(mulliganRemaining(match), 1);
  assert.strictEqual(confirmMulligan(match, ['left', 'right']), match);
  match = replaceMulliganCard(match, 'second', { random: () => .99 });
  assert.equal(match.players.human.hand[1].id, 'last');
  assert.equal(mulliganRemaining(match), 0);
  assert.strictEqual(replaceMulliganCard(match, 'last'), match);
  assert.deepEqual(match.players.human.deck.map(({ id }) => id),
    ['original-copy', 'replacement-copy', 'original', 'replacement', 'second']);

  match = confirmMulligan(match);
  assert.equal(match.log.find(({ type, side }) => type === 'mulligan' && side === 'human').count, 3);
  match.players.human.hand.push(...Array.from({ length: 7 }, (_, i) => unit('fill-' + i)));
  match = applyAction(applyAction(match, 'human', pass), 'bot', pass);
  assert.equal(mulliganRemaining(match), 5);
  match = replaceMulliganCard(match, 'last');
  assert.equal(match.players.human.hand[1].id, 'original-copy');
});

test('instant mulligan does not spend an attempt if every replacement is a copy', () => {
  const match = setup();
  match.players.human.hand = [unit('original')];
  match.players.human.deck = [unit('copy')];
  assert.strictEqual(replaceMulliganCard(match, 'original'), match);
  assert.equal(mulliganRemaining(match), 3);
  assert.equal(confirmMulligan(match).players.human.hand[0].id, 'original');
});

test('later mulligans allow two swaps without blocked draws, including when the deck is short', () => {
  let match = confirmMulligan(setup(), []);
  match.players.human.hand.splice(0, 3);
  match.players.human.deck.splice(2);
  const drawn = match.players.human.deck.slice();
  match = applyAction(applyAction(match, 'human', pass), 'bot', pass);
  const event = match.log.findLast(({ type, side }) => type === 'draw' && side === 'human');
  assert.deepEqual(event, { type: 'draw', reason: 'round', side: 'human', count: 2, cards: drawn, extraSwaps: 0 });
  assert.notStrictEqual(event.cards[0], match.players.human.hand.at(-2));
  assert.equal(match.players.human.hand.length, 9);
  assert.equal(match.players.human.extraSwaps, 0);
  assert.equal(mulliganLimit(match, 'human'), 2);
  assert.strictEqual(confirmMulligan(match, match.players.human.hand.slice(0, 3).map(({ id }) => id)), match);
});

test('on entering a row Commander waits for the next owner turn, while Zeal is ready the same turn', () => {
  const match = confirmMulligan(setup(), []);
  const human = match.players.human;
  human.turns = 4;
  human.board.orbit = [unit('payer', 'bastion')];
  match.players.bot.board.orbit = [unit('enemy', 'assault')];
  placeCards(human, 'orbit', 1, [unit('commander', 'commander')]);
  assert.equal(human.board.orbit[1].readyAt, 5);
  assert.ok(availableOrders(match, 'human').some(({ card }) => card.id === FIRST_SIGNAL.id));
  assert.strictEqual(action(match, 'order', 'commander'), match);
  match.players.bot.turns += 1;
  assert.strictEqual(action(match, 'order', 'commander'), match);
  human.turns += 1;
  assert.ok(action(match, 'order', 'commander').pending);
});

test('First Signal starts on the first mover side, can only boost a friendly unit, and is exiled after one use', () => {
  for (const starter of ['human', 'bot']) {
    let match = confirmMulligan(setup(starter), []);
    const opponent = starter === 'human' ? 'bot' : 'human';
    const player = match.players[starter];
    const [signal] = player.board.surface;
    assert.equal(signal.definition.id, FIRST_SIGNAL.id);
    assert.equal(signal.definition.type, 'artifact');
    assert.equal(signal.readyAt, 0);
    assert.equal(signal.definition.doomed, true);
    assert.ok(match.players[opponent].board.surface.length === 0);
    assert.strictEqual(action(match, 'order', signal.id), match); // No allied unit yet.
    player.board.orbit = [unit('ally')];
    match.players[opponent].board.orbit = [unit('enemy')];
    match = action(match, 'order', signal.id);
    assert.deepEqual(match.pending.options, ['ally']);
    assert.strictEqual(action(match, 'target', 'enemy'), match);
    match = action(match, 'target', 'ally');
    assert.equal(match.players[starter].board.orbit[0].power, 8);
    assert.equal(match.players[starter].board.surface.length, 0);
    assert.equal(match.players[starter].exile[0].id, signal.id);
    assert.equal(canPass(match, starter), true);
    assert.strictEqual(action(match, 'order', signal.id), match);
  }
});

test('unused First Signal disappears in round one and is never redeployed', () => {
  let match = confirmMulligan(setup(), []);
  match = applyAction(applyAction(match, 'human', pass), 'bot', pass);
  assert.equal(match.phase, 'mulligan');
  assert.equal(match.players.human.exile[0].id, FIRST_SIGNAL.id);
  match = confirmMulligan(match, []);
  assert.equal(match.round, 2);
  assert.equal(match.players.human.board.surface.length, 0);
  assert.equal(match.players.bot.board.surface.length, 0);
  assert.equal(match.log.filter(({ type }) => type === 'stratagem').length, 1);
});


test('a played card opens the order window and blocks a second card or pass', () => {
  let match = confirmMulligan(setup(), []);
  match.players.human.hand = [unit('first'), unit('second')];
  assert.equal(action(match, 'end-turn').players.human.passed, true);
  match = action(match, 'play', 'first');
  assert.equal(match.turn, 'human');
  assert.equal(match.players.human.turns, 0);
  assert.equal(canEndTurn(match, 'human'), true);
  assert.equal(canPass(match, 'human'), false);
  assert.strictEqual(action(match, 'play', 'second'), match);
  assert.strictEqual(action(match, 'pass'), match);
  match = action(action(match, 'leader'), 'target', 'first');
  assert.equal(match.players.human.leader.charges, 0);
  assert.strictEqual(action(match, 'end-turn', undefined, 'bot'), match);
  match = action(match, 'order', FIRST_SIGNAL.id);
  assert.equal(canEndTurn(match, 'human'), false);
  assert.strictEqual(action(match, 'end-turn'), match);
  match = action(match, 'target', 'first');
  assert.equal(match.players.human.board.orbit[0].power, 8);
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.turns, 1);
  assert.equal(match.playedCard, false);
});

test('manual end runs end-of-turn effects once and keeps unused orders for the next turn', () => {
  let match = confirmMulligan(setup(), []);
  match.players.human.board.orbit = [unit('unit')];
  match.players.human.hand = [unit('incubator', 'incubator'), unit('spare')];
  match = action(match, 'play', 'incubator');
  assert.equal(match.players.human.board.orbit[1].timer, undefined);
  assert.ok(!match.log.some(({ type }) => type === 'spawn'));
  match = action(match, 'end-turn');
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.board.orbit[1].timer, undefined);
  assert.equal(match.log.filter(({ type }) => type === 'spawn').length, 1);
  match = action(match, 'pass');
  assert.equal(canPass(match, 'human'), true);
  assert.ok(availableOrders(match, 'human').some(({ card }) => card.id === FIRST_SIGNAL.id));
});

test('the bot uses an order made legal by its play, or ends the turn if already ahead of a passed player', () => {
  for (const opponentPassed of [false, true]) {
    let match = confirmMulligan(setup('bot'), []);
    match.players.bot.hand = [unit('first'), unit('spare')];
    match = action(match, 'play', 'first');
    assert.equal(match.turn, 'bot');
    match.players.human.passed = opponentPassed;
    const choice = chooseBotTurn(match);
    assert.deepEqual(choice, opponentPassed ? { type: 'end-turn' } : { type: 'order', cardId: FIRST_SIGNAL.id });
    match = applyAction(match, 'bot', choice);
    if (opponentPassed) {
      assert.equal(match.playedCard, false);
      assert.equal(match.players.bot.passed, false);
    } else {
      match = applyAction(match, 'bot', chooseBotTurn(match));
      assert.equal(match.turn, 'human');
    }
    assert.equal(match.players.bot.hand[0].id, 'spare');
  }
});

test('playing with no available order auto-ends even if there is a sleeping order on the board', () => {
  let match = confirmMulligan(setup('bot'), []);
  match = action(match, 'pass');
  match.players.human.leader.charges = 0;
  match.players.human.hand = [unit('commander', 'commander'), unit('spare')];
  match = action(match, 'play', 'commander');
  assert.equal(match.players.human.turns, 1);
  assert.equal(match.turn, 'human');
  assert.equal(match.playedCard, false);
  assert.equal(canPass(match, 'human'), true);
});

test('turn-start brackets turn effects and identifies the empty turn of a passed side', () => {
  let match = confirmMulligan(setup(), []);
  assert.deepEqual(match.log.findLast(({ type }) => type === 'turn-start'),
    { type: 'turn-start', side: 'human', empty: false });
  match.players.human.board.orbit = [unit('infected')];
  applyStatus(match, findUnit(match, 'infected'), 'infection', 2);
  const growing = unit('growing');
  growing.definition = { ...growing.definition, startTurnGrowth: 1 };
  match.players.bot.board.orbit = [growing];
  match.players.bot.hand = [unit('bot-play'), unit('bot-spare')];

  const afterPass = action(match, 'pass');
  const events = afterPass.log.slice(match.log.length);
  const turnStart = events.findIndex(({ type }) => type === 'turn-start');
  assert.deepEqual(events[turnStart], { type: 'turn-start', side: 'bot', empty: false });
  const tick = events.findIndex(({ type, tick }) => type === 'status' && tick);
  assert.ok(tick >= 0 && tick < turnStart);
  assert.ok(events.findIndex(({ cardId, type }) => cardId === growing.id && type === 'base-power') > turnStart);

  match = action(afterPass, 'play', afterPass.players.bot.hand[0].id);
  if (match.turn === 'bot') match = action(match, 'end-turn');
  assert.deepEqual(match.log.slice(afterPass.log.length).filter(({ type }) => type === 'turn-start'), [
    { type: 'turn-start', side: 'human', empty: true },
    { type: 'turn-start', side: 'bot', empty: false },
  ]);

  const roundEnd = action(match, 'pass');
  assert.ok(roundEnd.log.slice(match.log.length).some(({ type }) => type === 'round-end'));
  assert.ok(roundEnd.log.slice(match.log.length).every(({ type }) => type !== 'turn-start'));
});

test('the bot mulligans Helper Robot first while a legendary can still summon it from the deck', () => {
  const robot = findCardDefinition('helper-robot');
  const legend = { ...definitions.get('infantry'), id: 'test-legend', rarity: 'gold' };
  const prepare = (deckLegend) => {
    const match = setup();
    const { bot } = match.players;
    bot.hand = [createCard('bot-robot', robot), ...bot.hand.slice(1).map((card) => ({ ...card, power: 1 }))];
    bot.deck = [createCard('bot-legend', deckLegend ? legend : definitions.get('infantry')), ...bot.deck]
      .filter(({ definition }) => definition.rarity !== 'gold' || deckLegend);
    bot.hand = bot.hand.filter(({ definition }) => definition.rarity !== 'gold' || definition.id === robot.id);
    return confirmMulligan(match, []);
  };
  assert.ok(!prepare(true).players.bot.hand.some(({ definition }) => definition.id === 'helper-robot'));
  assert.ok(prepare(false).players.bot.hand.some(({ definition }) => definition.id === 'helper-robot'));
});
