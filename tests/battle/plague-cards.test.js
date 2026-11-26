import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, basePower, createCard, damage, findUnit, statusCount } from '../../docs/game/board.js';
import { chooseBotTurn, pickBotTarget } from '../../docs/game/bot.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { inspectDeck, PRESETS } from '../../docs/game/decks.js';
import { applyAction, createDeckMatch, createMatch } from '../../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { unit as makeUnit, drain } from '../helpers/battle-helpers.js';

const random = () => 0;
const definitions = new Map(FACTIONS.growth.pool.map((def) => [def.id, def]));
const card = (id) => createCard(id, definitions.get(id));
const unit = (id, power = 5, armor = 0) => makeUnit(id, power, { armor });
const action = (type, cardId, position = 0) => ({ type, cardId, row: 'orbit', position });
const act = (match, type, cardId, position, side = 'human') =>
  applyAction(match, side, action(type, cardId, position), { random });
const infection = (match, id) => statusCount(findUnit(match, id).card, 'infection');

function fixture(...ids) {
  const match = createMatch({ random });
  match.turn = 'human';
  match.phase = 'playing';
  Object.assign(match.players.human, { hand: ids.map(card).concat(unit('other')), deck: [], leader: null });
  Object.assign(match.players.bot, { hand: [unit('bot-spare')], deck: [], leader: null, passed: true });
  return match;
}

test('the Plague preset is legal, has Carrier, and uses all nine new cards with the requested rarities and categories', () => {
  const [protectorate, original, plague] = PRESETS;
  assert.deepEqual(protectorate.cardIds, FACTIONS.protectorate.deck.map(({ id }) => id));
  assert.deepEqual(original.cardIds, FACTIONS.growth.deck.map(({ id }) => id));
  const { valid, cost, units, leader } = inspectDeck(plague);
  assert.deepEqual([valid, cost, units, leader.id], [true, 150, 19, 'carrier']);
  assert.equal(createDeckMatch(plague, { random }).players.human.leader.id, 'carrier');
  for (const [id, provision, power, type = 'unit', rarity = 'bronze'] of [
    ['rot-midge',4,3], ['plague-carrier',5,1], ['rot-scavenger',4,5], ['boil',4,1], ['rot',4,undefined,'effect'],
    ['rot-giant',11,3,'unit','gold'], ['pestilence',8,undefined,'effect','gold'],
    ['plague-burst',7,undefined,'effect','epic'], ['spore-season',12,undefined,'artifact','gold'],
  ]) {
    const def = definitions.get(id);
    assert.deepEqual([def.provision, def.power, def.type, def.rarity], [provision,power,type,rarity]);
    assert.deepEqual(def.categories, id === 'spore-season' ? [] : ['Гниль']);
    assert.ok(plague.cardIds.includes(id));
  }
});

test('Rot Midge can order immediately and waits two owner turns to use the order again', () => {
  let match = fixture('rot-midge');
  match.players.bot.board.orbit = [unit('enemy')];
  match = act(match, 'play', 'rot-midge');
  match = act(match, 'order', 'rot-midge');
  assert.deepEqual(match.pending.options, ['enemy']);
  match = act(match, 'target', 'enemy');
  assert.equal(infection(match, 'enemy'), 2);
  assert.equal(findUnit(match, 'rot-midge').card.readyAt, 3);
  assert.equal(act(match, 'order', 'rot-midge'), match);
  assert.equal(match.players.human.turns, 1);
});

