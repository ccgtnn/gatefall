import { FACTIONS, NEUTRAL, CARD_TYPES, RARITY_LABELS } from '../game/cards.js?v=storm-eye-1';
import { createCard } from '../game/board.js?v=storm-eye-1';
import { collection, copyLimit, inspectDeck, MIN_CARDS, MIN_UNITS, PRESETS } from '../game/decks.js?v=collection-2';
import { addCardCrop, cardButton } from './cards.js?v=details-3';
import { button, element, selectField } from './dom.js?v=opponent-reveal-1';
import { factionFilters } from './faction-filters.js?v=1';
import { availabilityOptions, matchesAvailability } from './catalog-cards.js?v=collection-2';

const byProvision = (a, b) => b.provision - a.provision || a.name.localeCompare(b.name, 'ru');

function viewHeading(title) {
  const heading = element('h2', null, title);
  heading.tabIndex = -1;
  return heading;
}

function violations(result) {
  const messages = {
    name: 'Укажи название колоды.',
    cards: 'Нужно минимум ' + MIN_CARDS + ' карт.',
    units: 'Нужно минимум ' + MIN_UNITS + ' отрядов.',
    provisions: 'Лимит провизии ' + result.budget + ' превышен.',
    copies: 'Лимит копий: бронза ×2, золото ×1.',
    ownership: 'В коллекции отсутствуют копии · ' + [...result.missing.values()].reduce((sum, copies) => sum + copies, 0) + '.',
    foreign: 'Убери карты, недоступные этой фракции.',
    leader: 'Выбери лидера своей фракции.',
  };
  return Object.keys(messages).filter((key) => result.issues[key]).map((key) => messages[key]);
}

export function deckListScreen(phaseLabel, decks, stats, actions, inventory) {
  phaseLabel.textContent = '';
  const screen = element('section', 'deck-home');
  const toolbar = element('div', 'deck-toolbar');
  toolbar.append(viewHeading('Колоды'), button('Новая колода', actions.create, 'button primary'),
    button('Все карты', actions.catalog));
  screen.append(toolbar);
  const items = [];

  for (const [title, entries, preset] of [
    ['Стартовые колоды', PRESETS, true],
    ['Сохранённые колоды', decks, false],
  ]) {
    const group = element('section', 'deck-list-group');
    group.append(element('h3', null, title));
    const list = element('div', 'deck-list');
    if (!entries.length) list.append(element('p', 'muted', 'Пока нет сохранённых колод.'));
    for (const deck of entries) {
      const result = inspectDeck(deck);
      const item = element('article', 'panel deck-list-item');
      item.dataset.faction = deck.factionId;
      const title = deck.name.trim() || 'Без названия';
      item.append(element('h4', null, title), element('p', 'muted',
        [FACTIONS[deck.factionId]?.name, result.leader?.name, result.cards.length + ' карт',
          result.cost + ' / ' + result.budget + ' провизии'].filter(Boolean).join(' · ')));
      if (preset) {
        const { win, loss } = stats.get(deck.factionId);
        item.append(element('p', 'muted', 'Победы ' + win + ' · Поражения ' + loss));
      }
      const errors = element('p', 'deck-invalid');
      item.append(errors);
      const row = element('div', 'deck-toolbar');
      const play = button('Играть', () => actions.play(deck), 'button primary');
      play.setAttribute('aria-label', 'Играть: ' + title);
      const edit = button(preset ? 'Копировать' : 'Редактировать', () =>
        preset ? actions.copy(deck) : actions.edit(deck));
      edit.setAttribute('aria-label', (preset ? 'Копировать: ' : 'Редактировать: ') + title);
      row.append(play, edit);
      item.append(row);
      list.append(item);
      items.push({ deck, errors, play });
    }
    group.append(list);
    screen.append(group);
  }

  function update() {
    const { owned } = inventory();
    for (const { deck, errors, play } of items) {
      const result = inspectDeck(deck, owned);
      play.disabled = !result.valid;
      errors.hidden = result.valid;
      errors.textContent = violations(result).join(' ');
    }
  }
  screen.addEventListener('collection-change', update);
  update();
  return screen;
}

