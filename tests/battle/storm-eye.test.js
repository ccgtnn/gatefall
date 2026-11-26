import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, findUnit, removeUnit } from '../../docs/game/board.js';
import { NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { applyAction, createMatch } from '../../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';

const random = () => 0;
const unit = (id, power = 20) => createCard(id, { id, name: id, power });
const lightning = (event) => event.type === 'damage' && event.visual === 'lightning';

function setup() {
  const match = createMatch({ random, rules: { leaderCharges: 0 } });
  for (const player of Object.values(match.players)) player.leader.charges = 0;
  match.phase = 'playing';
  match.turn = 'human';
  const eye = createCard('eye', NEUTRAL_CARDS.find(({ id }) => id === 'storm-eye'));
  match.players.human.hand = [eye, unit('human-1'), unit('human-2'), unit('human-3')];
  match.players.bot.hand = [unit('bot-1'), unit('bot-2'), unit('bot-3')];
  match.players.bot.board.orbit = [unit('fragile', 2), unit('next')];
  return match;
}

function play(match, cardId, row = 'surface') {
  return applyAction(match, match.turn, { type: 'play', cardId, row, position: 0 }, { random });
}

test('Storm Eye hits three times on each new owner turn, retargets deaths and breaks before the final bolt', () => {
  const before = setup();
  let match = play(before, 'eye');
  assert.equal(match.turn, 'bot');
  assert.equal(findUnit(match, 'eye').card.timer, 3);
  assert.equal(match.log.filter(lightning).length, 0);

  const replay = createPlaybackState(before);
  for (let turn = 1; turn <= 3; turn += 1) {
    const start = match.log.length;
    match = play(match, 'bot-' + turn);
    const events = match.log.slice(start);
    const bolts = events.filter(lightning);
    assert.equal(bolts.length, turn === 3 ? 4 : 3);
    assert.ok(bolts.every(({ amount, side }) => amount === 1 && side === 'bot'));
    assert.deepEqual(bolts.map(({ cardId }) => cardId), turn === 1 ? ['fragile', 'fragile', 'next'] : bolts.map(() => 'next'));
    if (turn < 3) {
      assert.equal(findUnit(match, 'eye').card.timer, 3 - turn);
      match = play(match, 'human-' + turn);
    } else {
      const breakIndex = events.findIndex(({ cardId, reason }) => cardId === 'eye' && reason === 'timer');
      assert.equal(events.slice(0, breakIndex).filter(lightning).length, 3);
      assert.equal(events.slice(breakIndex).filter(lightning).length, 1);
    }
  }
  assert.equal(findUnit(match, 'next').card.power, 12);
  assert.deepEqual(match.players.human.discard.map(({ id }) => id), ['eye']);
  for (const event of match.log.slice(before.log.length)) applyJournalEvent(replay, event);
  assert.equal(findUnit(replay, 'eye'), undefined);
  assert.equal(findUnit(replay, 'next').card.power, 12);
});

test('Removing Storm Eye early stops the storm without a final bolt', () => {
  let match = play(setup(), 'eye');
  removeUnit(match, findUnit(match, 'eye'), 'discard');
  match = play(match, 'bot-1');
  assert.equal(match.log.some(lightning), false);
});

test('Storm Eye also expires if the opposing side has no units', () => {
  let match = setup();
  match.players.bot.board.orbit = [];
  match.players.bot.passed = true;
  match = play(match, 'eye');
  assert.equal(findUnit(match, 'eye').card.timer, 2);
  match = play(match, 'human-1');
  match = play(match, 'human-2');
  assert.equal(findUnit(match, 'eye'), undefined);
  assert.ok(match.players.human.discard.some(({ id }) => id === 'eye'));
  assert.equal(match.log.some(lightning), false);
});
