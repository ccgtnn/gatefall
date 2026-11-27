import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const gameRoot = resolve(root, 'docs/game');
const zones = ['shared', 'cards', 'engine', 'effects', 'bot', 'meta'];
const allowed = {
  shared: new Set(),
  cards: new Set(['shared']),
  engine: new Set(['shared', 'effects']),
  effects: new Set(['shared', 'engine']),
  bot: new Set(['shared', 'cards', 'engine', 'effects']),
  meta: new Set(['shared', 'cards']),
};
// Runtime create-play selects definitions from the catalog; removing this edge would
// require putting catalog data or callbacks into MatchState, which changes its contract.
const exceptions = [{ from: 'effects/effect-queries.js', to: 'cards/card-registry.js' }];

async function javascriptFiles(directory = gameRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

function projectPath(path) {
  return relative(root, path).split(sep).join('/');
}

function zoneOf(path) {
  const [zone] = path.split('/');
  return zones.includes(zone) ? zone : undefined;
}

function importsOf(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

const files = await javascriptFiles();
const sources = new Map(await Promise.all(files.map(async (path) => [
  relative(gameRoot, path).split(sep).join('/'), await readFile(path, 'utf8'),
])));

test('game zones only import allowed zones', () => {
  for (const [from, source] of sources) {
    const fromZone = zoneOf(from);
    assert.ok(fromZone, `${from} must belong to a game zone`);
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith('.')) continue;
      const to = join(dirname(from), specifier).replaceAll('\\', '/');
      const toZone = zoneOf(to);
      if (!toZone || toZone === fromZone) continue;
      const explicitException = exceptions.some((entry) => entry.from === from && entry.to === to);
      const setupCatalog = from === 'engine/match-setup.js' && toZone === 'cards';
      assert.ok(allowed[fromZone].has(toZone) || explicitException || setupCatalog,
        `${from} imports forbidden zone ${toZone} via ${to}`);
    }
  }
});

test('bot-future-value does not close the direct bot-evaluation cycle', () => {
  const futureImports = importsOf(sources.get('bot/bot-future-value.js'));
  assert.ok(!futureImports.includes('./bot-evaluation.js'));
  assert.ok(futureImports.includes('./bot-weights.js'));
  assert.ok(importsOf(sources.get('bot/bot-evaluation.js')).includes('./bot-weights.js'));
});