test('the carrier infects itself and both neighbors; a hard bot picks a legal enemy slot', () => {
  let match = fixture('plague-carrier');
  match.players.bot.board.orbit = [unit('left'), unit('right')];
  match = act(match, 'play', 'plague-carrier', 1);
  assert.deepEqual(match.players.bot.board.orbit.map(({ id }) => id), ['left','plague-carrier','right']);
  assert.deepEqual(['left','right','plague-carrier'].map((id) => infection(match,id)), [3,3,1]);

  match = fixture();
  match.turn = 'bot';
  match.players.bot.passed = false;
  match.players.bot.usedAbility = true;
  match.players.bot.hand = [card('plague-carrier')];
  match.players.human.board.orbit = Array.from({ length: 9 }, (_, i) => unit('blocked-' + i));
  match.players.human.board.surface = [unit('left'),unit('right')];
  const move = chooseBotTurn(match, 'hard', { random, rolloutSamples: 1 });
  assert.equal(move.row, 'surface');
  assert.notEqual(applyAction(match, 'bot', move), match);
});

test('Rot Scavenger counts infected enemies and Boil grows only at the end of its side’s turn', () => {
  let match = fixture('rot-scavenger');
  match.players.bot.passed = false;
  match.players.human.board.orbit = [card('boil'), unit('friend')];
  match.players.bot.board.orbit = [unit('weak',1),unit('strong',10),unit('clean')];
  for (const id of ['weak','strong','friend']) applyStatus(match, findUnit(match,id), 'infection', 1);
  match = act(match, 'play', 'rot-scavenger', 2);
  assert.equal(findUnit(match, 'rot-scavenger').card.power, 7);
  match = act(match, 'pass', undefined, 0, 'bot');
  assert.equal(findUnit(match, 'weak'), undefined);
  assert.equal(findUnit(match, 'boil').card.power, 2);
  assert.equal(findUnit(match, 'strong').card.power, 9);
});

test('Rot targets any enemy row and Pestilence replaces both rows for three turns', () => {
  let match = fixture('rot', 'pestilence');
  match.players.bot.passed = true;
  match.players.bot.board.orbit = [unit('enemy')];
  match = act(match, 'play', 'rot');
  assert.deepEqual(match.pending.options, ['orbit','surface']);
  assert.equal(match.pending.selectionSide, 'bot');
  assert.ok(match.pending.options.includes(pickBotTarget(match).cardId));
  match = act(match, 'target', 'surface');
  assert.equal(match.players.bot.rowEffects.surface.remaining, 3);
  assert.equal(match.players.bot.rowEffects.orbit, undefined);
  match = act(match, 'play', 'pestilence');
  assert.deepEqual(Object.values(match.players.bot.rowEffects).map((effect) => effect.remaining), [3,3]);
  assert.deepEqual(Object.values(match.players.bot.rowEffects).map((effect) => effect.sourceDefinitionId), ['pestilence','pestilence']);
  assert.deepEqual(match.players.human.rowEffects, {});
});

test('Rot Giant gains base power in the pile and damages all infected opponents on deployment', () => {
  let match = fixture('rot-giant');
  match.players.human.hand.push(unit('stay-in-round'));
  match.players.bot.board.orbit = [unit('plain'),unit('infected'),unit('armor', 8, 1)];
  for(const id of ['infected','armor']) applyStatus(match, findUnit(match,id),'infection',2);
  // Resolve the infection jobs before the giant itself enters the field.
  match = act(match, 'play', 'other');
  assert.equal(basePower(match.players.human.hand[0]), 5);
  match = act(match, 'play', 'rot-giant', 1);
  assert.equal(findUnit(match,'rot-giant').card.power, 5);
  assert.deepEqual(['plain','infected','armor'].map((id) => findUnit(match,id).card.power), [5,4,8]);
  assert.equal(findUnit(match,'armor').card.armor, 0);
  assert.equal(infection(match,'infected'), 2);
});

