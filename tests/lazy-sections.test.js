import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLazySection } from '../docs/ui/resources.js';

function section(t) {
  const statuses = [];
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, remove() { this.removed = true; } }),
  };
  t.after(() => { globalThis.document = original; });
  return { dialog: { open: false }, content: { append: (status) => statuses.push(status) }, statuses };
}

test('a section only mounts on demand and refreshes the same content on reopen', async (t) => {
  const { dialog, content, statuses } = section(t);
  const module = Promise.withResolvers();
  let loads = 0;
  let mounts = 0;
  let refreshes = 0;
  const prepare = prepareLazySection(dialog, content, () => {
    loads += 1;
    return module.promise;
  });
  assert.equal(loads, 0);
  dialog.open = true;
  const loading = prepare();
  assert.equal(prepare(), loading);
  assert.equal(statuses.length, 1);

  dialog.open = false;
  module.resolve(() => {
    mounts += 1;
    return () => { refreshes += 1; };
  });
  await loading;
  assert.equal(mounts, 0);
  assert.equal(refreshes, 0);

  dialog.open = true;
  prepare();
  prepare();
  assert.deepEqual({ loads, mounts, refreshes }, { loads: 1, mounts: 1, refreshes: 2 });
  assert.equal(statuses[0].removed, true);
});

test('a failed module load leaves feedback inside the closable section', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { dialog, content, statuses } = section(t);
  const prepare = prepareLazySection(dialog, content, () => Promise.reject(new Error('network unavailable')));
  dialog.open = true;
  await prepare();
  assert.match(statuses[0].textContent, /Не удалось загрузить раздел/);
  assert.equal(dialog.open, true);
});
