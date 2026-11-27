import { dialogClose } from './resources.js';
import { button, element, setCardRarity } from './dom.js';
import { KEYWORDS } from '../game/shared/card-keywords.js';
import { CARD_TYPES, NEUTRAL, RARITY_LABELS, ROW_LABELS } from '../game/shared/card-metadata.js';
import { FACTION_CATALOG } from '../game/cards/faction-catalog.js';
import { basePower, cardType, createCard, isUnit, statusCount } from '../game/engine/board.js';
import { relatedEffectCards } from '../game/cards/related-cards.js';
import { deathwishDefinitions } from '../game/engine/events.js';
import { cardArt, hasPremiumArt, selectPremiumArt, usesPremiumArt } from './card-art.js';
import { decorateCard, growthValue, psionicCountLabel } from './card-badges.js';

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
  const { leader = false, orderReady = false, orderCooldown = 0, actions, frame, back } = options;
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
  if (infection) glossaryWords.add('Заражение');
  if (hasShield || card.statuses?.shield === 0) glossaryWords.add('Силовой щит');
  if (definition.endTurn) glossaryWords.add('Конец хода');
  if (definition.order) glossaryWords.add('Приказ');
  if (leader ? definition.order?.usesCharges : definition.order?.charges !== undefined) glossaryWords.add('Заряды');
  if (definition.order?.cooldown > 0) glossaryWords.add('Перезарядка');
  if (definition.timer !== undefined) glossaryWords.add('Таймер');
  if (glossaryWords.has('Конец хода') || glossaryWords.has('Таймер')) glossaryWords.add('Пас и пустой ход');
  if (['Призыв', 'Порождение'].some((word) => glossaryWords.has(word))) glossaryWords.add('Лимит ряда');
  const explanations = [...glossaryWords].filter((word) => Object.hasOwn(KEYWORDS, word))
    .map((word) => [word, KEYWORDS[word]]);
  const orderRow = ROW_LABELS[definition.order?.sourceRow];
  if (orderRow) explanations.push([orderRow, 'Приказ доступен, пока карта находится в этом ряду.']);
  if (actions) body.append(actions);

  const layout = element('div', 'preview-layout');
  if (!leader) {
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
