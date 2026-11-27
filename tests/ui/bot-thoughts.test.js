import assert from 'node:assert/strict';
import test from 'node:test';
import { byClass, tree } from '../helpers/card-badges.js';
import { logView } from '../../docs/ui/menu.js';

test('the journal shows the largest signed position changes in Russian when thoughts are enabled', () => {
  const match = { log: [{ type: 'bot-thought', chosen: 'Розыгрыш', reason: 'Сравниваю позиции.', candidates: [
    { label: 'Розыгрыш', score: 18.3, samples: 4,
      changes: { coins: -1.6, armor: .14, leaderCharges: -.8, field: 4.2, outcome: 1e-12 } },
  ] }] };
  assert.equal(byClass(logView(match), 'bot-thought'), undefined);
  const candidates = byClass(logView(match, true), 'bot-thought-options');
  assert.equal(candidates.children.length, 1);
  assert.ok(tree(candidates).some(({ textContent }) => textContent === 'поле +4,2 · монеты −1,6 · заряды лидера −0,8'));
});
