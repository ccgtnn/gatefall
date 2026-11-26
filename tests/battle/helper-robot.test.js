import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, findUnit, ROW_LIMIT } from '../../docs/game/board.js';
import { NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/match.js';

const robot = NEUTRAL_CARDS.find(({ id }) => id === 'helper-robot');
const unit = (id, rarity = 'bronze') => createCard(id, { id, name: id, power: 1, rarity });
const goldEffect = (id) => createCard(id, { id, name: id, type: 'effect', rarity: 'gold' });
const zero = () => 0;
const play = (match, side, cardId, row = 'orbit', random = zero) => applyAction(match, side,
  { type: 'play', cardId, row, position: 0 }, { random });

function fixture() {
  const match = confirmMulligan(createMatch({ random: zero, rules: { leaderCharges: 0 } }));
  for (const player of Object.values(match.players)) player.leader.charges = 0;
  for (const [side, player] of Object.entries(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.hand = [unit(`${side}-spare`)];
    player.deck = [createCard(`${side}-robot`, robot)];
  }
  return match;
}

test('each side summons its own Robot only after its first legendary play', () => {
  let match = fixture();
  match.players.human.hand.push(unit('epic', 'epic'), unit('human-gold', 'gold'));
  match.players.bot.hand.push(unit('bot-gold', 'gold'));
  match = play(match, 'human', 'epic');
  assert.equal(findUnit(match, 'human-robot'), undefined);

  match = play(match, 'bot', 'bot-gold', 'orbit', () => .99);
  assert.equal(findUnit(match, 'human-robot'), undefined);
  assert.equal(findUnit(match, 'bot-robot').row, 'surface');

  match = play(match, 'human', 'human-gold');
  assert.equal(findUnit(match, 'human-robot').row, 'orbit');
  assert.equal(findUnit(match, 'human-robot').card.power, 4);
  assert.equal(match.players.human.deck.length, 0);
  assert.equal(match.log.some((event) => event.type === 'play' && event.cardId === 'human-robot'), false);
  assert.ok(match.log.some((event) => event.type === 'spawn' && event.from === 'deck' &&
    event.cards[0].id === 'human-robot'));
});

test('the Robot takes the last available slot when a legendary unit fills the other row', () => {
  const match = fixture();
  const human = match.players.human;
  for (const row of ['orbit', 'surface']) {
    human.board[row] = Array.from({ length: ROW_LIMIT - 1 }, (_, index) => unit(`${row}-${index}`));
  }
  human.hand.push(unit('human-gold', 'gold'));
  const next = play(match, 'human', 'human-gold');
  assert.equal(findUnit(next, 'human-robot').row, 'surface');
  assert.equal(next.players.human.board.surface.length, ROW_LIMIT);
});

test('a full field leaves the Robot in the deck and later legendaries do not retry', () => {
  let match = fixture();
  const human = match.players.human;
  for (const row of ['orbit', 'surface']) {
    human.board[row] = Array.from({ length: ROW_LIMIT }, (_, index) => unit(`${row}-${index}`));
  }
  human.hand.push(goldEffect('first-gold'), goldEffect('second-gold'));
  match = play(match, 'human', 'first-gold');
  assert.equal(match.players.human.deck[0].id, 'human-robot');

  match = applyAction(match, 'bot', { type: 'pass' }, { random: zero });
  match.players.human.board.orbit.pop();
  match = play(match, 'human', 'second-gold');
  assert.equal(findUnit(match, 'human-robot'), undefined);
  assert.equal(match.players.human.deck[0].id, 'human-robot');
});

test('the Robot in hand is not summoned by a legendary effect', () => {
  const match = fixture();
  const human = match.players.human;
  human.hand.push(human.deck.pop(), goldEffect('gold-effect'));
  const next = play(match, 'human', 'gold-effect');
  assert.ok(next.players.human.hand.some(({ id }) => id === 'human-robot'));
  assert.equal(findUnit(next, 'human-robot'), undefined);
});

test('a legendary card played from the deck also triggers the Robot', () => {
  let match = fixture();
  const human = match.players.human;
  human.hand.push(createCard('tutor', { type: 'effect', rarity: 'bronze', deploy: {
    steps: [{ action: 'play-from-deck', filter: { rarity: 'gold' } }],
  } }));
  human.deck.push(unit('deck-gold', 'gold'));
  match = play(match, 'human', 'tutor');
  assert.equal(match.pending.kind, 'deck-placement');
  match = applyAction(match, 'human', { type: 'place', row: 'orbit', position: 0 }, { random: zero });
  assert.deepEqual(match.players.human.board.orbit.map(({ id }) => id), ['deck-gold', 'human-robot']);
});
