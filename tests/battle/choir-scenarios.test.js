import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { announcePlay, applyStatus, createCard, damage, findUnit, spawnCards, statusCount, weaken } from '../../docs/game/board.js';
import { pickBotTarget } from '../../docs/game/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { FACTIONS, KEYWORDS } from '../../docs/game/cards.js';
import { AWAKENING, CHOIR_CARDS, CULTIST, FANATIC, LARGE_TENTACLE, PSIONICS, SLEEPER, TENTACLE } from '../../docs/game/choir.js';
import { collection, copyLimit, inspectDeck, PRESETS } from '../../docs/game/decks.js';
import { availableOrders, canUseLeader, enqueueEndTurn } from '../../docs/game/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../../docs/game/match.js';
import { createRewardProgress } from '../../docs/game/rewards.js';
import { filterCatalog } from '../../docs/ui/catalog-cards.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { drain as drainEffects, pick as pickTarget, play as playCard } from '../helpers/battle-helpers.js';

import { action, cards, drain, fixed, get, hit, human, pick, play, quiet, setup, unit } from '../helpers/choir.js';

test('Scenario prologue surrounds the artifact and Fanatic transformation triggers chapter one', () => {
  const match = play(setup({ hand: [AWAKENING], orbit: [unit(9)], deck: [FANATIC, unit(4)] }), 'orbit', 0);
  const row = human(match).board.orbit;
  assert.deepEqual(row.map(({ definition }) => definition.id), [FANATIC.id, AWAKENING.id, FANATIC.id, 'unit-9']);
  assert.equal(row[0].definition.token, true);
  assert.equal(row[2].definition.token, true);
  assert.equal(get(match, 'hand-0').playedEffects, 0);
  const result = hit(match, row[0].id, 2);
  assert.equal(get(result, 'hand-0').chapter, 1);
  assert.deepEqual(human(result).deck.map(({ power, basePower }) => [power, basePower]), [[5, 5], [4, 4]]);
});

test('Chapter two destroys the selected ally, triggers its deathwish and summons a large tentacle', () => {
  const spores = FACTIONS.growth.deck.find(({ id }) => id === 'spore-sac');
  let match = setup({ orbit: [AWAKENING, spores, unit(9)] });
  spawnCards(match, 'bot', 'surface', 0, 1, TENTACLE);
  drain(match);
  assert.equal(get(match, 'orbit-0').chapter, 0);
  spawnCards(match, 'human', 'surface', 0, 2, TENTACLE);
  drain(match);
  assert.equal(get(match, 'orbit-0').chapter, 2);
  assert.deepEqual(pickBotTarget(match), { type: 'target', cardId: 'orbit-1' });
  match = pick(match, 'orbit-1');
  assert.equal(get(match, 'orbit-1'), undefined);
  assert.ok(get(match, 'orbit-2'));
  assert.equal(match.pending, null);
  assert.equal(human(match).board.surface.at(-1).definition.id, LARGE_TENTACLE.id);
  assert.equal(human(match).discard[0].id, 'orbit-1');
  assert.ok(human(match).board.orbit.some(({ definition }) => definition.id === 'larva'));
  const destroyed = match.log.findIndex(({ type, reason, cardId }) =>
    type === 'death' && reason === 'destroy' && cardId === 'orbit-1');
  const summoned = match.log.findIndex(({ type, cards }) =>
    type === 'spawn' && cards.some(({ definition }) => definition.id === LARGE_TENTACLE.id));
  assert.ok(destroyed >= 0 && summoned > destroyed);
});

test('Chapter two summons without a choice when no allied unit can be sacrificed', () => {
  const match = setup({ orbit: [AWAKENING] });
  get(match, 'orbit-0').chapter = 1;
  match.effects.push({ side: 'human', sourceId: 'orbit-0', scenarioChapter: true });
  drain(match);
  assert.equal(match.pending, null);
  assert.equal(human(match).board.surface[0].definition.id, LARGE_TENTACLE.id);
});

test('Final chapter needs a new appearance with seven played effects, completes once and summons in its own row', () => {
  const match = setup({ surface: [AWAKENING], orbit: [unit(5)] });
  const scenario = get(match, 'surface-0');
  scenario.chapter = 2;
  for (let index = 0; index < 6; index++) announcePlay(match, 'human', createCard(`spell-${index}`, quiet));
  announcePlay(match, 'human', createCard('scenario-inert', AWAKENING));
  announcePlay(match, 'bot', createCard('enemy-spell', quiet));
  spawnCards(match, 'human', 'surface', 1, 1, TENTACLE);
  drain(match);
  assert.equal(scenario.chapter, 2);
  assert.equal(scenario.playedEffects, 6);
  announcePlay(match, 'human', createCard('spell-7', quiet));
  drain(match);
  assert.equal(scenario.chapter, 2);
  spawnCards(match, 'human', 'surface', 2, 1, TENTACLE);
  drain(match);
  assert.equal(scenario.chapter, 3);
  assert.equal(scenario.playedEffects, 7);
  const sleeper = human(match).board.surface.find(({ definition }) => definition.id === SLEEPER.id);
  assert.ok(sleeper);
  assert.equal(findUnit(match, sleeper.id).row, 'surface');
  spawnCards(match, 'human', 'surface', 3, 1, TENTACLE);
  drain(match);
  assert.equal(human(match).board.surface.filter(({ definition }) => definition.id === SLEEPER.id).length, 1);
});

