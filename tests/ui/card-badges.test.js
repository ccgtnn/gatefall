import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCard } from '../../docs/game/board.js';
import { FACTIONS, NEUTRAL_CARDS } from '../../docs/game/cards.js';
import { AWAKENING, LARGE_TENTACLE } from '../../docs/game/choir.js';
import { CAPTAIN_CARDS } from '../../docs/game/captains.js';

import { TestElement, byClass, decorateCard, drawable, makeCard, orderBadge, preview, showCard, tree } from '../helpers/card-badges.js';

test('scenario progress renders filled diamonds and the wing marker is absent', () => {
  const card = makeCard('spore-season');
  card.chapter = 2;
  const face = new TestElement('button');
  decorateCard(face, card, {});
  const chapters = byClass(face, 'stat-badge-chapters');
  assert.deepEqual(tree(chapters).filter(({ tag }) => tag === 'use')
    .map(({ attributes }) => attributes.href.split('#')[1]),
  ['chapter-filled', 'chapter-filled']);
  assert.equal(byClass(face, 'stat-badge-rarity'), undefined);
});

test('Vine and Spore Sac display their accumulated growth on the card', () => {
  for (const [id, shown, label] of [['vine', 2, 'n'], ['spore-sac', 3, 'Сила будущей личинки']]) {
    const card = makeCard(id);
    card.growth = 2;
    const face = new TestElement('button');
    decorateCard(face, card, {});
    const badge = byClass(face, 'stat-badge-hourglass');
    assert.equal(badge.children.at(-1).textContent, shown);
    assert.equal(badge.attributes['aria-label'], label + ': ' + shown);
  }
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
  const face = new TestElement('button');
  decorateCard(face, card, {}, { orderOnField: true });
  const lock = byClass(face, 'stat-badge-lock');
  assert.equal(lock.attributes['aria-label'], 'Блокировка');
  assert.match(lock.children[0].children[0].attributes.href, /#lock$/);
  assert.ok(byClass(face, 'stat-badge-target'));
  assert.ok(byClass(face, 'stat-badge-infection'));
  assert.equal(byClass(face, 'stat-badge-order'), undefined);
  assert.equal(byClass(face, 'stat-badge-hourglass'), undefined);
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

test('a field Order leaves room for the card counter, timer and Deathwish', () => {
  const template = FACTIONS.choir.pool.find(({ order, type }) => order && type === 'unit');
  const card = createCard('marked', { ...template, counter: { amount: 3 }, timer: 2,
    deathwish: { steps: [] } });
  const face = new TestElement('button');
  decorateCard(face, card, {}, { orderOnField: true });
  const badges = byClass(face, 'card-timing-badges');
  assert.match(badges.className, /is-above-order/);
  assert.deepEqual(badges.children.map((node) => node.attributes['aria-label']), ['Счётчик 3', 'Таймер 2', 'Завещание']);
  assert.equal(byClass(face, 'stat-badge-order'), undefined);
});
