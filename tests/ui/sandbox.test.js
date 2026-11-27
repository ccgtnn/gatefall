import assert from 'node:assert/strict';
import test from 'node:test';

import { TestNode } from '../helpers/test-node.js';

const body = new TestNode('body');
globalThis.document = {
  body,
  createElement(tag) {
    const node = new TestNode(tag);
    node.remove = () => {
      if (!node.parent) return;
      node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = undefined;
    };
    return node;
  },
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
const { findCardDefinition } = await import('../../docs/game/cards/card-registry.js');

test('sandbox builds every section for every faction without writes or fixture errors', () => {
  const root = new TestNode('main');
  root.id = 'sandbox';
  body.append(root);
  const page = createSandboxPage(root);
  assert.equal(root.querySelectorAll('[data-section]').length, 5);

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

test('every animation scenario runs at zero duration for each playable faction without storage writes', async () => {
  const { FACTIONS } = await import('../../docs/game/cards/cards.js');
  const { motionGroups } = await import('../../docs/ui/sandbox/motion-scenarios.js');
  const root = new TestNode('main');
  body.append(root);
  const { builders: { motion } } = createSandboxPage(root);
  const cases = motionGroups.flatMap(([, items]) => items);
  const choiceCounts = { 'offer-three': 3, 'offer-all': 10, 'offer-discard': 3 };
  const roundWinners = { 'round-win': 'human', 'round-loss': 'bot', 'round-draw': null };
  motion.speed.value = 'off';
  for (const faction of Object.keys(FACTIONS)) {
    motion.update(faction);
    for (const scenario of cases) {
      await motion.run(scenario, async () => {});
      const state = motion.state();
      const label = faction + ' · ' + scenario.id;
      assert.ok(state.log.length || scenario.id === 'coin', label);
      if (scenario.id in choiceCounts) {
        assert.equal(state.pending?.options.length, choiceCounts[scenario.id], label);
        assert.ok(motion.section.querySelector('.deck-offer'), label);
      }
      if (scenario.id in roundWinners) {
        assert.equal(state.log.find(({ type }) => type === 'round-end')?.winner, roundWinners[scenario.id], label);
      }
      assert.ok(motion.section.querySelector('.match-board'), label);
    }
  }
  await motion.runAll(async () => {});
  assert.equal(motion.state().pending?.pile, 'discard');
  motion.section.querySelector('.deck-offer').querySelector('.effect-target').dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(motion.state().pending?.kind, 'deck-placement');
  assert.ok(motion.section.querySelector('.target-prompt'));
  assert.equal(motion.section.querySelector('#app').dataset.reducedMotion, 'true');
  assert.equal(storageWrites, 0);
});
