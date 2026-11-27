import { createCard } from '../../docs/game/engine/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards/cards.js';
import { CAPTAIN_CARDS } from '../../docs/game/cards/factions/captains.js';

export class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = {
      add: (name) => { this.className += ' ' + name; },
      toggle: (name, on) => { if (on) this.classList.add(name); },
    };
  }

  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll(selector) { return selector === '[data-premium-card]' ? tree(this).filter(({ dataset }) => dataset.premiumCard) : []; }
  replaceWith(node) { this.parent.children[this.parent.children.indexOf(this)] = node; node.parent = this.parent; }
  append(...children) {
    for (const child of children) child.parent = this;
    this.children.push(...children);
  }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
  focus(options) { this.focusOptions = options; }
}

globalThis.document = {
  body: new TestElement('body'),
  createElement: (tag) => new TestElement(tag),
  createElementNS: (_, tag) => new TestElement(tag),
  querySelectorAll: (selector) => document.body.querySelectorAll(selector),
};
export const { decorateCard, preview, showCard } = await import('../../docs/ui/cards.js');
export const { orderBadge } = await import('../../docs/ui/stat-badges.js');
export const decks = [...NEUTRAL_CARDS, ...FACTIONS.protectorate.pool, ...FACTIONS.growth.pool, ...CAPTAIN_CARDS];
export const makeCard = (id) => createCard(id, decks.find((entry) => entry.id === id));
export const tree = (root) => [root, ...root.children.flatMap(tree)];
export const byClass = (node, name) => tree(node).find((child) => child.className.split(' ').includes(name));
export const drawable = (id, options) => {
  const node = new TestElement('button');
  decorateCard(node, makeCard(id), {}, options);
  return node;
};
