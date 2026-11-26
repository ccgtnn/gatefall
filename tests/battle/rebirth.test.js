import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, findUnit } from '../../docs/game/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/match.js';
import { unit, pick as pickTarget, play as playCard } from '../helpers/battle-helpers.js';

const cards = [...FACTIONS.growth.pool, ...NEUTRAL_CARDS];
const card = (definitionId, id = definitionId) => createCard(id, cards.find(({ id }) => id === definitionId));
const random = () => 0;
const play = (match, cardId) =>
  playCard(match, cardId, { side: 'human', row: 'orbit', position: match.players.human.board.orbit.length, random });
const pick = (match, cardId) => pickTarget(match, cardId, { side: 'human', random });

function fixture(cardId) {
  const match = confirmMulligan(createMatch({ random, rules: { leaderCharges: 0 } }));
  match.players.human.board.surface = [];
  match.players.human.deck = [];
  match.players.human.hand = [card(cardId), unit('spare', 1)];
  match.players.bot.hand = [unit('bot-spare', 1)];
  return match;
}

test('Bioreactor resolves each deathwish before choosing the next of three sacrifices', () => {
  let match = fixture('bioreactor');
  match.players.human.board.orbit = [card('thorn-screecher', 'first'), card('acid-capsule'), unit('third', 2)];
  match.players.human.deck = [card('thorn-screecher', 'second')];
  match.players.bot.board.surface = [unit('enemy', 9)];
  match = play(match, 'bioreactor');
  assert.deepEqual(match.pending.options, ['first', 'acid-capsule', 'third']);
  match = pick(match, 'first');
  assert.deepEqual(match.pending.options, ['second', 'acid-capsule', 'third']);
  assert.equal(match.players.human.deck.length, 0);
  match = pick(match, 'acid-capsule');
  assert.equal(findUnit(match, 'enemy').card.power, 4);
  match = pick(match, 'third');
  assert.equal(match.pending, null);
  assert.equal(findUnit(match, 'bioreactor').card.power, 14);
  assert.ok(findUnit(match, 'second'));
});

test('Synaptic Parasite triggers an allied bronze deathwish while leaving the original on the board', () => {
  const match = fixture('synaptic-parasite');
  match.players.human.board.surface = [card('thorn-screecher', 'first'), card('xylaris-bloom')];
  match.players.human.deck = [card('thorn-screecher', 'second')];
  const pending = play(match, 'synaptic-parasite');
  assert.deepEqual(pending.pending.options, ['first']);
  const next = pick(pending, 'first');
  assert.deepEqual(next.players.human.board.surface.map(({ id }) => id), ['first', 'second', 'xylaris-bloom']);
  assert.deepEqual(next.players.human.discard, []);
});

test('immunity prevents both kinds of manual choice, while random and weakest effects can hit', () => {
  const match = fixture('armor-piercing-shot');
  const immuneAlly = card('bioreactor', 'ally');
  const immuneEnemy = card('bioreactor', 'enemy');
  match.players.human.board.surface = [immuneAlly];
  match.players.bot.board.surface = [immuneEnemy, unit('stronger', 6)];
  assert.deepEqual(play(match, 'armor-piercing-shot').pending.options, ['stronger']);
  match.players.human.hand[0] = card('veteran-mercenary');
  const friendly = play(match, 'veteran-mercenary');
  assert.deepEqual(friendly.pending.options, ['veteran-mercenary']);

  match.players.human.hand[0] = card('bioreactor');
  match.players.human.board.surface.push(card('acid-capsule'));
  const randomHit = pick(play(match, 'bioreactor'), 'acid-capsule');
  assert.equal(findUnit(randomHit, 'enemy'), undefined);
  assert.equal(randomHit.pending, null);

  match.players.human.board.surface[1] = card('xylaris-bloom');
  match.players.bot.board.surface.push(unit('tied', 4));
  const weakest = pick(play(match, 'bioreactor'), 'xylaris-bloom');
  assert.equal(findUnit(weakest, 'enemy'), undefined);
  assert.ok(findUnit(weakest, 'tied'));
});

test('Genome Keeper copies unique bronze wishes and triggers them on its own death', () => {
  const match = fixture('genome-keeper');
  match.players.human.deck = [card('thorn-screecher', 'reserve')];
  match.players.human.discard = [
    card('thorn-screecher'), card('acid-capsule', 'capsule1'), card('acid-capsule', 'capsule2'), card('xylaris-bloom'),
  ];
  match.players.bot.board.surface = [unit('enemy', 12)];
  match.players.bot.hand = [card('armor-piercing-shot'), unit('bot-spare', 1)];
  let next = play(match, 'genome-keeper');
  const keeper = findUnit(next, 'genome-keeper').card;
  assert.deepEqual(keeper.inheritedDeathwishes.map(({ id }) => id), ['thorn-screecher', 'acid-capsule']);
  next = applyAction(next, 'bot', { type: 'play', cardId: 'armor-piercing-shot' }, { random });
  next = applyAction(next, 'bot', { type: 'target', cardId: keeper.id }, { random });
  assert.equal(findUnit(next, 'enemy').card.power, 7);
  assert.ok(findUnit(next, 'reserve'));
  assert.equal(next.log.filter(({ type, name }) => type === 'deathwish' && name === keeper.definition.name).length, 2);
});

test('the bot chooses a deathwish sacrifice over an ordinary unit', () => {
  const match = fixture('bioreactor');
  match.players.human.board.orbit = [unit('ordinary', 2), card('acid-capsule')];
  [match.players.bot, match.players.human] = [match.players.human, match.players.bot];
  match.turn = 'bot';
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'bioreactor', row: 'orbit', position: 2 }, { random });
  assert.equal(chooseBotTurn(pending, 2)?.cardId, 'acid-capsule');
});