export function factionPicker(phaseLabel, select, back) {
  phaseLabel.textContent = '';
  const screen = element('section', 'intro');
  screen.append(viewHeading('Выбери фракцию'));
  const options = element('div', 'deck-choices');
  for (const [id, faction] of Object.entries(FACTIONS)) {
    const choice = button(undefined, () => select(id), 'button deck-choice');
    choice.dataset.faction = id;
    addCardCrop(choice, faction.leader);
    choice.append(element('strong', null, faction.name), element('span', 'muted', faction.strategy));
    options.append(choice);
  }
  screen.append(options, button('К колодам', back));
  return screen;
}

export function deckEditor(phaseLabel, deck, { save, play, back, inventory }) {
  phaseLabel.textContent = '';
  const screen = element('section', 'deck-editor');
  const toolbar = element('header', 'deck-toolbar deck-editor-toolbar');
  const columns = element('div', 'deck-editor-columns');
  const left = element('section', 'panel deck-editor-panel deck-editor-owned');
  const right = element('section', 'panel deck-editor-panel deck-editor-collection');
  const nameField = element('label', 'deck-field');
  const name = element('input');
  name.type = 'text';
  name.maxLength = 80;
  name.value = deck.name;
  nameField.append(element('span', null, 'Название'), name);

  const leaders = FACTIONS[deck.factionId]?.leaders ?? [];
  const leader = selectField('Лидер', leaders.map(({ id, name, provisionBonus }) =>
    [id, name + ' (+' + provisionBonus + ')']));
  leader.input.value = deck.leaderId;
  const totals = element('div', 'deck-totals');
  totals.setAttribute('aria-live', 'polite');
  const errors = element('ul', 'deck-invalid');
  const owned = element('ul', 'deck-owned-list');
  const status = element('p', 'deck-save-status');
  status.setAttribute('role', 'status');
  const playButton = button('Играть', () => {
    if (inspectDeck(deck, inventory().owned).valid) play(deck);
  }, 'button primary');
  const saveButton = button('Сохранить', () => {
    dirty = false;
    status.textContent = save(deck) ? 'Колода сохранена.' : 'Колода доступна до закрытия страницы. Браузер не сохранил данные.';
  });
  let dirty = false;
  const backButton = button('Назад', () => {
    if (dirty) save(deck);
    back();
  });
  toolbar.append(backButton, viewHeading('Редактор колоды'), saveButton, playButton, status);
  left.append(nameField, leader.field, totals, errors, owned);
  columns.append(left, right);
  screen.append(toolbar, columns);

  const pool = collection(deck.factionId).toSorted(byProvision);
  const searchField = element('label', 'deck-field');
  const search = element('input');
  search.type = 'search';
  searchField.append(element('span', null, 'Поиск по имени'), search);
  const types = selectField('Тип', [['', 'Все'], ...Object.entries(CARD_TYPES)]);
  const rarity = selectField('Редкость', [['', 'Вся'], ...Object.entries(RARITY_LABELS)]);
  const availability = selectField('Наличие', availabilityOptions);
  const provisions = selectField('Провизия', [['', 'Любая'], ...[...new Set(pool.map(({ provision }) => provision))]
    .sort((a, b) => a - b).map((cost) => [String(cost), String(cost)])]);
  let faction = '';
  const choices = [['', 'Все']];
  if (FACTIONS[deck.factionId]) choices.push([deck.factionId, FACTIONS[deck.factionId].name]);
  choices.push([NEUTRAL, 'Нейтральные']);
  const factions = factionFilters(choices, (id) => {
    faction = id;
    updateCollection();
  });
  const filters = element('div', 'deck-filters');
  filters.append(types.field, rarity.field, provisions.field, availability.field);
  const available = element('div', 'deck-collection-grid');
  right.append(element('h3', null, 'Коллекция'), factions, searchField, filters, available);
  const cards = new Map();

  function updateDeck(ownership = inventory().owned) {
    const result = inspectDeck(deck, ownership);
    playButton.disabled = !result.valid;
    name.setAttribute('aria-invalid', String(result.issues.name));
    leader.input.setAttribute('aria-invalid', String(result.issues.leader));
    totals.replaceChildren(...[
      ['Карты ' + result.cards.length + ' / ' + MIN_CARDS, result.issues.cards],
      ['Отряды ' + result.units + ' / ' + MIN_UNITS, result.issues.units],
      ['Провизия осталось ' + (result.budget - result.cost) + ' / ' + result.budget, result.issues.provisions],
    ].map(([text, invalid]) => element('strong', invalid ? 'deck-invalid' : '', text)));
    errors.replaceChildren(...violations(result).map((message) => element('li', null, message)));

    const known = [...new Map(result.cards.map((card) => [card.id, card])).values()].sort(byProvision);
    const unknown = [...new Set(deck.cardIds.filter((id) => !result.counts.has(id)))];
    const entries = [...known, ...unknown.map((id) => ({ id, name: id }))];
    owned.replaceChildren(...entries.map((card) => {
      const line = element('li');
      const remove = button(undefined, () => {
        deck.cardIds.splice(deck.cardIds.lastIndexOf(card.id), 1);
        changed();
      }, 'deck-remove');
      const quantity = result.counts.get(card.id) ?? deck.cardIds.filter((id) => id === card.id).length;
      const missing = result.missing.get(card.id);
      remove.setAttribute('aria-label', 'Убрать: ' + card.name + (missing ? ' · отсутствует копий ' + missing : ''));
      const invalid = missing || result.overLimit.has(card.id) || !result.counts.has(card.id);
      remove.classList.toggle('deck-invalid', invalid);
      const image = element('span', 'deck-thumb');
      if (card.faction) image.dataset.faction = card.faction;
      addCardCrop(image, card);
      remove.append(image, element('span', 'deck-number', card.provision ?? '—'),
        element('span', 'deck-number', card.power ?? '—'), element('span', null, card.name),
        element('small', null, missing ? `×${quantity} · нет ${missing}` : '×' + quantity));
      line.append(remove);
      return line;
    }));

    for (const [id, { face, pips, limit, label }] of cards) {
      const used = result.counts.get(id) ?? 0;
      face.classList.toggle('deck-copies-used', limit > 0 && used >= limit);
      face.setAttribute('aria-disabled', String(used >= limit));
      face.setAttribute('aria-label', label + ' · В колоде ' + used + ' из ' + limit);
      pips.forEach((pip, index) => pip.classList.toggle('is-used', index < used));
    }
  }

  function changed() {
    dirty = true;
    status.textContent = 'Есть несохранённые изменения.';
    const scroll = owned.scrollTop;
    updateDeck();
    owned.scrollTop = scroll;
  }

  function updateCollection() {
    cards.clear();
    const { owned } = inventory();
    const query = search.value.trim().toLocaleLowerCase('ru');
    const shown = pool.filter((card) =>
      card.name.toLocaleLowerCase('ru').includes(query) &&
      matchesAvailability(availability.input.value, owned[card.id]) &&
      (!types.input.value || types.input.value === card.type) &&
      (!rarity.input.value || rarity.input.value === card.rarity) &&
      (!provisions.input.value || Number(provisions.input.value) === card.provision) &&
      (!faction || faction === card.faction));
    available.replaceChildren(...shown.map((card) => {
      const item = element('div', 'deck-collection-entry');
      const limit = Math.min(copyLimit(card), owned[card.id]);
      item.classList.toggle('card-unavailable', !limit);
      const face = cardButton(createCard(card.id, card), () => {
        const currentLimit = Math.min(copyLimit(card), inventory().owned[card.id]);
        if ((inspectDeck(deck).counts.get(card.id) ?? 0) >= currentLimit) return;
        deck.cardIds.push(card.id);
        changed();
      }, { factionId: deck.factionId }, false, { showProvision: true });
      const copies = element('span', 'deck-card-copies', '×' + limit);
      copies.setAttribute('aria-hidden', 'true');
      const pips = Array.from({ length: limit }, () => element('i'));
      copies.append(...pips);
      cards.set(card.id, { face, pips, limit, label: face.getAttribute('aria-label') });
      face.append(copies);
      item.append(face, element('span', 'deck-card-name', card.name));
      return item;
    }));
    if (!shown.length) available.append(element('p', 'muted', 'Карты не найдены.'));
    updateDeck(owned);
  }

  screen.addEventListener('collection-change', updateCollection);
  name.addEventListener('input', () => { deck.name = name.value; changed(); });
  leader.input.addEventListener('change', () => { deck.leaderId = leader.input.value; changed(); });
  search.addEventListener('input', updateCollection);
  for (const { input } of [types, rarity, provisions, availability]) input.addEventListener('change', updateCollection);
  updateCollection();
  return screen;
}
