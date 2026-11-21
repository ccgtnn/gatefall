import assert from 'node:assert/strict';
import test from 'node:test';
import { findUnit, createCard } from '../docs/game/board.js';
import { NEUTRAL_CARDS } from '../docs/game/cards.js';
import { applyAction, canEndTurn, confirmMulligan, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

const sentinel = { id: 'sentinel', name: 'Дозорный', power: 20 };
const card = (id, instanceId = id) => createCard(instanceId, NEUTRAL_CARDS.find((def) => def.id === id));
const fixture = () => confirmMulligan(createMatch({ decks: { human: [sentinel], bot: [sentinel] }, random: () => 0 }));
const play = (match, cardId, row = 'orbit') => applyAction(match, match.turn, {
  type: 'play', cardId, row, position: match.players[match.turn].board[row].length,
});
const pick = (match, cardId) => applyAction(match, match.turn, { type: 'target', cardId });
const finish = (match, side) => canEndTurn(match, side) ? applyAction(match, side, { type: 'end-turn' }) : match;

test('only earlier friendly Golem plays scale damage, and Old Golem grows on its own play', () => {
  let match = fixture();
  match.players.human.hand = [card('old-golem'), card('fire-golem'), card('sleeping-mountain')];
  match.players.bot.hand = [card('old-golem', 'bot-golem'), createCard('bot-filler', sentinel)];
  match.players.bot.board.surface = [createCard('enemy', sentinel)];
  const before = createPlaybackState(match);

  let next = play(match, 'old-golem');
  assert.equal(findUnit(next, 'old-golem').card.power, 10);
  assert.equal(next.players.human.categoryPlays['Голем'], 1);
  assert.equal(match.players.human.categoryPlays, undefined);
  for (const event of next.log.slice(match.log.length)) applyJournalEvent(before, event);
  assert.equal(before.players.human.categoryPlays['Голем'], 1);
  assert.equal(findUnit(before, 'old-golem').card.power, 10);
  match = finish(next, 'human');

  match = finish(play(match, 'bot-golem'), 'bot');
  assert.equal(match.turn, 'human');
  assert.equal(findUnit(match, 'old-golem').card.power, 10);
  assert.equal(match.players.bot.categoryPlays['Голем'], 1);

  match = play(match, 'fire-golem');
  assert.equal(match.pending.amount, 5);
  assert.ok(match.pending.options.includes('old-golem'));
  assert.ok(!match.pending.options.includes('fire-golem'));
  match = finish(pick(match, 'enemy'), 'human');
  assert.equal(findUnit(match, 'enemy').card.power, 15);
  assert.equal(findUnit(match, 'old-golem').card.power, 11);

  match = finish(play(match, 'bot-filler'), 'bot');
  match = play(match, 'sleeping-mountain');
  assert.equal(findUnit(match, 'sleeping-mountain').card.power, 9);
  assert.equal(findUnit(match, 'old-golem').card.power, 12);
  assert.equal(findUnit(match, 'bot-golem').card.power, 10);
});

test('Sleeping Mountain uses 10 damage on the first play and never takes negative damage', () => {
  for (const [earlier, power] of [[0, 7], [10, 17], [12, 17]]) {
    const match = fixture();
    match.players.human.hand = [card('sleeping-mountain')];
    match.players.human.categoryPlays = { 'Голем': earlier };
    assert.equal(findUnit(play(match, 'sleeping-mountain'), 'sleeping-mountain').card.power, power);
  }
});

test('playing Fire Golem from the discard pile uses prior counts and adds one play', () => {
  let match = fixture();
  match.players.human.categoryPlays = { 'Голем': 3 };
  match.players.human.hand = [card('resurrection')];
  match.players.human.discard = [card('fire-golem')];
  match.players.bot.board.surface = [createCard('enemy', sentinel)];
  match = pick(play(match, 'resurrection'), 'fire-golem');
  match = applyAction(match, 'human', { type: 'place', row: 'orbit', position: 0 });
  assert.equal(match.pending.amount, 7);
  assert.equal(match.players.human.categoryPlays['Голем'], 4);
  assert.equal(findUnit(pick(match, 'enemy'), 'enemy').card.power, 13);
});
