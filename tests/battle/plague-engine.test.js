import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, basePower, changeBasePower, damage, findUnit, heal, setRowEffect, statusCount } from '../../docs/game/engine/board.js';
import { FACTIONS, LARVA, NEUTRAL_CARDS, SHADOW } from '../../docs/game/cards/cards.js';
import { applyAction, canPlayCard, createMatch, totalScore } from '../../docs/game/engine/match.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';
import { unit as makeUnit } from '../helpers/battle-helpers.js';

const rng = () => 0;
const unit = (id, rules) => makeUnit(id, 5, rules);
const source = { scope: 'source' };
const boost = (amount) => ({ steps: [{ action: 'boost', target: source, amount }] });
const rot = { type: 'rot', remaining: 3 };
const pass = { type: 'pass' };
const play = (cardId, position = 0) => ({ type: 'play', cardId, row: 'orbit', position });
const step = (match, side, action) => applyAction(match, side, action, { random: rng });

function setup() {
  const match = createMatch({ random: rng });
  match.phase = 'playing';
  match.turn = 'human';
  for (const [side, player] of Object.entries(match.players)) {
    player.leader = null;
    player.hand = [unit(side + '-spare')];
    player.deck = [];
  }
  return match;
}

test('categories cover the existing Growth pool and identify the Void neutrals', () => {
  const categories = Object.groupBy([...FACTIONS.growth.pool, LARVA], (def) => def.categories?.[0]);
  assert.deepEqual(categories['Выводок'].map(({ id }) => id).sort(),
    ['broodlord','cocoon','colossus','feast','gulper','incubator','larva','nest','ravager','scavenger','swarm-call']);
  assert.deepEqual(categories['Росток'].map(({ id }) => id).sort(), ['acid-capsule', 'bioreactor', 'predator', 'spore-sac', 'synaptic-parasite', 'thorn-screecher', 'vine', 'xylaris-bloom']);
  assert.deepEqual(categories['Гниль'].slice(0, 2).map(({ id }) => id), ['acid-gland','spitter']);
  assert.deepEqual(categories.undefined.filter((card) => !card.scenario).map(({ id }) => id).sort(),
    ['genome-keeper', 'infected-carcass']);
  assert.deepEqual(FACTIONS.protectorate.pool.filter((card) => card.categories).map(({ id, categories }) => [id, categories]),
    [['imperial-golem', ['Голем']], ['aggressor', ['Тяжёлый корабль']],
      ['aurelian', ['Тяжёлый корабль']], ['tiberius', ['Тяжёлый корабль']],
      ['emperors-hand', ['Тяжёлый корабль']], ['brander', ['Лёгкий корабль']],
      ['gonets', ['Лёгкий корабль']], ['assault-tank', ['Бронетехника']]]);
  assert.deepEqual([...NEUTRAL_CARDS, SHADOW].filter((card) => card.categories?.includes('Пустота')).map(({ id, categories }) => [id, categories]),
    [['falura', ['Пустота']], ['shadow', ['Пустота']]]);
});

test('damage changes current power; fortify and weaken preserve the offset; healing resets it', () => {
  const match = setup();
  match.players.human.board.orbit = [unit('ally', { armor: 2 })];
  const target = findUnit(match, 'ally');
  damage(match, target, 4);
  assert.deepEqual([basePower(target.card), target.card.power, target.card.armor], [5, 3, 0]);
  changeBasePower(match, target, 2);
  assert.deepEqual([basePower(target.card), target.card.power], [7, 5]);
  changeBasePower(match, target, -1);
  assert.deepEqual([basePower(target.card), target.card.power], [6, 4]);
  heal(match, target);
  assert.equal(target.card.power, 6);
  assert.equal(target.card.definition.power, 5);
});

test('rot adds to the old counter, ticks on the row owner turn and handles both infection and damage', () => {
  let match = setup();
  const { human, bot } = match.players;
  human.hand.push(unit('next'));
  bot.hand.push(unit('bot-next'));
  bot.board.orbit = [unit('enemy', { armor: 1 }), unit('untouched')];
  setRowEffect(match, 'bot', 'orbit', { ...rot, remaining: 1 });
  setRowEffect(match, 'bot', 'orbit', rot);
  match = step(match, 'human', play('human-spare'));
  assert.equal(statusCount(findUnit(match, 'enemy').card, 'infection'), 2);
  assert.equal(match.players.bot.rowEffects.orbit.remaining, 3);
  match = step(match, 'bot', play('bot-spare', 2));
  assert.equal(match.players.bot.rowEffects.orbit.remaining, 3);
  match = step(match, 'human', play('next', 1));
  assert.equal(findUnit(match, 'enemy').card.power, 3);
  assert.equal(findUnit(match, 'enemy').card.armor, 0);
  assert.equal(findUnit(match, 'untouched').card.power, 5);
  assert.equal(match.players.bot.rowEffects.orbit.remaining, 2);
});

test('empty rows expire on their owner turn, including when the other side has passed', () => {
  let match = setup();
  match.players.bot.passed = true;
  match.players.human.hand.push(unit('another'));
  setRowEffect(match, 'human', 'surface', { ...rot, remaining: 1 });
  match = step(match, 'human', play('human-spare'));
  assert.equal(match.players.human.rowEffects.surface, undefined);
  assert.equal(match.turn, 'human');
});

