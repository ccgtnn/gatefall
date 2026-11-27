import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { versionFiles } from '../../tools/build-pages.mjs';
import { TestNode } from '../helpers/test-node.js';

const docs = new URL('../../docs/', import.meta.url);
const html = readFileSync(new URL('index.html', docs), 'utf8');
const app = readFileSync(new URL('app.js', docs), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const artworks = ['gate', 'protectorate', 'growth', 'choir', 'captains'];

test('boot overlay is the first body element, has critical styles and receives the first render signal', () => {
  assert.match(html, /<body>\s*<div id="boot-screen">/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#boot-screen\s*\{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: #05060a;/);
  assert.ok(html.indexOf('</style>') < html.indexOf('href="./style.css"'));
  assert.match(app, /^render\(\);\s*window\.gatefallBootReady\?\.\(\);/m);
});

test('all six WebP assets exist and their literal URLs are versioned by the Pages build', () => {
  const media = new Map();
  for (const name of [...artworks, 'logo']) {
    const path = 'art/loading/' + name + '.webp';
    assert.ok(html.includes('./' + path));
    const bytes = readFileSync(new URL(path, docs));
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length <= 300_000, path);
    media.set(path, bytes);
  }
  const built = versionFiles(new Map([['index.html', html]]), media).get('index.html');
  for (const name of [...artworks, 'logo']) {
    assert.match(built, new RegExp('./art/loading/' + name + '\\.webp\\?gf=[0-9a-f]{16}'));
  }
});

function startBoot({ osReduced = false, preference = null, styles = [] } = {}) {
  const screen = new TestNode('div');
  const art = new TestNode('img');
  art.className = 'boot-art';
  const track = new TestNode('div');
  track.className = 'boot-track';
  const hint = new TestNode('p');
  hint.className = 'boot-hint';
  const retry = new TestNode('button');
  retry.className = 'boot-retry';
  retry.hidden = true;
  const backup = new TestNode('button');
  backup.className = 'boot-retry boot-export';
  backup.hidden = true;
  screen.append(art, track, hint, retry, backup);
  screen.style.getPropertyValue = (key) => screen.style[key];
  screen.remove = () => { screen.removed = true; };
  const moduleScript = new EventTarget();
  const window = new EventTarget();
  let reloads = 0;
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  function setTimeout(callback, delay) {
    const id = ++nextId;
    timers.set(id, { callback, at: now + delay });
    return id;
  }
  function advanceTo(time) {
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, { callback, at }] = next;
      timers.delete(id);
      now = at;
      callback();
    }
    now = time;
  }
  runInNewContext(inlineScript, {
    document: {
      getElementById: () => screen,
      querySelector: () => moduleScript,
      querySelectorAll: () => styles,
    },
    window, AbortController, setTimeout, clearTimeout: (id) => timers.delete(id),
    performance: { now: () => now }, requestAnimationFrame: (callback) => setTimeout(callback, 16),
    matchMedia: () => ({ matches: osReduced }), localStorage: { getItem(key) {
      assert.equal(key, 'gatefall.animation-speed');
      return preference;
    } },
    location: { reload: () => { reloads += 1; } },
  });
  return { art, track, hint, retry, backup, screen, window, moduleScript, advanceTo, reloads: () => reloads };
}

test('boot waits for the stylesheet and minimum time, then completes progress and fades out', () => {
  const style = new EventTarget();
  const boot = startBoot({ styles: [style] });
  assert.match(boot.art.src, /^\.\/art\/loading\/.+\.webp$/);
  boot.art.dispatchEvent(new Event('load'));
  assert.ok(boot.art.classList.contains('is-loaded'));
  boot.window.gatefallBootReady();
  boot.advanceTo(600);
  assert.equal(boot.screen.style['--boot-progress'], '.9');
  style.dispatchEvent(new Event('load'));
  assert.equal(style.media, 'all');
  boot.advanceTo(700);
  assert.equal(boot.screen.style['--boot-progress'], '1');
  assert.equal(boot.screen.classList.contains('boot-leaving'), false);
  boot.advanceTo(880);
  assert.ok(boot.screen.classList.contains('boot-leaving'));
  boot.advanceTo(1280);
  assert.equal(boot.screen.removed, true);
});

test('boot follows the system motion preference unless the player selected an animation speed', () => {
  for (const settings of [{ osReduced: true }, { osReduced: true, preference: 'system' }]) {
    const boot = startBoot(settings);
    assert.ok(boot.screen.classList.contains('boot-still'));
    boot.window.gatefallBootReady();
    assert.equal(boot.screen.removed, true);
  }
  for (const preference of ['normal', 'fast']) {
    const boot = startBoot({ osReduced: true, preference });
    assert.equal(boot.screen.classList.contains('boot-still'), false);
    boot.window.gatefallBootReady();
    assert.equal(boot.screen.removed, undefined);
  }
});

test('startup errors and timeout offer reload and backup while awaiting a late render signal', () => {
  const failures = [
    (boot) => boot.advanceTo(15000),
    (boot) => boot.window.dispatchEvent(new Event('error')),
    (boot) => boot.window.dispatchEvent(new Event('unhandledrejection')),
    (boot) => boot.moduleScript.dispatchEvent(new Event('error')),
  ];
  for (const fail of failures) {
    const boot = startBoot();
    fail(boot);
    assert.equal(boot.hint.textContent, 'Не удалось загрузить игру. Обнови страницу');
    assert.ok(boot.track.hidden);
    assert.equal(boot.retry.hidden, false);
    assert.equal(boot.backup.hidden, false);
    assert.equal(boot.screen.removed, undefined);
    boot.retry.dispatchEvent(new Event('click'));
    assert.equal(boot.reloads(), 1);
    boot.window.gatefallBootReady();
    assert.equal(boot.screen.removed, true);
  }
});

test('a late render after timeout reveals the game even with a stylesheet still pending', () => {
  const style = new EventTarget();
  const boot = startBoot({ styles: [style] });
  boot.advanceTo(15000);
  boot.window.gatefallBootReady();
  assert.equal(boot.screen.removed, true);
  style.dispatchEvent(new Event('load'));
  assert.equal(style.media, 'all');
});
