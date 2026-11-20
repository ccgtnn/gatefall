import assert from 'node:assert/strict';
import test from 'node:test';
import { createFactionStats } from '../docs/ui/stats.js';

test('faction records persist wins and losses independently across reloads', () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const factions = ['protectorate', 'growth'];
  const stats = createFactionStats(factions, storage);
  stats.record('growth', 'win');
  stats.record('growth', 'draw');
  stats.record('protectorate', 'loss');
  const restored = createFactionStats(factions, storage);
  assert.deepEqual(restored.get('growth'), { win: 1, loss: 0 });
  assert.deepEqual(restored.get('protectorate'), { win: 0, loss: 1 });
});

test('the game keeps session stats even when the browser denies storage', () => {
  const unavailable = () => { throw new Error('unavailable'); };
  const stats = createFactionStats(['growth'], { getItem: unavailable, setItem: unavailable });
  stats.record('growth', 'loss');
  assert.deepEqual(stats.get('growth'), { win: 0, loss: 1 });
});
