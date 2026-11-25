import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard } from '../docs/game/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../docs/game/cards.js';
import { AWAKENING, LARGE_TENTACLE } from '../docs/game/choir.js';
import { CAPTAIN_CARDS } from '../docs/game/captains.js';

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
const decks = [...NEUTRAL_CARDS, ...FACTIONS.protectorate.pool, ...FACTIONS.growth.pool, ...CAPTAIN_CARDS];
const makeCard = (id) => createCard(id, decks.find((entry) => entry.id === id));
const tree = (root) => [root, ...root.children.flatMap(tree)];
const byClass = (node, name) => tree(node).find((child) => child.className.split(' ').includes(name));
const drawable = (id, options) => {
  const node = new TestElement('button');
  decorateCard(node, makeCard(id), {}, options);
  return node;
};

test('catalog thumbnails stay lazy when switching back from premium art', async () => {
  const { selectPremiumArt } = await import('../docs/ui/card-art.js');
  const catalog = drawable('world-gates', { lazyArt: true });
  const hand = drawable('world-gates');
  document.body.append(catalog, hand);
  try {
    assert.equal(byClass(catalog, 'card-art-crop').loading, 'lazy');
    assert.equal(byClass(hand, 'card-art-crop').loading, undefined);
    selectPremiumArt('world-gates', true);
    assert.equal(byClass(catalog, 'card-art-crop').tag, 'video');
    selectPremiumArt('world-gates', false);
    assert.equal(byClass(catalog, 'card-art-crop').loading, 'lazy');
    assert.equal(byClass(hand, 'card-art-crop').loading, undefined);
  } finally {
    selectPremiumArt('world-gates', false);
    document.body.replaceChildren(preview);
  }
});

test('turret shows the default art and switches its face only when replay marks it as failing', () => {
  const card = makeCard('broken-turret');
  assert.equal(byClass(drawable('broken-turret'), 'card-art-crop').src, './art/broken-turret.webp');
  showCard(card);
  assert.equal(byClass(preview, 'card-art-crop').src, './art/broken-turret.webp');
  card.artState = 'failing';
  const field = new TestElement('button');
  decorateCard(field, card, {});
  assert.equal(byClass(field, 'card-art-crop').src, './art/broken-turret-failing.webp');
});

test('catalog and detail faces show the printed faction and keep Hound categories as text', () => {
  for (const [id, faction] of [['bastion', 'protectorate'], ['cocoon', 'growth'],
    ['hound-foreman', 'captains'], ['fugitive-monk', 'neutral']]) {
    const catalog = drawable(id, { showProvision: true, showFaction: true });
    showCard(makeCard(id));
    for (const face of [catalog, byClass(preview, 'preview-card-face')]) {
      const badge = byClass(face, 'card-faction-mark');
      const icon = tree(badge).find(({ tag }) => tag === 'use');
      assert.equal(face.dataset.faction, faction);
      assert.equal(icon.attributes.href.split('#').at(-1), faction);
      assert.ok(byClass(face, 'stat-badge-provision'));
      if (faction === 'captains') {
        const category = byClass(face, 'card-category');
        assert.equal(category.textContent, 'Гончая');
        assert.deepEqual(category.children, []);
      }
    }
    assert.equal(byClass(drawable(id), 'card-faction-mark'), undefined);
  }
});

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
  const { PREMIUM_ART_KEY, selectPremiumArt } = await import('../docs/ui/card-art.js');
  const saved = new Map();
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const face = drawable(id);
  const other = drawable(devourer);
  document.body.append(face, other);
  try {
    assert.equal(byClass(face, 'card-art-crop').tag, 'img');
    showCard(makeCard(id));
    const [regular, premium] = byClass(preview, 'preview-art-versions').children;
    assert.equal(regular.textContent, 'Обычная');
    assert.equal(premium.textContent, 'Премиальная');
    assert.equal(regular.attributes['aria-pressed'], 'true');
    assert.equal(premium.attributes['aria-pressed'], 'false');
    premium.listeners.click();
    assert.equal(regular.attributes['aria-pressed'], 'false');
    assert.equal(premium.attributes['aria-pressed'], 'true');
    const video = byClass(face, 'card-art-video');
    assert.equal(video.src, './art/synaptic-parasite-hand.mp4');
    assert.equal(video.poster, './art/synaptic-parasite.webp');
    assert.ok(video.autoplay && video.muted && video.loop && video.playsInline);
    assert.equal(byClass(preview, 'card-art-video').src, './art/synaptic-parasite-preview.mp4');
    assert.equal(byClass(other, 'card-art-crop').tag, 'img');
    selectPremiumArt(devourer, true);
    assert.equal(byClass(other, 'card-art-video').src, './art/carrion-devourer-card.mp4');
    assert.deepEqual(JSON.parse(saved.get(PREMIUM_ART_KEY)), { enabled: false, overrides: { [id]: true, [devourer]: true } });

    const restored = await import('../docs/ui/card-art.js?test-reload');
    assert.ok(restored.usesPremiumArt(id) && restored.usesPremiumArt(devourer));
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(byClass(drawable(id), 'card-art-crop').tag, 'img');
    delete globalThis.matchMedia;
    regular.listeners.click();
    assert.equal(regular.attributes['aria-pressed'], 'true');
    assert.equal(byClass(face, 'card-art-crop').tag, 'img');
    assert.ok(byClass(other, 'card-art-video'));
    showCard(makeCard('bastion'));
    assert.equal(byClass(preview, 'preview-art-versions'), undefined);
  } finally {
    selectPremiumArt(id, false);
    selectPremiumArt(devourer, false);
    document.body.replaceChildren(preview);
    delete globalThis.localStorage;
    delete globalThis.matchMedia;
  }
});

