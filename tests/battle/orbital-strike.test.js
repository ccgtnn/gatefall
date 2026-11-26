import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, cleanse, createCard, findUnit, statusCount } from '../../docs/game/board.js';
import { chooseBotTurn, pickBotTarget } from '../../docs/game/bot.js';
import { FACTIONS } from '../../docs/game/cards.js';
import { ORBITAL_STRIKE_PRESET, PRESETS, inspectDeck } from '../../docs/game/decks.js';
import { availableOrders } from '../../docs/game/effects.js';
import { applyAction, confirmMulligan, createDeckMatch, createMatch } from '../../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../../docs/ui/turn-playback.js';

const unit = { id: 'test-unit', name: 'Тестовый отряд', power: 20 };
const pool = FACTIONS.protectorate.pool;
const card = (id, instance = id) => createCard(instance, pool.find((definition) => definition.id === id));
const dummy = (id, power = unit.power) => createCard(id, { ...unit, power });
const random = () => 0;
const fixture = (side = 'human') => {
  const match = confirmMulligan(createMatch({ decks: { human: [unit], bot: [unit] }, random }));
  match.players.human.board.surface = [];
  match.turn = side;
  return match;
};
const act = (match, type, cardId, row) => applyAction(match, match.turn, {
  type, cardId, row, position: row ? match.players[match.turn].board[row].length : undefined,
}, { random });
const get = (match, id) => findUnit(match, id).card;
const marked = (match, id) => statusCount(get(match, id), 'target');
const orders = (match) => availableOrders(match, match.turn).map(({ card }) => card.id);
const hits = (match, id) => match.log.filter((event) => event.type === 'damage' && event.sourceDefinitionId === id);

test('Spotter marks an enemy once, through shields, and journal playback retains the mark', () => {
  const match = fixture();
  match.players.human.hand = [card('spotter')];
  const target = createCard('victim', { ...unit, shield: true });
  match.players.bot.board.surface = [target, createCard('artifact', { type: 'artifact' })];
  const selecting = act(match, 'play', 'spotter', 'orbit');
  assert.deepEqual(selecting.pending.options, ['victim']);
  const result = act(selecting, 'target', 'victim');
  assert.equal(marked(result, 'victim'), 1);
  assert.equal(statusCount(get(result, 'victim'), 'shield'), 1);
  const replay = createPlaybackState(match);
  for (const event of result.log.slice(match.log.length)) applyJournalEvent(replay, event);
  assert.equal(marked(replay, 'victim'), 1);
  assert.equal(replay.players.human.marksPlaced, 1);
  const eventCount = result.log.length;
  assert.equal(applyStatus(result, findUnit(result, 'victim'), 'target', 1, { attacker: 'human' }), 0);
  assert.equal(applyStatus(result, findUnit(result, 'spotter'), 'target', 1, { attacker: 'human' }), 0);
  assert.equal(result.log.length, eventCount);
});

test('mark choices exclude marked units, and a mark after Cleansing counts again', () => {
  const match = fixture();
  match.players.human.hand = [card('spotter'), card('aurelian')];
  match.players.human.board.orbit = [card('aggressor')];
  match.players.bot.board.orbit = [dummy('victim'), dummy('unmarked')];
  const attempt = () => applyStatus(match, findUnit(match, 'victim'), 'target', 1, { attacker: 'human' });
  attempt();
  assert.equal(attempt(), 0);
  assert.equal(match.players.human.marksPlaced, 1);
  assert.deepEqual(act(match, 'play', 'spotter', 'surface').pending.options, ['unmarked']);
  cleanse(match, findUnit(match, 'victim'));
  attempt();
  assert.equal(match.players.human.marksPlaced, 2);
  const result = act(match, 'play', 'aurelian', 'orbit');
  assert.equal(get(result, 'aurelian').power, 10);
  assert.equal(hits(result, 'aggressor').length, 3);
});

test('Aggressor fires for friendly light ships with shipClass, even without that category', () => {
  const match = fixture();
  match.players.human.hand = [card('scout-frigate')];
  match.players.human.board.orbit = [card('aggressor')];
  match.players.bot.board.orbit = [dummy('victim')];
  const result = act(match, 'play', 'scout-frigate', 'orbit');
  assert.equal(hits(result, 'aggressor').length, 1);
});

