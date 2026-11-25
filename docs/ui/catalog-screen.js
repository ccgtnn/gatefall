import { refreshPremiumArt, resumeCardVideos } from './card-art.js';
import { button, element, selectField } from './dom.js';
import { createCard } from '../game/board.js';
import { CARD_TYPES, NEUTRAL, RARITY_LABELS } from '../game/card-metadata.js';
import { CATALOG_CARDS } from '../game/card-registry.js';
import { FACTION_CATALOG } from '../game/faction-catalog.js';
import { cardButton, showCard } from './cards.js';
import { availabilityOptions, filterCatalog } from './catalog-cards.js';
import { factionFilters } from './faction-filters.js';
import { copyLimit } from '../game/decks.js';
import { craftPrice, dismantleValue } from '../game/collection-economy.js';
import { resourceIcon } from './resource-icon.js';

const catalogFactions = [['', 'Все фракции'], [NEUTRAL, 'Нейтральные'],
  ...Object.entries(FACTION_CATALOG).map(([id, faction]) => [id, faction.name])];
const categoryOptions = [...new Set(CATALOG_CARDS.flatMap(({ categories }) => categories ?? []))]
  .sort((a, b) => a.localeCompare(b, 'ru')).map((category) => [category, category]);
const provisionOptions = [...new Set(CATALOG_CARDS.map(({ provision }) => provision).filter(Number.isInteger))]
  .sort((a, b) => a - b).map((cost) => [String(cost), String(cost)]);

