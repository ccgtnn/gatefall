import { findCardDefinition } from '../../game/cards/card-registry.js';
import { button, element, selectField } from '../dom.js';
import { createCardSection } from './card-section.js';
import { defaultCardId, factionCards, factionOptions } from './fixtures.js';
import { createGridSection } from './grid-section.js';
import { createRewardsSection } from './rewards-section.js';
import { createRowSection } from './row-section.js';

const tabs = [
  ['card', 'Карта'],
  ['row', 'Ряд'],
  ['rewards', 'Награды'],
  ['grid', 'Все карты фракции'],
];

export function createSandboxPage(root) {
  let factionId = factionOptions[0][0];
  let cardId = defaultCardId(factionId);
  const faction = selectField('Фракция', factionOptions, 'deck-field sandbox-field');
  faction.input.value = factionId;
  const card = selectField('Карта', [], 'deck-field sandbox-field');
  const builders = {
    card: createCardSection(),
    row: createRowSection(),
    rewards: createRewardsSection(),
    grid: createGridSection(),
  };
  const navigation = element('nav', 'sandbox-tabs');
  navigation.setAttribute('aria-label', 'Разделы песочницы');
  const controls = element('div', 'sandbox-controls');
  controls.append(faction.field, card.field);
  const content = element('div', 'sandbox-content');
  content.append(...tabs.map(([id]) => builders[id].section));

  function showSection(id) {
    for (const [key, builder] of Object.entries(builders)) builder.section.hidden = key !== id;
    card.field.hidden = id !== 'card';
    for (const tab of navigation.children) tab.setAttribute('aria-pressed', String(tab.dataset.sectionTab === id));
  }
  for (const [id, label] of tabs) {
    const tab = button(label, () => showSection(id), 'button sandbox-tab');
    tab.dataset.sectionTab = id;
    navigation.append(tab);
  }

  function updateCard() {
    builders.card.update(factionId, findCardDefinition(cardId));
  }
  function updateFaction() {
    const definitions = factionCards(factionId);
    if (!definitions.some(({ id }) => id === cardId)) cardId = defaultCardId(factionId);
    card.input.replaceChildren(...definitions.map((definition) => {
      const option = element('option', null, definition.name);
      option.value = definition.id;
      return option;
    }));
    card.input.value = cardId;
    updateCard();
    builders.row.update(factionId);
    builders.rewards.update(factionId);
    builders.grid.update(factionId);
  }
  faction.input.addEventListener('change', () => {
    factionId = faction.input.value;
    cardId = defaultCardId(factionId);
    updateFaction();
  });
  card.input.addEventListener('change', () => {
    cardId = card.input.value;
    updateCard();
  });

  const heading = element('header', 'sandbox-header');
  heading.append(element('h1', null, 'Gatefall · визуальная песочница'),
    element('p', 'muted', 'Фикстуры без матча и изменений сохранений. Страница доступна только по прямому URL.'));
  root.replaceChildren(heading, navigation, controls, content);
  updateFaction();
  showSection('card');
  return { builders, showSection, updateFaction };
}
