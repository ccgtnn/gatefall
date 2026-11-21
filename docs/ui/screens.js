import { button, element, selectField } from './dom.js?v=opponent-reveal-1';
import { createCard } from '../game/board.js?v=storm-eye-1';
import { CARD_TYPES, FACTIONS, NEUTRAL, NEUTRAL_CARDS, RARITY_LABELS } from '../game/cards.js?v=storm-eye-1';
import { addCardCrop, cardButton, showCard } from './cards.js?v=storm-eye-1';
import { logView, roundText } from './menu.js?v=storm-eye-1';
import { filterCatalog } from './catalog-cards.js?v=opponent-reveal-1';
import { factionFilters } from './faction-filters.js?v=1';
import { copyLimit } from '../game/decks.js?v=storm-eye-1';
import { craftPrice } from '../game/rewards.js?v=economy-1';
import { resourceIcon } from './resource-icon.js?v=1';

const catalogCards = [...NEUTRAL_CARDS, ...Object.values(FACTIONS).flatMap(({ pool }) => pool)];
const catalogFactions = [['', 'Все фракции'], [NEUTRAL, 'Нейтральные'],
  ...Object.entries(FACTIONS).map(([id, faction]) => [id, faction.name])];
const categoryOptions = [...new Set(catalogCards.flatMap(({ categories }) => categories ?? []))]
  .sort((a, b) => a.localeCompare(b, 'ru')).map((category) => [category, category]);
const provisionOptions = [...new Set(catalogCards.map(({ provision }) => provision))]
  .sort((a, b) => a - b).map((cost) => [String(cost), String(cost)]);

export function catalogScreen(progress) {
  const panel = element('section', 'card-catalog');
  let faction = '';
  const factions = factionFilters(catalogFactions, (id) => {
    faction = id;
    update();
  });

  const toolbar = element('div', 'catalog-filters');
  const search = element('input');
  search.type = 'search';
  const searchField = element('label', 'catalog-field catalog-search');
  searchField.append(element('span', null, 'Поиск по названию и тексту'), search);
  const select = (label, options) => selectField(label, options, 'catalog-field');
  const type = select('Тип', [['', 'Все типы'], ...Object.entries(CARD_TYPES)]);
  const rarity = select('Редкость', [['', 'Вся редкость'], ...Object.entries(RARITY_LABELS)]);
  const category = select('Категория', [['', 'Все категории'], ...categoryOptions]);
  const provision = select('Провизия', [['', 'Любая'], ...provisionOptions]);
  const sort = select('Сортировка', [['provision', 'По провизии'], ['name', 'По имени'], ['power', 'По силе']]);
  const fields = [type, rarity, category, provision, sort];
  toolbar.append(searchField, ...fields.map(({ field }) => field));

  const count = element('p', 'muted');
  count.setAttribute('role', 'status');
  const grid = element('div', 'catalog-grid');
  const message = element('p', 'economy-status');
  message.setAttribute('role', 'status');
  let items = [];
  let crafting = false;

  function updateCrafting() {
    const { essence, owned } = progress.inventory();
    for (const { definition, price, quantity, craft } of items) {
      const copies = owned[definition.id];
      quantity.textContent = `В коллекции · ${copies}`;
      craft.disabled = crafting || copies >= copyLimit(definition) || essence < price;
      craft.title = copies >= copyLimit(definition) ? 'Для колоды уже хватает копий'
        : essence < price ? 'Нужно больше эссенции' : craft.getAttribute('aria-label');
    }
  }

  function update() {
    const shown = filterCatalog(catalogCards, {
      faction, query: search.value, type: type.input.value, rarity: rarity.input.value,
      category: category.input.value, provision: provision.input.value, sort: sort.input.value,
    });
    count.textContent = `Показано ${shown.length} из ${catalogCards.length}`;
    items = shown.map((definition) => {
      const card = createCard(definition.id, definition);
      const item = element('div', 'catalog-entry');
      item.append(cardButton(card, () => showCard(card), { factionId: definition.faction }, false, { showProvision: true }),
        element('span', null, definition.name));
      if (definition.categories?.length) item.append(element('span', 'catalog-category', definition.categories.join(' · ')));
      const price = craftPrice(definition);
      const quantity = element('span', 'catalog-quantity');
      const craft = button(undefined, async () => {
        if (crafting) return;
        crafting = true;
        updateCrafting();
        const outcome = await progress.craft(definition.id);
        crafting = false;
        updateCrafting();
        message.textContent = outcome === 'done' ? `Создана карта «${definition.name}»`
          : outcome === 'owned' ? 'В коллекции уже достаточно копий.' : outcome === 'unaffordable'
            ? 'Нужно больше эссенции.' : 'Не удалось сохранить карту.';
        if (!craft.disabled) craft.focus({ preventScroll: true });
      }, 'button craft-button');
      craft.setAttribute('aria-label', `Создать «${definition.name}» за ${price} эссенции`);
      craft.append(resourceIcon('essence'), element('span', null, price));
      item.append(quantity, craft);
      return { definition, price, item, quantity, craft };
    });
    grid.replaceChildren(...items.map(({ item }) => item));
    updateCrafting();
    if (!shown.length) grid.append(element('p', 'catalog-empty muted', 'Карты не найдены.'));
  }

  search.addEventListener('input', update);
  for (const { input } of fields) input.addEventListener('change', update);
  update();
  progress.subscribe(updateCrafting);
  panel.append(factions, toolbar, count, message, grid);
  return panel;
}

export function leaderScreen(phaseLabel, factionId, start, back) {
  const faction = FACTIONS[factionId];
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  const heading = element('h2', null, 'Выбери лидера · ' + faction.name);
  heading.tabIndex = -1;
  const choices = element('div', 'leader-choices');
  for (const leader of faction.leaders) {
    const choice = button(undefined, () => start(factionId, leader.id), 'button leader-choice');
    choice.dataset.faction = factionId;
    if (leader.art) addCardCrop(choice, leader);
    else choice.append(element('span', 'leader-placeholder', '♜'));
    choice.append(element('strong', null, leader.name + ' (+' + leader.provisionBonus + ')'), element('span', 'leader-description', leader.text));
    choices.append(choice);
  }
  panel.append(heading, choices, button('Назад', back));
  return panel;
}

export function finishedScreen(match, phaseLabel, start, leaveMatch, showThoughts) {
  phaseLabel.textContent = `Матч завершён · раундов ${match.round}`;
  const game = element('div', 'game');
  const panel = element('section', 'panel finish');
  const outcomes = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
  const heading = element('h2', null, outcomes[match.result]);
  heading.tabIndex = -1;
  const rounds = match.log.filter((event) => event.type === 'round-end');
  const wins = rounds.filter(({ winner }) => winner === 'human').length;
  const losses = rounds.filter(({ winner }) => winner === 'bot').length;
  const ties = rounds.length - wins - losses;
  const score = element('p', 'match-result-score', `Раунды · Ты ${wins} : ${losses} Противник${ties ? ' · Ничьих: ' + ties : ''}`);
  const actions = element('div', 'finish-actions');
  actions.append(
    button('Ещё раз той же колодой', start, 'button primary'),
    button('Выбор колоды', leaveMatch),
  );
  panel.append(
    heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    actions,
  );
  game.append(panel, logView(match, showThoughts));
  return game;
}
