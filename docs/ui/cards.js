import { dialogClose } from './resources.js';
import { button, element, setCardRarity } from './dom.js';
import { KEYWORDS } from '../game/card-keywords.js';
import { CARD_TYPES, NEUTRAL, RARITY_LABELS, ROW_LABELS } from '../game/card-metadata.js';
import { FACTION_CATALOG } from '../game/faction-catalog.js';
import { basePower, cardType, createCard, isUnit, statusCount } from '../game/board.js';
import { relatedEffectCards } from '../game/effect-piles.js';
import { resourceIcon } from './resource-icon.js';

import { deathwishDefinitions } from '../game/events.js';
import { orderBadge, scenarioBadge, statBadge } from './stat-badges.js';

import { addCardCrop, cardArt, hasPremiumArt, selectPremiumArt, usesPremiumArt } from './card-art.js';
export { addCardCrop, cardArt } from './card-art.js';

export const preview = document.createElement('dialog');
preview.className = 'card-preview panel';
preview.setAttribute('aria-labelledby', 'preview-title');
document.body.append(preview);
preview.addEventListener('click', (event) => {
  if (event.target === preview) preview.close();
});
preview.addEventListener('close', () => {
  if (!preview.open) preview.querySelector('.card-art-video')?.pause();
});
export function showCard(card, options = {}) {
  const { leader = false, legacy = false, orderReady = false, orderCooldown = 0, actions, frame, back } = options;
  const { definition, power, armor, timer, counter } = card;
  setCardRarity(preview, definition.rarity);
  const faction = definition.faction === NEUTRAL ? 'Нейтральная' : FACTION_CATALOG[definition.faction]?.name;
  const details = leader ? ['Лидер'] : [definition.scenario ? 'Сценарий' : CARD_TYPES[cardType(card)], faction, RARITY_LABELS[definition.rarity],
    definition.stratagem ? 'Стратагема' : definition.token ? 'Токен' : definition.provision === undefined ? ''
      : `Провизия ${definition.provision}`].filter(Boolean);
  details.push(...(definition.categories ?? []));
  if (definition.shipClass) details.push(definition.shipClass);
  const stats = [];
  if (definition.scenario) stats.push(`Главы ${card.chapter ?? 0}/${definition.scenario.chapters.length}`);
  if (definition.scenario?.countPlayedEffects) stats.push(psionicCountLabel(card));
  const infection = statusCount(card, 'infection');
  const marked = statusCount(card, 'target');
  const locked = statusCount(card, 'lock');
  if (marked) stats.push('Цель');
  if (infection) stats.push('Заражение ' + infection);
  const hasShield = statusCount(card, 'shield');
  if (hasShield || card.statuses?.shield === 0) {
    stats.push(hasShield ? 'Щит активен' : 'Щит сбит');
  }
  if (!leader && isUnit(card)) {
    const base = basePower(card);
    stats.push(power === base ? `Сила ${power}` : `Сила / база ${power} / ${base}`, `Броня ${armor ?? 0}`);
  }
  if (locked) stats.push('Блокировка');
  if (card.orderCharges !== undefined) stats.push('Осталось зарядов: ' + card.orderCharges);
  if (growthValue(card) !== undefined) stats.push(card.definition.growth.label + ': ' + growthValue(card));
  if (!locked && counter > 0) stats.push(`Счётчик ${counter}`);
  if (!locked && timer !== undefined) stats.push(`Таймер ${timer}`);
  const title = element('h2', null, definition.name);
  title.id = 'preview-title';
  title.tabIndex = -1;
  title.autofocus = true;
  const body = element('div', 'preview-body');
  if (definition.accent) body.dataset.accent = definition.accent;
  if (back) body.append(button('Назад к карте', back, 'button preview-back'));
  body.append(title, element('p', 'muted preview-details', details.join(' · ')));
  if (hasPremiumArt(definition.id)) {
    const versions = element('div', 'preview-art-versions');
    versions.setAttribute('role', 'group');
    versions.setAttribute('aria-label', 'Версия карты');
    const choices = [[false, 'Обычная'], [true, 'Премиальная']].map(([enabled, label]) =>
      [enabled, button(label, () => {
        selectPremiumArt(definition.id, enabled);
        syncVersions();
      })]);
    function syncVersions() {
      for (const [enabled, choice] of choices) {
        choice.setAttribute('aria-pressed', String(enabled === usesPremiumArt(definition.id)));
      }
    }
    syncVersions();
    versions.append(...choices.map(([, choice]) => choice));
    body.append(versions);
  }
  if (stats.length) body.append(element('p', 'preview-stats', stats.join(' · ')));
  body.append(element('p', 'preview-effect', definition.text || 'Без эффекта.'));
  const { fixed, possible } = relatedEffectCards(definition);
  const backToCard = () => showCard(card, options);
  if (fixed.length) body.append(relatedCards(fixed, backToCard));
  if (possible.length) {
    const choices = element('details', 'preview-related-options');
    choices.append(element('summary', null, 'Возможные карты'));
    choices.addEventListener('toggle', () => {
      if (choices.open && choices.children.length === 1) choices.append(relatedCards(possible, backToCard));
    });
    body.append(choices);
  }
  if (!locked && card.inheritedDeathwishes?.length) {
    const wishes = element('ul');
    wishes.append(...card.inheritedDeathwishes.map(({ name }) => element('li', null, name)));
    body.append(element('p', 'preview-stats', 'Полученные Завещания'), wishes);
  }
  const glossaryWords = new Set([...(definition.keywords ?? []), ...(definition.categories ?? [])]);
  if (deathwishDefinitions(card).length) glossaryWords.add('Завещание');
  if (marked) glossaryWords.add('Цель');
  if (locked) glossaryWords.add('Блокировка');
  if (infection || definition.id === 'carrier') glossaryWords.add('Заражение');
  if (hasShield || card.statuses?.shield === 0) glossaryWords.add('Силовой щит');
  if (definition.endTurn) glossaryWords.add('Конец хода');
  if (definition.order) glossaryWords.add('Приказ');
  const explanations = [...glossaryWords].filter((word) => Object.hasOwn(KEYWORDS, word))
    .map((word) => [word, KEYWORDS[word]]);
  const orderRow = ROW_LABELS[definition.order?.sourceRow];
  if (orderRow) explanations.push([orderRow, 'Приказ доступен, пока карта находится в этом ряду.']);
  if (actions) body.append(actions);

  const layout = element('div', 'preview-layout');
  if (!leader && !legacy) {
    const face = element('div', 'preview-card-face');
    decorateCard(face, card, { factionId: definition.faction }, { showProvision: !definition.token, showFaction: true, fullArt: true, orderReady, orderCooldown, frame });
    layout.append(face);
  } else if (definition.art) {
    layout.append(cardArt(definition, 'preview-art', { fullArt: true }));
  }
  layout.append(body);
  if (explanations.length) {
    const glossary = element('aside', 'preview-glossary');
    const label = element('h3', null, 'Ключевые слова');
    const list = element('dl', 'preview-keywords');
    for (const [keyword, explanation] of explanations) {
      const entry = element('div', 'preview-keyword');
      entry.append(element('dt', null, keyword), element('dd', null, explanation));
      list.append(entry);
    }
    glossary.append(label, list);
    layout.append(glossary);
  }
  preview.replaceChildren(dialogClose(preview, 'preview-close'), layout);
  if (!preview.open) preview.showModal();
  else title.focus({ preventScroll: true });
  preview.scrollTop = 0;
}

