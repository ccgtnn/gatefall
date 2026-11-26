import assert from 'node:assert/strict';
import test from 'node:test';
import { createBusyGuard } from '../../docs/ui/dom.js';

test('busy UI actions exclude concurrent calls and become available after a rejection', async (context) => {
  context.mock.method(console, 'error', () => {});
  const guard = createBusyGuard();
  const { promise, reject } = Promise.withResolvers();
  const run = guard.run(() => promise);
  assert.equal(guard.active, true);
  assert.equal(await guard.run(() => assert.fail('second task started')), undefined);
  reject(new Error('cannot save'));
  assert.equal(await run, 'unavailable');
  assert.equal(guard.active, false);
  assert.equal(await guard.run(() => 'done'), 'done');
});
