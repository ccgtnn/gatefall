import { element } from './dom.js';
import { CARD_TYPES, NEUTRAL, RARITY_LABELS } from '../game/shared/card-metadata.js';
import { FACTION_CATALOG } from '../game/cards/faction-catalog.js';
import { basePower, cardType, isUnit, statusCount } from '../game/engine/board.js';
import { resourceIcon } from './resource-icon.js';
import { deathwishDefinitions } from '../game/engine/events.js';
import { orderBadge, scenarioBadge, statBadge } from './stat-badges.js';
import { addCardCrop } from './card-art.js';

const keywordIcons = {
  'Неуязвимость': '◈',
  'Броня': '⬟',
  'Стойкость': '⛨',
  'Урон': '✷',
  'Порождение': '✦',
  'Поглощение': '◉',
  'Завещание': '†',
  'Огненный шторм': '🔥',
  'Приказ': '⚑',
  'Рвение': 'ϟ',
  'Конец хода': '◷',
};

function keywordsFor(card) {
  const { definition } = card;
  const words = new Set(definition.keywords);
  words.delete('Стойкость');
  if (card.resilient) words.add('Стойкость');
  if (definition.endTurn) words.add('Конец хода');
  return [...words].filter((word) => keywordIcons[word]);
}

function passiveBadge(status) {
  const badge = element('span', 'card-state', keywordIcons[status] ?? '○');
  badge.title = status;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', status);
  return badge;
}

function factionMark(faction) {
  const badge = element('span', 'card-faction-mark');
  badge.title = faction === NEUTRAL ? 'Нейтральная' : FACTION_CATALOG[faction].name;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', badge.title);
  badge.append(resourceIcon(faction, true));
  return badge;
}

export function decorateCard(node, card, player, { orderOnField = false,
  showProvision = false, showFaction = false, fullArt = false, lazyArt = false, staticArt = false, orderReady = false, orderCooldown = 0, frame } = {}) {
  const { definition } = card;
  const type = cardType(card);
  node.dataset.type = type;
  if (definition.accent) node.dataset.accent = definition.accent;
  if (definition.enemySide) node.dataset.enemySide = 'true';
  node.dataset.faction = definition.faction === NEUTRAL ? NEUTRAL : player.factionId ?? '';
  if (showFaction) {
    const faction = Object.hasOwn(FACTION_CATALOG, definition.faction) ? definition.faction : NEUTRAL;
    node.dataset.faction = faction;
    node.dataset.factionMark = '';
    node.append(factionMark(faction));
  }
  node.setAttribute('aria-label', cardLabel(card, showProvision));
  node.dataset.cardFace = '';
  if (frame) node.dataset.cardFrame = frame;
  liveBadges(node, card, { orderOnField, showProvision, orderReady, orderCooldown });
  if (statusCount(card, 'target')) node.append(statBadge('target', 'Отмечен Целью'));
  if (definition.categories?.length) node.append(element('span', 'card-category', definition.categories.join(' · ')));
  const alternateArt = definition.artStates?.[card.artState];
  const artwork = alternateArt ? { ...definition, art: alternateArt, artCrop: alternateArt } : definition;
  addCardCrop(node, artwork, { fullArt, lazyArt, staticArt });
  if (!definition.art) node.append(element('span', 'card-art-placeholder', definition.name));
}

export function psionicCountLabel(card) {
  const { countPlayedEffects, finalChapterMinimum } = card.definition.scenario;
  return `Сыграно эффектов «${countPlayedEffects}»: ${card.playedEffects ?? 0} / ${finalChapterMinimum}`;
}

export function growthValue(card) {
  return card.growth === undefined ? undefined : card.growth + (card.definition.growth.base ?? 0);
}

