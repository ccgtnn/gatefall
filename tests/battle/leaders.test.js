import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, findUnit, statusCount } from '../../docs/game/board.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { DEVOURER_SPAWN } from '../../docs/game/growth.js';
import { findCardDefinition } from '../../docs/game/card-registry.js';
import { FACTIONS } from '../../docs/game/cards.js';
import { availableOrders, canUseLeader } from '../../docs/game/effects.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/match.js';
import { unit as makeUnit } from '../helpers/battle-helpers.js';

const unit = (id, power = 7) => makeUnit(id, power, { type: 'unit' });
const member = (id, key) => createCard(id, FACTIONS.protectorate.pool.find((def) => def.id === key));
const act = (state, action, side = 'human') => applyAction(state, side, action, { random: () => 0 });
const pick = (state, cardId) => act(state, { type: 'target', cardId });
const leaderAction = { type: 'leader' };

function fixture(humanFaction, humanLeader) {
  const match = confirmMulligan(createMatch({ humanFaction, humanLeader, random: () => 0 }), []);
  match.players.human.board = { orbit: [], surface: [] };
  match.players.bot.board = { orbit: [], surface: [] };
  return match;
}

test('human selects a faction leader and bot sampling can select any of its three leaders', () => {
  for (const [index, roll] of [0, .45, .99].entries()) {
    const match = createMatch({ humanFaction: 'growth', humanLeader: 'carrier', random: () => roll });
    assert.equal(match.players.human.leader.id, 'carrier');
    assert.equal(match.players.human.leader.charges, 1);
    assert.equal(match.players.bot.leader.id, FACTIONS.protectorate.leaders[index].id);
    assert.equal(match.players.bot.leader.charges, [1, 2, 3][index]);
  }
});

test('Supreme Commander has two charges, boosts and readies one Order per turn', () => {
  let match = fixture('protectorate', 'supreme-commander');
  const commander = member('order', 'commander');
  commander.readyAt = 3;
  commander.armor = 2;
  match.players.human.board.orbit = [commander, unit('plain')];
  match.players.human.hand = [unit('spare'), unit('later')];
  match.players.bot.board.orbit = [unit('enemy')];
  match.players.bot.passed = true;
  assert.equal(match.players.human.leader.charges, 2);

  const pending = act(match, leaderAction);
  assert.deepEqual(pending.pending.options, ['order', 'plain']);
  match = pick(pending, 'order');
  assert.equal(findUnit(match, 'order').card.power, 7);
  assert.equal(availableOrders(match, 'human')[0].card.id, 'order');
  assert.equal(match.players.human.leader.charges, 1);
  assert.strictEqual(act(match, leaderAction), match);

  match = act(match, { type: 'play', cardId: 'spare', row: 'surface', position: 0 });
  match = act(match, { type: 'end-turn' });
  match = pick(act(match, leaderAction), 'plain');
  assert.equal(findUnit(match, 'plain').card.power, 9);
  assert.equal(findUnit(match, 'plain').card.definition.order, undefined);
  assert.equal(match.players.human.leader.charges, 0);
  assert.strictEqual(act(match, leaderAction), match);
});

test('Fleet Admiral boosts and shields one friendly unit per turn for three charges without stacking', () => {
  let match = fixture('protectorate', 'fleet-admiral');
  match.players.human.board.orbit = [unit('ally')];
  match.players.human.board.surface = [createCard('artifact', { name: 'Artifact', type: 'artifact' })];
  match.players.bot.board.surface = [unit('enemy')];
  match.players.bot.passed = true;
  match.players.human.hand = [unit('spare-2'), unit('spare-1'), unit('spare-0'), unit('later')];
  assert.equal(match.players.human.leader.charges, 3);
  for (const remaining of [2, 1, 0]) {
    const pending = act(match, leaderAction);
    assert.ok(pending.pending.options.includes('ally'));
    assert.ok(!pending.pending.options.includes('artifact') && !pending.pending.options.includes('enemy'));
    match = pick(pending, 'ally');
    const { card } = findUnit(match, 'ally');
    assert.equal(card.power, 10 - remaining);
    assert.equal(statusCount(card, 'shield'), 1);
    assert.equal(match.players.human.leader.charges, remaining);
    assert.strictEqual(act(match, leaderAction), match);
    match = act(match, { type: 'play', cardId: 'spare-' + remaining, row: 'surface', position: 0 });
  }
  assert.equal(canUseLeader(match, 'human'), false);
  assert.equal(findUnit(match, 'enemy').card.power, 7);
  assert.equal(match.log.filter((event) => event.status === 'shield' && event.cardId === 'ally').length, 1);
});

test('all bot difficulties favor a cooling Order and shield an exposed key unit', () => {
  for (const [leader, expected] of [['supreme-commander', 'cooling'], ['fleet-admiral', 'key']]) {
    const match = fixture('protectorate', leader);
    const { human, bot } = match.players;
    bot.leader = human.leader;
    human.leader = null;
    match.turn = 'bot';
    const commander = member('cooling', 'commander');
    commander.readyAt = bot.turns + 2;
    if (leader === 'fleet-admiral') commander.statuses = { shield: 1 };
    const shielded = unit('shielded', 30);
    shielded.statuses = { shield: 1 };
    const key = member('key', 'orbital-shield');
    key.statuses = { target: 1, infection: 2 };
    bot.board.surface = [commander, shielded, key];
    human.board.surface = [unit('enemy', 40)];
    for (const difficulty of [2, 4, 6]) {
      const pending = act(match, leaderAction, 'bot');
      assert.deepEqual(chooseBotTurn(pending, difficulty, { rolloutSamples: 0 }), { type: 'target', cardId: expected });
    }
  }
});

