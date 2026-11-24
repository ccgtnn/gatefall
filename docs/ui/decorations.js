import { FACTIONS } from '../game/cards.js?v=choir-playable-1';
import { createCard } from '../game/board.js?v=choir-playable-1';
import { decorateCard } from './cards.js?v=choir-playable-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { sectionBack } from './resources.js?v=essence-gain-1';

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
  { id: 'wood', name: 'Деревянная доска', art: 'battlefield-wood.webp?v=2' },
  { id: 'metal', name: 'Тактический стол', art: 'battlefield-metal.webp?v=2' },
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
    current = choices.some((choice) => choice.id === id) ? id : 'standard';
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
      if (!choices.some((choice) => choice.id === id)) return false;
      apply(id);
      try {
        if (!storage) return false;
        storage.setItem(key, id);
        return true;
      } catch { return false; }
    },
  };
}

export function decorationsScreen(phase, framesPreference, battlefieldPreference, back) {
  phase.textContent = '';
  const panel = element('section', 'panel decorations-panel');
  const heading = element('h2', null, 'Украшения');
  heading.tabIndex = -1;
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  const definition = FACTIONS.protectorate.pool.find(({ id }) => id === 'bastion');
  const sample = createCard(definition.id, definition);
  const frameOptions = decorationOptions('Рамки карт', frames, framesPreference, ({ id }) => {
    const face = element('span', 'hand-card decoration-face');
    decorateCard(face, sample, { factionId: definition.faction }, { showProvision: true, fullArt: true, frame: id });
    return face;
  });
  const fieldOptions = decorationOptions('Поле боя · ПК', battlefields, battlefieldPreference, ({ art }) => {
    const image = element('img', 'decoration-field');
    image.alt = '';
    image.src = './art/' + art;
    return image;
  });

  function decorationOptions(label, items, preferences, preview) {
    const section = element('section', 'decoration-section');
    const grid = element('div', 'decoration-options');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', label);
    const options = items.map((item) => {
      const choice = button(undefined, () => {
        status.textContent = preferences.select(item.id) ? '' : 'Выбор действует до перезагрузки.';
        update();
      }, 'button decoration-option');
      const visual = preview(item);
      visual.setAttribute('aria-hidden', 'true');
      choice.append(visual, element('strong', null, item.name));
      grid.append(choice);
      return { id: item.id, choice };
    });
    function update() {
      for (const { id, choice } of options) choice.setAttribute('aria-pressed', String(id === preferences.current()));
    }
    panel.addEventListener('decorations-change', update);
    update();
    section.append(element('h3', null, label), grid);
    return section;
  }
  const header = element('header', 'decoration-header');
  header.append(sectionBack(back), heading);
  panel.append(header, frameOptions, fieldOptions, status);
  return panel;
}
