import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const profiles = {
  engine: ['Движок матча', [
    'docs/game/match.js', 'docs/game/board.js', 'docs/game/effects.js',
    'docs/game/effect-piles.js', 'docs/game/effect-queries.js', 'docs/game/events.js', 'docs/game/card-metadata.js', 'tests/round-rules.test.js',
  ]],
  bot: ['Стратегия и симуляции бота', [
    'docs/game/bot.js', 'docs/game/bot-strategy.js', 'docs/game/bot-rollouts.js',
    'docs/game/bot-effect-value.js', 'tests/bot-strategy.test.js',
  ]],
  economy: ['Сохранения, награды и экономика', [
    'docs/game/rewards.js', 'docs/game/collection-economy.js', 'docs/game/base.js',
    'docs/game/base-production.js', 'docs/game/tavern.js', 'docs/game/ranks.js', 'docs/game/league.js', 'tests/rewards.test.js',
  ]],
  ui: ['Оболочка игры и управление экранами', [
    'docs/app.js', 'docs/ui/dom.js', 'docs/ui/resources.js', 'docs/ui/settings.js',
    'docs/ui/match-turn.js', 'docs/ui/match-session.js', 'docs/ui/app-timers.js', 'tests/match-turn.test.js',
  ]],
  'ui:battle': ['Поле и действия игрока', [
    'docs/ui/match-turn.js', 'docs/ui/field.js', 'docs/ui/hand.js', 'docs/ui/targeting.js',
    'docs/card-placement.js', 'docs/turn-playback.js', 'tests/card-placement.test.js',
  ]],
  'ui:catalog': ['Каталог и просмотр карт', [
    'docs/ui/catalog-screen.js', 'docs/ui/catalog-cards.js', 'docs/ui/cards.js',
    'docs/ui/card-art.js', 'docs/game/card-registry.js', 'tests/catalog.test.js',
  ]],
  'ui:base': ['Экран Базы и Таверны', [
    'docs/ui/base-screen.js', 'docs/ui/base-grid.js', 'docs/ui/base-layout.js',
    'docs/ui/tavern-screen.js', 'tests/base-layout.test.js',
  ]],
  'ui:rewards': ['Книга наград и панель ресурсов', [
    'docs/ui/reward-book.js', 'docs/ui/reward-reveal.js', 'docs/ui/resources.js',
    'docs/game/reward-book.js', 'tests/reward-reveal.test.js',
  ]],
};

const languages = new Map([
  ['.js', 'js'], ['.mjs', 'js'], ['.md', 'markdown'], ['.css', 'css'], ['.html', 'html'],
  ['.json', 'json'], ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.txt', 'text'],
]);

function usage() {
  return [
    'npm run --silent ctx -- <пакет> [дополнительные файлы]',
    '',
    ...Object.entries(profiles).map(([id, [name]]) => `  ${id.padEnd(13)} ${name}`),
  ].join('\n');
}

async function loadSource(root, requested) {
  const file = await realpath(resolve(root, requested));
  const name = relative(root, file);
  if (!name || isAbsolute(name) || name === '..' || name.startsWith('..' + sep)) {
    throw new Error(`Файл должен быть внутри проекта (${requested}).`);
  }
  const language = languages.get(extname(file));
  if (!language) throw new Error(`Выбери текстовый файл проекта (${requested}).`);
  return { name: name.split(sep).join('/'), language, source: await readFile(file, 'utf8') };
}

function renderSource({ name, language, source }) {
  const width = (source.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3);
  const fence = '`'.repeat(width);
  const text = source.endsWith('\n') ? source : source + '\n';
  return `## ${name}\n\n${fence}${language}\n${text}${fence}`;
}

async function main([id, ...extra]) {
  if (!id || id === '--help' || id === '-h') {
    process.stdout.write(usage() + '\n');
    return;
  }
  if (!Object.hasOwn(profiles, id)) throw new Error(`Неизвестный пакет (${id}).\n${usage()}`);
  const [title, paths] = profiles[id];
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const sources = await Promise.all([...new Set(['AGENTS.md', 'CONTRACTS.md', ...paths, ...extra])]
    .map((name) => loadSource(root, name)));
  const files = [...new Map(sources.map((file) => [file.name, file])).values()];
  const header = `# Gatefall · ${title}\n\nПакет ${id}. В нём ${files.length} файлов. Некоторые импорты ведут в другие части проекта.`;
  process.stdout.write([header, ...files.map(renderSource)].join('\n\n') + '\n');
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
