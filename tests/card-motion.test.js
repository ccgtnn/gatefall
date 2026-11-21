import assert from 'node:assert/strict';
import test from 'node:test';
import { presentJournalEvent } from '../docs/card-motion.js';

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
      animate() {
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
