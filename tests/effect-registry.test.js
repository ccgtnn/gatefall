import assert from 'node:assert/strict';
import test from 'node:test';
import * as cards from '../docs/game/cards.js';
import * as captains from '../docs/game/captains.js';
import * as choir from '../docs/game/choir.js';
import * as growth from '../docs/game/growth.js';
import * as neutrals from '../docs/game/neutral-cards.js';
import { effectOperations } from '../docs/game/effect-operations.js';
import { runEffect } from '../docs/game/effects.js';
import { createMatch } from '../docs/game/match.js';

test('all card, token, leader and scenario actions have a registered handler', () => {
  const visited = new WeakSet();
  const actions = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (typeof value.action === 'string') actions.add(value.action);
    for (const entry of Object.values(value)) visit(entry);
  }
  for (const definitions of [cards, captains, choir, growth, neutrals]) visit(definitions);

  assert.ok(actions.has('create-play') && actions.has('advance-growth'));
  const unhandled = [...actions].filter((action) =>
    !Object.hasOwn(effectOperations, action) || typeof effectOperations[action] !== 'function');
  assert.deepEqual(unhandled.sort(), []);
});

test('an unknown effect action throws even when there is no target', () => {
  const match = createMatch({ random: () => 0 });
  assert.throws(() => runEffect(match, {
    side: 'human', sourceDefinitionId: 'test-card', ability: { steps: [{ action: 'toString' }] },
  }, () => 0), /Unknown effect action "toString" at step 1 of "test-card"/);
});
