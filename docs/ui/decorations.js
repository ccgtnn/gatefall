import { on } from './app-events.js';
import { assetUrl } from './asset-url.js';
import { FACTIONS } from '../game/cards/cards.js';
import { REWARD_SECTIONS } from '../game/meta/reward-book.js';
import { createCard } from '../game/engine/board.js';
import { decorateCard } from './cards.js';
import { button, element } from './dom.js';
import { sectionBack } from './resources.js';

export const FRAME_STORAGE_KEY = 'gatefall.card-frame';
export const BATTLEFIELD_STORAGE_KEY = 'gatefall.battlefield';
export const CARD_BACK_STORAGE_KEY = 'gatefall.card-backs';
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
  { id: 'bridge', name: 'Мостик флагмана', art: 'battlefield-bridge.webp' },
  { id: 'new-year', name: 'Новогодний стол', art: 'battlefield-new-year.webp' },
  { id: 'heart-of-growth', name: 'Сердце Поросли', art: 'battlefield-heart-of-growth.webp' },
  // Fields from the Reward Book open after purchase. Until their art is drawn they show the standard nebula.
  ...REWARD_SECTIONS.flatMap(({ chapters }) => chapters.flatMap(({ nodes }) => nodes))
    .filter(({ kind }) => kind === 'battlefield')
    .map(({ id, label }) => ({ id: 'book-' + id.replace(':', '-'), name: label, art: 'home-nebula.webp', reward: id })),
];

export function createFramePreferences(storage, root) {
  return createChoicePreferences(storage, root, FRAME_STORAGE_KEY, 'cardFrameChoice', frames);
}

const bookBacks = new Map(REWARD_SECTIONS[0].chapters.flatMap(({ faction, nodes }) =>
  nodes.filter(({ kind }) => kind === 'card-back').map(({ id, label }) => [faction, { id, label }])));
const BACK_FACTIONS = Object.keys(FACTIONS).filter((faction) => FACTIONS[faction].cardBack);

/** Back choices for one faction: its standard back, its improved Reward Book back and the neutral book back. */
export function cardBackChoices(faction, rewardUnlocked = () => false) {
  const own = bookBacks.get(faction);
  const neutral = bookBacks.get('neutral');
  return [
    { id: 'standard', faction, name: 'Стандартная', art: FACTIONS[faction].cardBack },
    ...(own ? [{ id: 'improved', faction, name: own.label, art: `back-${faction}-improved.webp`, reward: own.id }] : []),
    ...(neutral ? [{ id: 'neutral', faction, name: neutral.label, art: 'back-neutral-improved.webp', reward: neutral.id }] : []),
  ].map((item) => item.reward ? { ...item, locked: !rewardUnlocked(item.reward) } : item);
}

/** @param {(nodeId: string) => boolean} [rewardUnlocked] */
export function createCardBackPreferences(storage, rewardUnlocked = () => false) {
  let saved = {};
  const choice = (faction) => cardBackChoices(faction, rewardUnlocked)
    .find(({ id, locked }) => id === saved[faction] && !locked) ?? cardBackChoices(faction)[0];
  function refresh() {
    try {
      const parsed = JSON.parse(storage?.getItem(CARD_BACK_STORAGE_KEY) ?? '{}');
      saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { /* keep the last known choice */ }
  }
  refresh();
  return {
    factions: BACK_FACTIONS,
    choices: (faction) => cardBackChoices(faction, rewardUnlocked),
    current: (faction) => choice(faction).id,
    art: (faction) => choice(faction).art,
    refresh,
    select(faction, id) {
      if (!cardBackChoices(faction, rewardUnlocked).some((item) => item.id === id && !item.locked)) return false;
      saved = { ...saved, [faction]: id };
      try {
        if (!storage) return false;
        storage.setItem(CARD_BACK_STORAGE_KEY, JSON.stringify(saved));
        return true;
      } catch { return false; }
    },
  };
}

/** @param {(nodeId: string) => boolean} [rewardUnlocked] */
export function createBattlefieldPreferences(storage, root, rewardUnlocked = () => false) {
  return createChoicePreferences(storage, root, BATTLEFIELD_STORAGE_KEY, 'battlefieldChoice', () => battlefields.map((item) =>
    item.reward ? { ...item, locked: !rewardUnlocked(item.reward) } : item));
}

function createChoicePreferences(storage, root, key, attribute, source) {
  const list = () => typeof source === 'function' ? source() : source;
  let current;
  function apply(id) {
    current = list().some((choice) => choice.id === id && !choice.locked) ? id : 'standard';
    root.dataset[attribute] = current;
  }
  function refresh() {
    try { apply(storage?.getItem(key)); }
    catch { apply(current); }
  }
  refresh();
  return {
    current: () => current,
    choices: list,
    refresh,
    select(id) {
      if (!list().some((choice) => choice.id === id && !choice.locked)) return false;
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
  { frameChoices = frames, battlefieldChoices = battlefieldPreference.choices?.() ?? battlefields, cardBacks } = {}) {
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
  if (cardBacks) {
    const items = cardBacks.factions.flatMap((faction) => cardBacks.choices(faction).map((item) =>
      ({ ...item, id: faction + ':' + item.id, choice: item.id, name: `${FACTIONS[faction].name} · ${item.name}` })));
    const split = (id) => [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    groups.push(options('backs', 'Рубашки', items, {
      current: () => '',
      isCurrent: (id) => cardBacks.current(split(id)[0]) === split(id)[1],
      select: (id) => cardBacks.select(...split(id)),
    }, backImage));
  }

  function backImage({ art, faction }) {
    const image = element('img', 'decoration-back');
    image.alt = '';
    image.src = assetUrl('./art/' + art);
    image.addEventListener?.('error', () => { image.src = assetUrl('./art/' + FACTIONS[faction].cardBack); }, { once: true });
    return image;
  }

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
        choice.setAttribute('aria-pressed', String(preferences.isCurrent ? preferences.isCurrent(item.id) : item.id === preferences.current()));
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
