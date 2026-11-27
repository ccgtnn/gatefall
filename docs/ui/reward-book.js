import { button, createBusyGuard, element } from './dom.js';
import { REWARD_SECTIONS, rewardState } from '../game/meta/reward-book.js';
import { createRewardMap } from './reward-book-map.js';
import { resourceIcon } from './resource-icon.js';
import { dialogClose } from './resources.js';
const rewardKinds = {
  gold: ['Золото', 'Для покупки бустеров.'],
  'gold-stack': ['Большой запас золота', 'Для покупки бустеров.'],
  essence: ['Эссенция', 'Для создания карт.'],
  booster: ['Бустер', 'Набор карт Gatefall.'],
  'card-back': ['Рубашка карт', 'Косметическая награда.'],
  battlefield: ['Фон игрового поля', 'Косметическая награда.'],
};
const stateLabels = {
  available: 'Доступно', unlocked: 'Открыто', locked: 'Закрыто', unaffordable: 'Не хватает ключей',
};

function rewardNotice(node) {
  const amount = {
    gold: 'золота', 'gold-stack': 'золота', essence: 'эссенции', booster: 'буст.',
  }[node.kind];
  const reward = amount ? `+${node.value} ${amount}` : node.label;
  return node.keyReward ? `${reward} · +${node.keyReward} ключей` : reward;
}

