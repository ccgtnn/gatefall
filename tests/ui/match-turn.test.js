import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { createMatchTurn } from '../../docs/ui/match-turn.js';

function readyMatch() {
  return confirmMulligan(createMatch({ random: () => 0 }), [], { random: () => 0 });
}

function controller(options = {}) {
  return createMatchTurn({
    screen: { querySelector: () => null, querySelectorAll: () => [] },
    settings: { motion: () => 0, showBotThoughts: () => false, playSound() {} },
    aim: { update() {}, showTap: () => false },
    notices: {}, announcement: {}, showNotice() {}, hideNotice() {}, render() {}, recordJournal() {},
    onMatchChanged() {}, onCancelTargeting() {}, difficulty: () => 2, battlefieldStyle: () => 'standard',
    ...options,
  });
}

test('the bot waits for playback and a reset cancels its scheduled turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const image = Promise.withResolvers();
  const card = { dataset: { boardCard: 'animated' }, getBoundingClientRect: () => ({}),
    querySelector: () => ({ decode: () => image.promise }) };
  let requestedBotTurn = 0;
  let duration = 1;
  const turns = controller({
    screen: {
      classList: { add() {} }, querySelector: () => null,
      querySelectorAll: (selector) => selector === '[data-board-card]' ? [card] : [],
    },
    settings: { motion: () => duration, playSound() {}, showBotThoughts: () => false },
    difficulty: () => { requestedBotTurn += 1; return 2; },
  });
  const ready = readyMatch();
  turns.reset(ready);
  const next = applyAction(ready, 'human', { type: 'pass' });
  assert.equal(next.turn, 'bot');
  next.log.push({ type: 'art-state', cardId: 'animated' });
  const handoff = turns.updateMatch(next);
  assert.equal(turns.replaying, true);
  t.mock.timers.tick(2000);
  assert.equal(requestedBotTurn, 0);

  image.resolve();
  await handoff;
  assert.equal(turns.match, next);
  assert.equal(turns.replaying, false);
  const replacement = readyMatch();
  turns.reset(replacement);
  t.mock.timers.tick(2000);
  assert.equal(requestedBotTurn, 0);
  assert.equal(turns.match, replacement);

  duration = 0;
  await turns.playHuman({ type: 'pass' });
  t.mock.timers.tick(999);
  assert.equal(requestedBotTurn, 0);
  t.mock.timers.tick(1);
  assert.equal(requestedBotTurn, 1);
});

test('a target confirmation from the previous match cannot change the next match', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousCSS = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  t.after(() => { globalThis.CSS = previousCSS; });
  const turns = controller({ aim: { update() {}, showTap: () => true } });
  const ready = readyMatch();
  const shot = FACTIONS.protectorate.deck.find(({ id }) => id === 'orbital-salvo');
  const vine = FACTIONS.growth.deck.find(({ id }) => id === 'vine');
  ready.players.human.hand.unshift(createCard('shot', shot));
  ready.players.bot.board.surface = [createCard('victim', vine)];
  turns.reset(ready);
  await turns.playHuman({ type: 'play', cardId: 'shot' });
  assert.equal(turns.match.pending.side, 'human');
  assert.ok(turns.cancelTargeting());
  assert.equal(turns.match, ready);
  await turns.playHuman({ type: 'play', cardId: 'shot' });
  const confirmation = turns.playHuman({ type: 'target', cardId: 'victim' });
  const replacement = readyMatch();
  turns.reset(replacement);
  t.mock.timers.tick(90);
  await confirmation;
  assert.equal(turns.match, replacement);
  assert.equal(turns.humanCanAct(), true);
});

test('position copying reads the current logical match and difficulty', () => {
  let readPosition;
  let level = 5;
  const turns = controller({
    settings: { bindPositionCopy: (read) => { readPosition = read; } },
    difficulty: () => level,
  });
  assert.equal(readPosition(), undefined);
  const ready = readyMatch();
  const hidden = ready.players.human.hand[0].id;
  turns.reset(ready);
  const { state, level: copiedLevel } = JSON.parse(readPosition());
  assert.equal(copiedLevel, 5);
  assert.ok(!state.players.human.hand.some(({ id }) => id === hidden));
  level = 7;
  assert.equal(JSON.parse(readPosition()).level, 7);
  turns.reset();
  assert.equal(readPosition(), undefined);
});
