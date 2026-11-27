import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS } from '../../docs/game/cards/decks.js';
import { createLeague, leagueOpponent } from '../../docs/game/meta/league.js';
import { deckListItem, deckListScreen } from '../../docs/ui/deck-list.js';
import { createDeckStorage } from '../../docs/ui/deck-storage.js';
import { nextOpponent } from '../../docs/ui/league-opponent.js';

class Node extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.returnValue = '';
    this.style = {};
    this.classList = {
      add: (...names) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        names.forEach((name) => values.add(name));
        this.className = [...values].join(' ');
      },
      toggle: (name, force) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        const enabled = force ?? !values.has(name);
        if (enabled) values.add(name);
        else values.delete(name);
        this.className = [...values].join(' ');
        return enabled;
      },
      contains: (name) => this.className.split(' ').includes(name),
    };
  }

  append(...children) {
    for (const child of children) {
      if (child instanceof Node) child.parent = this;
      this.children.push(child);
      if (this.tag === 'select' && child instanceof Node && child.tag === 'option' && !this.value) this.value = child.value;
    }
  }
  prepend(...children) {
    const existing = this.children;
    this.children = [];
    this.append(...children, ...existing);
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  contains(target) { return target === this || this.children.some((child) => child instanceof Node && child.contains(target)); }
  focus() { document.activeElement = this; }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
  showModal() { this.open = true; }
  reset() {}
  close(value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
}

globalThis.document = new EventTarget();
document.createElement = (tag) => new Node(tag);
document.createElementNS = (_, tag) => new Node(tag);
document.body = new Node('body');
document.activeElement = document.body;
globalThis.window = new EventTarget();

const tree = (node) => [node, ...(node.children ?? []).filter((child) => child instanceof Node).flatMap(tree)];
const byClass = (node, name) => tree(node).find((entry) => entry.className.split(' ').includes(name));
const allByClass = (node, name) => tree(node).filter((entry) => entry.className.split(' ').includes(name));
const label = (node) => [node.textContent ?? '', ...(node.children ?? []).map((entry) =>
  entry instanceof Node ? label(entry) : entry)].join('');
const press = (node) => node.dispatchEvent(new Event('click'));
const menuButton = (menu, text) => tree(menu).find((node) => node.tag === 'button' && label(node) === text);

function itemFixture(signal, { primary = false, preset = false } = {}) {
  const source = PRESETS[0];
  const deck = preset ? source : { ...source, id: 'custom', name: 'Моя колода' };
  const calls = [];
  const actions = Object.fromEntries(['setPrimary', 'edit', 'copy', 'export', 'remove']
    .map((name) => [name, (value) => calls.push([name, value.id])]));
  const view = deckListItem(deck, undefined, actions, primary, signal);
  return { deck, calls, ...view };
}

test('deck cards open the editor and expose actions through one keyboard-friendly menu', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const first = itemFixture(scope.signal);
  const second = itemFixture(scope.signal);
  const trigger = byClass(first.item, 'deck-card-menu-trigger');
  const menu = byClass(first.item, 'deck-card-menu-popover');
  assert.equal(trigger.attributes['aria-label'], 'Действия: Моя колода');
  assert.equal(menuButton(menu, 'Играть'), undefined);
  press(first.item);
  assert.deepEqual(first.calls, [['edit', 'custom']]);

  press(trigger);
  assert.equal(menu.hidden, false);
  assert.equal(trigger.attributes['aria-expanded'], 'true');
  assert.equal(document.activeElement, menuButton(menu, 'Сделать основной'));
  press(byClass(second.item, 'deck-card-menu-trigger'));
  assert.equal(menu.hidden, true);
  assert.equal(byClass(second.item, 'deck-card-menu-popover').hidden, false);
  document.dispatchEvent(new Event('click'));
  assert.equal(byClass(second.item, 'deck-card-menu-popover').hidden, true);

  press(trigger);
  const down = new Event('keydown');
  down.key = 'ArrowDown';
  menu.dispatchEvent(down);
  assert.equal(document.activeElement, menuButton(menu, 'Редактировать'));
  press(document.activeElement);
  assert.deepEqual(first.calls.at(-1), ['edit', 'custom']);
  assert.equal(menu.hidden, true);

  press(trigger);
  press(menuButton(menu, 'Сделать основной'));
  press(trigger);
  press(menuButton(menu, 'Копировать'));
  press(trigger);
  press(menuButton(menu, 'Экспорт JSON'));
  assert.deepEqual(first.calls.slice(-3), [['setPrimary', 'custom'], ['copy', 'custom'], ['export', 'custom']]);

  press(trigger);
  const escape = new Event('keydown');
  escape.key = 'Escape';
  document.dispatchEvent(escape);
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, trigger);
});