export function mountRewardBook(progress, { dialog: book, shell }) {
  const content = element('section', 'reward-chapter');
  const sections = element('div', 'reward-sections');
  sections.setAttribute('role', 'group');
  sections.setAttribute('aria-label', 'Разделы Книги наград');
  const tabs = element('div', 'reward-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Главы раздела');
  const current = element('div', 'reward-page');
  content.append(sections, tabs, current);
  const message = element('p', 'visually-hidden');
  message.setAttribute('role', 'status');
  shell.append(content, message);

  let activeSection = REWARD_SECTIONS[0];
  const selectedChapters = new Map(REWARD_SECTIONS.map((section) => [section.id, section.chapters[0]]));
  let activeChapter = selectedChapters.get(activeSection.id);
  let selected;
  const busy = createBusyGuard();
  let nodeViews = [];
  let chapterViews = [];
  const panel = element('dialog', 'reward-details');
  panel.setAttribute('aria-labelledby', 'reward-details-title');
  const emblem = element('div', 'reward-emblem');
  const kind = element('p', 'reward-kind');
  const label = element('h3', 'reward-label');
  label.id = 'reward-details-title';
  const value = element('p', 'reward-value');
  const description = element('p', 'reward-description');
  const status = element('p', 'reward-status');
  status.setAttribute('role', 'status');
  const action = button(undefined, openNode, 'button primary reward-action');
  const actionPrice = element('span');
  action.append(resourceIcon('key'), actionPrice);
  const close = dialogClose(panel, 'reward-details-close');
  close.autofocus = true;
  panel.append(close, emblem, kind, label, value, description, status, action);
  panel.addEventListener('click', (event) => {
    if (event.target !== panel) return;
    const { top, right, bottom, left } = panel.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) panel.close();
  });
  book.addEventListener('close', () => { if (panel.open) panel.close(); });
  document.body.append(panel);
  const sectionViews = REWARD_SECTIONS.map((section) => {
    const control = button(undefined, () => {
      if (section === activeSection) return;
      activeSection = section;
      activeChapter = selectedChapters.get(section.id);
      drawSection();
    }, 'reward-section-tab');
    const count = element('span', 'reward-tab-progress');
    control.append(element('strong', null, section.title), count);
    sections.append(control);
    return { section, control, count };
  });

  function drawSection() {
    chapterViews = activeSection.chapters.map((chapter) => {
      const tab = button(undefined, () => {
        if (chapter === activeChapter) return;
        activeChapter = chapter;
        selectedChapters.set(activeSection.id, chapter);
        drawPage();
      }, 'reward-tab');
      tab.dataset.faction = chapter.faction;
      const count = element('span', 'reward-tab-progress');
      tab.append(resourceIcon(chapter.faction, true), element('span', 'reward-tab-name', chapter.title), count);
      return { chapter, tab, count };
    });
    tabs.replaceChildren(...chapterViews.map(({ tab }) => tab));
    drawPage();
  }

  function drawPage() {
    const state = progress.get();
    const { faction, tall } = activeChapter;
    message.textContent = '';
    selected = undefined;
    current.dataset.faction = faction;
    current.classList.toggle('reward-page-tall', tall);
    const { chart, nodeViews: views } = createRewardMap(activeChapter, (node) => {
      selected = node;
      message.textContent = '';
      refresh();
      panel.showModal();
    });
    nodeViews = views;

    current.replaceChildren(chart);
    refresh(state);
  }

  function refresh(state = progress.get()) {
    if (!nodeViews.length) return;
    for (const { section, control, count } of sectionViews) {
      const nodes = section.chapters.flatMap((chapter) => chapter.nodes);
      const opened = nodes.filter(({ id }) => state.unlocked.has(id)).length;
      count.textContent = `${opened}/${nodes.length}`;
      control.setAttribute('aria-pressed', String(section === activeSection));
      control.setAttribute('aria-label', `${section.title}, открыто ${opened} из ${nodes.length}`);
    }
    for (const { chapter, tab, count } of chapterViews) {
      const opened = chapter.nodes.filter(({ id }) => state.unlocked.has(id)).length;
      count.textContent = `${opened}/${chapter.nodes.length}`;
      tab.setAttribute('aria-pressed', String(chapter === activeChapter));
      tab.setAttribute('aria-label', `${chapter.title}, открыто ${opened} из ${chapter.nodes.length}`);
    }
    for (const { node, control, incoming } of nodeViews) {
      const availability = rewardState(node, state);
      control.dataset.state = availability;
      control.setAttribute('aria-label', `${node.finale ? 'Главная награда · ' : ''}${node.label} · ${rewardKinds[node.kind][0]} · ключей: ${node.cost} · ${stateLabels[availability]}`);
      control.title = control.getAttribute('aria-label');
      for (const { edge, parent } of incoming) {
        edge.dataset.state = state.unlocked.has(parent.id) ? availability : 'locked';
      }
    }

    if (!selected) return;
    const availability = rewardState(selected, state);
    const [kindLabel, descriptionText] = rewardKinds[selected.kind];
    panel.dataset.kind = selected.kind;
    emblem.replaceChildren(resourceIcon(selected.kind));
    kind.textContent = selected.finale ? 'Главная награда · ' + kindLabel : kindLabel;
    label.textContent = selected.label;
    value.textContent = typeof selected.value === 'string' ? '' : '×' + selected.value;
    description.textContent = selected.keyReward ? `${descriptionText} Бонус: +${selected.keyReward} ключей.` : descriptionText;
    const requirements = activeChapter.nodes.filter((node) => selected.parents.includes(node.id));
    const names = requirements.map((node) => `«${node.label}»`).join(' или ');
    status.textContent = availability === 'locked' ? `Сначала открой ${names}.`
      : availability === 'unaffordable' ? `Нужно ключей: ${selected.cost}. У тебя ${state.keys}.`
        : availability === 'unlocked' ? 'Награда открыта.' : '';
    action.disabled = busy.active || availability !== 'available';
    actionPrice.textContent = availability === 'unlocked' ? 'Открыто' : `Открыть за ${selected.cost}`;
  }

  function showNotice(node, control) {
    if (!control?.isConnected || !book.open) return;
    const notice = element('span', 'reward-notice', rewardNotice(node));
    notice.setAttribute('aria-hidden', 'true');
    control.append(notice);
    const plot = control.parentElement.getBoundingClientRect();
    const buttonRect = control.getBoundingClientRect();
    const middle = buttonRect.left + buttonRect.width / 2;
    const half = notice.offsetWidth / 2;
    const center = Math.max(plot.left + half + 4, Math.min(plot.right - half - 4, middle));
    notice.style.marginInlineStart = (center - middle) + 'px';
    setTimeout(() => notice.remove(), 1800);
  }

  async function openNode() {
    if (busy.active || !selected) return;
    const node = selected;
    const control = nodeViews.find((view) => view.node === node)?.control;
    const outcome = await busy.run(() => {
      action.disabled = true;
      return progress.unlock(node.id);
    });
    if (outcome === 'opened') {
      if (node === selected && panel.open) panel.close();
      showNotice(node, control);
      message.textContent = `Награда получена. ${rewardNotice(node)}. Потрачено ключей: ${node.cost}.`;
    } else {
      message.textContent = outcome === 'unavailable'
        ? 'Не удалось сохранить открытие. Ключи не потрачены.' : stateLabels[outcome] ?? '';
    }
    refresh();
    if (outcome === 'unavailable' && node === selected) status.textContent = message.textContent;
  }

  progress.subscribe(() => { if (book.open) refresh(); });
  return drawSection;
}
