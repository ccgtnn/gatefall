import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppTimers } from '../../docs/ui/app-timers.js';

test('page timers retry, avoid overlapping checkpoints, and resume on return', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 10000 });
  const listeners = new Set();
  const pendingRanks = Promise.withResolvers();
  const calls = { league: 0, ticks: 0, tavern: 0, ranks: 0 };
  const progress = {
    league: () => ({}),
    tavern: () => ({ resetAt: 11000 }),
    rankResetAt: () => 12000,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async checkpointLeague() { calls.league += 1; },
    async checkpointTavern() { return ++calls.tavern === 1 ? 'unavailable' : 'done'; },
    async checkpointRanks() { return ++calls.ranks === 2 ? pendingRanks.promise : 'done'; },
  };
  const timers = createAppTimers(progress, () => { calls.ticks += 1; });

  timers.start();
  timers.start();
  await Promise.resolve();
  assert.deepEqual(calls, { league: 1, ticks: 0, tavern: 1, ranks: 1 });
  assert.equal(listeners.size, 1);
  t.mock.timers.tick(14000);
  assert.deepEqual(calls, { league: 1, ticks: 14, tavern: 1, ranks: 2 });
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, { league: 1, ticks: 15, tavern: 2, ranks: 2 });

  timers.stop();
  timers.stop();
  assert.equal(listeners.size, 0);
  t.mock.timers.tick(2000);
  assert.deepEqual(calls, { league: 1, ticks: 15, tavern: 2, ranks: 2 });
  await Promise.resolve();
  timers.start();
  assert.deepEqual(calls, { league: 2, ticks: 15, tavern: 3, ranks: 2 });
  assert.equal(listeners.size, 1);
  pendingRanks.resolve('done');
  timers.stop();
});
