import { FACTIONS } from '../game/cards.js?v=robot-art-28';
import { createCard } from '../game/board.js?v=robot-art-28';
import { decorateCard } from './cards.js?v=decorations-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { sectionBack } from './resources.js?v=interface-polish-1';

export const FRAME_STORAGE_KEY = 'gatefall.card-frame';
const frames = [
  { id: 'standard', name: 'Стандартные рамки' },
  { id: 'protectorate-rampart', name: 'Рубеж Протектората' },
];

export function createFramePreferences(storage, root) {
  let current;
  function apply(id) {
    current = frames.some((frame) => frame.id === id) ? id : 'standard';
    root.dataset.cardFrameChoice = current;
  }
  function refresh() {
    try { apply(storage?.getItem(FRAME_STORAGE_KEY)); }
    catch { apply(current); }
  }
  refresh();
  return {
    current: () => current,
    refresh,
    select(id) {
      if (!frames.some((frame) => frame.id === id)) return false;
      apply(id);
      try {
        if (!storage) return false;
        storage.setItem(FRAME_STORAGE_KEY, id);
        return true;
      } catch { return false; }
    },
  };
}

export function decorationsScreen(phase, preferences, back) {
  phase.textContent = '';
  const panel = element('section', 'panel decorations-panel');
  const heading = element('h2', null, 'Украшения');
  heading.tabIndex = -1;
  const grid = element('div', 'decoration-options');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Рамки карт');
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  const definition = FACTIONS.protectorate.pool.find(({ id }) => id === 'bastion');
  const sample = createCard(definition.id, definition);
  const options = frames.map(({ id, name }) => {
    const choice = button(undefined, () => {
      const saved = preferences.select(id);
      status.textContent = saved ? '' : 'Выбор действует до перезагрузки.';
      update();
    }, 'button decoration-option');
    const face = element('span', 'hand-card decoration-face');
    decorateCard(face, sample, { factionId: definition.faction }, { showProvision: true, fullArt: true, frame: id });
    face.setAttribute('aria-hidden', 'true');
    choice.append(face, element('strong', null, name));
    grid.append(choice);
    return { id, choice };
  });
  function update() {
    for (const { id, choice } of options) {
      choice.setAttribute('aria-pressed', String(id === preferences.current()));
    }
  }
  panel.addEventListener('frame-change', update);
  update();
  panel.append(sectionBack(back), heading, grid, status);
  return panel;
}
