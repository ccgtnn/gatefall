import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = /(["'])(\.{1,2}\/[^"'?#\s]+\.js)(\?[^"'#\s]*)?(#[^"'\s]*)?\1/g;

function referencedModule(filename, specifier) {
  return posix.normalize(posix.join(posix.dirname(filename), specifier));
}

export function versionModules(files) {
  const scripts = new Map(
    [...files].filter(([name]) => name.endsWith('.js')).map(([name, source]) => [
      name,
      [...new Set([...source.matchAll(moduleUrl)]
        .map(([, , specifier]) => referencedModule(name, specifier))
        .filter((dependency) => files.has(dependency)))],
    ]),
  );

  const versions = new Map();
  for (const script of scripts.keys()) {
    const reachable = new Set();
    const pending = [script];
    while (pending.length) {
      const name = pending.pop();
      if (reachable.has(name)) continue;
      reachable.add(name);
      pending.push(...scripts.get(name));
    }
    const inputs = [...reachable].sort().map((name) => [name, files.get(name)]);
    versions.set(script, createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16));
  }

  return new Map([...files].map(([filename, source]) => [
    filename,
    source.replace(moduleUrl, (match, quote, specifier, query, fragment = '') => {
      const version = versions.get(referencedModule(filename, specifier));
      if (!version) return match;
      return quote + specifier + (query ? query + '&' : '?') + 'gf=' + version + fragment + quote;
    }),
  ]));
}

export async function buildPages(source, output) {
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /\.(?:js|html)$/.test(entry.name))
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
  const files = new Map(await Promise.all(filenames.map(async (name) => [
    name, await readFile(join(source, name), 'utf8'),
  ])));

  await mkdir(output);
  await cp(source, output, { recursive: true });
  for (const [name, content] of versionModules(files)) {
    if (content !== files.get(name)) await writeFile(join(output, name), content);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: npm run build:pages -- <new-output-directory>');
  await buildPages(resolve('docs'), resolve(output));
}
