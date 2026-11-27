import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards/cards.js';
import { AWAKENING, LARGE_TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { CAPTAIN_CARDS } from '../../docs/game/cards/factions/captains.js';

import { TestElement, byClass, decorateCard, drawable, makeCard, orderBadge, preview, showCard, tree } from '../helpers/card-badges.js';

test('catalog thumbnails stay lazy when switching back from premium art', async () => {
  const { selectPremiumArt } = await import('../../docs/ui/card-art.js');
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

test('premium selection updates existing copies and persists independently for both cards', async () => {
  const id = 'synaptic-parasite';
  const devourer = 'carrion-devourer';
  const { PREMIUM_ART_KEY, selectPremiumArt } = await import('../../docs/ui/card-art.js');
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

    const restored = await import('../../docs/ui/card-art.js?test-reload');
    assert.ok(restored.usesPremiumArt(id) && restored.usesPremiumArt(devourer));
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(byClass(drawable(id), 'card-art-crop').tag, 'img');
    const app = { dataset: { animationSpeed: 'normal' } };
    document.getElementById = () => app;
    assert.ok(byClass(drawable(id), 'card-art-video'));
    app.dataset.animationSpeed = 'fast';
    assert.ok(byClass(drawable(id), 'card-art-video'));
    delete document.getElementById;
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
    delete document.getElementById;
    delete globalThis.matchMedia;
  }
});

test('a global premium setting clears exceptions and updates existing copies', async () => {
  const { premiumArtEnabled, selectPremiumArt, setPremiumArtEnabled, usesPremiumArt } = await import('../../docs/ui/card-art.js');
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
  const { PREMIUM_ART_KEY } = await import('../../docs/ui/card-art.js');
  const saved = new Map([[PREMIUM_ART_KEY, JSON.stringify(['world-gates'])]]);
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  try {
    const legacy = await import('../../docs/ui/card-art.js?test-legacy');
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

    const restored = await import('../../docs/ui/card-art.js?test-global-reload');
    assert.equal(restored.premiumArtEnabled(), true);
    assert.equal(restored.usesPremiumArt('world-gates'), false);
    assert.equal(restored.usesPremiumArt('falura'), true);
  } finally {
    delete globalThis.localStorage;
  }
});

test('World Gates uses its own premium clips on the small and full card faces', async () => {
  const id = 'world-gates';
  const { selectPremiumArt } = await import('../../docs/ui/card-art.js');
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
      await access(new URL(`../../docs/art/${file}`, import.meta.url));
    }
  } finally {
    selectPremiumArt(id, false);
    document.body.replaceChildren(preview);
  }
});

test('Plague cards use their own static and premium art on both faces', async () => {
  const { cardArt } = await import('../../docs/ui/card-art.js');
  for (const id of ['plague-leviathan', 'plague-sower']) {
    const { definition } = makeCard(id);
    for (const [fullArt, poster, clip] of [[false, '-crop.webp', '-card.mp4'], [true, '.webp', '-preview.mp4']]) {
      const still = cardArt(definition, 'card-art-crop', { fullArt, animated: false });
      assert.equal(still.src, './art/' + id + poster);
      const video = cardArt(definition, 'card-art-crop', { fullArt, animated: true });
      assert.equal(video.src, './art/' + id + clip);
      assert.equal(video.poster, still.src);
      assert.ok(video.loop && video.muted && video.playsInline);
    }
  }
});

test('filtered or moved video resumes after layout only while it is visible and attached', async () => {
  const { resumeCardVideos } = await import('../../docs/ui/card-art.js');
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

test('premium art toggles and media fallback preserve the small-card crop', async () => {
  const { cardArt, selectPremiumArt } = await import('../../docs/ui/card-art.js');
  const wrap = new TestElement('div');
  const definition = { ...makeCard('world-gates').definition, artFocus: '25% 35%', artZoom: 1.4 };
  document.body.append(wrap);
  try {
    selectPremiumArt(definition.id, false);
    wrap.append(cardArt(definition, 'card-art-crop'));
    selectPremiumArt(definition.id, true);
    const video = wrap.children[0];
    assert.equal(video.tag, 'video');
    assert.deepEqual(video.style, { objectPosition: '25% 35%', transformOrigin: '25% 35%', scale: '1.4' });
    video.listeners.error();
    assert.equal(wrap.children[0].tag, 'img');
    assert.deepEqual(wrap.children[0].style, video.style);
    selectPremiumArt(definition.id, false);
    assert.deepEqual(wrap.children[0].style, video.style);
  } finally {
    selectPremiumArt(definition.id, false);
    document.body.children.splice(document.body.children.indexOf(wrap), 1);
  }
});

test('card choice dialogs show static art for premium cards from the hand', async () => {
  const { setPremiumArtEnabled } = await import('../../docs/ui/card-art.js');
  const { createFieldChoices } = await import('../../docs/ui/field-choices.js');
  const ids = ['forbidden-scroll-keeper', 'abyss-shepherd', 'great-sacrifice'];
  const hand = ids.map((id) => createCard(id, FACTIONS.choir.pool.find((card) => card.id === id)));
  setPremiumArtEnabled(true);
  try {
    for (const card of hand) {
      const inHand = new TestElement('button');
      decorateCard(inHand, card, {});
      assert.ok(byClass(inHand, 'card-art-video'));
    }
    const { deckChoice } = createFieldChoices({ playHuman() {} });
    const panel = deckChoice({ pending: { pile: 'hand', kind: 'hand-return', options: hand.map(({ id }) => id),
      prompt: 'Верни карту из руки в колоду' }, players: { human: { hand } } });
    const choices = byClass(panel, 'deck-choice-cards').children;
    assert.equal(choices.length, ids.length);
    for (const [index, choice] of choices.entries()) {
      const art = byClass(choice, 'card-art-crop');
      const { artCrop, art: full } = hand[index].definition;
      assert.equal(art.tag, 'img');
      assert.equal(art.src, './art/' + (artCrop ?? full));
    }
  } finally {
    setPremiumArtEnabled(false);
  }
});
