import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { exportReview, parseOnlyArgs } from '../../tools/export-review.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'gatefall-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

test('review export orders sections, starts with a contents list and only measures binary files', async (t) => {
  const root = await fixture(t, {
    'tests/ui/core.test.js': 'test("core", () => {});\n',
    'types/contracts.d.ts': 'export type Id = string;\n',
    'tools/tool.mjs': 'export const tool = true;\n',
    'docs/style.css': 'body { color: white; }\n',
    'docs/ui/view.js': 'export function view() {}\n',
    'docs/app.js': 'export const app = true;\n',
    'docs/game/core.js': 'export class Core {}\n',
    'docs/art/loop.webm': Buffer.from([26, 69, 223, 163]),
    'docs/art/picture.webp': Buffer.from([0, 1, 2, 255]),
  });
  const output = join(root, 'tools/review-export');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'stale.txt'), 'stale');
  const parts = await exportReview({ root, targetBytes: 100000 });
  assert.equal(parts.length, 1);
  const text = await readFile(join(output, parts[0].name), 'utf8');
  const toc = text.split('## Оглавление\n')[1].split('\n\n')[0].split('\n').map((line) => line.slice(2));
  assert.deepEqual(toc, [
    'docs/game/core.js',
    'docs/app.js',
    'docs/ui/view.js',
    'docs/style.css',
    'tools/tool.mjs',
    'types/contracts.d.ts',
    'docs/art/loop.webm',
    'docs/art/picture.webp',
    'tests/ui/core.test.js',
  ]);
  assert.ok(text.startsWith('# Gatefall · внешнее ревью · часть 1\n'));
  assert.ok(text.includes('docs/art/picture.webp, 4 bytes'));
  assert.ok(text.includes('docs/art/loop.webm, 4 bytes'));
  assert.ok(!text.includes('## docs/art/picture.webp'));
  assert.ok(!text.includes('## docs/art/loop.webm'));
  assert.ok(text.includes('## docs/game/core.js\n\n```js\nexport class Core {}\n```'));
  await assert.rejects(readFile(join(output, 'stale.txt'), 'utf8'));
});

test('review export splits at file boundaries and isolates a large file', async (t) => {
  const root = await fixture(t, {
    'docs/game/a.js': `${'a'.repeat(80)}\n`,
    'docs/game/b.js': `${'b'.repeat(80)}\n`,
    'docs/game/large.js': `${'x'.repeat(500)}\n`,
    'docs/ui/c.js': 'export const c = true;\n',
  });
  const output = join(root, 'tools/review-export');
  const parts = await exportReview({ root, targetBytes: 160 });
  assert.ok(parts.length >= 3);
  assert.deepEqual(parts.find(({ files }) => files.includes('docs/game/large.js')).files, ['docs/game/large.js']);
  for (const [index, part] of parts.entries()) {
    const text = await readFile(join(output, part.name), 'utf8');
    assert.equal(part.name, `part-${index + 1}.txt`);
    const toc = text.split('## Оглавление\n')[1].split('\n\n')[0].split('\n').map((line) => line.slice(2));
    assert.deepEqual(toc, part.files);
    const sections = Array.from(text.matchAll(/^## (?!Оглавление$)(.+)$/gm), (match) => match[1]);
    assert.deepEqual(sections, part.files);
  }
});

test('--only selects files and directories, rejects missing or external paths', async (t) => {
  const root = await fixture(t, {
    'docs/game/core.js': 'export const core = true;\n',
    'docs/ui/view.js': 'export const view = true;\n',
    'docs/ui/extra.js': 'export const extra = true;\n',
    'docs/app.js': 'export const app = true;\n',
    'tests/ui/core.test.js': 'test("core", () => {});\n',
  });
  const output = join(root, 'tools/review-export');
  const parts = await exportReview({ root, only: ['./docs/ui/', 'docs/app.js', 'docs/ui/view.js'] });
  const text = await readFile(join(output, parts[0].name), 'utf8');
  assert.deepEqual(parts[0].files, ['docs/app.js', 'docs/ui/extra.js', 'docs/ui/view.js']);
  assert.ok(!text.includes('docs/game/core.js') && !text.includes('tests/ui/core.test.js'));
  await assert.rejects(exportReview({ root, only: ['missing'] }));
  await assert.rejects(exportReview({ root, only: ['../outside.js'] }), /внутри проекта/);
  assert.deepEqual(parseOnlyArgs(['--only', 'docs/ui', '--only', 'docs/app.js']), ['docs/ui', 'docs/app.js']);
  assert.deepEqual(parseOnlyArgs([]), []);
  assert.throws(() => parseOnlyArgs(['--only']), /хотя бы одну/);
});
