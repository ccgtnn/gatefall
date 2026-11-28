import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards/cards.js';
import { AWAKENING, LARGE_TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { CAPTAIN_CARDS } from '../../docs/game/cards/factions/captains.js';

import { TestElement, byClass, decorateCard, drawable, makeCard, orderBadge, preview, showCard, tree } from '../helpers/card-badges.js';

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

test('Awakening has no Psionics tag, shows full art and live scenario counter', () => {
  const card = createCard(AWAKENING.id, AWAKENING);
  card.playedEffects = 6;
  showCard(card);
  assert.ok(tree(preview).filter(({ className }) => String(className ?? '').includes('card-category'))
    .every(({ textContent }) => textContent !== 'Псионика'));
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

