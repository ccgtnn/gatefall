import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clearRememberedRects, ghostCard, pileAnchor, rememberRect, takeRememberedRect } from '../../docs/ui/card-motion-core.js';
import { motionDuration } from '../../docs/ui/motion-tokens.js';
import { animateHandTurn, presentJournalEvent } from '../../docs/ui/card-motion.js';

import { playJournal } from '../../docs/ui/turn-playback.js';

function scenario(turnFinished, entranceFinished) {
  const trace = [];
  const overlays = [];
  let finishReveal;
  const revealed = new Promise((resolve) => { finishReveal = resolve; });
  const field = {
    animate() {},
    isConnected: true,
    dataset: { faction: 'growth' },
    getBoundingClientRect: () => ({ right: 648, top: 50, height: 200, left: 80, width: 568 }),
  };
  const document = {
    defaultView: { getComputedStyle: () => ({ visibility: 'visible' }), innerHeight: 740 },
    body: { append: (node) => overlays.push(node) },
    createElement: () => ({
      ownerDocument: document,
      className: '',
      dataset: {},
      offsetWidth: 100,
      style: {},
      children: [],
      classList: { add() {} },
      setAttribute() {},
      append(node) { this.children.push(node); },
      isConnected: true,
      remove() {
        trace.push(this.className + ':end');
        this.isConnected = false;
      },
      animate(keyframes, options) {
        this.motion = { keyframes, options };
        trace.push(this.className + ':start');
        return {
          finished: this.className.endsWith('motion-opponent-reveal') ? revealed
            : (this.className.includes('motion-overlay turn-banner') ? turnFinished
              : this.className === 'turn-banner-label' ? entranceFinished : undefined) ?? Promise.resolve(),
          cancel() {},
        };
      },
    }),
  };
  const screen = {
    ownerDocument: document,
    querySelectorAll: () => [],
    querySelector: (selector) => selector.startsWith('.side') || selector.startsWith('.field-center') ? field : null,
  };
  const play = {
    type: 'play', side: 'bot', cardId: 'gates', name: 'Врата Миров',
    card: { definition: { art: 'world-gates.webp', rarity: 'gold', faction: 'neutral' } },
  };
  return { trace, overlays, field, finishReveal, screen, play };
}

const reveal = 'motion-overlay motion-opponent-reveal';
const flight = 'motion-overlay motion-flight';

test('an opponent effect is readable before it resolves, then the existing flight plays', async () => {
  const { trace, overlays, finishReveal, screen, play } = scenario();
  const present = presentJournalEvent(screen, play, () => trace.push('commit'), () => trace.push('render'), 320);
  assert.deepEqual(trace, [reveal + ':start']);
  assert.equal(overlays[0].style.left, '640px');
  assert.equal(overlays[0].children[0].src, './art/world-gates.webp');
  assert.equal(overlays[0].children[1].textContent, 'Врата Миров');
  const { keyframes, options } = overlays[0].motion;
  assert.equal(options.duration, 1344);
  assert.deepEqual(keyframes.slice(1, 3).map(({ opacity, offset }) => [opacity, offset]), [[1, 1 / 6], [1, 5 / 6]]);
  finishReveal();
  await present;
  assert.deepEqual(trace, [reveal + ':start', reveal + ':end', 'commit', 'render', flight + ':start', flight + ':end']);
  assert.match(overlays[1].motion.keyframes[0].transform, /translate3d\(226px, 0px, 0\)/);
});

test('a local play or reduced motion skips the opponent reveal', async () => {
  const { trace, screen, play } = scenario();
  await presentJournalEvent(screen, { ...play, side: 'human' }, () => trace.push('commit'), () => {}, 320);
  assert.deepEqual(trace, ['commit', flight + ':start', flight + ':end']);
  trace.length = 0;
  await presentJournalEvent(screen, play, () => trace.push('commit'), () => {}, 0);
  assert.deepEqual(trace, ['commit']);
});

test('leaving during a reveal prevents its old flight after the field is detached', async () => {
  const { trace, field, finishReveal, screen, play } = scenario();
  const present = presentJournalEvent(screen, play, () => trace.push('commit'), () => {}, 320);
  field.isConnected = false;
  finishReveal();
  await present;
  assert.deepEqual(trace, [reveal + ':start', reveal + ':end']);
});

test('the turn cue sweeps the hand in order and respects reduced motion', () => {
  const pulses = [];
  const cards = Array.from({ length: 10 }, (_, index) => ({
    animate: (_, { delay, duration }) => pulses.push({ index, delay, duration }),
  }));
  const screen = { querySelectorAll: () => cards };
  animateHandTurn(screen, 0);
  assert.deepEqual(pulses, []);
  animateHandTurn(screen, 320);
  assert.deepEqual(pulses, cards.map((_, index) => ({ index, delay: 53 * index, duration: 106 })));
});

