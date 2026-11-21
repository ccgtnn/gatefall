import assert from 'node:assert/strict';
import test from 'node:test';
import { animateHandTurn, presentJournalEvent } from '../docs/card-motion.js';

function scenario() {
  const trace = [];
  const overlays = [];
  let finishReveal;
  const revealed = new Promise((resolve) => { finishReveal = resolve; });
  const field = {
    isConnected: true,
    dataset: { faction: 'growth' },
    getBoundingClientRect: () => ({ right: 648, top: 50, height: 200, left: 80, width: 568 }),
  };
  const document = {
    defaultView: { getComputedStyle: () => ({ visibility: 'visible' }), innerHeight: 740 },
    body: { append: (node) => overlays.push(node) },
    createElement: () => ({
      dataset: {},
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
          finished: this.className.endsWith('motion-opponent-reveal') ? revealed : Promise.resolve(),
          cancel() {},
        };
      },
    }),
  };
  const screen = {
    ownerDocument: document,
    querySelectorAll: () => [],
    querySelector: (selector) => selector.startsWith('.side') || selector === '.field-center' ? field : null,
  };
  const play = {
    type: 'play', side: 'bot', cardId: 'gates', name: 'Врата миров',
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
  assert.equal(overlays[0].children[1].textContent, 'Врата миров');
  const { keyframes, options } = overlays[0].motion;
  assert.equal(options.duration, 1344);
  assert.deepEqual(keyframes.slice(1, 3).map(({ opacity, offset }) => [opacity, offset]), [[1, 1 / 6], [1, 5 / 6]]);
  finishReveal();
  await present;
  assert.deepEqual(trace, [reveal + ':start', reveal + ':end', 'commit', 'render', flight + ':start', flight + ':end']);
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

test('a row effect updates the field immediately on application and expiry', async () => {
  const trace = [];
  for (const effect of [{ type: 'rot', remaining: 3 }, null]) {
    const event = { type: 'row-effect', side: 'bot', row: 'orbit', effect };
    await presentJournalEvent({}, event, () => event, (state) => trace.push(state.effect), 320);
  }
  assert.deepEqual(trace, [{ type: 'rot', remaining: 3 }, null]);
});
