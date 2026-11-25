import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const mediaExtension = /\.(?:webp|mp4|svg|png|webm)$/;
const textExtension = /\.(?:js|css|html|webmanifest)$/;
const versionedText = /\.(?:js|css|webmanifest)$/;
const moduleUrl = /(["'])(\.{1,2}\/[^"'?#\s]+\.js)(\?[^"'#\s]*)?(#[^"'\s]*)?\1/g;
const quotedUrl = /(["'])([^"'?#\s]+\.(?:js|css|webmanifest|webp|mp4|svg|png|webm))(\?[^"'#\s]*)?(#[^"'\s]*)?\1/g;
const cssUrl = /(\burl\(\s*["']?|@import\s+["'])([^"'?#()\s]+\.(?:css|webp|mp4|svg|png|webm))(\?[^"'#()\s]*)?(#[^"'()\s]*)?(?=["')\s]|$)/g;
const assetManifest = 'const versions = /* pages:media-versions */ {};';
// Rewriting URLs changes the served bytes even when the input graph stays the same.
const urlFormat = 'pages-url-3';

const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

function referencedFile(filename, specifier) {
  if (specifier.startsWith('/') || /^[a-z][\w+.-]*:/i.test(specifier)) return undefined;
  return posix.normalize(posix.join(posix.dirname(filename), specifier));
}

function mapUrls(filename, source, transform) {
  const css = filename.endsWith('.css');
  const pattern = css ? cssUrl : filename.endsWith('.js') ? moduleUrl : quotedUrl;
  return source.replace(pattern, (match, prefix, specifier, query, fragment) => {
    const url = transform(referencedFile(filename, specifier), specifier, query, fragment);
    return url === undefined ? match : prefix + url + (css ? '' : prefix);
  });
}

export function versionFiles(sourceFiles, media = new Map()) {
  const files = new Map(sourceFiles);
  const mediaHashes = new Map([...media].map(([name, content]) => [name, hash(content)]));
  const assetSource = files.get('ui/asset-url.js');
  if (assetSource !== undefined) {
    if (!assetSource.includes(assetManifest)) throw new Error('Missing Pages media manifest slot in ui/asset-url.js');
    const versions = Object.fromEntries([...mediaHashes].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, version]) => ['./' + name, version]));
    files.set('ui/asset-url.js', assetSource.replace(assetManifest, 'const versions = ' + JSON.stringify(versions) + ';'));
  }

  const hashes = new Map([...mediaHashes, ...[...files].map(([name, source]) => [name, hash(source)])]);
  const dependencies = new Map();
  for (const [name, source] of files) {
    if (!versionedText.test(name)) continue;
    const references = new Set();
    mapUrls(name, source, (reference) => {
      if (hashes.has(reference)) references.add(reference);
    });
    dependencies.set(name, references);
  }

  const versions = new Map(mediaHashes);
  for (const entry of dependencies.keys()) {
    const reachable = new Set();
    const pending = [entry];
    while (pending.length) {
      const name = pending.pop();
      if (reachable.has(name)) continue;
      reachable.add(name);
      for (const reference of dependencies.get(name) ?? []) pending.push(reference);
    }
    const inputs = [...reachable].sort().map((name) => [name, hashes.get(name)]);
    versions.set(entry, hash(JSON.stringify([urlFormat, inputs])));
  }

  return new Map([...files].map(([filename, source]) => [
    filename,
    mapUrls(filename, source, (reference, specifier, query, fragment = '') => {
      const version = versions.get(reference);
      if (!version) return;
      const html = filename.endsWith('.html');
      const params = new URLSearchParams(html ? query?.replaceAll('&amp;', '&') : query);
      params.delete('v');
      params.set('gf', version);
      const search = html ? params.toString().replaceAll('&', '&amp;') : params.toString();
      return specifier + '?' + search + fragment;
    }),
  ]));
}

export async function buildPages(source, output) {
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
  const [text, media] = await Promise.all([
    Promise.all(filenames.filter((name) => textExtension.test(name)).map(async (name) => [
      name, await readFile(join(source, name), 'utf8'),
    ])),
    Promise.all(filenames.filter((name) => mediaExtension.test(name)).map(async (name) => [
      name, await readFile(join(source, name)),
    ])),
  ]);

  const files = new Map(text);
  await mkdir(output);
  await cp(source, output, { recursive: true });
  for (const [name, content] of versionFiles(files, new Map(media))) {
    if (content !== files.get(name)) await writeFile(join(output, name), content);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: npm run build:pages -- <new-output-directory>');
  await buildPages(resolve('docs'), resolve(output));
}
