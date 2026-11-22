import { dialogClose } from './resources.js?v=interface-polish-1';
import { button, element, setCardRarity } from './dom.js?v=opponent-reveal-1';
import { CARD_TYPES, KEYWORDS, NEUTRAL, RARITY_LABELS } from '../game/cards.js?v=rebirth-1';
import { basePower, cardType, isUnit, statusCount } from '../game/board.js?v=rebirth-1';

import { deathwishDefinitions } from '../game/events.js?v=rebirth-1';
import { orderBadge, scenarioBadge, statBadge } from './stat-badges.js?v=orbital-strike-1';

export const preview = document.createElement('dialog');
preview.className = 'card-preview panel';
preview.setAttribute('aria-labelledby', 'preview-title');
document.body.append(preview);
preview.addEventListener('click', (event) => {
  if (event.target === preview) preview.close();
});
export function cardArt(definition, className) {
  const image = element('img', className);
  const art = className === 'card-art-crop' ? definition.artCrop ?? definition.art : definition.art;
  image.src = './art/' + art;
  image.alt = '';
  image.width = 480;
  image.height = 720;
  image.draggable = false;
  return image;
}

export function addCardCrop(node, definition, { fullArt = false } = {}) {
  setCardRarity(node, definition.rarity);
  if (!definition.art) return;
  node.classList.add('has-art');
  node.prepend(cardArt(fullArt ? { ...definition, artCrop: undefined } : definition, 'card-art-crop'));
}

export function showCard(card, { leader = false, legacy = false,
  orderReady = false, orderCooldown = 0, actions } = {}) {
  const { definition, power, armor, timer, counter } = card;
  setCardRarity(preview, definition.rarity);
  const details = leader ? ['Лидер'] : [CARD_TYPES[cardType(card)], definition.faction === NEUTRAL && 'Нейтральная', RARITY_LABELS[definition.rarity],
    definition.stratagem ? 'Стратагема' : definition.provision === undefined ? 'Токен'
      : `Провизия ${definition.provision}`].filter(Boolean);
  details.push(...(definition.categories ?? []));
  const stats = [];
  if (definition.scenario) stats.push(`Главы ${card.chapter ?? 0}/${definition.scenario.chapters.length}`);
  const infection = statusCount(card, 'infection');
  const marked = statusCount(card, 'target');
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
  if (counter > 0) stats.push(`Счётчик ${counter}`);
  if (timer !== undefined) stats.push(`Таймер ${timer}`);
  const title = element('h2', null, definition.name);
  title.id = 'preview-title';
  title.tabIndex = -1;
  title.autofocus = true;
  const heading = element('div', 'preview-heading');
  heading.append(title, dialogClose(preview));
  const body = element('div', 'preview-body');
  if (definition.accent) body.dataset.accent = definition.accent;
  body.append(heading, element('p', 'muted', details.join(' · ')));
  if (stats.length) body.append(element('p', 'preview-stats', stats.join(' · ')));
  body.append(element('p', null, definition.text ?? 'Без эффекта.'));
  if (card.inheritedDeathwishes?.length) {
    const wishes = element('ul');
    wishes.append(...card.inheritedDeathwishes.map(({ name }) => element('li', null, name)));
    body.append(element('p', 'preview-stats', 'Полученные Завещания'), wishes);
  }
  const glossaryWords = new Set(definition.keywords);
  if (deathwishDefinitions(card).length) glossaryWords.add('Завещание');
  if (marked) glossaryWords.add('Цель');
  if (infection || definition.id === 'carrier') glossaryWords.add('Заражение');
  if (definition.endTurn) glossaryWords.add('Конец хода');
  if (glossaryWords.size) {
    const glossary = element('dl', 'preview-keywords');
    for (const keyword of glossaryWords) {
      glossary.append(element('dt', null, keyword), element('dd', null, KEYWORDS[keyword]));
    }
    body.append(glossary);
  }
  if (actions) body.append(actions);
  if (definition.art || (!leader && !legacy)) {
    const layout = element('div', 'preview-layout');
    let art;
    if (!leader && !legacy) {
      const face = element('div', 'preview-card-face');
      decorateCard(face, card, { factionId: definition.faction }, { showProvision: true, fullArt: true, orderReady, orderCooldown });
      art = face;
    } else art = cardArt(definition, 'preview-art');
    layout.append(art, body);
    preview.replaceChildren(layout);
  } else {
    preview.replaceChildren(body);
  }
  if (!preview.open) preview.showModal();
  else title.focus({ preventScroll: true });
  preview.scrollTop = 0;
}

