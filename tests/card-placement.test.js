import { FACTIONS } from '../docs/game/cards.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCardPlacement, insertionPoint, placementEffectRows } from '../docs/card-placement.js';

const rowBounds = { left: 20, width: 200 };
const cardBounds = [{ left: 80, right: 105 }, { left: 109, right: 134 }];

test('the empty row shows a centered insertion target', () => {
  assert.deepEqual(insertionPoint(rowBounds, [], 38), { position: 0, offset: 100 });
});

test('a populated row offers positions at both edges and between neighboring cards', () => {
  assert.deepEqual(insertionPoint(rowBounds, cardBounds, 50), { position: 0, offset: 58 });
  assert.deepEqual(insertionPoint(rowBounds, cardBounds, 106), { position: 1, offset: 87 });
  assert.deepEqual(insertionPoint(rowBounds, cardBounds, 190), { position: 2, offset: 116 });
});

function placementFixture(pointerType, { isEffect = false, full = false, enemy = false, side = 'human', effectRows } = {}) {
  const played = [];
  const listeners = new Map();
  const ghost = {
    classList: { add() {} }, setAttribute() {}, style: {}, remove() { this.removed = true; },
  };
  const marker = { ...ghost, classList: { toggle() {} } };
  let captured = null;
  const card = {
    dataset: { cardId: 'orbit-card', type: isEffect ? 'effect' : 'unit', ...(enemy && { enemySide: 'true' }), effectRows },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ width: 32 }),
    cloneNode: () => ghost,
    setPointerCapture: (id) => { captured = id; },
    hasPointerCapture: (id) => captured === id,
    releasePointerCapture: () => { captured = null; },
    contains: (hit) => hit === card,
    closest: () => card,
  };
  const slots = cardBounds.map((bounds) => ({ getBoundingClientRect: () => bounds }));
  const classes = new Set();
  const row = {
    dataset: { playRow: 'orbit', full: String(full), side },
    classList: {
      add: (value) => classes.add(value),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      toggle: (value, on) => on ? classes.add(value) : classes.delete(value),
    },
    contains: (hit) => hit === row,
    getBoundingClientRect: () => rowBounds,
    querySelector: () => slots[0],
    querySelectorAll: () => slots,
    append() {},
  };
  const screen = {
    classList: { add() {}, remove() {} },
    ownerDocument: {
      defaultView: { requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
      elementFromPoint: (_x, y) => y === 40 ? row : y === 90 ? card : null,
      createElement: () => marker,
      body: { append() {} },
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    querySelectorAll: () => [row],
  };
  bindCardPlacement(screen, (id, row, position) => played.push({ id, row, position }));

  function send(type, x, y, overrides = {}) {
    listeners.get(type)({
      target: card, pointerType, pointerId: 1, isPrimary: true, button: 0,
      clientX: x, clientY: y, ...overrides,
    });
  }

  return { send, marker, played, classes };
}

for (const pointer of ['mouse', 'touch']) {
  test(`${pointer} drag shows the middle target and plays into that position on release`, () => {
    const { send, marker, played } = placementFixture(pointer);
    send('pointerdown', 105, 90);
    send('pointermove', 106, 40);
    assert.equal(marker.hidden, false);
    assert.equal(marker.style.left, '87px');
    assert.deepEqual(played, []);
    send('pointerup', 106, 40);
    assert.deepEqual(played, [{ id: 'orbit-card', row: 'orbit', position: 1 }]);
    assert.equal(marker.removed, true);
  });
}

test('cancelled drags and releases outside the correct row do not play the card', () => {
  const { send, marker, played } = placementFixture('touch');
  send('pointerdown', 105, 90);
  send('pointermove', 106, 40);
  send('pointercancel', 106, 40);
  send('pointerup', 106, 40);
  send('pointerdown', 105, 90);
  send('pointermove', 106, 50);
  assert.equal(marker.hidden, true);
  send('pointerup', 107, 50);
  assert.deepEqual(played, []);
});

test('a tap does not place a card before the row is chosen', () => {
  const { send, played } = placementFixture('touch');
  send('pointerdown', 105, 90);
  send('pointerup', 105, 90);
  assert.deepEqual(played, []);
});

test('full rows block placement but accept a dragged Effect', () => {
  const blocked = placementFixture('touch', { full: true });
  blocked.send('pointerdown', 105, 90);
  blocked.send('pointermove', 106, 40);
  blocked.send('pointerup', 106, 40);
  assert.deepEqual(blocked.played, []);

  const cast = placementFixture('touch', { isEffect: true, full: true });
  cast.send('pointerdown', 105, 90);
  cast.send('pointermove', 106, 40);
  cast.send('pointerup', 106, 40);
  assert.deepEqual(cast.played, [{ id: 'orbit-card', row: 'orbit', position: 1 }]);
  assert.equal(cast.marker.hidden, true);
});

test('units played to the enemy side use its drop targets only', () => {
  for (const side of ['human', 'bot']) {
    const { send, played } = placementFixture('mouse', { enemy: true, side });
    send('pointerdown', 105, 90);
    send('pointermove', 106, 40);
    send('pointerup', 106, 40);
    assert.equal(played.length, Number(side === 'bot'));
  }
});


test('placement hints reflect the rows actually used by deploy, orders, and ongoing abilities', () => {
  const card = (id) => FACTIONS.protectorate.pool.find((card) => card.id === id);
  for (const id of ['aurelian', 'tiberius', 'aggressor']) assert.deepEqual(placementEffectRows(card(id)), ['orbit']);
  for (const id of ['fleet-gunner', 'scout-frigate']) assert.deepEqual(placementEffectRows(card(id)), ['surface']);
  assert.deepEqual(new Set(placementEffectRows(card('spear-battery'))), new Set(['surface', 'orbit']));
  assert.deepEqual(placementEffectRows(card('spotter')), []);
  assert.deepEqual(placementEffectRows(card('orbital-salvo')), []);
});

test('the effect row lights up before reaching it and clears when the drag is cancelled', () => {
  const { send, classes, played } = placementFixture('touch', { effectRows: 'orbit' });
  send('pointerdown', 105, 90);
  send('pointermove', 106, 65);
  assert.ok(classes.has('is-drag-effect-row'));
  send('pointercancel', 106, 65);
  assert.ok(!classes.has('is-drag-effect-row'));
  assert.deepEqual(played, []);
});

test('a card can still be dropped in a row without its ability', () => {
  const { send, classes, played } = placementFixture('mouse', { effectRows: 'surface' });
  send('pointerdown', 105, 90);
  send('pointermove', 106, 40);
  assert.ok(!classes.has('is-drag-effect-row'));
  send('pointerup', 106, 40);
  assert.equal(played[0].row, 'orbit');
});
