import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS } from '../docs/game/decks.js';
import { createDeckStorage, parseDeckJson, serializeDeckJson } from '../docs/ui/deck-storage.js';

const preset = PRESETS[0];
const { name, factionId, leaderId, cardIds } = preset;
const deck = { name, factionId, leaderId, cardIds };
const document = { format: 'gatefall-deck', version: 1, ...deck };

test('JSON preserves the deck fields and card order but leaves out storage IDs', () => {
  assert.deepEqual(JSON.parse(serializeDeckJson(preset)), document);
  assert.deepEqual(JSON.parse(serializeDeckJson([preset, { ...preset, id: 'other', name: 'Своя' }])),
    [document, { ...document, name: 'Своя' }]);
  assert.deepEqual(JSON.parse(serializeDeckJson([])), []);
  for (const payload of [deck, document, { ...document, other: 'ignored', id: preset.id }]) {
    assert.deepEqual(parseDeckJson(JSON.stringify(payload)), { deck, missing: [] });
  }
});

test('import reports malformed data, unsupported versions, and unknown faction or leader', () => {
  assert.match(parseDeckJson('{').errors.join(' '), /Некорректный JSON/);
  assert.match(parseDeckJson('[]').errors.join(' '), /объект одной колоды/);
  const invalid = (changes) => parseDeckJson(JSON.stringify({ ...document, ...changes })).errors.join(' ');
  assert.match(invalid({ version: 2 }), /версия/);
  assert.match(invalid({ format: 'other' }), /Формат/);
  assert.match(invalid({ factionId: '__proto__' }), /Неизвестная фракция/);
  assert.match(invalid({ leaderId: PRESETS[1].leaderId }), /Лидер неизвестен/);
  assert.match(invalid({ cardIds: [null] }), /массивом идентификаторов/);
});

test('import explains card IDs and deck-rule violations', () => {
  const invalid = (cardIds) => parseDeckJson(JSON.stringify({ ...document, cardIds })).errors.join(' ');
  const costly = [...cardIds, ...Array(8).fill(cardIds[0]), 'vine', 'unknown-id'];
  const errors = invalid(costly);
  assert.match(errors, /Неизвестные карты: "unknown-id"/);
  assert.match(errors, /Карты другой фракции: Ползучая лоза/);
  assert.match(errors, /Превышен лимит копий/);
  assert.match(errors, /Лимит провизии превышен/);
  assert.match(invalid([]), /минимум 25 карт/);
  assert.match(invalid([]), /минимум 13 отрядов/);
});

test('an imported deck keeps unowned cards and receives a new ID every time', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createDeckStorage(storage);
  const json = JSON.stringify({ ...document, id: preset.id });
  const owned = Object.fromEntries(cardIds.map((id) => [id, 2]));
  owned[cardIds[0]] = 0;
  const first = store.importJson(json, owned);
  const second = store.importJson(json, owned);
  assert.ok(first.saved && second.saved);
  assert.notEqual(first.deck.id, second.deck.id);
  assert.notEqual(first.deck.id, preset.id);
  assert.deepEqual(first.deck.cardIds, cardIds);
  assert.deepEqual(first.missing.map(({ id, count }) => [id, count]), [[cardIds[0], cardIds.filter((id) => id === cardIds[0]).length]]);
  assert.ok(first.missing[0].name);
  assert.deepEqual(createDeckStorage(storage).list(), [first.deck, second.deck]);
  assert.ok(store.importJson('invalid', owned).errors);
  assert.equal(store.list().length, 2);
});
