import assert from 'node:assert/strict';
import test from 'node:test';
import { effectOperations } from '../../docs/game/effect-operations.js';
import { runEffect } from '../../docs/game/effects.js';
import { createMatch } from '../../docs/game/match.js';
import { visitDefinitions } from '../helpers/effect-definitions.js';

test('all card, token, leader and scenario actions have a registered handler', () => {
  const actions = new Set();
  visitDefinitions((value) => {
    if (typeof value.action === 'string') actions.add(value.action);
  });

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