function relatedCards(definitions, back) {
  const list = element('div', 'preview-related');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Связанные карты');
  for (const definition of definitions) {
    const card = createCard(definition.id, definition);
    const entry = element('div', 'preview-related-entry');
    const face = button(undefined, () => showCard(card, { back }), 'hand-card');
    face.dataset.cardId = definition.id;
    decorateCard(face, card, { factionId: definition.faction },
      { showProvision: !definition.token, showFaction: true });
    entry.append(face, element('span', null, definition.name));
    list.append(entry);
  }
  return list;
}

export function cardInspection(node, card, placement = false, show = () => showCard(card)) {
  if (card.definition.text?.includes('\n')) node.title = card.definition.text;
  let holdTimer;
  let activated;
  let pendingClick;
  let firstX, firstY;
  function inspect(event) {
    event.preventDefault();
    clearTimeout(holdTimer);
    clearTimeout(pendingClick);
    if (node.isConnected) show();
  }
  node.addEventListener('dblclick', inspect);
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (event.pointerType !== 'touch' && !event.sourceCapabilities?.firesTouchEvents) inspect(event);
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) inspect(event);
  });
  if (!placement) {
    node.addEventListener('pointerdown', (event) => {
      activated = false;
      if (!event.isPrimary || event.pointerType !== 'touch') return;
      firstX = event.clientX;
      firstY = event.clientY;
      holdTimer = setTimeout(() => {
        activated = true;
        if (node.isConnected) show();
      }, 450);
    });
    node.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - firstX, event.clientY - firstY) > 6) clearTimeout(holdTimer);
    });
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
      node.addEventListener(end, () => clearTimeout(holdTimer));
    }
  }
  node.addEventListener('click', (event) => {
    if (activated || node.dataset.suppressClick) {
      event.stopImmediatePropagation();
      activated = false;
      delete node.dataset.suppressClick;
      return;
    }
    if (event.detail > 1) {
      clearTimeout(pendingClick);
      event.stopImmediatePropagation();
    } else if (event.detail === 1 && !node.hasAttribute('data-aim-target') && node.classList.contains('effect-target') && event.pointerType !== 'touch') {
      event.stopImmediatePropagation();
      pendingClick = setTimeout(() => {
        if (node.isConnected) node.click();
      }, 520);
    }
  }, { capture: true });
}