const turnState = () => ({
  log: [], turn: 'bot',
  players: {
    human: { hand: [], board: { orbit: [], surface: [] } },
    bot: { hand: [], board: { orbit: [], surface: [] }, passed: true },
  },
});
const humanTurn = { type: 'turn-start', side: 'human', empty: false };

test('a turn banner waits for the entrance and stays until its animation finishes', async () => {
  const end = Promise.withResolvers();
  const entrance = Promise.withResolvers();
  const { screen, overlays } = scenario(end.promise, entrance.promise);
  const state = turnState();
  state.players.bot.passed = false;
  let shown;
  const presentation = presentJournalEvent(screen, humanTurn, () => state, () => {}, 320)
    .then((result) => { shown = result; });
  await new Promise(setImmediate);
  assert.equal(shown, undefined);
  entrance.resolve();
  await presentation;
  assert.equal(shown, true);
  const [banner] = overlays;
  assert.equal(banner.dataset.side, 'human');
  assert.equal(banner.children[1].textContent, 'ТВОЙ ХОД');
  assert.equal(banner.motion.options.duration, 1088);
  assert.equal(banner.children[1].motion.options.duration, 1088 * .3);
  assert.equal(banner.isConnected, true);
  end.resolve();
  await new Promise(setImmediate);
  assert.equal(banner.isConnected, false);
});

test('speed off still renders a turn change and creates no banner or pass overlay', async () => {
  const { screen, overlays } = scenario();
  let renders = 0;
  for (const event of [humanTurn, { type: 'pass', side: 'human', reason: 'manual' }]) {
    await presentJournalEvent(screen, event, turnState, () => { renders++; }, 0);
  }
  assert.equal(renders, 2);
  assert.deepEqual(overlays, []);
});

test('an empty turn and the following active turn share one banner', async () => {
  const { screen, overlays } = scenario();
  const skipped = { type: 'turn-start', side: 'bot', empty: true };
  const rendered = [];
  await playJournal(turnState(), [skipped, humanTurn], (event, commit, _, next, previous) =>
    presentJournalEvent(screen, event, commit, (state) => rendered.push(state.turn), 320, { next, previous }));
  assert.deepEqual(rendered, ['human']);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].children[1].textContent, 'ПРОТИВНИК СПАСОВАЛ · СНОВА ТВОЙ ХОД');
  assert.match(overlays[0].className, /is-compact/);
});

test('an isolated empty turn pulses the pass indicator on its own half', async () => {
  const { screen, overlays } = scenario();
  const indicator = screen.ownerDocument.createElement('span');
  const select = screen.querySelector;
  screen.querySelector = (selector) => selector === '[data-passed-side="bot"]' ? indicator : select(selector);
  await presentJournalEvent(screen, { type: 'turn-start', side: 'bot', empty: true },
    turnState, () => {}, 320);
  assert.equal(overlays[0].dataset.side, 'bot');
  assert.equal(overlays[0].children[1].textContent, 'ход пропущен');
  assert.equal(indicator.motion.keyframes[1].transform, 'translateY(-50%) scale(1.2)');
});

test('a phone banner plays for at most 700ms', async () => {
  const { screen, overlays } = scenario();
  screen.ownerDocument.defaultView.matchMedia = () => ({ matches: true });
  const state = turnState();
  state.players.bot.passed = false;
  await presentJournalEvent(screen, humanTurn, () => state, () => {}, 320);
  assert.equal(overlays[0].motion.options.duration, 700);
});

test('a row effect updates the field immediately on application and expiry', async () => {
  const trace = [];
  for (const effect of [{ type: 'rot', remaining: 3 }, null]) {
    const event = { type: 'row-effect', side: 'bot', row: 'orbit', effect };
    await presentJournalEvent({}, event, () => event, (state) => trace.push(state.effect), 320);
  }
  assert.deepEqual(trace, [{ type: 'rot', remaining: 3 }, null]);
});

test('turret playback waits for its alternate art before the shot, with no wait at zero duration', async () => {
  const trace = [];
  let finishDecode;
  const decoded = new Promise((resolve) => { finishDecode = resolve; });
  const image = { decode: () => { trace.push('decode'); return decoded; } };
  const turret = {
    dataset: { boardCard: 'turret' },
    getBoundingClientRect: () => ({}),
    querySelector: () => image,
  };
  const screen = { querySelectorAll: () => [turret] };
  const artSwap = { type: 'art-state', cardId: 'turret', artState: 'failing' };
  const commit = () => { trace.push('commit'); return artSwap; };
  const render = () => trace.push('render');
  const pending = presentJournalEvent(screen, artSwap, commit, render, 320)
    .then(() => trace.push('next event'));
  assert.deepEqual(trace, ['commit', 'render', 'decode']);
  finishDecode();
  await pending;
  assert.deepEqual(trace, ['commit', 'render', 'decode', 'next event']);
  trace.length = 0;
  await presentJournalEvent(screen, artSwap, commit, render, 0);
  assert.deepEqual(trace, ['commit']);
});


