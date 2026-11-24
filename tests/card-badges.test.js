import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../docs/game/cards.js';

class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.dataset = {};
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
  assert.equal(byClass(byClass(catalog, 'stat-badge-provision'), 'stat-badge-multiple-digits').textContent, 11);
  assert.ok(byClass(catalog, 'stat-badge-armor'));
  assert.equal(catalog.dataset.rarity, 'gold');
  showCard(makeCard('bastion'));
  assert.ok(byClass(preview, 'stat-badge-provision'));
  assert.match(byClass(preview, 'muted').textContent, /Провизия 11/);
});

test('premium selection updates existing copies and persists independently for both cards', async () => {
  const id = 'synaptic-parasite';
  const devourer = 'carrion-devourer';
  const { PREMIUM_ART_KEY, selectPremiumArt } = await import('../docs/ui/card-art.js?v=failura-1');
  const saved = new Map();
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const face = drawable(id);
  const other = drawable(devourer);
  document.body.append(face, other);
  try {
    assert.equal(byClass(face, 'card-art-crop').tag, 'img');
    showCard(makeCard(id));
    const choice = tree(preview).find(({ tag }) => tag === 'select');
    assert.equal(choice.value, 'regular');
    choice.value = 'premium';
    choice.listeners.change();
    const video = byClass(face, 'card-art-video');
    assert.equal(video.src, './art/synaptic-parasite-hand.mp4?v=loop-1');
    assert.equal(video.poster, './art/synaptic-parasite.webp');
    assert.ok(video.autoplay && video.muted && video.loop && video.playsInline);
    assert.equal(byClass(preview, 'card-art-video').src, './art/synaptic-parasite-preview.mp4?v=loop-1');
    assert.equal(byClass(other, 'card-art-crop').tag, 'img');
    selectPremiumArt(devourer, true);
    assert.equal(byClass(other, 'card-art-video').src, './art/carrion-devourer-card.mp4?v=loop-1');
    assert.deepEqual(JSON.parse(saved.get(PREMIUM_ART_KEY)), [id, devourer]);

    const restored = await import('../docs/ui/card-art.js?test-reload');
    assert.ok(restored.usesPremiumArt(id) && restored.usesPremiumArt(devourer));
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(byClass(drawable(id), 'card-art-crop').tag, 'img');
    delete globalThis.matchMedia;
    selectPremiumArt(id, false);
    assert.equal(byClass(face, 'card-art-crop').tag, 'img');
    assert.ok(byClass(other, 'card-art-video'));
    showCard(makeCard('bastion'));
    assert.equal(tree(preview).find(({ tag }) => tag === 'select'), undefined);
  } finally {
    selectPremiumArt(id, false);
    selectPremiumArt(devourer, false);
    document.body.replaceChildren(preview);
    delete globalThis.localStorage;
    delete globalThis.matchMedia;
  }
});

test('filtered or moved video resumes after layout only while it is visible and attached', async () => {
  const { resumeCardVideos } = await import('../docs/ui/card-art.js?v=failura-1');
  const frames = [];
  const played = [];
  const video = (name, isConnected, visible) => ({
    isConnected, getClientRects: () => visible ? [{}] : [],
    play: async () => { played.push(name); },
  });
  const result = [video('visible', true, true), video('detached', false, true), video('hidden', true, false)];
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    resumeCardVideos({ querySelectorAll: () => result });
    assert.deepEqual(played, []);
    frames[0]();
    assert.deepEqual(played, ['visible']);
  } finally {
    delete globalThis.requestAnimationFrame;
  }
});

