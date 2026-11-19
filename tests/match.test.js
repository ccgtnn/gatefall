import assert from 'node:assert/strict';
import test from 'node:test';
import { ROWS } from '../docs/game/cards.js';
import { DECKS } from './fixtures/prototype-decks.js';
import {
  HAND_LIMIT, ROW_LIMIT, applyAction, availableRows, confirmMulligan, createMatch, playableCards, totalScore,
} from '../docs/game/match.js';
import { chooseBotAction, createBotView } from '../docs/game/bot.js';

const pass = { type: 'pass' };

function orderedMatch({ human = DECKS.human, bot = DECKS.bot, starter = 'human', rules } = {}) {
  let remainingSwaps = human.length + bot.length - 2;
  const random = () => remainingSwaps-- > 0 ? 0.999 : Number(starter === 'bot') * 0.999;
  return createMatch({ decks: { human, bot }, random, rules });
}

function playFirst(match) {
  const player = match.players[match.turn];
  const [card] = playableCards(match, match.turn);
  const row = availableRows(player).includes(card.definition.row) ? card.definition.row : availableRows(player)[0];
  return applyAction(match, match.turn, {
    type: 'play', cardId: card.id, row, position: player.board[row].length,
  });
}

function endRound(match) {
  return [0, 1].reduce((current) => applyAction(current, current.turn, pass), match);
}

function roundEvents(match, type) {
  return match.log.filter((event) => event.type === type);
}

test('the original starter decks each have 25 valid cards with power from 1 to 10', () => {
  for (const deck of Object.values(DECKS)) {
    assert.equal(deck.length, 25);
    assert.equal(new Set(deck.map((card) => card.id)).size, 25);
    assert.equal(new Set(deck.map((card) => card.name)).size, 25);
    assert.deepEqual([...new Set(deck.map((card) => card.power))].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(deck.every((card) => ROWS.includes(card.row) && card.provision >= 4));
  }
});

test('hands start at ten and the coin decides who opens round one', () => {
  for (const starter of ['human', 'bot']) {
    const setup = orderedMatch({ starter });
    assert.equal(setup.phase, 'mulligan');
    assert.equal(setup.turn, null);
    for (const player of Object.values(setup.players)) {
      assert.equal(player.lives, 2);
      assert.equal(player.hand.length, 10);
      assert.equal(player.deck.length, 15);
    }
    assert.equal(confirmMulligan(setup, []).turn, starter);
  }
});

test('mulligan replaces up to three distinct cards before play and returns them to the bottom', () => {
  const setup = orderedMatch();
  const { human, bot } = setup.players;
  const ids = human.hand.slice(0, 4).map((card) => card.id);
  assert.strictEqual(confirmMulligan(setup, ids), setup);
  assert.strictEqual(confirmMulligan(setup, [bot.hand[0].id]), setup);

  const match = confirmMulligan(setup, ids.slice(0, 3));
  assert.deepEqual(match.players.human.hand.slice(0, 3), human.deck.slice(0, 3));
  assert.deepEqual(match.players.human.deck.slice(-3), human.hand.slice(0, 3));
  assert.equal(match.players.human.hand.length, HAND_LIMIT);
  assert.deepEqual(match.players.bot.hand, bot.hand);
  assert.strictEqual(confirmMulligan(match, [ids[3]]), match);
  assert.deepEqual(setup.players.human.hand.slice(0, 4).map((card) => card.id), ids);
});

test('only the active side may move, and the card goes into the chosen row', () => {
  const match = confirmMulligan(orderedMatch(), []);
  assert.strictEqual(applyAction(match, 'bot', pass), match);
  assert.strictEqual(applyAction(match, 'human', { type: 'play', cardId: 'missing', position: 0 }), match);
  const [card] = match.players.human.hand;
  const next = playFirst(match);
  assert.deepEqual(next.players.human.board[card.definition.row], [card]);
  assert.equal(totalScore(next.players.human), card.power);
  assert.equal(next.turn, 'bot');
  assert.equal(match.players.human.hand.length, HAND_LIMIT);
});

test('a side stays passed while its opponent can play repeatedly', () => {
  let match = confirmMulligan(orderedMatch(), []);
  match = applyAction(match, 'human', pass);
  match = playFirst(playFirst(match));
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.passed, true);
  assert.equal(match.players.bot.hand.length, 8);
  assert.strictEqual(applyAction(match, 'human', pass), match);
  match = applyAction(match, 'bot', pass);
  assert.equal(match.round, 2);
  assert.equal(match.starter, 'bot');
  assert.equal(match.players.human.lives, 1);
  assert.equal(match.players.human.passed, false);
  assert.equal(totalScore(match.players.bot), 0);
});

test('draws burn all overflow, and both round-two and round-three draws consume three cards', () => {
  let match = confirmMulligan(orderedMatch(), []);
  match = endRound(playFirst(match)); // Human wins round 1.
  assert.deepEqual(roundEvents(match, 'draw').map(({ count, burned }) => [count, burned]),
    [[1, 2], [0, 3]]);
  assert.equal(match.players.human.discard.length, 3); // One played and two burned.
  assert.equal(match.players.bot.discard.length, 3);

  match = applyAction(match, 'human', pass);
  match = applyAction(playFirst(match), 'bot', pass); // Bot wins round 2.
  assert.equal(match.round, 3);
  assert.equal(match.turn, 'bot');
  for (const player of Object.values(match.players)) {
    assert.equal(player.hand.length, HAND_LIMIT);
    assert.equal(player.deck.length, 9);
    assert.equal(totalScore(player), 0);
  }
});