test('a hidden deck uses its side’s hand stack, then the count and the half of the field', () => {
  const node = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
  const fallback = new Map([
    ['.field-hand-stack[data-hand-side="human"]', node(100, 120, 40, 30)],
    ['.field-corner .field-hand-count', node(160, 180, 30, 20)],
    ['.side[data-side="human"]', node(20, 80, 240, 90)],
  ]);
  let piles = [node(0, 0, 0, 0)];
  const screen = { querySelectorAll: () => piles, querySelector: (key) => fallback.get(key) };
  assert.deepEqual(pileAnchor(screen, 'human', 'deck'), { x: 120, y: 135 });
  fallback.delete('.field-hand-stack[data-hand-side="human"]');
  assert.deepEqual(pileAnchor(screen, 'human', 'deck'), { x: 175, y: 190 });
  fallback.delete('.field-corner .field-hand-count');
  assert.deepEqual(pileAnchor(screen, 'human', 'deck'), { x: 140, y: 125 });
  piles.push(node(300, 230, 30, 30));
  assert.deepEqual(pileAnchor(screen, 'human', 'deck'), { x: 315, y: 245 });
});

test('remembered card positions are independent, one-shot and clearable when the match changes', () => {
  const first = { left: 15, top: 30 };
  const second = { left: 35, top: 60 };
  rememberRect('first', first);
  rememberRect('second', second);
  assert.equal(takeRememberedRect('first'), first);
  assert.equal(takeRememberedRect('first'), undefined);
  assert.equal(takeRememberedRect('second'), second);
  rememberRect('second', second);
  clearRememberedRects();
  assert.equal(takeRememberedRect('second'), undefined);
});

test('departure clones replace premium video with its poster before insertion', () => {
  let replaced;
  const video = {
    className: 'card-art-crop card-art-video', poster: './art/poster.webp',
    style: { cssText: 'object-position: 40% 40%;' },
    replaceWith(image) { replaced = image; },
  };
  const clone = { querySelectorAll: () => [video], style: {}, classList: { add() {} }, setAttribute() {} };
  const screen = { ownerDocument: {
    createElement: (tag) => ({ tag, style: {}, classList: { remove() {} } }),
    body: { append: (node) => { assert.equal(node, clone); assert.equal(replaced?.src, video.poster); } },
  } };
  const entry = { node: { cloneNode: () => clone }, rect: { left: 1, top: 2, width: 3, height: 4 } };
  assert.equal(ghostCard(screen, entry), clone);
  assert.equal(replaced.tag, 'img');
  assert.equal(replaced.style.cssText, video.style.cssText);
});

