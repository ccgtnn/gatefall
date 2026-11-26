import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createExportMap, listExports } from '../../tools/context.mjs';

const tool = fileURLToPath(new URL('../../tools/context.mjs', import.meta.url));
const run = (...args) => promisify(execFile)(process.execPath, [tool, ...args], { cwd: tmpdir() });

async function write(root, name, content) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

test('the export parser recognizes function, const and class declarations without their bodies', () => {
  const source = [
    'export const first = 1;',
    'export async function load() {',
    '  return "function hidden()";',
    '}',
    'export default class Thing {}',
    'export function* iterate() {}',
    'const internal = true;',
  ].join('\n');
  assert.deepEqual(listExports(source), ['const first', 'function load', 'class Thing', 'function iterate']);
});

test('the export map covers project JavaScript and skips generated and dependency directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gatefall-map-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'alpha.js', 'export const first = 1;\nexport function second() {}\n');
  await write(root, 'nested/module.mjs', 'export class Module {}\n');
  await write(root, 'empty.js', 'const internal = true;\n');
  await write(root, 'node_modules/dependency.js', 'export const hidden = true;\n');
  await write(root, '.git/hidden.js', 'export const hidden = true;\n');
  await write(root, 'tools/review-export/hidden.js', 'export const hidden = true;\n');
  await write(root, 'types/contracts.d.ts', 'export const ignored: true;\n');

  assert.equal(await createExportMap(root), [
    'alpha.js — const first, function second',
    'empty.js — (нет export)',
    'nested/module.mjs — class Module',
  ].join('\n'));
});

test('ctx --map prints one line per JavaScript file', async () => {
  const { stdout } = await run('--map');
  const lines = stdout.trim().split('\n');
  assert.ok(lines.includes('tools/build-pages.mjs — function versionFiles, function buildPages'));
  assert.ok(lines.some((line) => line.startsWith('docs/app.js — ')));
  assert.ok(lines.some((line) => line.startsWith('tests/ui/context-map.test.js — ')));
  assert.ok(lines.every((line) => /^.+\.(?:js|mjs) — (?:\(|(?:function|const|class) )/.test(line)));
  await assert.rejects(run('--map', 'docs/app.js'), { stdout: '' });
});
