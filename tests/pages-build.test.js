import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPages, versionModules } from '../tools/build-pages.mjs';

const files = new Map([
  ['index.html', '<script type="module" src="./app.js?v=legacy"></script>\n<script src="./demo.js"></script>'],
  ['app.js', "import './game/cards.js?v=catalog';\nimport './standalone.js';"],
  ['game/cards.js', "export { value } from './neutral.js';"],
  ['game/neutral.js', 'export const value = 1;'],
  ['standalone.js', 'export const stable = true;'],
  ['demo.js', 'export const demo = true;'],
]);

test('a catalog change updates every importing URL and preserves unrelated module URLs', () => {
  const before = versionModules(files);
  const after = versionModules(new Map(files).set('game/neutral.js', 'export const value = 2;'));
  assert.match(before.get('index.html'), /\.\/app\.js\?v=legacy&gf=[0-9a-f]{16}/);
  assert.match(before.get('game/cards.js'), /\.\/neutral\.js\?gf=[0-9a-f]{16}/);
  assert.notEqual(before.get('game/cards.js'), after.get('game/cards.js'));
  assert.notEqual(before.get('app.js').split('\n')[0], after.get('app.js').split('\n')[0]);
  assert.notEqual(before.get('index.html').split('\n')[0], after.get('index.html').split('\n')[0]);
  assert.equal(before.get('app.js').split('\n')[1], after.get('app.js').split('\n')[1]);
  assert.equal(before.get('index.html').split('\n')[1], after.get('index.html').split('\n')[1]);
});

test('cycles have stable versions regardless of file enumeration order', () => {
  const cycle = new Map([
    ['a.js', "import './b.js';"],
    ['b.js', "import './a.js';"],
  ]);
  const original = versionModules(cycle);
  assert.deepEqual(original, versionModules(new Map([...cycle].reverse())));
  const after = versionModules(new Map(cycle).set('b.js', cycle.get('b.js') + '\nexport const added = 1;'));
  assert.notEqual(original.get('a.js'), after.get('a.js'));
  assert.notEqual(original.get('b.js').split('\n')[0], after.get('b.js').split('\n')[0]);
});

test('the Pages build writes a separate copy and preserves assets and their URLs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gatefall-pages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'docs');
  const output = join(root, 'site');
  await mkdir(source);
  const html = '<link rel="stylesheet" href="./style.css?v=art"><script type="module" src="./app.js"></script>';
  await writeFile(join(source, 'index.html'), html);
  await writeFile(join(source, 'app.js'), "import('./extra.js');");
  await writeFile(join(source, 'extra.js'), 'export const ready = true;');
  await writeFile(join(source, 'style.css'), 'body { color: black; }');
  const image = Buffer.from([0, 88, 255]);
  await writeFile(join(source, 'art.webp'), image);

  await buildPages(source, output);
  assert.equal(await readFile(join(source, 'index.html'), 'utf8'), html);
  const result = await readFile(join(output, 'index.html'), 'utf8');
  assert.match(result, /src="\.\/app\.js\?gf=[0-9a-f]{16}"/);
  assert.match(result, /href="\.\/style\.css\?v=art"/);
  assert.match(await readFile(join(output, 'app.js'), 'utf8'), /\.\/extra\.js\?gf=[0-9a-f]{16}/);
  assert.deepEqual(await readFile(join(output, 'art.webp')), image);
  await assert.rejects(buildPages(source, output), { code: 'EEXIST' });
});
