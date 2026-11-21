import { button, element } from './dom.js?v=step-11';
import { CARD_TYPES, KEYWORDS, NEUTRAL, RARITY_LABELS } from '../game/cards.js?v=art-26';
import { cardType, isUnit, statusCount } from '../game/board.js?v=art-26';

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

export function addCardCrop(node, definition) {
  if (!definition.art) return;
  node.classList.add('has-art');
  node.prepend(cardArt(definition, 'card-art-crop'));
}

export function showCard(card, { leader = false } = {}) {
  const { definition, power, armor, timer, counter } = card;
  const details = leader ? ['Лидер'] : [CARD_TYPES[cardType(card)], definition.faction === NEUTRAL && 'Нейтральная', RARITY_LABELS[definition.rarity],
    definition.stratagem ? 'Стратагема' : definition.provision !== undefined ? `Провизия ${definition.provision}` : 'Токен'].filter(Boolean);
  const stats = [];
  const infection = statusCount(card, 'infection');
  if (infection) stats.push('Заражение ' + infection);
  if (!leader && isUnit(card)) stats.push(`Сила ${power}`, `Броня ${armor ?? 0}`);
  if (counter > 0) stats.push(`Счётчик ${counter}`);
  if (timer !== undefined) stats.push(`Таймер ${timer}`);
  const title = element('h2', null, definition.name);
  title.id = 'preview-title';
  const close = button('Закрыть', () => preview.close());
  close.autofocus = true;
  const body = element('div', 'preview-body');
  body.append(title, element('p', 'muted', details.join(' · ')));
  if (stats.length) body.append(element('p', 'preview-stats', stats.join(' · ')));
  body.append(element('p', null, definition.text ?? 'Без эффекта.'));
  const glossaryWords = new Set(definition.keywords);
  if (infection || definition.id === 'carrier') glossaryWords.add('Заражение');
  if (definition.endTurn) glossaryWords.add('Конец хода');
  if (glossaryWords.size) {
    const glossary = element('dl', 'preview-keywords');
    for (const keyword of glossaryWords) {
      glossary.append(element('dt', null, keyword), element('dd', null, KEYWORDS[keyword]));
    }
    body.append(glossary);
  }
  body.append(close);
  if (definition.art) {
    const layout = element('div', 'preview-layout');
    layout.append(cardArt(definition, 'preview-art'), body);
    preview.replaceChildren(layout);
  } else {
    preview.replaceChildren(body);
  }
  if (!preview.open) preview.showModal();
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
    } else if (event.detail === 1 && node.classList.contains('effect-target') && event.pointerType !== 'touch') {
      event.stopImmediatePropagation();
      pendingClick = setTimeout(() => {
        if (node.isConnected) node.click();
      }, 520);
    }
  }, { capture: true });
}

const keywordIcons = {
  'Броня': '⬟',
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
  if (definition.endTurn) words.add('Конец хода');
  return [...words].filter((word) => keywordIcons[word]);
}

function cardStats(card) {
  const stats = element('span', 'card-stats');
  if (isUnit(card)) {
    const power = element('strong', 'unit-power', card.power);
    power.title = 'Сила ' + card.power;
    stats.append(power);
  }
  if (card.armor) {
    const armor = element('strong', 'armor-stat', card.armor);
    armor.title = 'Броня ' + card.armor;
    stats.append(armor);
  }
  return stats;
}

export function decorateCard(node, card, player, { orderOnField = false } = {}) {
  const { definition, timer, counter } = card;
  const type = cardType(card);
  node.dataset.type = type;
  node.dataset.faction = definition.faction === NEUTRAL ? NEUTRAL : player.factionId ?? '';
  node.dataset.rarity = definition.rarity ?? '';
  node.setAttribute('aria-label', cardLabel(card));
  node.append(cardStats(card));
  if (type !== 'unit') {
    const mark = element('span', 'card-kind', type === 'artifact' ? '◇' : '✦');
    mark.title = CARD_TYPES[type];
    node.append(mark);
  }
  const word = definition.order ? 'Приказ' : definition.deathwish ? 'Завещание'
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
  addCardCrop(node, definition);
  if (!definition.art) node.append(element('span', 'card-art-placeholder', definition.name));
}

function cardLabel(card) {
  const { definition, power, armor, timer, counter } = card;
  const details = [definition.name, CARD_TYPES[cardType(card)]];
  if (definition.faction === NEUTRAL) details.push('Нейтральная');
  if (isUnit(card)) details.push(`сила ${power}`);
  if (armor) details.push(`броня ${armor}`);
  if (definition.rarity) details.push(RARITY_LABELS[definition.rarity], `провизия ${definition.provision}`);
  if (statusCount(card, 'doomed')) details.push('Обречённая');
  const infection = statusCount(card, 'infection');
  if (infection) details.push('Заражение ' + infection);
  if (definition.deathwish) details.push('Завещание');
  if (counter > 0) details.push(`счётчик ${counter}`);
  if (timer !== undefined) details.push(`таймер ${timer}`);
  details.push(...keywordsFor(card).filter((word) => word !== 'Завещание' && (word !== 'Броня' || !armor)));
  return details.join(' · ');
}

export function cardButton(card, handler, player, placement = false) {
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  decorateCard(node, card, player);
  cardInspection(node, card, placement);
  return node;
}
