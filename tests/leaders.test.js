import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, statusCount } from '../docs/game/board.js';
import { chooseBotTurn } from '../docs/game/bot.js';
import { FACTIONS } from '../docs/game/cards.js';
import { availableOrders } from '../docs/game/effects.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';

const unit = (id, power = 7) => createCard(id, { id, name: id, type: 'unit', power });
const member = (id, key) => createCard(id, FACTIONS.protectorate.deck.find((def) => def.id === key));
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
    assert.equal(match.players.bot.leader.charges, 1);
  }
});

test('Supreme Commander boosts an ally and makes its sleeping Order available immediately', () => {
  const match = fixture('protectorate', 'supreme-commander');
  const commander = member('order', 'commander');
  commander.readyAt = 3;
  commander.armor = 2;
  match.players.human.board.orbit = [commander];
  match.players.bot.board.orbit = [unit('enemy')];
  const next = pick(act(match, leaderAction), 'order');
  assert.equal(next.players.human.board.orbit[0].power, 7);
  assert.equal(availableOrders(next, 'human')[0].card.id, 'order');
  assert.equal(next.playedCard, false);
  assert.equal(next.turn, 'human');
  assert.equal(next.players.human.leader.charges, 0);
  assert.strictEqual(act(next, leaderAction), next);
});

test('Fleet Admiral targets only enemy units on Surface', () => {
  const match = fixture('protectorate', 'fleet-admiral');
  match.players.bot.board.orbit = [unit('orbit')];
  assert.strictEqual(act(match, leaderAction), match);
  match.players.bot.board.surface = [unit('surface')];
  const pending = act(match, leaderAction);
  assert.deepEqual(pending.pending.options, ['surface']);
  assert.equal(pick(pending, 'surface').players.bot.board.surface[0].power, 3);
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

test('Carrier infects its target and adjacent units only', () => {
  const match = fixture('growth', 'carrier');
  match.players.bot.board.surface = [unit('left'), unit('center'), unit('right'), unit('beyond')];
  match.players.bot.board.orbit = [unit('other-row')];
  const next = pick(act(match, leaderAction), 'center');
  assert.deepEqual(next.players.bot.board.surface.map((card) => statusCount(card, 'infection')), [3, 3, 3, 0]);
  assert.equal(statusCount(next.players.bot.board.orbit[0], 'infection'), 0);
});

test('strategic bots simulate favorable uses and legal choices for all six leaders', () => {
  for (const [faction, { leaders }] of Object.entries(FACTIONS)) {
    for (const leader of leaders) {
      const match = fixture(faction, leader.id);
      const { human, bot } = match.players;
      bot.leader = { ...leader, charges: 1 };
      human.leader = null;
      match.turn = 'bot';
      match.round = 3;
      human.board.surface = [unit('enemy-a'), unit('enemy-b'), unit('enemy-c')];
      bot.board.surface = [unit('friendly-a'), unit('friendly-b'), unit('friendly-c')];
      bot.hand = [unit('plain', 4)];
      if (leader.id === 'supreme-commander') {
        const commander = member('commander', 'commander');
        commander.readyAt = 3;
        commander.armor = 2;
        bot.board.surface[1] = commander;
      }
      for (const difficulty of ['normal', 'hard']) {
        assert.deepEqual(chooseBotTurn(match, difficulty, { rolloutSamples: 0 }), leaderAction, leader.id + ' ' + difficulty);
        let next = act(match, leaderAction, 'bot');
        while (next.pending) {
          const chosen = act(next, chooseBotTurn(next, difficulty), 'bot');
          assert.notStrictEqual(chosen, next);
          next = chosen;
        }
        assert.equal(next.players.bot.leader.charges, 0);
        assert.equal(next.playedCard, false);
      }
    }
  }
});