test('resilient cards carry state through round cleanup while row effects disappear without triggers', () => {
  let match = setup();
  const sturdy = unit('sturdy', { resilience: true });
  sturdy.power = 3;
  sturdy.armor = 2;
  match.players.human.board.orbit = [unit('ordinary'), sturdy];
  setRowEffect(match, 'human', 'orbit', rot);
  setRowEffect(match, 'bot', 'surface', rot);
  match = step(step(match, 'human', pass), 'bot', pass);
  assert.equal(match.phase, 'mulligan');
  assert.deepEqual(match.players.human.board.orbit, [{ ...sturdy, resilient: false }]);
  assert.equal(sturdy.resilient, true);
  assert.deepEqual(match.players.human.rowEffects, {});
  assert.deepEqual(match.players.bot.rowEffects, {});
  assert.equal(match.players.human.discard[0].id, 'ordinary');
});

test('an enemy-side play requires a free enemy slot and puts strength and neighbors on that side', () => {
  const match = setup();
  const spy = unit('spy', { power: 1, enemySide: true, deploy: { steps: [
    { action: 'status', target: { scope: 'neighbors' }, status: 'infection', amount: 3 },
    { action: 'damage', target: { scope: 'enemy', type: 'unit', infected: true }, amount: 1 },
  ] } });
  match.players.human.hand.push(spy);
  match.players.bot.board.orbit = Array.from({ length: 9 }, (_, i) => unit('enemy-' + i));
  assert.equal(canPlayCard(match, 'human', spy), true);
  assert.equal(step(match, 'human', play('spy', 0)), match);
  match.players.bot.board.orbit.splice(2);
  const next = step(match, 'human', play('spy', 0));
  assert.equal(totalScore(next.players.human), 0);
  assert.equal(totalScore(next.players.bot), 10);
  assert.equal(findUnit(next, 'spy').side, 'bot');
  assert.equal(statusCount(findUnit(next, 'enemy-0').card, 'infection'), 3);
  assert.equal(statusCount(findUnit(next, 'enemy-1').card, 'infection'), 0);
  const playback = createPlaybackState(match);
  for (const event of next.log.slice(match.log.length)) applyJournalEvent(playback, event);
  assert.equal(totalScore(playback.players.bot), 10);
  damage(next, findUnit(next, 'spy'), 1);
  assert.equal(next.players.human.discard.at(-1).id, 'spy');
});

test('pile passives trigger on the first infection and after expiry, in both deck and hand only', () => {
  let match = setup();
  const passive = { 'first-infection': { enemy: true, ability: { steps: [{ action: 'base-power', target: source, amount: 1 }] } } };
  match.players.human.hand.push(unit('hand', { pileEvents: passive }));
  match.players.human.deck.push(unit('deck', { pileEvents: passive }));
  match.players.human.board.orbit = [unit('field', { pileEvents: passive })];
  match.players.bot.board.orbit = [unit('enemy', { power: 10 })];
  const enemy = findUnit(match, 'enemy');
  applyStatus(match, enemy, 'infection', 1);
  applyStatus(match, enemy, 'infection', 2);
  applyStatus(match, findUnit(match, 'field'), 'infection', 2);
  applyStatus(match, enemy, 'infection', -3);
  applyStatus(match, enemy, 'infection', 1);
  match = step(match, 'human', play('human-spare', 1));
  assert.equal(basePower(match.players.human.hand.find(({ id }) => id === 'hand')), 7);
  assert.equal(basePower(match.players.human.deck[0]), 7);
  assert.equal(basePower(findUnit(match, 'field').card), 5);
});

test('scenarios run the prologue, ignore themselves and enemy plays, stop triggering at chapter three and carry the completed scenario', () => {
  let match = setup();
  const ally = { scope: 'ally', type: 'unit' };
  const spell = (amount) => ({ steps: [{ action: 'boost', target: ally, amount }] });
  const scenario = unit('scenario', { type: 'artifact', resilience: true, categories: ['Гниль'],
    scenario: { category: 'Гниль', prologue: spell(1), chapters: [spell(2), spell(3), spell(4)] } });
  match.players.human.board.orbit = [unit('witness', { resilience: true })];
  match.players.human.hand.push(scenario, ...['one','two','three','four'].map((id) => unit(id, { categories: ['Гниль'] })));
  match.players.bot.hand.push(unit('wrong', { categories: ['Гниль'] }));
  match = step(match, 'human', play('scenario', 1));
  assert.equal(findUnit(match, 'witness').card.power, 6);
  assert.equal(findUnit(match, 'scenario').card.chapter, 0);
  match = step(match, 'bot', play('wrong'));
  assert.equal(findUnit(match, 'scenario').card.chapter, 0);
  match = step(match, 'human', play('one', 2));
  assert.equal(findUnit(match, 'scenario').card.chapter, 1);
  match = step(match, 'bot', pass);
  match = step(match, 'human', play('two', 3));
  assert.equal(findUnit(match, 'scenario').card.chapter, 2);
  match = step(match, 'human', play('three', 4));
  assert.equal(findUnit(match, 'scenario').card.chapter, 3);
  assert.equal(findUnit(match, 'witness').card.power, 15);
  match = step(match, 'human', play('four', 5));
  assert.equal(match.log.filter(({ type }) => type === 'scenario-chapter').length, 3);
  const next = step(match, 'human', pass);
  assert.equal(next.round, 2);
  assert.equal(findUnit(next, 'scenario').card.chapter, 3);
  assert.equal(findUnit(next, 'scenario').card.resilient, false);
});