export function catalogScreen(progress, isOpen) {
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
  const availability = select('Наличие', availabilityOptions);
  const fields = [type, rarity, category, provision, availability, sort];
  toolbar.append(searchField, ...fields.map(({ field }) => field));

  const count = element('p', 'muted');
  count.setAttribute('role', 'status');
  const grid = element('div', 'catalog-grid');
  const empty = element('p', 'catalog-empty muted', 'Карты не найдены.');
  let busy = false;
  let visible = [];
  let tradeView;
  const items = new Map(CATALOG_CARDS.map((definition) => [definition.id, createEntry(definition)]));

  function createEntry(definition) {
    const card = createCard(definition.id, definition);
    const item = element('div', 'catalog-entry');
    const inspect = () => openDetails(card);
    const face = cardButton(card, inspect, { factionId: definition.faction }, false, { showProvision: true, showFaction: true, lazyArt: true, inspect });
    face.title = 'Подробнее';
    face.setAttribute('aria-haspopup', 'dialog');
    item.append(face, element('span', null, definition.name));
    if (definition.categories?.length) item.append(element('span', 'catalog-category', definition.categories.join(' · ')));
    const quantity = element('span', 'catalog-quantity');
    item.append(quantity);
    return { item, quantity };
  }

  function openDetails(card) {
    const { definition } = card;
    const panel = element('section', 'card-trade');
    panel.setAttribute('aria-label', 'Коллекция');
    const quantity = element('span', 'catalog-quantity');
    const balance = element('span', 'catalog-quantity');
    const balanceLine = element('p', 'card-trade-balance');
    balanceLine.dataset.essenceBalance = '';
    balanceLine.append(quantity, balance);
    const message = element('p', 'economy-status');
    message.setAttribute('role', 'status');
    const buttons = element('div', 'card-trade-actions');
    const price = craftPrice(definition);
    const payout = dismantleValue(definition);
    const craft = tradeButton('Создать', '−' + price, `Создать «${definition.name}» за ${price} эссенции`, () => trade('craft'));
    const dismantle = tradeButton('Распылить', '+' + payout, `Распылить «${definition.name}» за ${payout} эссенции`, () => {
      buttons.hidden = true;
      confirmation.hidden = false;
      cancel.focus();
    });
    const confirmation = element('div', 'card-trade-confirmation');
    confirmation.hidden = true;
    confirmation.setAttribute('role', 'group');
    const question = `Распылить одну копию «${definition.name}»? Ты получишь ${payout} эссенции.`;
    confirmation.setAttribute('aria-label', question);

    function dismissConfirmation() {
      confirmation.hidden = true;
      buttons.hidden = false;
    }

    const cancel = button('Отмена', () => {
      dismissConfirmation();
      dismantle.focus();
    });
    const confirm = button('Да, распылить', () => {
      dismissConfirmation();
      void trade('dismantle');
    }, 'button craft-button');
    const confirmActions = element('div', 'card-trade-actions');
    confirmActions.append(cancel, confirm);
    confirmation.append(element('p', null, question), confirmActions);
    confirmation.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel.click();
    });
    buttons.append(craft, dismantle);
    panel.append(balanceLine, buttons, confirmation, message);
    showCard(card, { actions: panel });
    tradeView = {
      panel,
      update({ essence, owned }) {
        const copies = owned[definition.id];
        quantity.textContent = `В коллекции · ${copies}`;
        balance.textContent = `Эссенция · ${essence}`;
        craft.disabled = busy || copies >= copyLimit(definition) || essence < price;
        craft.title = copies >= copyLimit(definition) ? 'Для колоды уже хватает копий'
          : essence < price ? 'Нужно больше эссенции' : craft.getAttribute('aria-label');
        dismantle.disabled = confirm.disabled = busy || !copies;
      },
    };
    tradeView.update(progress.inventory());

    async function trade(action) {
      if (busy) return;
      busy = true;
      update();
      const result = await progress[action](definition.id);
      busy = false;
      update();
      const success = action === 'craft' ? `Создана карта «${definition.name}».`
        : `Распылена карта «${definition.name}».`;
      const messages = {
        done: success, empty: 'В коллекции нет копий этой карты.', owned: 'В коллекции уже достаточно копий.',
        unaffordable: 'Нужно больше эссенции.',
      };
      message.textContent = messages[result] ?? 'Не удалось сохранить изменение коллекции.';
      if (panel.closest('dialog')?.open && !panel.contains(document.activeElement)) {
        const next = [action === 'craft' ? craft : dismantle, craft, dismantle].find((control) => !control.disabled);
        (next ?? panel.closest('dialog').querySelector('#preview-title')).focus({ preventScroll: true });
      }
    }
  }

  function tradeButton(label, amount, description, onClick) {
    const control = button(label, onClick, 'button craft-button');
    const value = element('span', 'card-trade-value');
    value.append(resourceIcon('essence'), element('span', null, amount));
    control.append(value);
    control.setAttribute('aria-label', description);
    control.title = description;
    return control;
  }

  function update() {
    const inventory = progress.inventory();
    const { owned } = inventory;
    if (tradeView?.panel.isConnected) tradeView.update(inventory);
    const shown = filterCatalog(CATALOG_CARDS, {
      faction, query: search.value, type: type.input.value, rarity: rarity.input.value,
      category: category.input.value, provision: provision.input.value, sort: sort.input.value,
      availability: availability.input.value, owned,
    });
    count.textContent = `Показано ${shown.length} из ${CATALOG_CARDS.length}`;
    const next = shown.map((definition) => {
      const { item, quantity } = items.get(definition.id);
      const copies = owned[definition.id];
      item.classList.toggle('card-unavailable', !copies);
      quantity.textContent = `В коллекции · ${copies}`;
      return item;
    });
    if (!next.length) {
      empty.textContent = Object.hasOwn(FACTION_CATALOG, faction) && !CATALOG_CARDS.some((card) => card.faction === faction)
        ? 'У этой фракции пока нет карт.' : 'Карты не найдены.';
      next.push(empty);
    }
    if (visible.length !== next.length || next.some((item, index) => visible[index] !== item)) {
      grid.replaceChildren(...next);
      refreshPremiumArt(grid);
      resumeCardVideos(grid);
      visible = next;
    }
  }

  search.addEventListener('input', update);
  for (const { input } of fields) input.addEventListener('change', update);
  progress.subscribe(() => { if (isOpen()) update(); });
  panel.append(factions, toolbar, count, grid);
  return { panel, refresh: update };
}
