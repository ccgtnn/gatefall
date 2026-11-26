import assert from 'node:assert/strict';
import test from 'node:test';

class TestNode extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) classes.add(name);
        this.className = [...classes].join(' ');
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(' ');
      },
      toggle: (name, force) => {
        const has = this.classList.contains(name);
        const enabled = force ?? !has;
        if (enabled) this.classList.add(name);
        else this.classList.remove(name);
        return enabled;
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  get isConnected() {
    let node = this;
    while (node.parent) node = node.parent;
    return node === document.body;
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
  }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parent = undefined;
    this.children = [];
    this.append(...nodes);
  }
  replaceWith(node) {
    const index = this.parent.children.indexOf(this);
    node.parent = this.parent;
    this.parent.children[index] = node;
    this.parent = undefined;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  toggleAttribute(key, force) {
    const enabled = force ?? !(key in this.attributes);
    if (enabled) this.setAttribute(key, '');
    else this.removeAttribute(key);
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (/^\.[\w-]+(?:\.[\w-]+)*$/.test(selector)) {
      return selector.slice(1).split('.').every((name) => this.classList.contains(name));
    }
    const attribute = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (attribute) {
      const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.dataset[key] !== undefined && (attribute[2] === undefined || this.dataset[key] === attribute[2]);
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}

const body = new TestNode('body');
globalThis.document = {
  body,
  createElement: (tag) => new TestNode(tag),
  createElementNS: (_namespace, tag) => new TestNode(tag),
  querySelector: () => null,
  querySelectorAll: (selector) => body.querySelectorAll(selector),
  getElementById: () => null,
};
let storageWrites = 0;
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => { storageWrites += 1; },
};
globalThis.matchMedia = () => ({ matches: false });

const { createSandboxPage } = await import('../../docs/ui/sandbox/app.js');
await import('../../docs/ui/sandbox/index.js');
const { factionOptions, factionCards, defaultCardId } = await import('../../docs/ui/sandbox/fixtures.js');
const { findCardDefinition } = await import('../../docs/game/card-registry.js');

test('sandbox builds every section for every faction without writes or fixture errors', () => {
  const root = new TestNode('main');
  root.id = 'sandbox';
  body.append(root);
  const page = createSandboxPage(root);
  assert.equal(root.querySelectorAll('[data-section]').length, 4);

  for (const [factionId] of factionOptions) {
    const definitions = factionCards(factionId);
    page.builders.card.update(factionId, findCardDefinition(defaultCardId(factionId)));
    page.builders.row.update(factionId);
    page.builders.rewards.update(factionId);
    page.builders.grid.update(factionId);
    assert.equal(page.builders.row.section.querySelectorAll('.slot.filled').length, 9);
    assert.equal(page.builders.row.section.querySelector('.opponent-passed').textContent, 'ПАС');
    assert.ok(page.builders.row.section.querySelector('.row-effect-badge'));
    assert.equal(page.builders.rewards.section.querySelectorAll('.booster-card-slot').length, 5);
    assert.equal(page.builders.rewards.section.querySelector('.sandbox-inline-dialog').open, true);
    assert.equal(page.builders.grid.section.querySelectorAll('.catalog-entry').length, definitions.length);
  }

  page.builders.card.update('protectorate', findCardDefinition('commander'));
  const card = page.builders.card.section;
  for (const state of ['hand', 'field', 'ordinary', 'armor', 'shield', 'infection', 'lock', 'target',
    'counter', 'order-ready', 'order-cooldown', 'order-charges', 'boosted', 'weakened']) {
    assert.ok(card.querySelector(`[data-state="${state}"]`), state);
  }
  assert.ok(card.querySelector('.force-shield-aura'));
  assert.ok(card.querySelector('.power-boosted'));
  assert.ok(card.querySelector('.power-damaged'));

  page.builders.card.update('choir', findCardDefinition('abyss-shepherd'));
  const premium = page.builders.card.section.querySelector('[data-state="premium"]');
  assert.equal(premium.querySelector('.card-art-crop').tag, 'video');
  assert.equal(storageWrites, 0);
});