test('Plague Burst adds three ticks to existing infections on both sides and leaves clean units alone', () => {
  let match = fixture('plague-burst');
  match.players.human.board.surface = [unit('ally', 8, 2)];
  match.players.bot.board.orbit = [unit('armored', 8, 2), unit('weak', 2), unit('clean')];
  applyStatus(match, findUnit(match, 'ally'), 'infection', 1);
  applyStatus(match, findUnit(match, 'armored'), 'infection', 5);
  applyStatus(match, findUnit(match, 'weak'), 'infection', 3);
  match = act(match, 'play', 'plague-burst');
  const actions = match.log.filter(({ type, sourceDefinitionId }) => type === 'status' && sourceDefinitionId === 'plague-burst');
  assert.deepEqual(actions.filter(({ tick }) => !tick).map(({ cardId, count }) => [cardId, count]),
    [['ally', 4], ['armored', 8], ['weak', 6]]);
  assert.equal(infection(match, 'ally'), 3); // Its owner completed the turn.
  assert.equal(findUnit(match, 'armored').card.armor, 2);
  assert.equal(findUnit(match, 'weak').card.power, 2);
  assert.equal(infection(match, 'clean'), 0);
});

test('Incubator is a seven-provision epic and spends Resilience at round cleanup', () => {
  let match = fixture('incubator');
  const incubator = match.players.human.hand[0];
  assert.equal(incubator.definition.rarity, 'epic');
  assert.equal(incubator.definition.provision, 7);
  match = act(match, 'play', 'incubator');
  assert.equal(findUnit(match, 'incubator').card.resilient, true);
  match = act(match, 'pass');
  assert.equal(match.phase, 'mulligan');
  assert.equal(findUnit(match, 'incubator').card.resilient, false);
});

test('Spore Season summons two Acid Glands, opens two chapters from Rot plays and leaves at round end', () => {
  let match = fixture('spore-season', 'rot-midge', 'boil', 'rot-scavenger');
  match.players.bot.board.surface = [unit('target', 8), unit('clean', 8)];
  applyStatus(match, findUnit(match, 'target'), 'infection', 2);
  match = act(match, 'play', 'spore-season');
  const [left, scenario, right] = match.players.human.board.orbit;
  for (const gland of [left, right]) assert.deepEqual([gland.definition.id, gland.power], ['acid-gland', 2]);
  assert.equal(scenario.definition.scenario.chapters.length, 2);
  assert.equal(scenario.resilient, undefined);
  assert.match(scenario.definition.text, /Пролог:.*\nГлава 1:.*\nГлава 2:/);
  match = act(match, 'play', 'rot-midge', 3);
  assert.equal(match.pending.kind, 'row-effect');
  match = act(match, 'target', 'surface');
  assert.equal(match.players.bot.rowEffects.surface.remaining, 3);
  assert.equal(match.players.bot.rowEffects.orbit, undefined);
  match = act(match, 'end-turn');
  match = act(match, 'play', 'boil', 4);
  assert.equal(findUnit(match, 'target').card.power, 6);
  assert.equal(findUnit(match, 'clean').card.power, 8);
  match = act(match, 'play', 'rot-scavenger', 5);
  assert.equal(findUnit(match, 'spore-season').card.chapter, 2);
  assert.deepEqual(match.log.filter(({ type }) => type === 'scenario-chapter').map(({ chapter }) => chapter), [1, 2]);
  if (match.playedCard) match = act(match, 'end-turn');
  const playback = createPlaybackState(match);
  const next = act(match, 'pass');
  for (const event of next.log.slice(match.log.length)) applyJournalEvent(playback, event);
  assert.equal(next.round, 2);
  assert.equal(findUnit(next, 'spore-season'), undefined);
  assert.equal(findUnit(playback, 'spore-season'), undefined);
  assert.ok(next.players.human.discard.some(({ id }) => id === 'spore-season'));
});

test('Boil splits into three larvae in place even if the damage that removes its armor is lethal', () => {
  for (const amount of [1, 8]) {
    const match = fixture();
    match.players.human.board.orbit = [unit('left'), card('boil'), unit('right')];
    damage(match, findUnit(match, 'boil'), amount);
    drain(match, random);
    assert.deepEqual(match.players.human.board.orbit.map(({ definition }) => definition.id),
      ['left', 'larva', 'larva', 'larva', 'right']);
    assert.equal(match.log.filter(({ type, cardId }) => type === 'death' && cardId === 'boil').length, 1);
  }
});