export function cardInspection(node, card, placement = false, show = () => showCard(card)) {
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

export function decorateCard(node, card, player, { orderOnField = false, legacy = false,
  showProvision = false, fullArt = false, orderReady = false, orderCooldown = 0 } = {}) {
  const { definition } = card;
  const type = cardType(card);
  node.dataset.type = type;
  if (definition.accent) node.dataset.accent = definition.accent;
  if (definition.enemySide) node.dataset.enemySide = 'true';
  node.dataset.faction = definition.faction === NEUTRAL ? NEUTRAL : player.factionId ?? '';
  node.setAttribute('aria-label', cardLabel(card, legacy || showProvision));
  if (legacy) legacyBadges(node, card, orderOnField);
  else liveBadges(node, card, { orderOnField, showProvision, orderReady, orderCooldown });
  if (statusCount(card, 'target')) node.append(statBadge('target', 'Отмечен Целью'));
  if (definition.categories?.length) node.append(element('span', 'card-category', definition.categories.join(' · ')));
  addCardCrop(node, definition, { fullArt });
  if (!definition.art) node.append(element('span', 'card-art-placeholder', definition.name));
}

function liveBadges(node, card, { orderOnField, showProvision, orderReady, orderCooldown }) {
  const { definition, armor, counter, timer } = card;
  if (isUnit(card)) {
    const power = statBadge('power', `Сила ${card.power} · база ${basePower(card)}`, card.power);
    power.classList.add('unit-power');
    power.classList.toggle('power-boosted', card.power > basePower(card));
    power.classList.toggle('power-damaged', card.power < basePower(card));
    node.append(power);
  }
  if (armor) {
    const mark = statBadge('armor', 'Броня ' + armor, armor);
    mark.classList.add('armor-stat');
    node.append(mark);
  }
  if (showProvision && definition.provision !== undefined) node.append(statBadge('provision', 'Провизия ' + definition.provision, definition.provision));
  if (definition.scenario) node.append(scenarioBadge(card.chapter ?? 0, definition.scenario.chapters.length));
  else if (!isUnit(card)) node.append(element('span', 'card-kind', cardType(card) === 'artifact' ? '◇' : '✦'));
  const infection = statusCount(card, 'infection');
  if (infection) node.append(statBadge('infection', 'Заражение ' + infection, infection));

  if (orderOnField) return;
  if (counter > 0 || timer !== undefined) {
    node.append(statBadge('hourglass', (timer === undefined ? 'Счётчик ' : 'Таймер ') + (timer ?? counter), timer ?? counter));
  } else if (definition.order) {
    const label = orderReady ? 'Приказ готов' : orderCooldown ? 'Перезарядка Приказа: ' + orderCooldown : 'Приказ';
    node.append(orderBadge(orderReady, orderCooldown, label));
  } else {
    const word = card.resilient ? 'Стойкость' : statusCount(card, 'doomed') ? 'Обречённая'
      : keywordsFor(card).find((keyword) => keyword !== 'Броня');
    if (word) {
      const mark = element('span', 'card-state', keywordIcons[word] ?? '○');
      mark.title = word;
      node.append(mark);
    }
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
  const word = card.resilient ? 'Стойкость' : definition.order ? 'Приказ' : deathwishDefinitions(card).length ? 'Завещание'
    : statusCount(card, 'doomed') ? 'Обречённая' : keywordsFor(card).find((keyword) => keyword !== 'Броня');
  if (!orderOnField && (counter > 0 || timer !== undefined || word)) {
    const mark = element('span', 'card-state', counter > 0 ? counter : timer ?? keywordIcons[word] ?? '○');
    mark.title = counter > 0 ? 'Счётчик ' + counter : timer !== undefined ? 'Таймер ' + timer : word;
    if (word === 'Приказ' && timer === undefined) mark.classList.add('order-sleep');
    node.append(mark);
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
  const details = [definition.name, CARD_TYPES[cardType(card)]];
  if (definition.faction === NEUTRAL) details.push('Нейтральная');
  details.push(...(definition.categories ?? []));
  if (definition.scenario) details.push(`главы ${card.chapter ?? 0}/${definition.scenario.chapters.length}`);
  if (definition.enemySide) details.push('на сторону противника');
  if (isUnit(card)) details.push(`сила ${power}`);
  if (armor) details.push(`броня ${armor}`);
  if (definition.rarity) details.push(RARITY_LABELS[definition.rarity]);
  if (showProvision && definition.provision !== undefined) details.push(`провизия ${definition.provision}`);
  if (statusCount(card, 'target')) details.push('Отмечен Целью');
  if (statusCount(card, 'doomed')) details.push('Обречённая');
  const infection = statusCount(card, 'infection');
  if (infection) details.push('Заражение ' + infection);
  if (deathwishDefinitions(card).length) details.push('Завещание');
  if (counter > 0) details.push(`счётчик ${counter}`);
  if (timer !== undefined) details.push(`таймер ${timer}`);
  details.push(...keywordsFor(card).filter((word) => word !== 'Завещание' && (word !== 'Броня' || !armor)));
  return details.join(' · ');
}

export function cardButton(card, handler, player, placement = false, { showProvision = false, inspect } = {}) {
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  decorateCard(node, card, player, { showProvision });
  cardInspection(node, card, placement, inspect);
  return node;
}