test('a global premium setting clears exceptions and updates existing copies', async () => {
  const { premiumArtEnabled, selectPremiumArt, setPremiumArtEnabled, usesPremiumArt } = await import('../docs/ui/card-art.js');
  const worldGates = drawable('world-gates');
  const falura = drawable('falura');
  document.body.append(worldGates, falura);
  try {
    selectPremiumArt('world-gates', true);
    assert.equal(premiumArtEnabled(), false);
    assert.equal(byClass(worldGates, 'card-art-crop').tag, 'video');

    setPremiumArtEnabled(true);
    assert.equal(premiumArtEnabled(), true);
    assert.equal(byClass(falura, 'card-art-crop').tag, 'video');
    assert.equal(usesPremiumArt('bastion'), false);
    assert.equal(usesPremiumArt('ulmarin-awakening'), true);
    selectPremiumArt('world-gates', false);
    assert.equal(byClass(worldGates, 'card-art-crop').tag, 'img');
    assert.equal(byClass(falura, 'card-art-crop').tag, 'video');

    setPremiumArtEnabled(false);
    assert.equal(byClass(falura, 'card-art-crop').tag, 'img');
    setPremiumArtEnabled(true);
    assert.equal(byClass(worldGates, 'card-art-crop').tag, 'video');
  } finally {
    setPremiumArtEnabled(false);
    document.body.replaceChildren(preview);
  }
});

test('legacy enabled cards become exceptions to the default and negative overrides survive reload', async () => {
  const { PREMIUM_ART_KEY } = await import('../docs/ui/card-art.js');
  const saved = new Map([[PREMIUM_ART_KEY, JSON.stringify(['world-gates'])]]);
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  try {
    const legacy = await import('../docs/ui/card-art.js?test-legacy');
    assert.equal(legacy.premiumArtEnabled(), false);
    assert.equal(legacy.usesPremiumArt('world-gates'), true);
    assert.equal(legacy.usesPremiumArt('falura'), false);

    legacy.selectPremiumArt('falura', true);
    assert.deepEqual(JSON.parse(saved.get(PREMIUM_ART_KEY)),
      { enabled: false, overrides: { 'world-gates': true, falura: true } });

    legacy.setPremiumArtEnabled(true);
    legacy.selectPremiumArt('world-gates', false);
    assert.deepEqual(JSON.parse(saved.get(PREMIUM_ART_KEY)),
      { enabled: true, overrides: { 'world-gates': false } });

    const restored = await import('../docs/ui/card-art.js?test-global-reload');
    assert.equal(restored.premiumArtEnabled(), true);
    assert.equal(restored.usesPremiumArt('world-gates'), false);
    assert.equal(restored.usesPremiumArt('falura'), true);
  } finally {
    delete globalThis.localStorage;
  }
});

