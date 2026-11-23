import { button, element, selectField } from './dom.js?v=opponent-reveal-1';
import { createCard } from '../game/board.js?v=robot-art-28';
import { CARD_TYPES, FACTIONS, NEUTRAL, NEUTRAL_CARDS, RARITY_LABELS } from '../game/cards.js?v=robot-art-28';
import { addCardCrop, cardButton, showCard } from './cards.js?v=robot-art-28';
import { logView, roundText } from './menu.js?v=robot-art-28';
import { availabilityOptions, filterCatalog } from './catalog-cards.js?v=collection-2';
import { factionFilters } from './faction-filters.js?v=1';
import { copyLimit } from '../game/decks.js?v=robot-art-28';
import { craftPrice, dismantleValue } from '../game/rewards.js?v=robot-art-28';
import { resourceIcon } from './resource-icon.js?v=1';
import { sectionBack } from './resources.js?v=interface-polish-1';

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
  const items = new Map(catalogCards.map((definition) => [definition.id, createEntry(definition)]));

  function createEntry(definition) {
    const card = createCard(definition.id, definition);
    const item = element('div', 'catalog-entry');
    const inspect = () => openDetails(card);
    const face = cardButton(card, inspect, { factionId: definition.faction }, false, { showProvision: true, inspect });
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
    const quantity = element('p', 'catalog-quantity');
    const message = element('p', 'economy-status');
    message.setAttribute('role', 'status');
    const buttons = element('div', 'card-trade-actions');
    const price = craftPrice(definition);
    const payout = dismantleValue(definition);
    const craft = tradeButton('Создать', '−' + price, `Создать «${definition.name}» за ${price} эссенции`, () => trade('craft'));
    const dismantle = tradeButton('Распылить', '+' + payout, `Распылить «${definition.name}» за ${payout} эссенции`, () => trade('dismantle'));
    buttons.append(craft, dismantle);
    panel.append(quantity, buttons, message);
    showCard(card, { actions: panel });
    tradeView = {
      panel,
      update({ essence, owned }) {
        const copies = owned[definition.id];
        quantity.textContent = `В коллекции · ${copies} · Эссенция · ${essence}`;
        craft.disabled = busy || copies >= copyLimit(definition) || essence < price;
        craft.title = copies >= copyLimit(definition) ? 'Для колоды уже хватает копий'
          : essence < price ? 'Нужно больше эссенции' : craft.getAttribute('aria-label');
        dismantle.disabled = busy || !copies;
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
        : `Распылена карта «${definition.name}». Получено ${payout} эссенции.`;
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
    const shown = filterCatalog(catalogCards, {
      faction, query: search.value, type: type.input.value, rarity: rarity.input.value,
      category: category.input.value, provision: provision.input.value, sort: sort.input.value,
      availability: availability.input.value, owned,
    });
    count.textContent = `Показано ${shown.length} из ${catalogCards.length}`;
    const next = shown.map((definition) => {
      const { item, quantity } = items.get(definition.id);
      const copies = owned[definition.id];
      item.classList.toggle('card-unavailable', !copies);
      quantity.textContent = `В коллекции · ${copies}`;
      return item;
    });
    if (!next.length) next.push(empty);
    if (visible.length !== next.length || next.some((item, index) => visible[index] !== item)) {
      grid.replaceChildren(...next);
      visible = next;
    }
  }

  search.addEventListener('input', update);
  for (const { input } of fields) input.addEventListener('change', update);
  update();
  progress.subscribe(update);
  panel.append(factions, toolbar, count, grid);
  return panel;
}

export function leaderScreen(phaseLabel, factionId, start, back) {
  const faction = FACTIONS[factionId];
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  panel.setAttribute('aria-label', 'Выбери лидера · ' + faction.name);
  const choices = element('div', 'leader-choices');
  for (const leader of faction.leaders) {
    const choice = button(undefined, () => start(factionId, leader.id), 'button leader-choice');
    choice.dataset.faction = factionId;
    if (leader.art) addCardCrop(choice, leader);
    else choice.append(element('span', 'leader-placeholder', '♜'));
    choice.append(element('strong', null, leader.name + ' (+' + leader.provisionBonus + ')'), element('span', 'leader-description', leader.text));
    choices.append(choice);
  }
  panel.append(sectionBack(back), choices);
  return panel;
}

export function finishedScreen(match, phaseLabel, start, leaveMatch, showThoughts, canReplay, leagueResult) {
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
  const replay = button('Ещё раз той же колодой', start, 'button primary');
  const missing = element('p', 'deck-invalid', 'В коллекции отсутствуют копии для этой колоды.');
  function updateReplay() {
    replay.disabled = !canReplay();
    missing.hidden = !replay.disabled;
  }
  panel.addEventListener('collection-change', updateReplay);
  updateReplay();
  if (leagueResult) {
    actions.append(button(leagueResult.label, leaveMatch, 'button primary'));
    actions.firstChild.disabled = leagueResult.saving;
  } else {
    actions.append(replay, button('Выбор колоды', leaveMatch));
  }
  panel.append(
    heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    ...(leagueResult ? [element('p', 'league-reply', leagueResult.reply),
      element('p', 'muted', leagueResult.notice)] : [missing]), actions,
  );
  game.append(panel, logView(match, showThoughts));
  return game;
}