test('Vine ticks on each owner turn and infects three distinct enemies when n reaches two', () => {
  let match = fixture('vine');
  match.players.human.hand.push(unit('finish'), unit('spare'));
  match.players.bot.board.orbit = ['a', 'b', 'c', 'd'].map((id) => unit(id));
  match = act(match, 'play', 'vine');
  assert.equal(findUnit(match, 'vine').card.growth, 1);
  const playback = createPlaybackState(match);
  const next = act(match, 'play', 'other', 1);
  for (const event of next.log.slice(match.log.length)) applyJournalEvent(playback, event);
  match = next;
  assert.equal(findUnit(playback, 'vine').card.growth, 2);
  assert.equal(findUnit(match, 'vine').card.growth, 2);
  damage(match, findUnit(match, 'vine'), 2);
  match = act(match, 'play', 'finish', 1);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => infection(match, id)), [2, 2, 2, 0]);
});

test('Spore Sac releases a strength-three larva after two owner turns and that larva never grows', () => {
  let match = fixture('spore-sac');
  match.players.human.hand.push(unit('three'), unit('four'), unit('spare'));
  match = act(match, 'play', 'spore-sac');
  match = act(match, 'play', 'other', 1);
  damage(match, findUnit(match, 'spore-sac'), 2);
  match = act(match, 'play', 'three', 1);
  const larva = match.players.human.board.orbit[0];
  assert.deepEqual([larva.definition.id, larva.power], ['larva', 3]);
  match = act(match, 'play', 'four', 2);
  assert.equal(findUnit(match, larva.id).card.power, 3);
});

test('Incubator Order creates two larvae in the chosen row and can be used once each turn', () => {
  let match = fixture('incubator');
  match.players.human.hand.push(unit('spare'));
  match = act(match, 'play', 'incubator');
  assert.equal(findUnit(match, 'incubator').card.readyAt, 1);
  match = act(act(match, 'order', 'incubator'), 'target', 'surface');
  assert.equal(match.players.human.board.surface.length, 2);
  assert.strictEqual(act(match, 'order', 'incubator'), match);
  match = act(match, 'play', 'other', 2);
  match = act(act(match, 'order', 'incubator'), 'target', 'surface');
  assert.equal(match.players.human.board.surface.length, 4);
});

test('Swarm Call can place an enemy-side bronze from the deck and spawns next to it on that side', () => {
  let match = fixture('swarm-call');
  match.players.human.deck.push(card('plague-carrier'));
  match.players.bot.board.orbit = [unit('enemy')];
  match = act(match, 'play', 'swarm-call');
  assert.equal(match.pending.kind, 'deck-placement');
  assert.equal(match.pending.selectionSide, 'bot');
  match = act(match, 'place', undefined, 1);
  assert.deepEqual(match.players.bot.board.orbit.map(({ definition }) => definition.id),
    ['enemy', 'plague-carrier', 'larva']);
  assert.equal(match.players.human.board.orbit.length, 0);
});

test('reviving a strengthened unit restores modified base power and preserves spent Resilience', () => {
  let match = fixture();
  const medic = NEUTRAL_CARDS.find(({ id }) => id === 'field-medic');
  match.players.human.hand.push(createCard('medic', medic));
  const modified = createCard('modified', { id: 'modified', name: 'modified', power: 3, rarity: 'bronze', resilience: true });
  modified.resilient = false;
  modified.basePower = 7;
  modified.power = 0;
  match.players.human.discard.push(modified);
  match = act(match, 'play', 'medic');
  match = act(match, 'target', 'modified');
  match = act(match, 'place', undefined, 1);
  assert.equal(basePower(findUnit(match, 'modified').card), 7);
  assert.equal(findUnit(match, 'modified').card.power, 7);
  assert.equal(findUnit(match, 'modified').card.resilient, false);
});
