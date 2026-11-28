import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { createMatchTurn } from '../../docs/ui/match-turn.js';
import { takeRememberedRect } from '../../docs/ui/card-motion-core.js';

function readyMatch() {
  return confirmMulligan(createMatch({ random: () => 0 }), [], { random: () => 0 });
}

function controller(options = {}) {
  return createMatchTurn({
    screen: { classList: { add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [] },
    settings: { motion: () => 0, showBotThoughts: () => false, playSound() {} },
    aim: { update() {}, showTap: () => false },
    notices: {}, announcement: {}, showNotice() {}, hideNotice() {}, render() {}, recordJournal() {},
    onMatchChanged() {}, onCancelTargeting() {}, difficulty: () => 2,
    ...options,
  });
}

test('a stalled art decode cannot block playback and reset cancels the scheduled bot turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const card = { dataset: { boardCard: 'animated' }, getBoundingClientRect: () => ({}),
    querySelector: () => ({ decode: () => new Promise(() => {}) }) };
  let requestedBotTurn = 0;
  let duration = 1;
  const classes = new Set();
  const turns = controller({
    screen: {
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }, querySelector: () => null,
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
  assert.ok(classes.has('is-replaying'));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(299);
  assert.equal(turns.replaying, true);
  t.mock.timers.tick(1);
  assert.equal(requestedBotTurn, 0);

  await handoff;
  assert.equal(turns.match, next);
  assert.equal(turns.replaying, false);
  assert.ok(!classes.has('is-replaying'));
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

test('the old turn notice appears only when the journal did not show a banner', async () => {
  const notices = [];
  let duration = 320;
  const doc = {
    body: { append() {} },
    createElement: () => ({
      ownerDocument: doc, style: {}, dataset: {}, append() {}, setAttribute() {}, remove() {},
      animate: () => ({ finished: Promise.resolve(), cancel() {} }),
    }),
  };
  const field = {
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 500, height: 150 }),
    animate: () => ({ finished: Promise.resolve(), cancel() {} }),
  };
  const turns = controller({
    screen: {
      ownerDocument: doc, classList: { add() {}, remove() {} }, querySelector: (selector) =>
        selector.startsWith('.field-center') ? field : null,
      querySelectorAll: () => [],
    },
    settings: { motion: () => duration, playSound() {} },
    showNotice: (_, text) => notices.push(text),
  });

  for (duration of [320, 0]) {
    turns.reset(readyMatch());
    await turns.playHuman({ type: 'pass' });
    assert.deepEqual(notices, duration ? [] : ['Ход противника']);
  }
  turns.reset();
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

async function deckConfirmation(t, speed) {
  const savedCSS = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  t.after(() => { globalThis.CSS = savedCSS; });
  let duration = 0;
  const turns = controller({
    settings: { motion: () => duration, playSound() {}, showBotThoughts: () => false },
  });
  const ready = readyMatch();
  ready.players.human.hand.unshift(createCard('offer-source', findCardDefinition('reinforcements')));
  turns.reset(ready);
  await turns.playHuman({ type: 'play', cardId: 'offer-source' });
  assert.equal(turns.match.pending.kind, 'deck-card');
  const action = { type: 'target', cardId: turns.match.pending.options[0] };
  duration = speed;

  const end = Promise.withResolvers();
  const classList = { add() {}, remove() {} };
  const animationOptions = [];
  const rect = { left: 40, top: 50, width: 65, height: 95 };
  const item = {};
  const other = { classList, animate(_frames, options) { animationOptions.push(options); return { finished: end.promise }; } };
  const overlay = { classList, querySelectorAll: () => [item, other] };
  const card = {
    classList, closest: (selector) => selector === '.choice-overlay' ? overlay : item,
    getBoundingClientRect: () => rect,
    animate(_frames, options) { animationOptions.push(options); return { finished: end.promise }; },
  };
  return { turns, action, card, overlay, end, animationOptions, rect };
}

test('choosing a card waits for the effect, locks input, and remembers the card for placement', async (t) => {
  const { turns, action, card, overlay, end, animationOptions, rect } = await deckConfirmation(t, 200);
  const before = turns.match;
  const confirmation = turns.playHuman(action, card);
  assert.equal(turns.match, before);
  assert.equal(overlay.inert, true);
  assert.equal(turns.confirmingTarget, true);
  assert.equal(turns.cancelTargeting(), false);
  await turns.playHuman(action, card);
  assert.equal(animationOptions.length, 2);
  assert.equal(animationOptions[0].duration, 260);
  end.resolve();
  await confirmation;
  assert.equal(turns.match.pending.kind, 'deck-placement');
  assert.equal(turns.confirmingTarget, false);
  assert.equal(takeRememberedRect(action.cardId), rect);
});

test('reset while a choice animation runs leaves the replacement match and origins untouched', async (t) => {
  const { turns, action, card, end } = await deckConfirmation(t, 200);
  const confirmation = turns.playHuman(action, card);
  const replacement = readyMatch();
  turns.reset(replacement);
  end.resolve();
  await confirmation;
  assert.equal(turns.match, replacement);
  assert.equal(turns.confirmingTarget, false);
  assert.equal(takeRememberedRect(action.cardId), undefined);
});

test('choice at zero speed commits without waiting for an animation', async (t) => {
  const { turns, action, card, animationOptions } = await deckConfirmation(t, 0);
  const confirmation = turns.playHuman(action, card);
  assert.equal(turns.match.pending.kind, 'deck-placement');
  assert.deepEqual(animationOptions, []);
  await confirmation;
  turns.reset();
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

for (const interruption of ['cancelled', 'failed-to-start']) {
  test(`a ${interruption} choice animation unlocks input and commits the chosen card`, async (t) => {
    const warning = t.mock.method(console, 'warn', () => {});
    const { turns, action, card, end } = await deckConfirmation(t, 200);
    const error = new DOMException('Cancelled', 'AbortError');
    if (interruption === 'failed-to-start') card.animate = () => { throw error; };
    const confirmation = turns.playHuman(action, card);
    if (interruption === 'cancelled') {
      assert.equal(turns.confirmingTarget, true);
      end.reject(error);
    }
    await confirmation;
    assert.equal(warning.mock.callCount(), interruption === 'failed-to-start' ? 1 : 0);
    assert.equal(turns.confirmingTarget, false);
    assert.equal(turns.match.pending.kind, 'deck-placement');
    const placement = turns.match;
    await turns.playHuman({ type: 'place', row: 'surface', position: 0 });
    assert.notEqual(turns.match, placement);
    assert.ok(turns.match.players.human.board.surface.some(({ id }) => id === action.cardId));
    turns.reset();
  });
}

for (const playedCard of [false, true]) {
  test(`a rejected worker action gives the turn back via ${playedCard ? 'end-turn' : 'pass'}`, { timeout: 1500 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const warning = t.mock.method(console, 'warn', () => {});
    const previousWorker = globalThis.Worker;
    globalThis.Worker = class {
      addEventListener(type, listener) {
        if (type !== 'message') return;
        this.respond = listener;
        queueMicrotask(() => listener({ data: { ready: true } }));
      }

      postMessage() { this.respond({ data: { action: { type: 'target', cardId: 'missing' } } }); }
      terminate() {}
    };
    t.after(() => { globalThis.Worker = previousWorker; });

    const resumed = Promise.withResolvers();
    const turns = controller({ onMatchChanged: (_, match) => {
      if (match.turn === 'human') resumed.resolve(match);
    } });
    t.after(() => turns.reset());

    const ready = readyMatch();
    ready.playedCard = true;
    const botTurn = applyAction(ready, 'human', { type: 'end-turn' });
    assert.equal(botTurn.turn, 'bot');
    botTurn.playedCard = playedCard;
    if (!playedCard) botTurn.players.bot.hand = [];
    turns.reset(ready);
    await turns.updateMatch(botTurn);
    t.mock.timers.tick(1000);
    const match = await resumed.promise;
    assert.equal(match.players.bot.passed, !playedCard);
    assert.equal(turns.humanCanAct(), true);
    assert.equal(warning.mock.callCount(), 1);
  });
}