test('Fleet Gunner order is limited to Surface and deals damage without consuming the mark', () => {
  for (const row of ['surface', 'orbit']) {
    const match = fixture();
    match.players.human.hand = [card('fleet-gunner')];
    match.players.bot.board.orbit = [dummy('victim'), dummy('unmarked')];
    applyStatus(match, findUnit(match, 'victim'), 'target', 1, { attacker: 'human' });
    const played = act(match, 'play', 'fleet-gunner', row);
    if (row === 'orbit') {
      assert.ok(!orders(played).includes('fleet-gunner'));
      continue;
    }
    assert.ok(orders(played).includes('fleet-gunner'));
    const pending = act(played, 'order', 'fleet-gunner');
    assert.deepEqual(pending.pending.options, ['victim']);
    const result = act(pending, 'target', 'victim');
    assert.equal(get(result, 'victim').power, 17);
    assert.equal(marked(result, 'victim'), 1);
    assert.equal(get(result, 'fleet-gunner').readyAt, match.players.human.turns + 3);
  }
});

test('Scout Frigate marks with Zeal on Surface and only friendly ships shorten its current cooldown', () => {
  const match = fixture();
  const player = match.players.human;
  player.hand = [card('scout-frigate'), card('aurelian'), dummy('spare')];
  match.players.bot.hand = [card('aurelian', 'enemy-ship'), dummy('bot-spare')];
  match.players.bot.board.orbit = [dummy('victim')];
  const played = act(match, 'play', 'scout-frigate', 'surface');
  assert.equal(statusCount(get(played, 'scout-frigate'), 'shield'), 1);
  const result = act(act(played, 'order', 'scout-frigate'), 'target', 'victim');
  assert.equal(get(result, 'scout-frigate').readyAt, player.turns + 4);
  const enemy = act(result, 'play', 'enemy-ship', 'orbit');
  assert.equal(get(enemy, 'scout-frigate').readyAt, player.turns + 4);
  const own = act(enemy, 'play', 'aurelian', 'surface');
  assert.equal(get(own, 'scout-frigate').readyAt, player.turns + 3);
  assert.equal(marked(own, 'victim'), 1);

  const other = fixture();
  other.players.human.hand = [card('scout-frigate')];
  other.players.bot.board.orbit = [dummy('victim')];
  assert.ok(!orders(act(other, 'play', 'scout-frigate', 'orbit')).includes('scout-frigate'));
});

test('Spear Battery damages a random marked enemy on Surface and boosts a friendly unit on Orbit only with a mark', () => {
  for (const row of ['surface', 'orbit']) {
    for (const mark of [true, false]) {
      const match = fixture();
      match.players.human.hand = [card('spear-battery')];
      match.players.human.board.orbit = [dummy('ally')];
      match.players.bot.board.orbit = [dummy('unmarked'), dummy('victim'), dummy('another')];
      if (mark) for (const id of ['victim', 'another']) {
        applyStatus(match, findUnit(match, id), 'target', 1, { attacker: 'human' });
      }
      const next = act(match, 'play', 'spear-battery', row);
      assert.equal(get(next, 'victim').power, mark && row === 'surface' ? 18 : 20);
      assert.equal(get(next, 'another').power, 20);
      assert.equal(get(next, 'ally').power, mark && row === 'orbit' ? 22 : 20);
      assert.equal(get(next, 'unmarked').power, 20);
    }
  }
});

test('Destruction Protocol hits every enemy once and then hits marked enemies for two', () => {
  const match = fixture();
  match.players.human.hand = [card('destruction-protocol')];
  match.players.bot.board.orbit = [dummy('one'), dummy('unmarked')];
  match.players.bot.board.surface = [dummy('two')];
  for (const id of ['one', 'two']) applyStatus(match, findUnit(match, id), 'target', 1, { attacker: 'human' });
  const result = act(match, 'play', 'destruction-protocol');
  assert.deepEqual(hits(result, 'destruction-protocol').map(({ cardId, amount }) => [cardId, amount]), [['one', 1], ['unmarked', 1], ['two', 1], ['one', 2], ['two', 2]]);
  assert.equal(marked(result, 'one'), 1);
  assert.equal(get(result, 'unmarked').power, 19);
});