test('Hand and deck tutors offer Psionics and resolve the nested play before drawing', () => {
  const handTutor = cards.get('whisper-interpreter');
  const start = setup({ hand: [handTutor, quiet, AWAKENING], deck: [unit(8)] });
  const fromHand = play(start);
  assert.deepEqual(fromHand.pending.options, ['hand-1', 'hand-2']);
  assert.equal(fromHand.pending.pile, 'hand');
  assert.ok(fromHand.pending.options.includes(pickBotTarget(fromHand).cardId));
  const finished = pick(fromHand, 'hand-1');
  assert.equal(human(finished).effectCategoryPlays[PSIONICS], 1);
  assert.deepEqual(finished.log.filter(({ type }) => ['play', 'draw'].includes(type)).map(({ type, from }) => [type, from]),
    [['play', undefined], ['play', 'hand'], ['draw', undefined]]);

  const keeper = cards.get('forbidden-scroll-keeper');
  const deckChoice = play(setup({ hand: [keeper], deck: [unit(5), AWAKENING, quiet] }));
  assert.deepEqual(deckChoice.pending.options, ['deck-1', 'deck-2']);
  const placement = pick(deckChoice, 'deck-1');
  assert.equal(placement.pending.kind, 'deck-placement');
  const placed = action(placement, 'place', { row: 'surface', position: 0 });
  assert.deepEqual(human(placed).board.surface.map(({ definition }) => definition.id), [FANATIC.id, AWAKENING.id, FANATIC.id]);
});

test('Creation offers opposing bronze cards or tiered gold effects and plays the chosen copy', () => {
  const initial = setup({ hand: [cards.get('alien-dream')] });
  const choice = play(initial);
  assert.equal(choice.pending.options.length, 3);
  assert.ok(choice.pending.cards.every(({ definition }) => definition.faction === 'protectorate' && definition.rarity === 'bronze'));
  const created = choice.pending.cards.find(({ definition }) => definition.type === 'unit');
  const placement = pick(choice, created.id);
  const played = action(placement, 'place', { row: 'surface', position: 0 });
  assert.equal(get(played, created.id).definition.id, created.definition.id);
  assert.equal(played.log.find(({ cardId }) => cardId === created.id).from, 'created');

  for (const [count, offer] of [[2, 0], [3, 1], [6, 2], [9, 3], [12, 4], [15, 4]]) {
    const match = play(setup({ count, hand: [cards.get('sleeper-revelation')], orbit: [unit(6)], enemies: [unit(8)] }));
    assert.equal(match.pending?.options.length ?? 0, offer);
    assert.ok(match.pending?.cards.every(({ definition }) => definition.rarity === 'gold' && definition.type === 'effect') ?? true);
  }
});

test('Awakening survives one round and preserves its chapter', () => {
  const before = setup({ orbit: [AWAKENING, FANATIC] });
  const scenario = get(before, 'orbit-0');
  scenario.chapter = 2;
  const after = applyAction(action(before, 'pass'), 'bot', { type: 'pass' }, { random: fixed });
  const retained = get(after, 'orbit-0');
  assert.equal(after.round, 2);
  assert.equal(retained.chapter, 2);
  assert.equal(retained.resilient, false);
  assert.equal(human(after).board.surface.length, 0);
});

test('The bot completes placement of a created unit at all difficulties', () => {
  const initial = setup({});
  initial.turn = 'bot';
  initial.players.human.factionId = 'protectorate';
  initial.players.bot.factionId = 'choir';
  initial.players.bot.leader = null;
  initial.players.bot.hand = [createCard('alien-dream', cards.get('alien-dream')), createCard('extra', unit(3))];
  const choosing = applyAction(initial, 'bot', { type: 'play', cardId: 'alien-dream' }, { random: fixed });
  const unitChoice = choosing.pending.cards.find(({ definition }) => definition.type === 'unit');
  const placing = applyAction(choosing, 'bot', { type: 'target', cardId: unitChoice.id }, { random: fixed });
  for (const difficulty of [2, 4, 6]) {
    const move = chooseBotTurn(placing, difficulty);
    assert.equal(move.type, 'place');
    const played = applyAction(placing, 'bot', move, { random: fixed });
    assert.equal(findUnit(played, unitChoice.id).side, 'bot');
  }
});

test('the bot chooses and places the unit created by Litany on all difficulties', () => {
  const initial = setup();
  initial.turn = 'bot';
  const bot = initial.players.bot;
  bot.factionId = 'choir';
  bot.leader = null;
  bot.hand = [createCard('litany', cards.get('sleeper-litany'))];
  const choosing = applyAction(initial, 'bot', { type: 'play', cardId: 'litany' }, { random: fixed });
  for (const difficulty of [2, 4, 6]) {
    const next = chooseBotTurn(choosing, difficulty);
    assert.ok(choosing.pending.options.includes(next.cardId));
    const placing = applyAction(choosing, 'bot', next, { random: fixed });
    const placed = applyAction(placing, 'bot', chooseBotTurn(placing, difficulty), { random: fixed });
    assert.equal(findUnit(placed, next.cardId).side, 'bot');
    assert.equal(get(placed, next.cardId).counter, 2);
  }
});
