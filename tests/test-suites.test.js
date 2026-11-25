import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('every top-level test file belongs to a thematic npm test suite', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const assigned = new Set(['battle', 'bot', 'economy', 'ui'].flatMap((suite) => {
    const command = scripts['test:' + suite];
    assert.ok(command, 'Missing npm script test:' + suite);
    return [...command.matchAll(/(?:^|\s)tests\/([\w-]+\.test\.js)(?=\s|$)/g)].map(([, name]) => name);
  }));
  const files = (await readdir(new URL('.', import.meta.url))).filter((name) => name.endsWith('.test.js'));
  assert.deepEqual(files.filter((file) => !assigned.has(file)).sort(), [], 'Unassigned test files');
  assert.deepEqual([...assigned].filter((file) => !files.includes(file)).sort(), [], 'Missing test files');
});
