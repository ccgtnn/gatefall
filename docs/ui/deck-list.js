import { on } from './app-events.js';
import { FACTIONS } from '../game/cards.js';
import { FACTION_CATALOG } from '../game/faction-catalog.js';
import { inspectDeck, PRESETS } from '../game/decks.js';
import { button, element } from './dom.js';
import { factionFilters } from './faction-filters.js';
import { campaignShelf } from './campaigns.js';
import { deckImportDialog, exportDeckJson, exportOwnDecks } from './deck-transfer.js';
import { sectionBack } from './resources.js';
import { violations } from './deck-shared.js';

function deckListItem(deck, stats, actions) {
  const result = inspectDeck(deck);
  const item = element('article', 'panel deck-list-item');
  item.dataset.faction = deck.factionId;
  const title = deck.name.trim() || 'Без названия';
  item.append(element('h4', null, title), element('p', 'muted',
    [FACTIONS[deck.factionId]?.name, result.leader?.name, result.cards.length + ' карт',
      result.cost + ' / ' + result.budget + ' провизии'].filter(Boolean).join(' · ')));
  if (stats) {
    const { win, loss } = stats.get(deck.factionId);
    item.append(element('p', 'muted', 'Победы ' + win + ' · Поражения ' + loss));
  }
  const row = element('div', 'deck-toolbar');
  const play = button('Играть', () => actions.play(deck), 'button primary');
  play.setAttribute('aria-label', 'Играть: ' + title);
  row.append(play);
  if (actions.copy) {
    const copy = button('Копировать', () => actions.copy(deck));
    copy.setAttribute('aria-label', 'Копировать: ' + title);
    row.append(copy);
  }
  if (actions.edit) {
    const edit = button('Редактировать', () => actions.edit(deck));
    edit.setAttribute('aria-label', 'Редактировать: ' + title);
    row.append(edit);
  }
  if (actions.exportStatus) {
    const exportButton = button('Экспорт JSON', () => exportDeckJson(deck, actions.exportStatus));
    exportButton.setAttribute('aria-label', 'Экспорт JSON: ' + title);
    row.append(exportButton);
  }
  const errors = element('p', 'deck-invalid');
  errors.hidden = true;
  item.append(errors, row);
  return { deck, item, errors, play };
}

const campaigns = [];

export function deckHomeScreen(phaseLabel, stats, actions, recentDecks, signal) {
  phaseLabel.textContent = '';
  const screen = element('section', 'deck-home');
  const sections = element('section', 'home-block');
  const tiles = element('div', 'home-tiles home-tiles-sections');
  const base = button('База', actions.base, 'button home-tile home-tile-base');
  const badge = element('span', 'tavern-badge');
  badge.setAttribute('aria-hidden', 'true');
  base.append(badge);
  const ranks = button('', actions.ranks, 'button home-tile home-tile-ranks');
  tiles.append(base, button('Лига', actions.league, 'button home-tile home-tile-league'), ranks);
  const collectionTiles = element('div', 'home-tiles home-tiles-collection');
  collectionTiles.append(button('Все карты', actions.catalog, 'button home-tile'),
    button('Украшения', actions.decorations, 'button home-tile'));
  sections.append(element('h2', null, 'Разделы'), tiles, collectionTiles);
  const decks = element('section', 'home-block');
  const heading = element('div', 'deck-toolbar home-decks-toolbar');
  heading.append(element('h2', null, 'Колоды'), button('Все колоды', actions.all));
  const list = element('div', 'deck-list');
  decks.append(heading, list);
  screen.append(campaignShelf(campaigns), sections, decks);

  function update() {
    ranks.textContent = `Ранги · ${actions.currentRank()}`;
    const ready = actions.tavernRewards();
    badge.hidden = !ready;
    badge.textContent = ready;
    base.setAttribute('aria-label', ready ? `База · награды Таверны: ${ready}` : 'База');
    const cards = recentDecks().map((deck) => deckListItem(deck,
      PRESETS.includes(deck) ? stats : undefined, { play: actions.play }).item);
    list.replaceChildren(...(cards.length ? cards : [element('p', 'muted', 'Нет доступных колод.')]));
  }
  on('collection-change', update, { signal });
  update();
  return screen;
}

export function deckListScreen(phaseLabel, decks, stats, actions, inventory, signal) {
  phaseLabel.textContent = '';
  const screen = element('section', 'all-decks');
  screen.setAttribute('aria-label', 'Все колоды');
  const toolbar = element('div', 'deck-toolbar all-decks-toolbar');
  const filters = factionFilters([['', 'Все фракции'], ...Object.entries(FACTION_CATALOG)
    .map(([id, { name }]) => [id, name])], (id) => {
    faction = id;
    update();
  });
  const status = element('p', 'deck-save-status', actions.notice);
  status.setAttribute('role', 'status');
  const dialog = deckImportDialog((text) => actions.importJson(text, inventory().owned), actions.onImported);
  const exportAll = button('Экспорт всех своих колод', () => exportOwnDecks(decks));
  exportAll.disabled = !decks.length;
  toolbar.append(filters, button('Новая колода', actions.create, 'button primary'),
    button('Импорт JSON', () => dialog.showModal()), exportAll);
  screen.append(sectionBack(actions.back), toolbar, status, dialog);
  let faction = '';
  const groups = [
    ['Стартовые колоды', PRESETS, true],
    ['Сохранённые колоды', decks, false],
  ].map(([title, entries, preset]) => {
    const group = element('section', 'deck-list-group');
    const list = element('div', 'deck-list');
    const empty = element('p', 'muted');
    group.append(element('h3', null, title), list, empty);
    screen.append(group);
    const items = entries.map((deck) => deckListItem(deck, preset ? stats : undefined,
      { play: actions.play, copy: actions.copy, edit: preset ? undefined : actions.edit, exportStatus: status }));
    list.append(...items.map(({ item }) => item));
    return { items, empty, list, preset };
  });

  function update() {
    const { owned } = inventory();
    for (const { items, empty, list, preset } of groups) {
      let count = 0;
      for (const { deck, item, errors, play } of items) {
        item.hidden = Boolean(faction && deck.factionId !== faction);
        if (item.hidden) continue;
        count += 1;
        const result = inspectDeck(deck, owned);
        play.disabled = !result.valid;
        errors.hidden = result.valid;
        errors.textContent = violations(result).join(' ');
      }
      list.hidden = count === 0;
      empty.hidden = count > 0;
      empty.textContent = faction ? 'Нет колод этой фракции.'
        : !preset && !items.length ? 'Пока нет сохранённых колод.' : 'Нет доступных колод.';
    }
  }
  on('collection-change', update, { signal });
  update();
  return screen;
}
