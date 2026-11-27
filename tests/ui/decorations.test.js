import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emit } from '../../docs/ui/app-events.js';

class Node extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.className = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classList = {
      add: (...names) => { this.className = [this.className, ...names].join(' '); },
      contains: (name) => this.className.split(' ').includes(name),
      toggle: (name, enabled) => {
        const names = this.className.split(' ').filter((entry) => entry && entry !== name);
        if (enabled) names.push(name);
        this.className = names.join(' ');
      },
    };
  }

  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  focus() {
    document.activeElement?.dispatchEvent(new Event('blur'));
    document.activeElement = this;
    this.dispatchEvent(new Event('focus'));
  }
}

globalThis.document = {
  body: new Node('body'),
  createElement: (tag) => new Node(tag),
  createElementNS: (_, tag) => new Node(tag),
};
const { createBattlefieldPreferences, createFramePreferences, decorationsScreen } =
  await import('../../docs/ui/decorations.js');

const tree = (node) => [node, ...node.children.filter((child) => child instanceof Node).flatMap(tree)];
const byClass = (node, name) => tree(node).find((entry) => entry.classList.contains(name));
const byRole = (node, role) => tree(node).filter((entry) => entry.getAttribute('role') === role);
const press = (node) => node.dispatchEvent(new Event('click'));
const pointer = (node, type) => node.dispatchEvent(new Event(type));
const key = (node, value) => node.dispatchEvent(Object.assign(new Event('keydown'), { key: value }));

function fixture(t, choices, { writable = true } = {}) {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const stored = new Map();
  const storage = {
    getItem: (item) => stored.get(item),
    setItem: (item, value) => {
      if (!writable) throw new Error('Storage unavailable');
      stored.set(item, value);
    },
  };
  const root = new Node('main');
  const frames = createFramePreferences(storage, root);
  const fields = createBattlefieldPreferences(storage, root);
  const phase = new Node('p');
  phase.textContent = 'Матч';
  const panel = decorationsScreen(phase, frames, fields, () => {}, scope.signal, choices);
  return { panel, root, phase, frames, fields, stored };
}

test('decorations render three faction cards and switch tab panels by click or arrow', (t) => {
  const { panel, phase } = fixture(t);
  const [frames, fields] = byRole(panel, 'tab');
  const [frameOptions, fieldOptions] = byRole(panel, 'tabpanel');
  assert.equal(phase.textContent, '');
  assert.equal(tree(panel).find(({ tag }) => tag === 'h2').textContent, 'Украшения');
  assert.ok(byClass(panel, 'section-back'));
  assert.deepEqual(byClass(panel, 'decoration-samples').children.map((card) => card.dataset.faction),
    ['protectorate', 'growth', 'choir']);
  assert.equal(frames.getAttribute('aria-selected'), 'true');
  assert.equal(frameOptions.hidden, false);
  assert.equal(fieldOptions.hidden, true);
  press(fields);
  assert.equal(fields.getAttribute('aria-selected'), 'true');
  assert.equal(frames.tabIndex, -1);
  assert.equal(frameOptions.hidden, true);
  assert.equal(fieldOptions.hidden, false);
  key(fields, 'ArrowLeft');
  assert.equal(document.activeElement, frames);
  assert.equal(frameOptions.hidden, false);
  assert.equal(fieldOptions.hidden, true);
});

