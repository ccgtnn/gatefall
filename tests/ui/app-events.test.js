import assert from 'node:assert/strict';
import test from 'node:test';
import { emit, on } from '../../docs/ui/app-events.js';

test('replacing a screen aborts its subscribers and only the new screen receives later events', () => {
  const seen = [];
  const oldScreen = new AbortController();
  on('collection-change', (detail) => seen.push(['old', detail]), { signal: oldScreen.signal });
  emit('collection-change', 1);
  oldScreen.abort();

  const newScreen = new AbortController();
  const unsubscribe = on('collection-change', (detail) => seen.push(['new', detail]), { signal: newScreen.signal });
  emit('collection-change', 2);
  unsubscribe();
  emit('collection-change', 3);
  assert.deepEqual(seen, [['old', 1], ['new', 2]]);
});