function liveBadges(node, card, { orderOnField, showProvision, orderReady, orderCooldown }) {
  const { definition, armor, counter, timer } = card;
  if (isUnit(card)) {
    const base = basePower(card);
    const power = statBadge('power', `Сила ${card.power} · база ${base}`, card.power);
    power.classList.add('unit-power');
    power.classList.toggle('power-boosted', card.power > base);
    power.classList.toggle('power-damaged', card.power < base);
    node.append(power);
  }
  if (armor) {
    const mark = statBadge('armor', 'Броня ' + armor, armor);
    mark.classList.add('armor-stat');
    node.append(mark);
  }
  if (showProvision && definition.provision !== undefined) {
    node.append(statBadge('provision', 'Провизия ' + definition.provision, definition.provision));
  }
  if (definition.scenario) node.append(scenarioBadge(card.chapter ?? 0, definition.scenario.chapters.length));
  else if (!isUnit(card)) node.append(element('span', 'card-kind', cardType(card) === 'artifact' ? '◇' : '✦'));
  if (definition.scenario?.countPlayedEffects) {
    const counter = element('span', 'scenario-play-count', `${card.playedEffects ?? 0}/${definition.scenario.finalChapterMinimum}`);
    counter.title = psionicCountLabel(card);
    node.append(counter);
  }
  const infection = statusCount(card, 'infection');
  if (infection) node.append(statBadge('infection', 'Заражение ' + infection, infection));

  const wishes = card.inheritedDeathwishes ?? [];
  if (wishes.some(({ grantedBy, deathwish }) => grantedBy &&
      deathwish.steps.some(({ effect }) => effect === 'firestorm'))) {
    const mark = passiveBadge('Огненный шторм');
    mark.classList.add('weather-deathwish-mark');
    node.append(mark);
  }
  if (statusCount(card, 'lock')) {
    node.append(statBadge('lock', 'Блокировка'));
    return;
  }
  const badges = [];
  const growth = growthValue(card);
  if (growth !== undefined) badges.push(statBadge('hourglass', definition.growth.label + ': ' + growth, growth));
  if (counter > 0) {
    const badge = statBadge('hourglass', 'Счётчик ' + counter, counter);
    badge.classList.add('counter-stat');
    badges.push(badge);
  }
  if (timer > 0) badges.push(statBadge('hourglass', 'Таймер ' + timer, timer));
  if (definition.order && !orderOnField) {
    const label = orderReady ? 'Приказ готов' : orderCooldown ? 'Перезарядка Приказа: ' + orderCooldown : 'Приказ';
    badges.push(orderBadge(orderReady, orderCooldown, card.orderCharges === undefined
      ? label : label + ' · Осталось зарядов: ' + card.orderCharges, card.orderCharges));
  }
  if (deathwishDefinitions(card).some(({ grantedBy }) => !grantedBy)) badges.push(passiveBadge('Завещание'));
  if (card.resilient) badges.push(passiveBadge('Стойкость'));
  if (statusCount(card, 'immune')) badges.push(passiveBadge('Неуязвимость'));
  if (statusCount(card, 'doomed')) badges.push(passiveBadge('Обречённая'));
  if (definition.endTurn) badges.push(passiveBadge('Конец хода'));
  if (!badges.length) return;
  if (badges.length === 1 && !orderOnField) {
    node.append(badges[0]);
  } else {
    const badgesRow = element('span', 'card-timing-badges');
    badgesRow.classList.toggle('is-above-order', orderOnField);
    badgesRow.append(...badges);
    node.append(badgesRow);
  }
}

function cardLabel(card, showProvision) {
  const { definition, power, armor, timer, counter } = card;
  const details = [definition.name, definition.scenario ? 'Сценарий' : CARD_TYPES[cardType(card)]];
  if (definition.faction === NEUTRAL) details.push('Нейтральная');
  details.push(...(definition.categories ?? []));
  if (definition.scenario) details.push(`главы ${card.chapter ?? 0}/${definition.scenario.chapters.length}`);
  if (definition.scenario?.countPlayedEffects) details.push(psionicCountLabel(card));
  if (definition.enemySide) details.push('на сторону противника');
  if (isUnit(card)) details.push(`сила ${power}`);
  if (armor) details.push(`броня ${armor}`);
  if (definition.rarity) details.push(RARITY_LABELS[definition.rarity]);
  if (showProvision && definition.provision !== undefined) details.push(`провизия ${definition.provision}`);
  if (statusCount(card, 'target')) details.push('Отмечен Целью');
  if (statusCount(card, 'doomed')) details.push('Обречённая');
  const infection = statusCount(card, 'infection');
  if (infection) details.push('Заражение ' + infection);
  if (statusCount(card, 'lock')) details.push('Блокировка');
  else {
    if (deathwishDefinitions(card).length) details.push('Завещание');
    if (counter > 0) details.push(`счётчик ${counter}`);
    if (timer !== undefined) details.push(`таймер ${timer}`);
    details.push(...keywordsFor(card).filter((word) => word !== 'Завещание' && (word !== 'Броня' || !armor)));
  }
  return details.join(' · ');
}