test('miniatures temporarily preview choices on hover and focus, and click persists the selection', (t) => {
  const { panel, root, frames, fields, stored } = fixture(t);
  const [framesTab, fieldsTab] = byRole(panel, 'tab');
  const [frameOptions, fieldOptions] = byRole(panel, 'tabpanel');
  const [standard, rampart, vines] = frameOptions.children;
  const caption = byClass(panel, 'decoration-caption');
  const stage = byClass(panel, 'decoration-stage');
  const samples = byClass(panel, 'decoration-samples');
  const original = samples.children[0];
  assert.equal(standard.getAttribute('aria-pressed'), 'true');

  pointer(rampart, 'pointerenter');
  assert.match(caption.textContent, /Рубеж Протектората/);
  assert.notEqual(samples.children[0], original);
  assert.equal(frames.current(), 'standard');
  pointer(rampart, 'pointerleave');
  assert.match(caption.textContent, /Стандартные рамки/);

  rampart.focus();
  assert.match(caption.textContent, /Рубеж Протектората/);
  framesTab.focus();
  assert.match(caption.textContent, /Стандартные рамки/);
  press(rampart);
  assert.equal(root.dataset.cardFrameChoice, 'protectorate-rampart');
  assert.equal(stored.get('gatefall.card-frame'), 'protectorate-rampart');
  assert.equal(rampart.getAttribute('aria-pressed'), 'true');
  assert.equal(standard.getAttribute('aria-pressed'), 'false');
  pointer(vines, 'pointerenter');
  pointer(vines, 'pointerleave');
  assert.match(caption.textContent, /Рубеж Протектората/);

  press(fieldsTab);
  const [, wood, metal] = fieldOptions.children;
  pointer(wood, 'pointerenter');
  assert.match(stage.style.backgroundImage, /battlefield-wood\.webp/);
  assert.equal(fields.current(), 'standard');
  pointer(wood, 'pointerleave');
  assert.match(stage.style.backgroundImage, /home-nebula\.webp/);
  press(wood);
  assert.equal(stored.get('gatefall.battlefield'), 'wood');
  assert.equal(wood.getAttribute('aria-pressed'), 'true');
  stored.set('gatefall.battlefield', 'metal');
  fields.refresh();
  emit('decorations-change');
  assert.equal(metal.getAttribute('aria-pressed'), 'true');
  assert.match(stage.style.backgroundImage, /battlefield-metal\.webp/);
});

test('the flagship bridge follows metal and uses its WebP in the preview and on the board', (t) => {
  const { panel, root, fields, stored } = fixture(t);
  const [, fieldsTab] = byRole(panel, 'tab');
  const [, fieldOptions] = byRole(panel, 'tabpanel');
  press(fieldsTab);
  const [, , metal, bridge, newYear] = fieldOptions.children;
  assert.equal(byClass(metal, 'decoration-name').textContent, 'Тактический стол');
  assert.equal(byClass(bridge, 'decoration-name').textContent, 'Мостик флагмана');
  assert.equal(byClass(newYear, 'decoration-name').textContent, 'Новогодний стол');
  assert.match(byClass(bridge, 'decoration-field').src, /battlefield-bridge\.webp/);
  press(bridge);
  assert.equal(fields.current(), 'bridge');
  assert.equal(root.dataset.battlefieldChoice, 'bridge');
  assert.equal(stored.get('gatefall.battlefield'), 'bridge');
  assert.match(byClass(panel, 'decoration-stage').style.backgroundImage, /battlefield-bridge\.webp/);

  const css = readFileSync(new URL('../../docs/decorations.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-battlefield-choice="bridge"\]\) \.match-board \{[^}]+url\('\.\/art\/battlefield-bridge\.webp'\)/);
  const art = readFileSync(new URL('../../docs/art/battlefield-bridge.webp', import.meta.url));
  assert.equal(art.toString('ascii', 8, 12), 'WEBP');
  assert.ok(art.length <= 250_000);
});

test('locked options explain how to unlock and never select or persist', (t) => {
  const { panel, frames, stored } = fixture(t, {
    frameChoices: [
      { id: 'standard', name: 'Стандартные рамки' },
      { id: 'growth-vines', name: 'Лозы Поросли', locked: true },
    ],
  });
  const locked = byRole(panel, 'tabpanel')[0].children[1];
  assert.equal(locked.getAttribute('aria-disabled'), 'true');
  assert.equal(byClass(locked, 'decoration-unlock').textContent, 'Откроется в Книге наград');
  press(locked);
  assert.equal(locked.getAttribute('aria-pressed'), 'false');
  assert.equal(frames.current(), 'standard');
  assert.equal(stored.size, 0);
});

test('a storage error keeps the current choice and explains that it is temporary', (t) => {
  const { panel, frames } = fixture(t, undefined, { writable: false });
  const rampart = byRole(panel, 'tabpanel')[0].children[1];
  press(rampart);
  assert.equal(frames.current(), 'protectorate-rampart');
  assert.equal(rampart.getAttribute('aria-pressed'), 'true');
  assert.equal(byRole(panel, 'status')[0].textContent, 'Выбор действует до перезагрузки.');
});