test('World Gates uses its own premium clips on the small and full card faces', async () => {
  const id = 'world-gates';
  const { selectPremiumArt } = await import('../docs/ui/card-art.js');
  const face = drawable(id);
  document.body.append(face);
  try {
    showCard(makeCard(id));
    assert.equal(byClass(face, 'card-art-crop').src, './art/world-gates.webp');
    const [, premium] = byClass(preview, 'preview-art-versions').children;
    premium.listeners.click();
    for (const [root, file] of [[face, 'world-gates-card.mp4'], [preview, 'world-gates-preview.mp4']]) {
      const video = byClass(root, 'card-art-video');
      assert.equal(video.src, `./art/${file}`);
      assert.ok(video.loop && video.muted && video.playsInline);
      await access(new URL(`../docs/art/${file}`, import.meta.url));
    }
  } finally {
    selectPremiumArt(id, false);
    document.body.replaceChildren(preview);
  }
});

test('filtered or moved video resumes after layout only while it is visible and attached', async () => {
  const { resumeCardVideos } = await import('../docs/ui/card-art.js');
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

test('charged Orders show the remaining uses, including zero', () => {
  const generator = makeCard('shield-generator');
  generator.orderCharges = 0;
  showCard(generator);
  const badge = byClass(preview, 'stat-badge-order');
  assert.equal(badge.attributes['aria-label'], 'Приказ · Осталось зарядов: 0');
  assert.equal(badge.children.at(-1).textContent, 0);
  assert.match(byClass(preview, 'preview-stats').textContent, /Осталось зарядов: 0/);
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

test('Awakening shows its Psionics tag, full art and live scenario counter', () => {
  const card = createCard(AWAKENING.id, AWAKENING);
  card.playedEffects = 6;
  showCard(card);
  assert.equal(byClass(preview, 'card-category').textContent, 'Псионика');
  assert.equal(byClass(preview, 'scenario-play-count').textContent, '6/7');
  assert.match(byClass(preview, 'preview-details').textContent, /Сценарий.*Безмолвный хор/);
  assert.equal(byClass(preview, 'card-art-crop').src, './art/' + AWAKENING.art);
});

test('scenario details link to each granted card and tokens have a frame', () => {
  showCard(createCard(AWAKENING.id, AWAKENING));
  const related = byClass(preview, 'preview-related');
  const faces = tree(related).filter(({ dataset }) => dataset.cardId);
  assert.deepEqual(faces.map(({ dataset }) => dataset.cardId), [
    'ulmarin-fanatic', LARGE_TENTACLE.id, 'ulmarin-sleeper',
  ]);
  faces.find(({ dataset }) => dataset.cardId === LARGE_TENTACLE.id).listeners.click();
  assert.equal(byClass(preview, 'preview-card-face').dataset.rarity, 'bronze');
  assert.match(byClass(preview, 'preview-details').textContent, /Токен/);
  assert.equal(byClass(preview, 'card-art-crop').src, './art/' + LARGE_TENTACLE.art);
  byClass(preview, 'preview-back').listeners.click();
  assert.equal(byClass(preview, 'card-art-crop').src, './art/' + AWAKENING.art);
});

test('creation previews list matching possibilities only after expansion', () => {
  const effect = FACTIONS.choir.pool.find(({ id }) => id === 'sleeper-revelation');
  showCard(createCard(effect.id, effect));
  const options = byClass(preview, 'preview-related-options');
  assert.equal(options.children.length, 1);
  options.open = true;
  options.listeners.toggle();
  const choices = tree(byClass(options, 'preview-related')).filter(({ dataset }) => dataset.cardId);
  assert.ok(choices.some(({ dataset }) => dataset.cardId === 'annihilation'));
  assert.ok(choices.every(({ dataset }) => dataset.cardId !== effect.id && dataset.type === 'effect' && dataset.rarity === 'gold'));
});
