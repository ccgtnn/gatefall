import { readFile, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const profiles = {
  engine: ['Движок матча', [
    'docs/game/engine/match.js', 'docs/game/engine/match-setup.js', 'docs/game/engine/match-rounds.js', 'docs/game/engine/match-actions.js',
    'docs/game/engine/board.js', 'docs/game/engine/board-placement.js', 'docs/game/engine/board-power.js', 'docs/game/engine/board-status.js',
    'docs/game/effects/effects.js',
    'docs/game/effects/effect-operations.js', 'docs/game/effects/effect-piles.js', 'docs/game/effects/effect-queries.js', 'docs/game/shared/effect-schema.js', 'docs/game/engine/events.js', 'docs/game/shared/card-metadata.js', 'tests/battle/round-rules.test.js',
  ]],
  bot: ['Стратегия и симуляции бота', [
    'docs/game/bot/bot.js', 'docs/game/bot/bot-strategy.js', 'docs/game/bot/bot-evaluation.js', 'docs/game/bot/bot-levels.js', 'docs/game/bot/bot-rollouts.js',
    'docs/game/bot/bot-effect-value.js', 'docs/game/bot/bot-future-value.js', 'docs/game/bot/bot-leaders.js', 'tests/bot/bot-strategy.test.js',
  ]],
  economy: ['Сохранения, награды и экономика', [
    'docs/game/meta/rewards.js', 'docs/game/meta/collection-economy.js', 'docs/game/meta/base.js',
    'docs/game/meta/base-production.js', 'docs/game/meta/tavern.js', 'docs/game/meta/ranks.js', 'docs/game/meta/league.js', 'tests/economy/rewards.test.js',
  ]],
  ui: ['Оболочка игры и управление экранами', [
    'docs/app.js', 'docs/ui/dom.js', 'docs/ui/resources.js', 'docs/ui/settings.js',
    'docs/ui/match-turn.js', 'docs/ui/match-session.js', 'docs/ui/bot-search.js', 'docs/ui/bot-worker.js', 'docs/ui/app-timers.js', 'tests/ui/match-turn.test.js',
  ]],
  'ui:battle': ['Поле и действия игрока', [
    'docs/ui/match-turn.js', 'docs/ui/field.js', 'docs/ui/hand.js', 'docs/ui/targeting.js',
    'docs/ui/card-placement.js', 'docs/ui/turn-playback.js', 'tests/ui/card-placement.test.js',
  ]],
  'ui:catalog': ['Каталог и просмотр карт', [
    'docs/ui/catalog-screen.js', 'docs/ui/catalog-cards.js', 'docs/ui/cards.js',
    'docs/ui/card-art.js', 'docs/game/cards/card-registry.js', 'tests/ui/catalog.test.js',
  ]],
  'ui:base': ['Экран Базы и Таверны', [
    'docs/ui/base-screen.js', 'docs/ui/base-grid.js',
    'docs/ui/tavern-screen.js', 'tests/economy/base.test.js',
  ]],
  'ui:rewards': ['Книга наград и панель ресурсов', [
    'docs/ui/reward-book.js', 'docs/ui/reward-reveal.js', 'docs/ui/resources.js',
    'docs/game/meta/reward-book.js', 'tests/economy/reward-reveal.test.js',
  ]],
};

const languages = new Map([
  ['.js', 'js'], ['.mjs', 'js'], ['.md', 'markdown'], ['.css', 'css'], ['.html', 'html'],
  ['.json', 'json'], ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.txt', 'text'],
]);

function usage() {
  return [
    'npm run --silent ctx -- <пакет> [дополнительные файлы]',
    'npm run --silent ctx -- --map',
    '',
    ...Object.entries(profiles).map(([id, [name]]) => `  ${id.padEnd(13)} ${name}`),
  ].join('\n');
}

const excludedFiles = new Set(['ART_STYLE.md', 'README.md', 'CHANGELOG.md']);
const excludedDirectories = ['tools/analysis/', 'docs/game/meta/data/'];

async function loadSource(root, requested) {
  const file = await realpath(resolve(root, requested));
  const name = relative(root, file);
  if (!name || isAbsolute(name) || name === '..' || name.startsWith('..' + sep)) {
    throw new Error(`Файл должен быть внутри проекта (${requested}).`);
  }
  const path = name.split(sep).join('/');
  if (excludedFiles.has(path) || excludedDirectories.some((directory) => path.startsWith(directory))) return;
  const language = languages.get(extname(file));
  if (!language) throw new Error(`Выбери текстовый файл проекта (${requested}).`);
  return { name: path, language, source: await readFile(file, 'utf8') };
}

function renderSource({ name, language, source }) {
  const width = (source.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3);
  const fence = '`'.repeat(width);
  const text = source.endsWith('\n') ? source : source + '\n';
  return `## ${name}\n\n${fence}${language}\n${text}${fence}`;
}

export function listExports(source) {
  const declaration = /^[\t ]*export[\t ]+(?:default[\t ]+)?(?:async[\t ]+)?(function|const|class)(?:[\t ]*\*[\t ]*|[\t ]+)([\w$]+)/gm;
  return Array.from(source.matchAll(declaration), (match) => `${match[1]} ${match[2]}`);
}

async function javascriptFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = resolve(directory, entry.name);
    const name = relative(root, absolute).split(sep).join('/');
    if (['.git', 'node_modules', 'coverage', 'tools/review-export'].includes(name)) continue;
    if (entry.isDirectory()) files.push(...await javascriptFiles(root, absolute));
    else if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name))) files.push({ absolute, name });
  }
  return files;
}

export async function createExportMap(root) {
  const files = await javascriptFiles(await realpath(root));
  return (await Promise.all(files.map(async ({ absolute, name }) => {
    const exports = listExports(await readFile(absolute, 'utf8'));
    return `${name} — ${exports.length ? exports.join(', ') : '(нет export)'}`;
  }))).join('\n');
}

async function main([id, ...extra]) {
  if (!id || id === '--help' || id === '-h') {
    process.stdout.write(usage() + '\n');
    return;
  }
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  if (id === '--map') {
    if (extra.length) throw new Error('Режим --map не принимает дополнительные аргументы.');
    process.stdout.write(await createExportMap(root) + '\n');
    return;
  }
  if (!Object.hasOwn(profiles, id)) throw new Error(`Неизвестный пакет (${id}).\n${usage()}`);
  const [title, paths] = profiles[id];
  const sources = await Promise.all([...new Set(['AGENTS.md', 'CONTRACTS.md', ...paths, ...extra])]
    .map((name) => loadSource(root, name)));
  const files = [...new Map(sources.filter(Boolean).map((file) => [file.name, file])).values()];
  const header = `# Gatefall · ${title}\n\nПакет ${id}. В нём ${files.length} файлов. Некоторые импорты ведут в другие части проекта.`;
  process.stdout.write([header, ...files.map(renderSource)].join('\n\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
