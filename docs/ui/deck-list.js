import { on } from './app-events.js';
import { FACTIONS } from '../game/cards/cards.js';
import { FACTION_CATALOG } from '../game/cards/faction-catalog.js';
import { inspectDeck, PRESETS } from '../game/cards/decks.js';
import { button, confirmDeckDeletion, element, iconButton } from './dom.js';
import { factionFilters } from './faction-filters.js';
import { homeTiles } from './home-tiles.js';
import { quickMatchPanel } from './quick-match-panel.js';
import { campaignShelf } from './campaigns.js';
import { deckImportDialog, exportDeckJson, exportOwnDecks } from './deck-transfer.js';
import { sectionBack } from './resources.js';
import { violations } from './deck-shared.js';

let activeDeckMenu;

function closeActiveDeckMenu() {
  activeDeckMenu?.();
}

export function deckListItem(deck, stats, actions, isPrimary = false, signal) {
  const result = inspectDeck(deck);
  const item = element('article', 'panel deck-list-item');
  item.dataset.faction = deck.factionId;
  item.tabIndex = 0;
  const title = deck.name.trim() || 'Без названия';
  item.setAttribute('aria-label', 'Редактировать: ' + title);
  const heading = element('div', 'deck-card-heading');
  heading.append(element('h4', null, title));
  if (isPrimary) heading.append(element('span', 'deck-primary-badge', '★ Основная'));
  item.append(heading, element('p', 'muted',
    [FACTIONS[deck.factionId]?.name, result.leader?.name, result.cards.length + ' карт',
      result.cost + ' / ' + result.budget + ' провизии'].filter(Boolean).join(' · ')));
  if (stats) {
    const { win, loss } = stats.get(deck.factionId);
    item.append(element('p', 'muted', 'Победы ' + win + ' · Поражения ' + loss));
  }

  const menuRoot = element('div', 'deck-card-menu');
  const menu = element('div', 'deck-card-menu-popover');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const trigger = iconButton('⋯', 'Действия: ' + title, (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu(true);
  }, 'deck-card-menu-trigger');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  menuRoot.append(trigger, menu);
  item.append(menuRoot);

  const entries = [
    [isPrimary ? 'Основная ✓' : 'Сделать основной', () => actions.setPrimary(deck), isPrimary],
    ['Редактировать', () => actions.edit(deck), false],
    ['Копировать', () => actions.copy(deck), false],
    ['Экспорт JSON', () => actions.export(deck), false],
  ];
  if (!deck.id.startsWith('preset-') && actions.remove) {
    entries.push(['Удалить', () => confirmDeckDeletion(title, () => actions.remove(deck)), false, true]);
  }
  const buttons = entries.map(([label, action, disabled, danger]) => {
    const entry = button(label, (event) => {
      event.stopPropagation();
      closeMenu();
      action();
    }, 'deck-menu-item' + (danger ? ' deck-danger' : ''));
    entry.setAttribute('role', 'menuitem');
    entry.disabled = disabled;
    menu.append(entry);
    return entry;
  });

  function enabledButtons() {
    return buttons.filter((entry) => !entry.disabled);
  }

  function closeMenu(focus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (activeDeckMenu === closeMenu) activeDeckMenu = undefined;
    if (focus) trigger.focus();
  }

  function openMenu() {
    closeActiveDeckMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activeDeckMenu = closeMenu;
    enabledButtons()[0]?.focus();
  }

  menuRoot.addEventListener('click', (event) => event.stopPropagation());
  menu.addEventListener('keydown', (event) => {
    const enabled = enabledButtons();
    const index = enabled.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!menuRoot.contains(event.target)) closeMenu();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu(true);
  }, { signal });
  signal?.addEventListener('abort', () => closeMenu(), { once: true });

  item.addEventListener('click', (event) => {
    if (!menuRoot.contains(event.target)) actions.edit(deck);
  });
  item.addEventListener('keydown', (event) => {
    if (event.target !== item || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    actions.edit(deck);
  });

  const errors = element('p', 'deck-invalid');
  errors.hidden = true;
  item.append(errors);
  return { deck, item, errors };
}

const campaigns = [];

export function deckHomeScreen(phaseLabel, actions, progress, quickMatch, signal) {
  phaseLabel.textContent = '';
  const screen = element('section', 'deck-home');
  const sections = element('section', 'home-block');
  const collectionTiles = element('div', 'home-tiles home-tiles-collection');
  collectionTiles.append(button('Все карты', actions.catalog, 'button home-tile'),
    button('Украшения', actions.decorations, 'button home-tile'),
    button('Все колоды', actions.all, 'button home-tile'));
  sections.append(element('h2', null, 'Разделы'), homeTiles(progress, actions, signal), collectionTiles);
  screen.append(campaignShelf(campaigns), sections, quickMatchPanel(quickMatch, signal));
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
  let primaryId = actions.primary?.(inventory().owned)?.id ?? '';
  const definitions = [
    ['Стартовые колоды', PRESETS, true],
    ['Сохранённые колоды', decks, false],
  ];
  if (primaryId && !primaryId.startsWith('preset-')) definitions.reverse();
  const groups = definitions.map(([title, entries, preset]) => {
    const group = element('section', 'deck-list-group');
    const list = element('div', 'deck-list');
    const empty = element('p', 'muted');
    group.append(element('h3', null, title), list, empty);
    screen.append(group);
    const ordered = entries.toSorted((first, second) => Number(second.id === primaryId) - Number(first.id === primaryId));
    const items = ordered.map((deck) => deckListItem(deck, preset ? stats : undefined, {
      copy: actions.copy,
      edit: actions.edit,
      export: (deck) => exportDeckJson(deck, status),
      remove: actions.remove,
      setPrimary: actions.setPrimary,
    }, deck.id === primaryId, signal));
    list.append(...items.map(({ item }) => item));
    return { items, empty, list, preset };
  });

  function update() {
    const { owned } = inventory();
    for (const { items, empty, list, preset } of groups) {
      let count = 0;
      for (const { deck, item, errors } of items) {
        item.hidden = Boolean(faction && deck.factionId !== faction);
        if (item.hidden) continue;
        count += 1;
        const result = inspectDeck(deck, owned);
        errors.hidden = result.valid;
        errors.textContent = violations(result).join(' ');
      }
      list.hidden = count === 0;
      empty.hidden = count > 0;
      empty.textContent = faction ? 'Нет колод этой фракции.'
        : !preset && !items.length ? 'Пока нет сохранённых колод.' : 'Нет доступных колод.';
    }
  }
  on('collection-change', () => {
    const nextPrimaryId = actions.primary?.(inventory().owned)?.id ?? '';
    if (nextPrimaryId !== primaryId) {
      primaryId = nextPrimaryId;
      actions.refresh?.();
      return;
    }
    update();
  }, { signal });
  update();
  return screen;
}