test('Tiberius marks the whole selected row before Aggressor fires for each new mark and the ship', () => {
  for (const row of ['orbit', 'surface']) {
    const match = fixture();
    match.players.human.hand = [card('tiberius')];
    match.players.human.board.orbit = [card('aggressor')];
    match.players.human.board.surface = [card('aggressor', 'inactive')];
    match.players.bot.board.orbit = [dummy('one', 1), dummy('two', 1), dummy('already')];
    match.players.bot.board.surface = [dummy('other')];
    applyStatus(match, findUnit(match, 'already'), 'target', 1, { attacker: 'human' });
    // The pre-existing mark should not contribute to this play's triggers.
    match.effects = [];
    let result = act(match, 'play', 'tiberius', row);
    if (row === 'orbit') {
      assert.equal(result.pending.kind, 'mark-row');
      assert.equal(result.pending.selectionSide, 'bot');
      result = act(result, 'target', 'orbit');
      const events = result.log.slice(match.log.length).filter(({ type }) => ['status', 'damage'].includes(type));
      assert.deepEqual(events.slice(0, 2).map(({ type, cardId }) => [type, cardId]), [['status', 'one'], ['status', 'two']]);
      assert.equal(result.players.human.marksPlaced, 3);
      assert.equal(marked(result, 'other'), 0);
    }
    assert.equal(hits(result, 'aggressor').length, row === 'orbit' ? 3 : 1);
  }
});

test('Aggressor fires for its own play on Orbit only', () => {
  for (const row of ['orbit', 'surface']) {
    const match = fixture();
    match.players.human.hand = [card('aggressor')];
    match.players.bot.board.orbit = [dummy('victim')];
    const result = act(match, 'play', 'aggressor', row);
    assert.equal(hits(result, 'aggressor').length, row === 'orbit' ? 1 : 0);
    assert.equal(statusCount(get(result, 'aggressor'), 'shield'), 1);
  }
});

test('Aurelian counts marks placed in earlier rounds even if they left the board', () => {
  for (const row of ['orbit', 'surface']) {
    let match = fixture();
    match.players.bot.board.orbit = [dummy('one', 1), dummy('two', 1)];
    for (const id of ['one', 'two']) applyStatus(match, findUnit(match, id), 'target', 1, { attacker: 'human' });
    match.players.human.board.orbit = [dummy('ally')];
    match.players.human.hand = [card('aurelian')];
    match = act(act(match, 'pass'), 'pass');
    assert.equal(match.round, 2);
    match = confirmMulligan(match);
    assert.equal(findUnit(match, 'one'), undefined);
    assert.equal(match.players.human.marksPlaced, 2);
    assert.equal(get(act(match, 'play', 'aurelian', row), 'aurelian').power, row === 'orbit' ? 10 : 6);
  }
});

test('orbital preset is legal, present in the faction pool, and selected with the Admiral as a bot opponent', () => {
  const result = inspectDeck(ORBITAL_STRIKE_PRESET);
  assert.deepEqual([result.valid, result.cards.length, result.units, result.cost, result.budget], [true, 25, 20, 156, 165]);
  for (const id of ['spotter', 'fleet-gunner', 'scout-frigate', 'spear-battery', 'destruction-protocol', 'aggressor', 'aurelian', 'tiberius']) {
    assert.ok(pool.some((definition) => definition.id === id) && ORBITAL_STRIKE_PRESET.cardIds.includes(id));
  }
  const { bot } = createDeckMatch(PRESETS[1], { random }).players;
  assert.equal(bot.leader.id, 'fleet-admiral');
  assert.deepEqual([...bot.hand, ...bot.deck].map(({ definition }) => definition.id).sort(), ORBITAL_STRIKE_PRESET.cardIds.toSorted());
});

test('bots use active rows and target the row with the most new marks', () => {
  for (const [id, row] of [['aurelian', 'orbit'], ['tiberius', 'orbit'], ['fleet-gunner', 'surface'], ['scout-frigate', 'surface']]) {
    const match = fixture('bot');
    match.players.bot.hand = [card(id)];
    match.round = 3;
    match.players.human.board.surface = [dummy('enemy', 2)];
    for (const difficulty of ['easy', 'normal', 'hard']) {
      assert.equal(chooseBotTurn(match, difficulty).row, row, id + ' on ' + difficulty);
    }
  }
  const match = fixture('bot');
  match.players.bot.hand = [card('tiberius')];
  match.players.human.board.surface = [dummy('one'), dummy('two')];
  match.players.human.board.orbit = [dummy('already')];
  applyStatus(match, findUnit(match, 'already'), 'target', 1, { attacker: 'bot' });
  const pending = act(match, 'play', 'tiberius', 'orbit');
  assert.deepEqual(pickBotTarget(pending), { type: 'target', cardId: 'surface' });
});