test('card motion durations use named tokens and the sandbox scale has no global state', () => {
  for (const file of ['card-motion.js', 'card-motion-core.js', 'card-motion-card-effects.js', 'card-motion-hit-effects.js']) {
    const source = readFileSync(new URL('../../docs/ui/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bduration\s*(?:\*=|\*|\/)\s*(?:\d|\.\d)/, file);
  }
  assert.equal(motionDuration('normal', true, 4), 1280);
  assert.equal(motionDuration('normal', true), 320);
  assert.equal(motionDuration('fast', false), 200);
  assert.equal(motionDuration('system', true), 0);
  assert.equal(motionDuration('off', false, 4), 0);
});

function handScenario(t, count, side = 'human') {
  const { trace, overlays, screen } = scenario();
  const priorDocument = globalThis.document;
  globalThis.document = screen.ownerDocument;
  t.after(() => { globalThis.document = priorDocument; });
  screen.isConnected = true;
  const cards = Array.from({ length: count }, (_, index) => ({ id: 'drawn-' + index }));
  const rect = { left: 20, top: 40, width: 80, height: 120 };
  const counter = screen.ownerDocument.createElement();
  counter.className = 'bot-hand-count';
  counter.getBoundingClientRect = () => rect;
  let rendered = false;
  const slots = cards.map(({ id }) => {
    const node = screen.ownerDocument.createElement();
    node.className = 'hand-card';
    node.dataset.cardId = id;
    node.getBoundingClientRect = () => rect;
    node.cloneNode = () => {
      const face = screen.ownerDocument.createElement();
      face.className = 'cloned-face';
      face.querySelectorAll = () => [];
      trace.push('clone face');
      return face;
    };
    return node;
  });
  screen.querySelectorAll = (selector) => {
    if (selector.startsWith('[data-pile-side')) return [counter];
    if (selector.startsWith('.bot-hand-count')) return [counter];
    if (selector === '.hand [data-card-id]' && rendered) return slots;
    return [];
  };
  const commit = () => {
    trace.push('commit');
    return { players: { [side]: { factionId: 'growth', deck: [] } } };
  };
  const render = () => { rendered = true; trace.push('render'); };
  const event = { type: 'draw', side, count, cards };
  return { trace, overlays, screen, slots, event, commit, render };
}

test('draw commits and renders before starting the flight and revealing the real hand card', async (t) => {
  const { trace, overlays, screen, slots, event, commit, render } = handScenario(t, 1);
  await presentJournalEvent(screen, event, commit, render, 320);
  assert.deepEqual(trace.slice(0, 4), ['commit', 'render', 'clone face', 'motion-overlay motion-draw:start']);
  assert.equal(overlays[0].children[0].children.length, 2);
  assert.equal(overlays[0].style.width, '80px');
  assert.equal(overlays[0].motion.options.duration, 544);
  assert.deepEqual(slots[0].motion.keyframes.slice(0, 2).map(({ opacity, offset }) => [opacity, offset]),
    [[0, undefined], [0, .82]]);
});

test('opponent draw flies only card backs and announces the count after they land', async (t) => {
  const { trace, overlays, screen, event, commit, render } = handScenario(t, 3, 'bot');
  await presentJournalEvent(screen, event, commit, render, 320);
  assert.deepEqual(trace.slice(0, 2), ['commit', 'render']);
  assert.equal(trace.includes('clone face'), false);
  const flights = overlays.slice(0, 3);
  assert.ok(flights.every((node) => node.children[0].children.length === 1 &&
    node.children[0].children[0].className === 'motion-draw-back'));
  assert.equal(overlays[3].textContent, '+3');
  assert.ok(trace.lastIndexOf('motion-overlay motion-draw:end') < trace.indexOf('bot-hand-count:start'));
});

test('round draw, disabled motion and disconnected screens only commit', async (t) => {
  const { trace, overlays, screen, event, commit, render } = handScenario(t, 1);
  await presentJournalEvent(screen, event, commit, render, 0);
  await presentJournalEvent(screen, { ...event, reason: 'round' }, commit, render, 320);
  screen.isConnected = false;
  await presentJournalEvent(screen, event, commit, render, 320);
  assert.deepEqual(trace, ['commit', 'commit', 'commit']);
  assert.deepEqual(overlays, []);
});

test('draw staggers a large batch within 1.1 seconds for either side', async (t) => {
  for (const side of ['human', 'bot']) {
    const { overlays, screen, event, commit, render } = handScenario(t, 10, side);
    await presentJournalEvent(screen, event, commit, render, 320);
    const flights = overlays.filter(({ className }) => className === 'motion-overlay motion-draw');
    const feedback = overlays.find(({ className }) => className.includes('motion-number'));
    assert.equal(flights.length, 10);
    const end = Math.max(...flights.map(({ motion: { options } }) => options.duration + options.delay));
    assert.ok(end + (feedback?.motion.options.duration ?? 0) <= 1100);
    assert.ok(flights[1].motion.options.delay < 96);
  }
});

test('returning to the bottom uses the saved hand position and slides the remaining card', async (t) => {
  const { trace, overlays, screen, slots, commit, render } = handScenario(t, 2);
  const [leaving, neighbor] = slots;
  const bounds = neighbor.getBoundingClientRect();
  const query = screen.querySelectorAll;
  let updated = false;
  screen.querySelectorAll = (selector) => selector === '.hand [data-card-id]'
    ? (updated ? [neighbor] : slots)
    : query(selector);
  neighbor.getBoundingClientRect = () => ({ ...bounds, left: updated ? 40 : 80 });
  rememberRect(leaving.dataset.cardId, { ...bounds, left: 125 });
  await presentJournalEvent(screen, { type: 'hand-bottom', side: 'human', cardId: leaving.dataset.cardId }, commit, () => {
    updated = true;
    render();
  }, 320);
  assert.deepEqual(trace.slice(0, 2), ['commit', 'render']);
  assert.equal(overlays[0].style.left, '125px');
  assert.equal(overlays[0].motion.options.duration, 320 * 1.4);
  assert.equal(overlays[0].children[0].motion.keyframes.at(-1).transform, 'rotateY(180deg)');
  assert.match(neighbor.motion.keyframes[0].transform, /translate3d\(40px/);
  assert.equal(takeRememberedRect(leaving.dataset.cardId), undefined);
});