test('primary cards are labelled and presets have no delete action', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const primary = itemFixture(scope.signal, { primary: true });
  assert.equal(label(byClass(primary.item, 'deck-primary-badge')), '★ Основная');
  const primaryMenu = byClass(primary.item, 'deck-card-menu-popover');
  assert.equal(menuButton(primaryMenu, 'Основная ✓').disabled, true);
  const preset = itemFixture(scope.signal, { preset: true });
  const presetMenu = byClass(preset.item, 'deck-card-menu-popover');
  assert.equal(menuButton(presetMenu, 'Удалить'), undefined);
  assert.ok(menuButton(presetMenu, 'Редактировать'));
  assert.ok(menuButton(presetMenu, 'Копировать'));
});

test('delete confirmation can cancel without changes or confirm exactly one removal', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  document.body.replaceChildren();
  const { deck, calls, item } = itemFixture(scope.signal);
  const trigger = byClass(item, 'deck-card-menu-trigger');
  const menu = byClass(item, 'deck-card-menu-popover');
  press(trigger);
  press(menuButton(menu, 'Удалить'));
  let dialog = byClass(document.body, 'deck-delete-dialog');
  assert.equal(label(dialog).includes(`Удалить колоду „${deck.name}“?`), true);
  press(menuButton(dialog, 'Отмена'));
  assert.deepEqual(calls, []);
  assert.equal(byClass(document.body, 'deck-delete-dialog'), undefined);

  press(trigger);
  press(menuButton(menu, 'Удалить'));
  dialog = byClass(document.body, 'deck-delete-dialog');
  press(menuButton(dialog, 'Удалить'));
  assert.deepEqual(calls, [['remove', deck.id]]);
  assert.equal(byClass(document.body, 'deck-delete-dialog'), undefined);
});

test('the primary custom deck is the first card in All Decks', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = createDeckStorage(storage);
  const own = { ...PRESETS[0], id: 'own', name: 'Первая своя' };
  const primary = { ...PRESETS[1], id: 'primary', name: 'Основная своя' };
  store.save(own);
  store.save(primary);
  store.setPrimary(primary.id);
  const owned = Object.fromEntries(PRESETS.flatMap((deck) => deck.cardIds).map((id) => [id, 99]));
  const noop = () => {};
  const screen = deckListScreen(new Node('p'), store.list(), { get: () => ({ win: 0, loss: 0 }) }, {
    notice: '', back: noop, create: noop, edit: noop, copy: noop, importJson: noop, onImported: noop,
    primary: store.primary, setPrimary: noop, remove: noop,
  }, () => ({ owned }), scope.signal);
  const cards = allByClass(screen, 'deck-list-item');
  assert.equal(cards[0].attributes['aria-label'], 'Редактировать: Основная своя');
  assert.equal(label(byClass(cards[0], 'deck-primary-badge')), '★ Основная');
  assert.equal(cards[1].attributes['aria-label'], 'Редактировать: Первая своя');
});

