import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard } from '../../docs/game/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { AWAKENING, LARGE_TENTACLE } from '../../docs/game/choir.js';
import { CAPTAIN_CARDS } from '../../docs/game/captains.js';

import { TestElement, byClass, decorateCard, drawable, makeCard, orderBadge, preview, showCard, tree } from '../helpers/card-badges.js';

test('live cards follow the selected frame while explicit preview frames keep rarity', () => {
  const bastion = drawable('bastion');
  assert.equal(bastion.dataset.cardFace, '');
  assert.equal(bastion.dataset.cardFrame, undefined);
  assert.equal(bastion.dataset.rarity, 'gold');
  assert.equal(drawable('imperial-golem').dataset.cardFace, '');

  showCard(makeCard('bastion'), { frame: 'protectorate-rampart' });
  const face = byClass(preview, 'preview-card-face');
  assert.equal(face.dataset.cardFrame, 'protectorate-rampart');
  assert.equal(face.dataset.rarity, 'gold');
});

test('frame preferences persist, refresh and restore the standard selection', async () => {
  const { createFramePreferences, FRAME_STORAGE_KEY } = await import('../../docs/ui/decorations.js');
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
    await import('../../docs/ui/decorations.js');
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

