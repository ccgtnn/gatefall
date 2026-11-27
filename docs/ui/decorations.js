import { on } from './app-events.js';
import { assetUrl } from './asset-url.js';
import { FACTIONS } from '../game/cards/cards.js';
import { createCard } from '../game/engine/board.js';
import { decorateCard } from './cards.js';
import { button, element } from './dom.js';
import { sectionBack } from './resources.js';

export const FRAME_STORAGE_KEY = 'gatefall.card-frame';
export const BATTLEFIELD_STORAGE_KEY = 'gatefall.battlefield';
const frames = [
  { id: 'standard', name: 'Стандартные рамки' },
  { id: 'protectorate-rampart', name: 'Рубеж Протектората' },
  { id: 'growth-vines', name: 'Лозы Поросли' },
  { id: 'exemplars-crystal', name: 'Кристаллы Безупречных' },
];

const battlefields = [
  { id: 'standard', name: 'Стандартное поле', art: 'home-nebula.webp' },
  { id: 'wood', name: 'Деревянная доска', art: 'battlefield-wood.webp' },
  { id: 'metal', name: 'Тактический стол', art: 'battlefield-metal.webp' },
  { id: 'new-year', name: 'Новогодний стол', art: 'battlefield-new-year.webp' },
];

export function createFramePreferences(storage, root) {
  return createChoicePreferences(storage, root, FRAME_STORAGE_KEY, 'cardFrameChoice', frames);
}

export function createBattlefieldPreferences(storage, root) {
  return createChoicePreferences(storage, root, BATTLEFIELD_STORAGE_KEY, 'battlefieldChoice', battlefields);
}

function createChoicePreferences(storage, root, key, attribute, choices) {
  let current;
  function apply(id) {
    current = choices.some((choice) => choice.id === id && !choice.locked) ? id : 'standard';
    root.dataset[attribute] = current;
  }
  function refresh() {
    try { apply(storage?.getItem(key)); }
    catch { apply(current); }
  }
  refresh();
  return {
    current: () => current,
    refresh,
    select(id) {
      if (!choices.some((choice) => choice.id === id && !choice.locked)) return false;
      apply(id);
      try {
        if (!storage) return false;
        storage.setItem(key, id);
        return true;
      } catch { return false; }
    },
  };
}

export function decorationsScreen(phase, framesPreference, battlefieldPreference, back, signal,
  { frameChoices = frames, battlefieldChoices = battlefields } = {}) {
  phase.textContent = '';
  const panel = element('section', 'decorations-panel');
  const heading = element('h2', null, 'Украшения');
  heading.tabIndex = -1;
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  const samples = [['protectorate', 'bastion'], ['growth', 'vine'], ['choir', 'cult-dreamer']].map(([faction, id]) => {
    const definition = FACTIONS[faction].pool.find((card) => card.id === id);
    return createCard(id, definition);
  });
  function cardFace(sample, frame) {
    const face = element('span', 'hand-card decoration-face');
    decorateCard(face, sample, { factionId: sample.definition.faction }, { showProvision: true, fullArt: true, frame });
    return face;
  }

  const stage = element('div', 'decoration-stage');
  const cards = element('div', 'decoration-samples');
  cards.setAttribute('aria-hidden', 'true');
  stage.append(cards);
  const caption = element('p', 'decoration-caption muted');
  const preview = element('section', 'decoration-preview');
  preview.append(stage, caption);

  const tablist = element('div', 'decoration-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Виды украшений');
  const controls = element('div', 'decoration-controls');
  controls.append(tablist);
  let hovered;
  let focused;
  let shownFrame;
  let shownField;
  const groups = [
    options('frames', 'Рамки', frameChoices, framesPreference, ({ id }) => cardFace(samples[0], id)),
    options('fields', 'Поле боя', battlefieldChoices, battlefieldPreference, fieldImage),
  ];

  function fieldImage({ art }) {
    const image = element('img', 'decoration-field');
    image.alt = '';
    image.src = assetUrl('./art/' + art);
    return image;
  }

  function updatePreview() {
    const temporary = hovered ?? focused;
    const [frame, field] = groups.map((group) => {
      return temporary?.group === group.id ? temporary.item
        : group.items.find(({ id }) => id === group.preferences.current()) ?? group.items[0];
    });
    if (shownFrame !== frame.id) {
      shownFrame = frame.id;
      cards.replaceChildren(...samples.map((sample) => cardFace(sample, frame.id)));
    }
    if (shownField !== field.id) {
      shownField = field.id;
      stage.style.backgroundImage = `url("${assetUrl('./art/' + field.art)}")`;
    }
    caption.textContent = `Рамка: ${frame.name} · Поле: ${field.name}`;
  }

  function update() {
    for (const { preferences, choices } of groups) {
      for (const { item, choice } of choices) {
        choice.setAttribute('aria-pressed', String(item.id === preferences.current()));
      }
    }
    updatePreview();
  }

  function activateTab(id) {
    hovered = focused = undefined;
    for (const { id: groupId, tab, grid } of groups) {
      const active = id === groupId;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      grid.hidden = !active;
    }
    updatePreview();
  }

  function options(id, label, items, preferences, miniature) {
    const tab = button(label, () => activateTab(id), 'decoration-tab');
    tab.id = 'decoration-tab-' + id;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = groups.findIndex((group) => group.id === id);
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      const next = event.key === 'Home' ? groups[0] : event.key === 'End' ? groups.at(-1)
        : groups[(index + step + groups.length) % groups.length];
      activateTab(next.id);
      next.tab.focus();
    });
    const grid = element('div', 'decoration-options');
    grid.id = 'decoration-options-' + id;
    grid.setAttribute('role', 'tabpanel');
    grid.setAttribute('aria-labelledby', tab.id);
    tab.setAttribute('aria-controls', grid.id);
    const choices = items.map((item) => {
      const temporary = { group: id, item };
      const choice = button(undefined, () => {
        if (item.locked) return;
        status.textContent = preferences.select(item.id) ? '' : 'Выбор действует до перезагрузки.';
        update();
      }, 'decoration-option');
      const visual = element('span', 'decoration-thumbnail');
      visual.setAttribute('aria-hidden', 'true');
      visual.append(miniature(item), element('span', 'decoration-mark', item.locked ? '🔒' : '✓'));
      choice.append(visual, element('span', 'decoration-name', item.name));
      if (item.locked) {
        choice.setAttribute('aria-disabled', 'true');
        choice.append(element('small', 'decoration-unlock', 'Откроется в Книге наград'));
      }
      choice.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        hovered = temporary;
        updatePreview();
      });
      choice.addEventListener('pointerleave', () => {
        if (hovered === temporary) hovered = undefined;
        updatePreview();
      });
      choice.addEventListener('focus', () => {
        focused = temporary;
        updatePreview();
      });
      choice.addEventListener('blur', () => {
        if (focused === temporary) focused = undefined;
        updatePreview();
      });
      grid.append(choice);
      return { item, choice };
    });
    tablist.append(tab);
    controls.append(grid);
    return { id, items, preferences, tab, grid, choices };
  }

  const header = element('header', 'decoration-header');
  header.append(sectionBack(back), heading);
  const layout = element('div', 'decoration-layout');
  layout.append(preview, controls);
  panel.append(header, layout, status);
  activateTab('frames');
  update();
  on('decorations-change', update, { signal });
  return panel;
}
