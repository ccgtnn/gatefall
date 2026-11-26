import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_DEFINITIONS } from '../../docs/game/card-registry.js';
import { FACTIONS, FIRST_SIGNAL, LARVA, SHADOW } from '../../docs/game/cards.js';
import { HOUND, REINFORCED_HOUND } from '../../docs/game/captains.js';
import { CHOIR_CARDS } from '../../docs/game/choir.js';
import { DEVOURER_SPAWN } from '../../docs/game/growth.js';
import { EFFECT_SCHEMA } from '../../docs/game/effect-schema.js';

function checkKeys(value, kind, path) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkKeys(entry, kind, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const schema = EFFECT_SCHEMA[kind];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    const field = Object.hasOwn(schema, key) ? key : '*';
    assert.ok(Object.hasOwn(schema, field), `Unknown DSL key ${entryPath}`);
    if (schema[field]) checkKeys(entry, schema[field], entryPath);
  }
}

test('all cards, tokens, leaders and scenario chapters use known DSL keys', () => {
  const cards = new Set([
    ...CARD_DEFINITIONS, ...CHOIR_CARDS, FIRST_SIGNAL, LARVA, SHADOW, HOUND, REINFORCED_HOUND, DEVOURER_SPAWN,
  ]);
  for (const card of cards) checkKeys(card, 'card', `${card.name} (${card.id})`);
  for (const { leaders } of Object.values(FACTIONS)) {
    for (const leader of leaders) checkKeys(leader, 'leader', `${leader.name} (${leader.id})`);
  }
});

test('a misspelled target key reports its card and nested scenario path', () => {
  const card = { scenario: { chapters: [{ steps: [{ action: 'damage', target: { maxPower: 4 } }] }] } };
  assert.throws(() => checkKeys(card, 'card', 'Example Card'),
    /Unknown DSL key Example Card\.scenario\.chapters\[0\]\.steps\[0\]\.target\.maxPower/);
});
