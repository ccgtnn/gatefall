import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildPages, versionFiles } from '../tools/build-pages.mjs';

const files = new Map([
  ['index.html', '<script type="module" src="./app.js?v=legacy"></script>\n<script src="./demo.js"></script>'],
  ['app.js', "import './game/cards.js?v=catalog';\nimport './standalone.js';"],
  ['game/cards.js', "export { value } from './neutral.js';"],
  ['game/neutral.js', 'export const value = 1;'],
  ['standalone.js', 'export const stable = true;'],
  ['demo.js', 'export const demo = true;'],
]);

test('a catalog change updates every importing URL and preserves unrelated module URLs', () => {
  const before = versionFiles(files);
  const after = versionFiles(new Map(files).set('game/neutral.js', 'export const value = 2;'));
  assert.match(before.get('index.html'), /\.\/app\.js\?gf=[0-9a-f]{16}/);
  assert.match(before.get('game/cards.js'), /\.\/neutral\.js\?gf=[0-9a-f]{16}/);
  assert.notEqual(before.get('game/cards.js'), after.get('game/cards.js'));
  assert.notEqual(before.get('app.js').split('\n')[0], after.get('app.js').split('\n')[0]);
  assert.notEqual(before.get('index.html').split('\n')[0], after.get('index.html').split('\n')[0]);
  assert.equal(before.get('app.js').split('\n')[1], after.get('app.js').split('\n')[1]);
  assert.equal(before.get('index.html').split('\n')[1], after.get('index.html').split('\n')[1]);
});

test('legacy version aliases resolve to one module URL while other parameters and fragments survive', () => {
  const built = versionFiles(new Map([
    ['index.html', '<script src="./shared.js?v=branch&amp;layout=wide"></script>'],
    ['app.js', "import './shared.js?v=one';\nimport './shared.js?v=two';\nimport './shared.js';\nimport './shared.js?layout=wide&v=old#panel';"],
    ['shared.js', 'export const ready = true;'],
  ]));
  const [first, second, unversioned, layout] = built.get('app.js').split('\n');
  const hash = first.match(/\?gf=([0-9a-f]{16})/)[1];
  assert.equal(second, first);
  assert.equal(unversioned, first);
  assert.equal(layout, `import './shared.js?layout=wide&gf=${hash}#panel';`);
  assert.equal(built.get('index.html'), `<script src="./shared.js?layout=wide&amp;gf=${hash}"></script>`);
});

test('cycles have stable versions regardless of file enumeration order', () => {
  const cycle = new Map([
    ['a.js', "import './b.js';"],
    ['b.js', "import './a.js';"],
  ]);
  const original = versionFiles(cycle);
  assert.deepEqual(original, versionFiles(new Map([...cycle].reverse())));
  const after = versionFiles(new Map(cycle).set('b.js', cycle.get('b.js') + '\nexport const added = 1;'));
  assert.notEqual(original.get('a.js'), after.get('a.js'));
  assert.notEqual(original.get('b.js').split('\n')[0], after.get('b.js').split('\n')[0]);
});

test('the Pages build writes a separate copy and versions CSS and dynamic media URLs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gatefall-pages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'docs');
  const output = join(root, 'site');
  await mkdir(source);
  const html = '<link rel="stylesheet" href="./style.css?v=art"><script type="module" src="./app.js"></script>';
  await writeFile(join(source, 'index.html'), html);
  const assetSource = await readFile(new URL('../docs/ui/asset-url.js', import.meta.url), 'utf8');
  await mkdir(join(source, 'ui'));
  await writeFile(join(source, 'ui', 'asset-url.js'), assetSource);
  await writeFile(join(source, 'app.js'), "import './ui/asset-url.js'; import('./extra.js');");
  await writeFile(join(source, 'extra.js'), 'export const ready = true;');
  await writeFile(join(source, 'style.css'), 'body { background: url(art.webp?v=old); }');
  const image = Buffer.from([0, 88, 255]);
  await writeFile(join(source, 'art.webp'), image);
  await writeFile(join(source, 'clip.mp4'), Buffer.from([5, 6, 7]));
  await writeFile(join(source, 'icons.svg'), '<svg/>');

  await buildPages(source, output);
  assert.equal(await readFile(join(source, 'index.html'), 'utf8'), html);
  const result = await readFile(join(output, 'index.html'), 'utf8');
  assert.match(result, /src="\.\/app\.js\?gf=[0-9a-f]{16}"/);
  assert.match(result, /href="\.\/style\.css\?gf=[0-9a-f]{16}"/);
  const css = await readFile(join(output, 'style.css'), 'utf8');
  const { assetUrl } = await import(pathToFileURL(join(output, 'ui', 'asset-url.js')));
  assert.equal(css, `body { background: url(${assetUrl('./art.webp').slice(2)}); }`);
  assert.match(assetUrl('./clip.mp4'), /^\.\/clip\.mp4\?gf=[0-9a-f]{16}$/);
  assert.match(assetUrl('./icons.svg?skin=dark#shield'), /^\.\/icons\.svg\?skin=dark&gf=[0-9a-f]{16}#shield$/);
  assert.equal(assetUrl('./missing.svg#id'), './missing.svg#id');
  assert.match(await readFile(join(output, 'app.js'), 'utf8'), /\.\/extra\.js\?gf=[0-9a-f]{16}/);
  assert.deepEqual(await readFile(join(output, 'art.webp')), image);
  await assert.rejects(buildPages(source, output), { code: 'EEXIST' });
});

test('changed media invalidates nested styles and leaves unrelated URL versions alone', () => {
  const source = new Map([
    ['index.html', '<link href="theme/main.css"><link href="keep.css"><img src="./icon.svg?v=old&amp;size=2#mark"><img src="https://example.org/icon.svg">'],
    ['theme/main.css', '@import "palette.css";'],
    ['theme/palette.css', ':root { --icon: url(../icon.svg#mark); --local: url(#mark); }'],
    ['keep.css', 'body { color: black; }'],
  ]);
  const before = versionFiles(source, new Map([['icon.svg', '<svg>A</svg>']]));
  const after = versionFiles(source, new Map([['icon.svg', '<svg>B</svg>']]));
  const cssUrl = (content, name) => content.match(new RegExp(name + '\\?gf=([0-9a-f]{16})'))?.[1];
  assert.ok(cssUrl(before.get('index.html'), 'theme/main.css'));
  assert.ok(cssUrl(before.get('theme/main.css'), 'palette.css'));
  assert.notEqual(cssUrl(before.get('index.html'), 'theme/main.css'), cssUrl(after.get('index.html'), 'theme/main.css'));
  assert.notEqual(before.get('theme/main.css'), after.get('theme/main.css'));
  assert.equal(cssUrl(before.get('index.html'), 'keep.css'), cssUrl(after.get('index.html'), 'keep.css'));
  assert.match(before.get('index.html'), /icon\.svg\?size=2&amp;gf=[0-9a-f]{16}#mark/);
  assert.match(before.get('index.html'), /src="https:\/\/example\.org\/icon\.svg"/);
  assert.match(before.get('theme/palette.css'), /url\(\.\.\/icon\.svg\?gf=[0-9a-f]{16}#mark\); --local: url\(#mark\)/);
});