test('Brood Mother accepts either friendly row, refuses full rows and caps spawn at available slots', () => {
  const match = fixture('growth', 'brood-mother');
  match.players.human.board.orbit = Array.from({ length: 9 }, (_, index) => unit('orbit-' + index));
  match.players.human.board.surface = Array.from({ length: 8 }, (_, index) => unit('surface-' + index));
  const pending = act(match, leaderAction);
  assert.deepEqual(pending.pending.options, ['surface']);
  const next = pick(pending, 'surface');
  assert.equal(next.players.human.board.surface.length, 9);
  assert.equal(next.players.human.board.surface.at(-1).definition.id, 'larva');
});

test('Devourer has three charges, preserves victim strength and claims its slot before Deathwish', () => {
  let match = fixture('growth', 'devourer');
  const cocoon = FACTIONS.growth.pool.find(({ id }) => id === 'cocoon');
  const victim = createCard('victim', cocoon);
  victim.power = 11;
  match.players.human.board.orbit = [unit('left'), victim, ...Array.from({ length: 7 }, (_, i) => unit('fill-' + i))];
  match.players.bot.passed = true;
  match.players.bot.board.orbit = [unit('enemy')];
  assert.equal(findCardDefinition(DEVOURER_SPAWN.id), undefined);
  for (const [victimId, remaining] of [['victim', 2], ['fill-0', 1], ['fill-1', 0]]) {
    const pending = act(match, leaderAction);
    assert.ok(!pending.pending.options.includes('enemy'));
    match = pick(pending, victimId);
    assert.equal(match.players.human.leader.charges, remaining);
    assert.strictEqual(act(match, leaderAction), match);
    if (remaining === 2) {
      const offspring = match.players.human.board.orbit[1];
      assert.deepEqual([offspring.definition, offspring.power, offspring.basePower], [DEVOURER_SPAWN, 11, 0]);
      assert.equal(findUnit(match, victimId), undefined);
    }
    const next = match.players.human.hand.find(({ definition }) => (definition.type ?? 'unit') === 'unit' && !definition.requiredRow);
    match = act(match, { type: 'play', cardId: next.id, row: 'surface', position: 0 });
    if (match.playedCard) match = act(match, { type: 'end-turn' });
  }
  assert.equal(canUseLeader(match, 'human'), false);
  assert.strictEqual(act(match, leaderAction), match);
});

test('Brood Mother starts with five charges, spawns one larva and waits until next turn', () => {
  let match = fixture('growth', 'brood-mother');
  match.players.bot.passed = true;
  match.players.human.hand = Array.from({ length: 6 }, (_, i) => unit('play-' + i));
  assert.equal(match.players.human.leader.charges, 5);
  for (let i = 0; i < 5; i++) {
    match = pick(act(match, leaderAction), 'orbit');
    assert.equal(match.players.human.board.orbit.length, i + 1);
    assert.equal(match.players.human.leader.charges, 4 - i);
    assert.strictEqual(act(match, leaderAction), match);
    match = act(match, { type: 'play', cardId: 'play-' + i, row: 'surface', position: i });
  }
  assert.equal(canUseLeader(match, 'human'), false);
});

test('Carrier infects its target and adjacent units only', () => {
  const match = fixture('growth', 'carrier');
  match.players.bot.board.surface = [unit('left'), unit('center'), unit('right'), unit('beyond')];
  match.players.bot.board.orbit = [unit('other-row')];
  const next = pick(act(match, leaderAction), 'center');
  assert.deepEqual(next.players.bot.board.surface.map((card) => statusCount(card, 'infection')), [3, 3, 3, 0]);
  assert.equal(statusCount(next.players.bot.board.orbit[0], 'infection'), 0);
});

test('strategic bots resolve legal targets and placements for every leader', () => {
  for (const [faction, { leaders }] of Object.entries(FACTIONS)) {
    for (const leader of leaders.filter(({ ability }) => ability)) {
      const match = fixture(faction, leader.id);
      const { human, bot } = match.players;
      const charges = leader.charges ?? 1;
      bot.leader = { ...leader, charges };
      human.leader = null;
      match.turn = 'bot';
      match.round = 3;
      human.board.surface = [unit('enemy-a'), unit('enemy-b'), unit('enemy-c')];
      bot.board.surface = [unit('friendly-a'), unit('friendly-b'), unit('friendly-c')];
      bot.hand = [unit('plain', 4), unit('spare', 4)];
      if (leader.id === 'marshal') bot.hand[0] = member('standard', 'standard');
      if (leader.id === 'devourer') {
        bot.board.surface[0] = createCard('cocoon', FACTIONS.growth.pool.find(({ id }) => id === 'cocoon'));
      }
      if (leader.id === 'high-priest') bot.board.surface[0] = unit('offering', 1);
      if (leader.id === 'supreme-commander') {
        const commander = member('commander', 'commander');
        commander.readyAt = 3;
        commander.armor = 2;
        bot.board.surface[1] = commander;
      }
      for (const difficulty of [4, 6]) {
        let next = act(match, leaderAction, 'bot');
        assert.notStrictEqual(next, match, leader.id);
        while (next.pending) {
          const chosen = act(next, chooseBotTurn(next, difficulty), 'bot');
          assert.notStrictEqual(chosen, next);
          next = chosen;
        }
        assert.equal(next.players.bot.leader.charges, charges - 1);
        assert.equal(next.playedCard, false);
      }
    }
  }
});
