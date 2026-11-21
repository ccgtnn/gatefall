import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, basePower, createCard, damage, findUnit, statusCount } from '../docs/game/board.js';
import { chooseBotTurn, pickBotTarget } from '../docs/game/bot.js';
import { FACTIONS, NEUTRAL_CARDS } from '../docs/game/cards.js';
import { inspectDeck, PRESETS } from '../docs/game/decks.js';
import { applyAction, confirmMulligan, createDeckMatch, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

const random = () => 0;
const definitions = new Map(FACTIONS.growth.pool.map((def) => [def.id, def]));
const card = (id) => createCard(id, definitions.get(id));
const unit = (id, power = 5, armor = 0) => createCard(id, { id, name: id, power, armor });
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
  assert.deepEqual([valid, cost, units, leader.id], [true, 164, 19, 'carrier']);
  assert.equal(createDeckMatch(plague, { random }).players.human.leader.id, 'carrier');
  for (const [id, provision, power, type = 'unit', rarity = 'bronze'] of [
    ['rot-midge',4,3], ['plague-carrier',5,1], ['rot-scavenger',6,3], ['boil',4,3], ['rot',5,undefined,'effect'],
    ['rot-giant',11,3,'unit','gold'], ['pestilence',11,undefined,'effect','gold'],
    ['plague-burst',9,undefined,'effect','gold'], ['spore-season',12,undefined,'artifact','gold'],
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
  assert.equal(infection(match, 'enemy'), 1);
  assert.equal(findUnit(match, 'rot-midge').card.readyAt, 3);
  assert.equal(act(match, 'order', 'rot-midge'), match);
  assert.equal(match.players.human.turns, 1);
});

test('the carrier infects both neighbors in the middle; a hard bot picks a legal enemy slot', () => {
  let match = fixture('plague-carrier');
  match.players.bot.board.orbit = [unit('left'), unit('right')];
  match = act(match, 'play', 'plague-carrier', 1);
  assert.deepEqual(match.players.bot.board.orbit.map(({ id }) => id), ['left','plague-carrier','right']);
  assert.deepEqual(['left','right','plague-carrier'].map((id) => infection(match,id)), [3,3,0]);

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

test('Rot Scavenger counts infected enemies and Boil reacts even to death on the last infection tick', () => {
  let match = fixture('rot-scavenger');
  match.players.bot.passed = false;
  match.players.human.board.orbit = [card('boil'), unit('friend')];
  match.players.bot.board.orbit = [unit('weak',1),unit('strong',10),unit('clean')];
  for (const id of ['weak','strong','friend']) applyStatus(match, findUnit(match,id), 'infection', 1);
  match = act(match, 'play', 'rot-scavenger', 2);
  assert.equal(findUnit(match, 'rot-scavenger').card.power, 5);
  match = act(match, 'pass', undefined, 0, 'bot');
  assert.equal(findUnit(match, 'weak'), undefined);
  assert.equal(findUnit(match, 'boil').card.power, 5);
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

test('Plague Burst deals damage by infection counters and cleanses surviving targets, respecting armor', () => {
  let match = fixture('plague-burst');
  match.players.bot.board.orbit = [unit('armored', 8, 2),unit('weak', 2),unit('clean')];
  applyStatus(match, findUnit(match, 'armored'), 'infection', 5);
  applyStatus(match, findUnit(match, 'weak'), 'infection', 3);
  match = act(match, 'play', 'plague-burst');
  assert.equal(findUnit(match, 'armored').card.power, 5);
  assert.equal(infection(match,'armored'), 0);
  assert.equal(findUnit(match,'weak'), undefined);
  assert.equal(findUnit(match,'clean').card.power, 5);
});

test('Spore Season opens each chapter from actual Rot plays, chooses the strongest row and exiles itself', () => {
  let match = fixture('spore-season','rot-midge','rot-giant','boil');
  match.players.bot.board.orbit = [unit('a'),unit('b'),unit('c'),unit('d')];
  match.players.bot.board.surface = [unit('e',2)];
  match = act(match, 'play', 'spore-season');
  assert.equal(infection(match,'a'), 2);
  assert.equal(findUnit(match,'spore-season').card.chapter, 0);
  match = act(match, 'play', 'rot-midge', 1);
  assert.equal(findUnit(match,'spore-season').card.chapter, 1);
  assert.deepEqual(['a','b','c','d','e'].map((id) => infection(match,id)), [2,2,2,0,0]);
  match = act(match, 'end-turn');
  match = act(match, 'play', 'rot-giant', 2);
  assert.equal(match.players.bot.rowEffects.orbit.remaining, 2);
  assert.equal(match.players.bot.rowEffects.surface, undefined);
  match = act(match, 'end-turn');
  damage(match, findUnit(match,'d'), 1);
  match = act(match, 'play', 'boil', 3);
  assert.deepEqual(['a','b','c','d','e'].map((id) => findUnit(match,id).card.power), [2,2,2,4,2]);
  assert.equal(findUnit(match,'spore-season'), undefined);
  assert.equal(match.players.human.exile.at(-1).chapter, 3);
});

for (const destination of ['discard', 'exile']) {
  test(`Spore Season carries its chapter once, then enters ${destination} at the end of round two`, () => {
    let match = fixture('spore-season', 'boil');
    match = act(match, 'play', 'spore-season');
    match = act(match, 'play', 'boil', 1);
    const scenario = findUnit(match, 'spore-season');
    assert.equal(scenario.card.chapter, 1);
    assert.equal(scenario.card.resilient, true);
    if (destination === 'exile') applyStatus(match, scenario, 'doomed', 1);

    const playback = createPlaybackState(match);
    const roundTwo = act(match, 'pass');
    for (const event of roundTwo.log.slice(match.log.length)) applyJournalEvent(playback, event);

    assert.equal(roundTwo.round, 2);
    assert.equal(scenario.card.resilient, true);
    const retained = findUnit(roundTwo, 'spore-season').card;
    assert.equal(retained.chapter, 1);
    assert.equal(retained.resilient, false);
    assert.deepEqual(findUnit(playback, 'spore-season').card, retained);
    assert.equal(statusCount(retained, 'doomed'), Number(destination === 'exile'));

    match = confirmMulligan(roundTwo, [], { random });
    assert.equal(match.phase, 'playing');
    match = act(match, 'pass');
    const roundThree = act(match, 'play', 'bot-spare', 0, 'bot');
    const secondPlayback = createPlaybackState(match);
    for (const event of roundThree.log.slice(match.log.length)) applyJournalEvent(secondPlayback, event);

    assert.equal(roundThree.round, 3);
    assert.equal(findUnit(roundThree, 'spore-season'), undefined);
    assert.equal(findUnit(secondPlayback, 'spore-season'), undefined);
    assert.deepEqual(roundThree.players.human[destination].find(({ id }) => id === 'spore-season'), retained);
  });
}

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
