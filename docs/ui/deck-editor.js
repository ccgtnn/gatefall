import { on } from './app-events.js';
import { FACTIONS } from '../game/cards.js';
import { NEUTRAL, CARD_TYPES, RARITY_LABELS } from '../game/card-metadata.js';
import { createCard } from '../game/board.js';
import { collection, copyLimit, inspectDeck, MIN_CARDS, MIN_UNITS } from '../game/decks.js';
import { addCardCrop, cardButton } from './cards.js';
import { button, element, selectField } from './dom.js';
import { factionFilters } from './faction-filters.js';
import { availabilityOptions, matchesAvailability, normalizeCardSearch } from './catalog-cards.js';
import { deckAutosave } from './deck-storage.js';
import { exportDeckJson } from './deck-transfer.js';
import { sectionBack } from './resources.js';
import { byProvision, violations } from './deck-shared.js';

export function deckEditor(phaseLabel, deck, { save, play, back, inventory, notice, signal }) {
  phaseLabel.textContent = '';
  const screen = element('section', 'deck-editor');
  screen.setAttribute('aria-label', 'Редактор колоды');
  const actions = element('div', 'deck-toolbar deck-editor-actions');
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
  leader.input.value = inspectDeck(deck).leader?.id ?? deck.leaderId;
  const totals = element('div', 'deck-totals');
  totals.setAttribute('aria-live', 'polite');
  const errors = element('ul', 'deck-invalid');
  const owned = element('ul', 'deck-owned-list');
  const status = element('p', 'deck-save-status', notice);
  status.setAttribute('role', 'status');
  const playButton = button('Играть', () => {
    if (!inspectDeck(deck, inventory().owned).valid) return;
    autosave.save();
    play(deck);
  }, 'button primary');
  const autosave = deckAutosave(deck, save);
  signal.addEventListener('abort', autosave.flush, { once: true });
  window.addEventListener('pagehide', autosave.flush, { signal });
  const saveButton = button('Сохранить', () => {
    status.textContent = autosave.save() ? 'Колода сохранена.' : 'Колода доступна до закрытия страницы. Браузер не сохранил данные.';
  });
  const backButton = sectionBack(back);
  actions.append(saveButton, playButton, button('Экспорт JSON', () => exportDeckJson(deck, status)));
  left.append(nameField, leader.field, actions, status, totals, errors, owned);
  columns.append(left, right);
  screen.append(backButton, columns);

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
    const scroll = left.scrollTop;
    autosave.changed();
    status.textContent = 'Есть несохранённые изменения.';
    updateDeck();
    left.scrollTop = scroll;
  }

  function updateCollection() {
    cards.clear();
    const { owned } = inventory();
    const query = normalizeCardSearch(search.value).trim();
    const shown = pool.filter((card) =>
      normalizeCardSearch(card.name).includes(query) &&
      matchesAvailability(availability.input.value, owned[card.id]) &&
      (!types.input.value || types.input.value === card.type) &&
      (!rarity.input.value || rarity.input.value === card.rarity) &&
      (!provisions.input.value || Number(provisions.input.value) === card.provision) &&
      (!faction || faction === card.faction));
    available.replaceChildren(...shown.map((card) => {
      const item = element('div', 'deck-collection-entry');
      const limit = Math.min(copyLimit(card), owned[card.id] ?? 0);
      item.classList.toggle('card-unavailable', !limit);
      const face = cardButton(createCard(card.id, card), () => {
        const currentLimit = Math.min(copyLimit(card), inventory().owned[card.id] ?? 0);
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

  on('collection-change', updateCollection, { signal });
  name.addEventListener('input', () => { deck.name = name.value; changed(); });
  leader.input.addEventListener('change', () => { deck.leaderId = leader.input.value; changed(); });
  search.addEventListener('input', updateCollection);
  for (const { input } of [types, rarity, provisions, availability]) input.addEventListener('change', updateCollection);
  updateCollection();
  return screen;
}
