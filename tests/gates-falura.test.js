import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, damage, findUnit, removeUnit, statusCount } from '../docs/game/board.js';
import { chooseBotTurn } from '../docs/game/bot.js';
import { NEUTRAL_CARDS, SHADOW } from '../docs/game/cards.js';
import { canUseLeader, leaderCooldown } from '../docs/game/effects.js';
import { applyAction, canPlayCard, confirmMulligan, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

const random = () => 0;
const card = (id) => createCard(id, NEUTRAL_CARDS.find((entry) => entry.id === id));
const unit = (id, power = 12, armor = 0) => createCard(id, { id, name: id, power, armor });
const move = (state, type, cardId, row = 'orbit', position = 0) =>
  applyAction(state, state.pending?.side ?? state.turn, { type, cardId, row, position }, { random });

function setup(id, side = 'human') {
  const match = createMatch({ random, rules: { leaderCharges: 0 } });
  for (const player of Object.values(match.players)) player.leader.charges = 0;
  const other = side === 'human' ? 'bot' : 'human';
  const player = match.players[side];
  match.phase = 'playing';
  match.turn = side;
  player.hand = [card(id), unit('extra'), unit('spare'), unit('reserve')];
  player.deck = [];
  match.players[other].board.orbit = [unit('enemy')];
  match.players[other].passed = true;
  return match;
}

test('Resurrection offers playable cards of any type up to 10 provisions and casts a chosen effect', () => {
  let match = setup('resurrection');
  match.players.bot.discard = [card('gate-guardian')];
  assert.equal(move(match, 'play', 'resurrection'), match);
  match.players.human.discard = [card('world-gates')];
  assert.equal(move(match, 'play', 'resurrection'), match);
  match.players.human.discard.push(card('gate-guardian'), card('forgotten-gates'), card('gravity-pulse'));
  match = move(match, 'play', 'resurrection');
  assert.equal(match.pending.pile, 'discard');
  assert.deepEqual(match.pending.options, ['gate-guardian', 'forgotten-gates', 'gravity-pulse']);
  assert.equal(move(match, 'target', 'world-gates'), match);
  match = move(match, 'target', 'gravity-pulse');
  assert.equal(match.pending.kind, 'enemy-row');
  match = move(match, 'target', 'orbit');
  assert.equal(findUnit(match, 'enemy').card.power, 11);
  assert.equal(match.log.find(({ cardId }) => cardId === 'gravity-pulse').from, 'discard');
});

test('Resurrection supports the bot and is legal on a full board only with a castable discard effect', () => {
  let match = setup('resurrection', 'bot');
  const player = match.players.bot;
  player.discard = [card('gate-guardian')];
  for (const row of ['orbit', 'surface']) player.board[row] = Array.from({ length: 9 }, (_, i) => unit(row + i));
  assert.equal(move(match, 'play', 'resurrection'), match);
  player.discard.push(card('gravity-pulse'));
  match = move(match, 'play', 'resurrection');
  assert.deepEqual(match.pending.options, ['gravity-pulse']);
  const choice = chooseBotTurn(match, 'normal', { random });
  assert.deepEqual(choice, { type: 'target', cardId: 'gravity-pulse' });
  assert.equal(applyAction(match, 'bot', choice, { random }).pending.kind, 'enemy-row');
});

test('Forgotten Gates summons left at placement and right at the second owner turn', () => {
  let match = setup('forgotten-gates');
  const { human, bot } = match.players;
  bot.passed = false;
  bot.hand = [unit('turn-one'), unit('turn-two'), unit('turn-three')];
  human.deck = [card('recon-drone'), card('smuggler'), card('gate-relic'),
    createCard('expensive', { id: 'expensive', name: 'Expensive', power: 8, provision: 5 })];
  const replay = createPlaybackState(match);
  const firstEvent = match.log.length;
  const order = () => match.players.human.board.orbit.map(({ id }) => id);
  match = move(match, 'play', 'forgotten-gates');
  assert.deepEqual(order(), ['recon-drone', 'forgotten-gates']);
  assert.equal(findUnit(match, 'forgotten-gates').card.timer, 2);
  assert.equal(match.pending, null);
  match = move(match, 'play', 'turn-one', 'surface');
  assert.equal(findUnit(match, 'forgotten-gates').card.timer, 1);
  assert.deepEqual(order(), ['recon-drone', 'forgotten-gates']);
  match = move(match, 'play', 'extra', 'surface');
  match = move(match, 'play', 'turn-two', 'surface');
  assert.deepEqual(order(), ['recon-drone', 'forgotten-gates', 'smuggler']);
  assert.equal(findUnit(match, 'forgotten-gates').card.timer, 0);
  assert.equal(findUnit(match, 'smuggler').card.power, 3);
  assert.deepEqual(match.players.human.deck.map(({ id }) => id), ['gate-relic', 'expensive']);
  match = move(match, 'play', 'spare', 'surface');
  match = move(match, 'play', 'turn-three', 'surface');
  assert.equal(match.log.filter(({ from, type }) => type === 'spawn' && from === 'deck').length, 2);
  assert.equal(match.log.some(({ cardId }) => cardId === 'recon-drone' || cardId === 'smuggler'), false);
  for (const event of match.log.slice(firstEvent)) applyJournalEvent(replay, event);
  assert.deepEqual(replay.players.human.deck.map(({ id }) => id), ['gate-relic', 'expensive']);
  assert.deepEqual(replay.players.human.board.orbit.map(({ id }) => id), order());
});

test('Forgotten Gates skips each summon when the row is full or the deck has no eligible unit', () => {
  let match = setup('forgotten-gates');
  match.players.human.deck = [card('recon-drone')];
  match.players.human.board.orbit = Array.from({ length: 8 }, (_, i) => unit('slot-' + i));
  match = move(match, 'play', 'forgotten-gates');
  match = move(match, 'play', 'extra', 'surface');
  assert.equal(findUnit(match, 'forgotten-gates').card.timer, 0);
  assert.deepEqual(match.players.human.deck.map(({ id }) => id), ['recon-drone']);

  match = setup('forgotten-gates');
  match.players.human.deck = [card('gate-guardian')];
  match = move(match, 'play', 'forgotten-gates');
  match = move(match, 'play', 'extra', 'surface');
  assert.deepEqual(match.players.human.board.orbit.map(({ id }) => id), ['forgotten-gates']);
});

test('World Gates offers playable units, artifacts and effects and resolves a chosen effect without placement', () => {
  let match = setup('world-gates');
  match.players.human.deck = [unit('reserve-unit'), card('falura'), card('emp-grenade')];
  match = move(match, 'play', 'world-gates');
  assert.equal(match.pending.fullDeck, true);
  assert.deepEqual(match.pending.options, ['reserve-unit', 'falura', 'emp-grenade']);
  match = move(match, 'target', 'emp-grenade');
  assert.equal(match.pending.kind, 'emp');
  match = move(match, 'target', 'enemy');
  assert.equal(findUnit(match, 'enemy').card.power, 10);
  assert.deepEqual(match.players.human.discard.map(({ id }) => id), ['emp-grenade', 'world-gates']);
  assert.deepEqual(match.log.filter(({ type }) => type === 'play').map(({ cardId, from }) => [cardId, from]),
    [['world-gates', undefined], ['emp-grenade', 'deck']]);
});

test('World Gates can play and deploy an artifact chosen by the hard bot', () => {
  let match = setup('world-gates', 'bot');
  match.players.bot.deck = [card('falura')];
  match = move(match, 'play', 'world-gates');
  const choice = chooseBotTurn(match, 'hard', { random, rolloutSamples: 1 });
  assert.deepEqual(choice, { type: 'target', cardId: 'falura' });
  match = applyAction(match, 'bot', choice, { random });
  const placement = chooseBotTurn(match, 'hard', { random, rolloutSamples: 1 });
  assert.equal(placement.type, 'place');
  match = applyAction(match, 'bot', placement, { random });
  const bot = match.players.bot;
  assert.equal(bot.board[placement.row].length, 3);
  assert.equal(bot.leader.order.sourceDefinitionId, 'falura');
  assert.deepEqual(chooseBotTurn(match, 'hard', { random, rolloutSamples: 1 }), { type: 'leader' });
});

test('World Gates allows effects with a full board, rejects illegal targets and does not cast into an empty deck', () => {
  let match = setup('world-gates');
  const { human } = match.players;
  const gates = human.hand[0];
  assert.equal(canPlayCard(match, 'human', gates), false);
  for (const row of ['orbit', 'surface']) human.board[row] = Array.from({ length: 9 }, (_, i) => unit(row + i));
  human.deck = [unit('blocked'), card('falura'), card('gravity-pulse')];
  assert.equal(canPlayCard(match, 'human', gates), true);
  match = move(match, 'play', 'world-gates');
  assert.deepEqual(match.pending.options, ['gravity-pulse']);
  assert.equal(move(match, 'target', 'blocked'), match);
  match = move(match, 'target', 'gravity-pulse');
  assert.equal(match.pending.kind, 'enemy-row');
  match = move(match, 'target', 'orbit');
  assert.equal(match.log.find(({ type, cardId }) => type === 'damage' && cardId === 'enemy').power, 11);
});

test('Falura replaces a spent leader permanently, spawns Doomed Shadows and only allows one Order each turn', () => {
  let match = setup('falura');
  const before = match;
  const play = move(match, 'play', 'falura');
  const playback = createPlaybackState(before);
  for (const event of play.log.slice(before.log.length)) applyJournalEvent(playback, event);
  assert.deepEqual(playback.players.human.leader.order, play.players.human.leader.order);
  assert.equal(before.players.human.leader.order, undefined);
  const shadows = play.players.human.board.orbit.filter(({ definition }) => definition.id === SHADOW.id);
  assert.equal(shadows.length, 2);
  assert.ok(shadows.every((entry) => entry.power === 2 && statusCount(entry, 'doomed')));
  assert.equal(canUseLeader(play, 'human'), true);
  match = move(move(play, 'leader'), 'target', 'enemy');
  assert.equal(findUnit(match, 'enemy').card.power, 10);
  assert.equal(match.players.human.turns, play.players.human.turns + 1);
  assert.equal(canUseLeader(match, 'human'), true);
  removeUnit(match, findUnit(match, 'falura'), 'destroy');
  assert.equal(canUseLeader(match, 'human'), true);
  match = move(move(match, 'leader'), 'target', 'enemy');
  assert.equal(findUnit(match, 'enemy').card.power, 8);
  assert.equal(move(match, 'leader'), match);
  for (const shadow of shadows) damage(match, findUnit(match, shadow.id), 2);
  assert.equal(match.players.human.exile.filter(({ definition }) => definition.id === SHADOW.id).length, 2);
  match = move(match, 'play', 'extra');
  assert.equal(leaderCooldown(match.players.human), 1);
  assert.equal(move(match, 'leader'), match);
  match = move(match, 'play', 'spare');
  assert.equal(canUseLeader(match, 'human'), true);
  const next = move(match, 'pass');
  assert.equal(next.round, 2);
  assert.equal(confirmMulligan(next, [], { random }).players.human.leader.order.sourceDefinitionId, 'falura');
});

test('Falura fills space in the other row when the row of deployment is almost full', () => {
  const match = setup('falura');
  match.players.human.board.orbit = Array.from({ length: 8 }, (_, i) => unit('orbit' + i));
  const next = move(match, 'play', 'falura', 'orbit', 8);
  assert.equal(next.players.human.board.orbit.length, 9);
  assert.deepEqual(next.players.human.board.surface.map(({ definition }) => definition.id), ['shadow', 'shadow']);
});
