import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const tool = fileURLToPath(new URL('../../tools/context.mjs', import.meta.url));
const run = (...args) => promisify(execFile)(process.execPath, [tool, ...args], { cwd: tmpdir() });

test('all context packs include their contracts and keep broad content out by default', async () => {
  const expected = {
    engine: 'docs/game/effects.js', bot: 'docs/game/bot-strategy.js', economy: 'docs/game/rewards.js',
    ui: 'docs/app.js', 'ui:battle': 'docs/ui/field.js', 'ui:catalog': 'docs/ui/catalog-screen.js',
    'ui:base': 'docs/ui/base-screen.js', 'ui:rewards': 'docs/ui/reward-book.js',
  };
  for (const [id, { stdout }] of await Promise.all(Object.keys(expected).map(async (id) => [id, await run(id)]))) {
    const files = stdout.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
    assert.ok(files.includes('AGENTS.md') && files.includes('CONTRACTS.md'), id);
    assert.ok(files.includes(expected[id]), id);
    assert.ok(files.some((file) => file.startsWith('tests/')), id);
    assert.ok(!files.some((file) => file.endsWith('.css') || file === 'ART_STYLE.md' || file.endsWith('league-characters.js')), id);
  }
});

test('extra files are included once, and a missing profile writes no partial pack', async () => {
  const { stdout } = await run('ui:catalog', 'docs/card-preview.css', './docs/card-preview.css');
  assert.equal(stdout.match(/^## docs\/card-preview\.css$/gm).length, 1);
  await assert.rejects(run('unknown'), { stdout: '' });
});

test('work context excludes general documentation, analysis and league data even among extra files', async () => {
  const { stdout } = await run('engine', 'ART_STYLE.md', 'README.md', 'CHANGELOG.md',
    'tools/analysis/arena-step-19.md', 'docs/game/data/league-characters.js', 'docs/game/data/league-context-lines.js');
  const files = stdout.split('\n').filter((line) => line.startsWith('## '));
  assert.ok(!files.some((line) => /^## (ART_STYLE|README|CHANGELOG)\.md$|^## (tools\/analysis|docs\/game\/data)\//.test(line)));
});

test('extra files cannot read outside the repository', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gatefall-ctx-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = join(root, 'outside.txt');
  await writeFile(outside, 'Outside context');
  await assert.rejects(run('engine', outside), { stdout: '', stderr: /Файл должен быть внутри проекта/ });
});