test('card details start at the top and focus the title without scrolling the page', () => {
  preview.open = true;
  preview.scrollTop = 150;
  showCard(makeCard('spore-season'));
  const title = tree(preview).find(({ id }) => id === 'preview-title');
  assert.equal(title.autofocus, true);
  assert.equal(title.tabIndex, -1);
  assert.deepEqual(title.focusOptions, { preventScroll: true });
  assert.equal(preview.scrollTop, 0);
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

test('lock has its own icon alongside statuses and replaces disabled ability badges', () => {
  const card = makeCard('commander');
  card.statuses = { lock: 1, target: 1, infection: 2 };
  card.timer = 3;
  for (const legacy of [false, true]) {
    const face = new TestElement('button');
    decorateCard(face, card, {}, { legacy, orderOnField: true });
    const lock = byClass(face, 'stat-badge-lock');
    assert.equal(lock.attributes['aria-label'], 'Блокировка');
    assert.match(lock.children[0].children[0].attributes.href, /#lock$/);
    assert.ok(byClass(face, 'stat-badge-target'));
    assert.ok(byClass(face, legacy ? 'infection-badge' : 'stat-badge-infection'));
    assert.equal(byClass(face, 'stat-badge-order'), undefined);
    assert.equal(byClass(face, 'stat-badge-hourglass'), undefined);
  }
});

test('all rarities use numeric power plates and the shared provision hexagon', () => {
  for (const [id, rarity] of [['infantry', 'bronze'], ['helper-robot', 'epic'], ['imperial-golem', 'gold']]) {
    const card = makeCard(id);
    card.power += 2;
    showCard(card);
    const face = byClass(preview, 'preview-card-face');
    const power = byClass(face, 'stat-badge-power');
    const provision = byClass(face, 'stat-badge-provision');
    assert.equal(face.dataset.rarity, rarity);
    assert.deepEqual(power.children.map(({ tag }) => tag), ['strong']);
    assert.equal(power.children[0].textContent, card.power);
    assert.ok(byClass(power, 'power-boosted'));
    assert.match(provision.children[0].children[0].attributes.href, /#provision$/);
    assert.equal(provision.children[1].textContent, card.definition.provision);
  }
});

test('live cards follow the selected frame while explicit preview frames keep rarity', () => {
  const bastion = drawable('bastion');
  assert.equal(bastion.dataset.cardFace, '');
  assert.equal(bastion.dataset.cardFrame, undefined);
  assert.equal(bastion.dataset.rarity, 'gold');
  assert.equal(drawable('imperial-golem').dataset.cardFace, '');
  assert.equal(drawable('bastion', { legacy: true }).dataset.cardFace, undefined);

  showCard(makeCard('bastion'), { frame: 'protectorate-rampart' });
  const face = byClass(preview, 'preview-card-face');
  assert.equal(face.dataset.cardFrame, 'protectorate-rampart');
  assert.equal(face.dataset.rarity, 'gold');
});

test('frame preferences persist, refresh and restore the standard selection', async () => {
  const { createFramePreferences, FRAME_STORAGE_KEY } = await import('../docs/ui/decorations.js');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const root = { dataset: {} };
  const preferences = createFramePreferences(storage, root);
  assert.equal(preferences.current(), 'standard');
  assert.equal(preferences.select('protectorate-rampart'), true);
  assert.equal(root.dataset.cardFrameChoice, 'protectorate-rampart');
  assert.equal(createFramePreferences(storage, { dataset: {} }).current(), 'protectorate-rampart');
  assert.equal(preferences.select('unknown-frame'), false);
  assert.equal(root.dataset.cardFrameChoice, 'protectorate-rampart');
  assert.equal(preferences.select('growth-vines'), true);
  assert.equal(root.dataset.cardFrameChoice, 'growth-vines');
  assert.equal(createFramePreferences(storage, { dataset: {} }).current(), 'growth-vines');
  assert.equal(preferences.select('exemplars-crystal'), true);
  assert.equal(root.dataset.cardFrameChoice, 'exemplars-crystal');
  assert.equal(createFramePreferences(storage, { dataset: {} }).current(), 'exemplars-crystal');
  values.delete(FRAME_STORAGE_KEY);
  preferences.refresh();
  assert.equal(root.dataset.cardFrameChoice, 'standard');
});

test('the battlefield choice persists independently of the card frame', async () => {
  const { createBattlefieldPreferences, createFramePreferences, BATTLEFIELD_STORAGE_KEY, FRAME_STORAGE_KEY } =
    await import('../docs/ui/decorations.js');
  const values = new Map([[FRAME_STORAGE_KEY, 'protectorate-rampart']]);
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const root = { dataset: {} };
  createFramePreferences(storage, root);
  const battlefield = createBattlefieldPreferences(storage, root);
  assert.equal(battlefield.current(), 'standard');
  assert.equal(battlefield.select('wood'), true);
  assert.equal(createBattlefieldPreferences(storage, { dataset: {} }).current(), 'wood');
  assert.equal(root.dataset.battlefieldChoice, 'wood');
  assert.equal(root.dataset.cardFrameChoice, 'protectorate-rampart');
  assert.equal(values.get(FRAME_STORAGE_KEY), 'protectorate-rampart');
  values.delete(BATTLEFIELD_STORAGE_KEY);
  battlefield.refresh();
  assert.equal(root.dataset.battlefieldChoice, 'standard');
});
