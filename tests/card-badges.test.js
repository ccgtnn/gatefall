import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../docs/game/cards.js';

class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.classList = {
      add: (name) => { this.className += ' ' + name; },
      toggle: (name, on) => { if (on) this.classList.add(name); },
    };
  }

  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
}

globalThis.document = {
  body: new TestElement('body'),
  createElement: (tag) => new TestElement(tag),
  createElementNS: (_, tag) => new TestElement(tag),
};
const { decorateCard, preview, showCard } = await import('../docs/ui/cards.js');
const { orderBadge } = await import('../docs/ui/stat-badges.js');
const decks = [...NEUTRAL_CARDS, ...FACTIONS.protectorate.pool, ...FACTIONS.growth.pool];
const makeCard = (id) => createCard(id, decks.find((entry) => entry.id === id));
const tree = (root) => [root, ...root.children.flatMap(tree)];
const byClass = (node, name) => tree(node).find((child) => child.className.split(' ').includes(name));
const drawable = (id, options) => {
  const node = new TestElement('button');
  decorateCard(node, makeCard(id), {}, options);
  return node;
};

test('live battlefield and hand faces hide provision, while catalog and preview show it', () => {
  const field = drawable('bastion', { orderOnField: false });
  const hand = drawable('bastion');
  const catalog = drawable('bastion', { showProvision: true });
  assert.equal(byClass(field, 'stat-badge-provision'), undefined);
  assert.equal(byClass(hand, 'stat-badge-provision'), undefined);
  assert.equal(byClass(catalog, 'stat-badge-provision').children[1].textContent, 11);
  assert.ok(byClass(catalog, 'stat-badge-armor'));
  assert.equal(catalog.dataset.rarity, 'gold');
  showCard(makeCard('bastion'));
  assert.ok(byClass(preview, 'stat-badge-provision'));
  showCard(makeCard('bastion'), { showProvision: false });
  assert.equal(byClass(preview, 'stat-badge-provision'), undefined);
});

test('scenario progress renders filled diamonds and the wing marker is absent', () => {
  const card = makeCard('spore-season');
  card.chapter = 2;
  const face = new TestElement('button');
  decorateCard(face, card, {});
  const chapters = byClass(face, 'stat-badge-chapters');
  assert.deepEqual(tree(chapters).filter(({ tag }) => tag === 'use')
    .map(({ attributes }) => attributes.href.split('#')[1]),
  ['chapter-filled', 'chapter-filled', 'chapter-empty']);
  assert.equal(byClass(face, 'stat-badge-rarity'), undefined);
});

test('Orders keep their ready and cooldown states, with one overlay for the field control', () => {
  assert.equal(byClass(drawable('commander', { orderOnField: true }), 'stat-badge-order'), undefined);
  const ready = orderBadge(true, 0, 'Приказ готов');
  const cooldown = orderBadge(false, 2, 'Осталось 2 хода');
  assert.equal(ready.children[0].children[0].attributes.href.split('#')[1], 'order-ready');
  assert.equal(ready.children.length, 1);
  assert.equal(cooldown.children[0].children[0].attributes.href.split('#')[1], 'order-cooldown');
  assert.equal(cooldown.children[1].textContent, 2);
});
