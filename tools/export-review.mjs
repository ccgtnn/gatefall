import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = 'tools/review-export';
const defaultTargetBytes = 130 * 1024;
const binaryExtensions = new Set(['.png', '.webp', '.jpg', '.mp4', '.webm', '.ico', '.woff2']);
const languages = new Map([
  ['.js', 'js'], ['.mjs', 'js'], ['.ts', 'ts'], ['.md', 'markdown'], ['.css', 'css'],
  ['.html', 'html'], ['.json', 'json'], ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.txt', 'text'],
]);

export function parseOnlyArgs(args) {
  if (!args.length) return [];
  if (args[0] !== '--only') throw new Error('Использование: npm run export:review -- [--only <папки/файлы>]');
  const only = [];
  for (const arg of args) {
    if (arg === '--only') continue;
    if (arg.startsWith('--')) throw new Error(`Неизвестный флаг (${arg}).`);
    only.push(arg);
  }
  if (!only.length) throw new Error('После --only укажи хотя бы одну папку или файл.');
  return only;
}

function pathRank(name) {
  if (name.startsWith('tests/')) return 6;
  if (name.startsWith('docs/game/')) return 0;
  if (name.startsWith('docs/ui/') || name === 'docs/app.js') return 1;
  if (extname(name).toLowerCase() === '.css') return 2;
  if (name.startsWith('tools/')) return 3;
  if (name.startsWith('types/')) return 4;
  return 5;
}

function compareEntries(a, b) {
  return pathRank(a.name) - pathRank(b.name) || a.name.localeCompare(b.name);
}

async function walk(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const name = relative(root, absolute).split(sep).join('/');
    if (['.git', 'node_modules', 'coverage', outputDirectory].includes(name)) continue;
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    else if (entry.isFile()) files.push({ absolute, name });
  }
  return files;
}

function relativeName(root, absolute, requested) {
  const name = relative(root, absolute);
  if (!name || isAbsolute(name) || name === '..' || name.startsWith('..' + sep)) {
    throw new Error(`Путь должен быть внутри проекта (${requested}).`);
  }
  return name.split(sep).join('/');
}

async function normalizeSelections(root, requestedPaths) {
  return Promise.all(requestedPaths.map(async (requested) => {
    if (isAbsolute(requested)) throw new Error(`Путь должен быть внутри проекта (${requested}).`);
    const name = relativeName(root, resolve(root, requested), requested);
    const real = await realpath(resolve(root, requested));
    relativeName(root, real, requested);
    const details = await stat(real);
    if (!details.isDirectory() && !details.isFile()) throw new Error(`Ожидалась папка или файл (${requested}).`);
    return { name, directory: details.isDirectory() };
  }));
}

function renderText(name, source) {
  const width = (source.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3);
  const fence = '`'.repeat(width);
  const language = languages.get(extname(name).toLowerCase()) ?? 'text';
  const text = source.endsWith('\n') ? source : source + '\n';
  return `## ${name}\n\n${fence}${language}\n${text}${fence}`;
}

async function reviewEntry(file) {
  const details = await stat(file.absolute);
  if (binaryExtensions.has(extname(file.name).toLowerCase())) {
    return { ...file, section: `${file.name}, ${details.size} bytes` };
  }
  return { ...file, section: renderText(file.name, await readFile(file.absolute, 'utf8')) };
}

function renderPart(entries, index) {
  return [
    `# Gatefall · внешнее ревью · часть ${index}`,
    '',
    '## Оглавление',
    ...entries.map(({ name }) => `- ${name}`),
    '',
    ...entries.map(({ section }) => section),
  ].join('\n') + '\n';
}

export async function exportReview({ root, output, only = [], targetBytes = defaultTargetBytes }) {
  root = await realpath(root);
  output = resolve(output ?? resolve(root, outputDirectory));
  relativeName(root, output, output);
  if (!Number.isInteger(targetBytes) || targetBytes < 1) throw new Error('Размер части должен быть положительным целым числом.');

  const selections = await normalizeSelections(root, only);
  const files = (await walk(root)).filter(({ name }) => !selections.length || selections.some((selection) =>
    selection.directory ? name.startsWith(selection.name + '/') : name === selection.name));
  const entries = await Promise.all(files.sort(compareEntries).map((file) => reviewEntry(file)));
  if (!entries.length) throw new Error('Нет файлов для выгрузки.');

  const groups = [];
  let current = [];
  let currentBytes = 0;
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    currentBytes = 0;
  };
  for (const entry of entries) {
    const bytes = Buffer.byteLength(entry.section);
    if (current.length && currentBytes + bytes > targetBytes) flush();
    current.push(entry);
    currentBytes += bytes;
    if (bytes >= targetBytes) flush();
  }
  flush();

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const parts = [];
  for (const [index, group] of groups.entries()) {
    const content = renderPart(group, index + 1);
    const name = `part-${index + 1}.txt`;
    await writeFile(resolve(output, name), content);
    parts.push({ name, files: group.map((entry) => entry.name), bytes: Buffer.byteLength(content) });
  }
  return parts;
}

async function main(args) {
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const parts = await exportReview({ root, only: parseOnlyArgs(args) });
  process.stdout.write(`Выгружено ${parts.length} частей в ${outputDirectory}/:\n${parts.map(({ name }) => name).join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