const keywordIcons = {
  'Неуязвимость': '◈',
  'Броня': '⬟',
  'Стойкость': '⛨',
  'Урон': '✷',
  'Порождение': '✦',
  'Поглощение': '◉',
  'Завещание': '†',
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

function bottomStatus(card) {
  if (deathwishDefinitions(card).length) return 'Завещание';
  if (card.resilient) return 'Стойкость';
  if (statusCount(card, 'immune')) return 'Неуязвимость';
  if (statusCount(card, 'doomed')) return 'Обречённая';
  if (card.definition.endTurn) return 'Конец хода';
}

function passiveBadge(card) {
  const status = bottomStatus(card);
  if (!status) return;
  const badge = element('span', 'card-state', keywordIcons[status] ?? '○');
  badge.title = status;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', status);
  return badge;
}

function cardStats(card) {
  const stats = element('span', 'card-stats');
  if (isUnit(card)) {
    const power = element('strong', 'unit-power', card.power);
    power.title = `Сила ${card.power} · база ${basePower(card)}`;
    power.classList.toggle('power-boosted', card.power > basePower(card));
    power.classList.toggle('power-damaged', card.power < basePower(card));
    stats.append(power);
  }
  if (card.armor) {
    const armor = element('strong', 'armor-stat', card.armor);
    armor.title = 'Броня ' + card.armor;
    stats.append(armor);
  }
  return stats;
}

function factionMark(faction) {
  const badge = element('span', 'card-faction-mark');
  badge.title = faction === NEUTRAL ? 'Нейтральная' : FACTION_CATALOG[faction].name;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', badge.title);
  badge.append(resourceIcon(faction, true));
  return badge;
}

export function decorateCard(node, card, player, { orderOnField = false, legacy = false,
  showProvision = false, showFaction = false, fullArt = false, lazyArt = false, orderReady = false, orderCooldown = 0, frame } = {}) {
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
  node.setAttribute('aria-label', cardLabel(card, legacy || showProvision));
  if (legacy) legacyBadges(node, card, orderOnField);
  else {
    node.dataset.cardFace = '';
    if (frame) node.dataset.cardFrame = frame;
    liveBadges(node, card, { orderOnField, showProvision, orderReady, orderCooldown });
  }
  if (statusCount(card, 'target')) node.append(statBadge('target', 'Отмечен Целью'));
  if (definition.categories?.length) node.append(element('span', 'card-category', definition.categories.join(' · ')));
  const alternateArt = definition.artStates?.[card.artState];
  const artwork = alternateArt ? { ...definition, art: alternateArt, artCrop: alternateArt } : definition;
  addCardCrop(node, artwork, { fullArt, lazyArt });
  if (!definition.art) node.append(element('span', 'card-art-placeholder', definition.name));
}

function psionicCountLabel(card) {
  const { countPlayedEffects, finalChapterMinimum } = card.definition.scenario;
  return `Сыграно эффектов «${countPlayedEffects}»: ${card.playedEffects ?? 0} / ${finalChapterMinimum}`;
}

function growthValue(card) {
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

  if (statusCount(card, 'lock')) {
    node.append(statBadge('lock', 'Блокировка'));
    return;
  }
  if (orderOnField) return;
  if (growthValue(card) !== undefined) {
    node.append(statBadge('hourglass', card.definition.growth.label + ': ' + growthValue(card), growthValue(card)));
  } else if (counter > 0 || timer !== undefined) {
    node.append(statBadge('hourglass', (timer === undefined ? 'Счётчик ' : 'Таймер ') + (timer ?? counter), timer ?? counter));
  } else if (definition.order) {
    const label = orderReady ? 'Приказ готов' : orderCooldown ? 'Перезарядка Приказа: ' + orderCooldown : 'Приказ';
    node.append(orderBadge(orderReady, orderCooldown, card.orderCharges === undefined
      ? label : label + ' · Осталось зарядов: ' + card.orderCharges, card.orderCharges));
  } else {
    const badge = passiveBadge(card);
    if (badge) node.append(badge);
  }
}

function legacyBadges(node, card, orderOnField) {
  const { definition, timer, counter } = card;
  const type = cardType(card);
  node.append(cardStats(card));
  if (type !== 'unit') {
    const scenario = definition.scenario;
    const mark = element('span', 'card-kind', scenario
      ? `${card.chapter ?? 0}/${scenario.chapters.length}` : type === 'artifact' ? '◇' : '✦');
    const complete = scenario && card.chapter === scenario.chapters.length;
    mark.classList.toggle('is-complete', Boolean(complete));
    mark.title = complete ? 'Все главы сыграны' : scenario ? 'Главы сценария' : CARD_TYPES[type];
    node.append(mark);
  }
  if (statusCount(card, 'lock')) node.append(statBadge('lock', 'Блокировка'));
  else if (!orderOnField) {
    if (growthValue(card) !== undefined) {
      node.append(statBadge('hourglass', card.definition.growth.label + ': ' + growthValue(card), growthValue(card)));
    } else if (counter > 0 || timer !== undefined) {
      node.append(statBadge('hourglass', (timer === undefined ? 'Счётчик ' : 'Таймер ') + (timer ?? counter), timer ?? counter));
    } else if (definition.order) {
      node.append(orderBadge(false, 0, card.orderCharges === undefined
        ? 'Приказ' : 'Приказ · Осталось зарядов: ' + card.orderCharges, card.orderCharges));
    } else {
      const badge = passiveBadge(card);
      if (badge) node.append(badge);
    }
  }
  const infection = statusCount(card, 'infection');
  if (infection) {
    const badge = element('span', 'infection-badge', infection);
    badge.title = 'Заражение ' + infection;
    node.append(badge);
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

export function cardButton(card, handler, player, placement = false, { showProvision = false, showFaction = false, lazyArt = false, inspect } = {}) {
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  decorateCard(node, card, player, { showProvision, showFaction, lazyArt });
  cardInspection(node, card, placement, inspect);
  return node;
}
