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

test('the flagship bridge and heart of growth share their board layout and use separate art', (t) => {
  const { panel, root, fields, stored } = fixture(t);
  const [, fieldsTab] = byRole(panel, 'tab');
  const [, fieldOptions] = byRole(panel, 'tabpanel');
  press(fieldsTab);
  const [, , metal, bridge, newYear, growth] = fieldOptions.children;
  assert.equal(byClass(metal, 'decoration-name').textContent, 'Тактический стол');
  assert.equal(byClass(newYear, 'decoration-name').textContent, 'Новогодний стол');

  for (const [option, id, name] of [
    [bridge, 'bridge', 'Мостик флагмана'],
    [growth, 'heart-of-growth', 'Сердце Поросли'],
  ]) {
    const artFile = `battlefield-${id}.webp`;
    assert.equal(byClass(option, 'decoration-name').textContent, name);
    assert.ok(byClass(option, 'decoration-field').src.includes(artFile));
    press(option);
    assert.equal(fields.current(), id);
    assert.equal(root.dataset.battlefieldChoice, id);
    assert.equal(stored.get('gatefall.battlefield'), id);
    assert.ok(byClass(panel, 'decoration-stage').style.backgroundImage.includes(artFile));
    const art = readFileSync(new URL('../../docs/art/' + artFile, import.meta.url));
    assert.equal(art.toString('ascii', 8, 12), 'WEBP');
    assert.ok(art.length <= 250_000);
  }

  const css = readFileSync(new URL('../../docs/decorations.css', import.meta.url), 'utf8');
  assert.match(css, /"bridge"\], \[data-battlefield-choice="heart-of-growth"\]\) \.match-board \{[^}]+url\('\.\/art\/battlefield-bridge\.webp'\)/);
  assert.match(css, /\[data-battlefield-choice="heart-of-growth"\]\) \.match-board \{[^}]+--battlefield-art: url\('\.\/art\/battlefield-heart-of-growth\.webp'\)/);
  assert.match(css, /"bridge"\], \[data-battlefield-choice="heart-of-growth"\]\) \.field-right \{[^}]+background: rgb\(8 14 28 \/ 0\.62\);[^}]+backdrop-filter: blur\(4px\);/);
  assert.match(css, /"bridge"\], \[data-battlefield-choice="heart-of-growth"\]\) \.field-left \{[^}]+justify-items: center;[^}]+padding-inline: 28% 0;/);
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

test('card backs: each faction picks standard, its improved Reward Book back or the neutral one once bought', async (t) => {
  const { createCardBackPreferences, CARD_BACK_STORAGE_KEY } = await import('../../docs/ui/decorations.js');
  const { cardBack, useCardBacks } = await import('../../docs/ui/card-back.js');
  const stored = new Map();
  const storage = { getItem: (item) => stored.get(item), setItem: (item, value) => stored.set(item, value) };
  const bought = new Set();
  const backs = createCardBackPreferences(storage, (id) => bought.has(id));
  assert.deepEqual(backs.factions, ['protectorate', 'growth', 'choir', 'captains']);
  for (const faction of backs.factions) {
    assert.deepEqual(backs.choices(faction).map(({ id, locked }) => [id, Boolean(locked)]), [['standard', false], ['improved', true], ['neutral', true]]);
  }
  assert.equal(backs.select('choir', 'improved'), false);
  bought.add(backs.choices('choir')[1].reward);
  assert.equal(backs.select('choir', 'improved'), true);
  assert.deepEqual(JSON.parse(stored.get(CARD_BACK_STORAGE_KEY)), { choir: 'improved' });
  assert.equal(backs.current('growth'), 'standard');
  useCardBacks(backs.art);
  t.after(() => useCardBacks(() => undefined));
  assert.match(cardBack('choir').src, /back-choir-improved\.webp/);
  assert.match(cardBack('growth').src, /back-growth\.webp/);
  assert.match(cardBack('choir', 'booster-card-back', null).src, /back-choir\.webp/, 'booster covers keep the faction back');
  bought.clear();
  assert.equal(backs.current('choir'), 'standard');

  const scope = new AbortController();
  t.after(() => scope.abort());
  const root = new Node('main');
  const panel = decorationsScreen(new Node('p'), createFramePreferences(storage, root), createBattlefieldPreferences(storage, root),
    () => {}, scope.signal, { cardBacks: backs });
  assert.equal(byRole(panel, 'tab').length, 3);
  const backOptions = byRole(panel, 'tabpanel')[2];
  assert.equal(backOptions.children.length, 12);
  assert.equal(backOptions.children[0].getAttribute('aria-pressed'), 'true');
  assert.equal(backOptions.children[1].getAttribute('aria-disabled'), 'true');
});