test('the deck toolbar puts transfers in a keyboard-friendly menu', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const noop = () => {};
  const render = (decks) => deckListScreen(new Node('p'), decks, { get: () => ({ win: 0, loss: 0 }) }, {
    notice: '', back: noop, create: noop, edit: noop, copy: noop, importJson: noop, onImported: noop,
  }, () => ({ owned: {} }), scope.signal);
  const screen = render([]);
  const toolbar = byClass(screen, 'all-decks-toolbar');
  const controls = byClass(toolbar, 'deck-toolbar-controls');
  const root = byClass(toolbar, 'deck-transfer-menu');
  const menu = byClass(root, 'deck-card-menu-popover');
  const trigger = byClass(root, 'deck-card-menu-trigger');
  const importButton = menuButton(menu, 'Импорт JSON');
  const exportLabel = 'Экспорт всех своих колод';
  const dialog = tree(screen).find((node) => node.tag === 'dialog');
  assert.ok(menuButton(controls, 'Новая колода'));
  assert.equal(menuButton(controls, 'Импорт JSON'), undefined);
  assert.equal(menuButton(controls, exportLabel), undefined);
  assert.equal(trigger.getAttribute('aria-label'), 'Ещё');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(importButton.getAttribute('role'), 'menuitem');
  assert.equal(menu.hidden, true);
  assert.equal(menuButton(menu, exportLabel).disabled, true);

  press(trigger);
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, importButton);
  document.dispatchEvent(new Event('click'));
  assert.equal(menu.hidden, true);
  press(trigger);
  press(importButton);
  assert.equal(menu.hidden, true);
  assert.equal(dialog.open, true);
  dialog.close();

  const own = { ...PRESETS[0], id: 'own' };
  const filledRoot = byClass(render([own]), 'deck-transfer-menu');
  const filledMenu = byClass(filledRoot, 'deck-card-menu-popover');
  const filledTrigger = byClass(filledRoot, 'deck-card-menu-trigger');
  const exportButton = menuButton(filledMenu, exportLabel);
  assert.equal(exportButton.disabled, false);
  press(filledTrigger);
  const down = new Event('keydown');
  Object.defineProperty(down, 'key', { value: 'ArrowDown' });
  filledMenu.dispatchEvent(down);
  assert.equal(document.activeElement, exportButton);
  const escape = new Event('keydown');
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  document.dispatchEvent(escape);
  assert.equal(filledMenu.hidden, true);
  assert.equal(document.activeElement, filledTrigger);
});

test('editor has no deck deletion action and autosave still flushes changes', async (t) => {
  const { deckEditor } = await import('../../docs/ui/deck-editor.js');
  const scope = new AbortController();
  t.after(() => scope.abort());
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = createDeckStorage(storage);
  const deck = { ...PRESETS[0], id: 'editor-deck', name: 'Черновик' };
  store.save(deck);
  const owned = Object.fromEntries(deck.cardIds.map((id) => [id, 99]));
  const screen = deckEditor(new Node('p'), deck, {
    save: store.save,
    play() {},
    back() {},
    inventory: () => ({ owned }),
    notice: '',
    signal: scope.signal,
  });
  assert.equal(menuButton(screen, 'Удалить колоду'), undefined);
  const name = tree(screen).find((node) => node.tag === 'input' && node.type === 'text');
  name.value = 'Черновик названия';
  name.dispatchEvent(new Event('input'));
  scope.abort();
  assert.equal(store.get(deck.id).name, 'Черновик названия');
});

test('League selects the first primary deck by default and still accepts a manual choice', () => {
  const league = createLeague(0);
  const bot = leagueOpponent(league.season);
  const decks = [
    { ...PRESETS[0], id: 'primary', name: 'Основная' },
    { ...PRESETS[1], id: 'other', name: 'Другая' },
  ];
  let selected;
  const view = nextOpponent(bot, {
    active: false,
    season: league.season,
    league,
    ticket: 'ticket',
    actions: { decks: () => decks, gold: () => 100000, play() {}, concede() {} },
    busy: { active: false },
    submit: (task) => task(),
    openProfile() {},
    selectedDeck: 'deleted',
    setSelectedDeck: (id) => { selected = id; },
  });
  const picker = tree(view.opponent).find((node) => node.tag === 'select');
  assert.deepEqual(picker.children.map(({ value }) => value), ['primary', 'other']);
  assert.equal(picker.value, 'primary');
  picker.value = 'other';
  picker.dispatchEvent(new Event('change'));
  assert.equal(selected, 'other');
});
