import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnRowLabel, tributeLabel } from '../../docs/ui/field-labels.js';

test('row and tribute prompts describe the token and quantity in the effect', () => {
  const card = { name: 'Учебный дрон' };
  const row = { key: 'row', job: { ability: { steps: [
    { action: 'spawn', rowRef: 'other', card: { name: 'Не эта карта' }, amount: 1 },
    { action: 'spawn', rowRef: 'row', card, amount: 3 },
  ] } } };
  assert.equal(spawnRowLabel(row, 'Орбита'), 'Породить «Учебный дрон» ×3 в ряду «Орбита»');
  const tribute = { tiers: { 3: 2 }, job: { ability: { steps: [{ action: 'choose-tribute', spawn: { card } }] } } };
  assert.equal(tributeLabel(tribute, '3'), '◉ 3 · Учебный дрон ×2');
  assert.equal(tributeLabel(tribute, '0'), 'Без взноса');
});
