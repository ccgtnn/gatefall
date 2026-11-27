import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_DEFINITIONS } from '../../docs/game/cards/card-registry.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { EFFECT_SCHEMA } from '../../docs/game/shared/effect-schema.js';
import { visitDefinitions } from '../helpers/effect-definitions.js';

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
  const cards = new Set(CARD_DEFINITIONS);
  visitDefinitions((value) => {
    if (typeof value.id === 'string' && typeof value.name === 'string' && (value.token || value.stratagem)) {
      cards.add(value);
    }
  });
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