test('a tied round costs both sides a life and retains the opening side by default', () => {
  const match = endRound(confirmMulligan(orderedMatch({ starter: 'bot' }), []));
  assert.equal(match.round, 2);
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.lives, 1);
  assert.equal(match.players.bot.lives, 1);
  assert.equal(roundEvents(match, 'round-end')[0].winner, null);
});

test('alternate initiative uses the opposite previous starter even when the winner was second', () => {
  const setup = orderedMatch({ rules: { nextStarter: 'alternate' } });
  let match = playFirst(confirmMulligan(setup, []));
  match = endRound(match);
  assert.equal(match.round, 2);
  assert.equal(match.turn, 'bot');
});

test('zero lives ends the match with a win, loss, or draw', () => {
  const start = () => confirmMulligan(orderedMatch(), []);

  const drawn = endRound(endRound(start()));
  assert.equal(drawn.result, 'draw');
  assert.equal(drawn.turn, null);
  assert.equal(drawn.phase, 'finished');
  assert.strictEqual(applyAction(drawn, 'human', pass), drawn);

  let winning = endRound(playFirst(start()));
  winning = endRound(playFirst(winning));
  assert.equal(winning.result, 'win');
  assert.equal(winning.players.human.lives, 2);
  assert.equal(winning.players.bot.lives, 0);

  let losing = applyAction(start(), 'human', pass);
  losing = applyAction(playFirst(losing), 'bot', pass);
  losing = endRound(playFirst(losing));
  assert.equal(losing.result, 'loss');
  assert.equal(losing.players.human.lives, 0);
});

test('after a split in two rounds, round three decides the match', () => {
  let match = endRound(playFirst(confirmMulligan(orderedMatch(), [])));
  match = applyAction(match, 'human', pass);
  match = applyAction(playFirst(match), 'bot', pass);
  match = endRound(playFirst(match));
  assert.equal(match.round, 3);
  assert.equal(match.result, 'loss');
  assert.equal(roundEvents(match, 'round-start').length, 3);
  assert.equal(roundEvents(match, 'draw').length, 4);
});

test('an empty hand triggers autopass as soon as that player would act', () => {
  const shortDeck = DECKS.human.slice(0, 1);
  let match = confirmMulligan(orderedMatch({ human: shortDeck }), []);
  match = playFirst(match);
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.passed, false);
  match = playFirst(match);
  assert.equal(match.turn, 'bot');
  assert.equal(match.players.human.passed, true);
  assert.deepEqual(roundEvents(match, 'pass'), [
    { type: 'pass', side: 'human', reason: 'empty-hand' },
  ]);
});

test('a filled row rejects placement there while the other row accepts the same card', () => {
  const setup = orderedMatch({ human: Array(10).fill(DECKS.human[0]), bot: [] });
  let match = confirmMulligan(setup, []);
  for (let play = 0; play < ROW_LIMIT; play += 1) match = playFirst(match);

  assert.equal(match.players.human.board.orbit.length, ROW_LIMIT);
  const [card] = playableCards(match, 'human');
  assert.strictEqual(applyAction(match, 'human', {
    type: 'play', cardId: card.id, row: 'orbit', position: ROW_LIMIT,
  }), match);
  const next = applyAction(match, 'human', { type: 'play', cardId: card.id, row: 'surface', position: 0 });
  assert.notStrictEqual(next, match);
  assert.ok(next.players.human.discard.some(({ id }) => id === card.id));
});

test('128 reproducible matches terminate and keep each side’s cards in exactly one zone', () => {
  for (let seed = 1; seed <= 128; seed += 1) {
    let roll = seed;
    const random = () => {
      roll = (Math.imul(1664525, roll) + 1013904223) >>> 0;
      return roll / 0x100000000;
    };
    let match = confirmMulligan(createMatch({ decks: DECKS, random }), []);
    for (let turn = 0; turn < 40 && match.phase === 'playing'; turn += 1) {
      if (match.turn === 'bot') {
        match = applyAction(match, 'bot', chooseBotAction(createBotView(match)));
      } else {
        match = random() < 0.2 ? applyAction(match, 'human', pass) : playFirst(match);
      }
    }
    assert.equal(match.phase, 'finished');
    assert.ok(match.round <= 3);
    for (const player of Object.values(match.players)) {
      const cards = [...player.hand, ...player.deck, ...player.discard, ...Object.values(player.board).flat()];
      assert.equal(cards.length, 25);
      assert.equal(new Set(cards.map(({ id }) => id)).size, 25);
      assert.ok(player.hand.length <= HAND_LIMIT);
    }
  }
});

test('position inserts the first, leftmost, rightmost and middle cards in the expected order', () => {
  const setup = orderedMatch({ human: DECKS.human.filter(({ row }) => row === 'orbit'), bot: [] });
  let match = confirmMulligan(setup, []);
  const cards = match.players.human.hand.slice(0, 4);
  const playAt = (card, position) => applyAction(match, 'human', {
    type: 'play', cardId: card.id, row: 'orbit', position,
  });

  for (const invalid of [undefined, -1, 1, 0.5, '0', NaN]) {
    assert.strictEqual(playAt(cards[0], invalid), match);
  }
  match = playAt(cards[0], 0);
  assert.deepEqual(match.players.human.board.orbit, [cards[0]]);
  match = playAt(cards[1], 0);
  assert.deepEqual(match.players.human.board.orbit, [cards[1], cards[0]]);
  assert.strictEqual(playAt(cards[2], 3), match);
  match = playAt(cards[2], 2);
  match = playAt(cards[3], 1);
  assert.deepEqual(match.players.human.board.orbit, [cards[1], cards[3], cards[0], cards[2]]);
});
