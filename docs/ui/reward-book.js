import { button, element } from './dom.js?v=opponent-reveal-1';
import { REWARD_SECTIONS, rewardState } from '../game/rewards.js?v=reward-routes-1';
import { resourceIcon } from './resource-icon.js?v=1';
import { sectionDialog } from './resources.js?v=compact-nav-1';

const svgNamespace = 'http://www.w3.org/2000/svg';
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

function keyAmount(className) {
  const node = element('span', className);
  const count = element('strong', 'reward-key-count');
  node.append(resourceIcon('key'), count);
  return { node, count };
}

export function createRewardBook(progress) {
  const { dialog: book, shell } = sectionDialog('reward-book', 'Книга наград');
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
  let busy = false;
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
  const action = button(undefined, openNode, 'button reward-action');
  const actionPrice = element('span');
  action.append(resourceIcon('key'), actionPrice);
  const close = button('Закрыть', () => panel.close(), 'button reward-details-close');
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
    const { faction, title, image, nodes } = activeChapter;
    message.textContent = '';
    selected = undefined;
    current.dataset.faction = faction;
    const chart = element('div', 'reward-chart');
    chart.tabIndex = 0;
    chart.setAttribute('role', 'region');
    chart.setAttribute('aria-label', 'Маршруты · ' + title);
    const tip = element('p', 'reward-scroll-tip', 'Карту можно листать в стороны.');
    tip.id = 'reward-scroll-tip';
    chart.setAttribute('aria-describedby', tip.id);
    const plot = element('div', 'reward-plot');
    plot.style.setProperty('--reward-map-image', `url('./art/${image}')`);
    const edges = document.createElementNS(svgNamespace, 'svg');
    edges.setAttribute('class', 'reward-edges');
    edges.setAttribute('viewBox', '0 0 100 100');
    edges.setAttribute('preserveAspectRatio', 'none');
    edges.setAttribute('aria-hidden', 'true');
    plot.append(edges);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    nodeViews = nodes.map((node) => {
      const incoming = node.parents.map((id) => {
        const parent = nodesById.get(id);
        const edge = document.createElementNS(svgNamespace, 'line');
        edge.setAttribute('x1', parent.x);
        edge.setAttribute('y1', parent.y);
        edge.setAttribute('x2', node.x);
        edge.setAttribute('y2', node.y);
        edge.setAttribute('vector-effect', 'non-scaling-stroke');
        edges.append(edge);
        return { edge, parent };
      });
      const control = button(undefined, () => {
        selected = node;
        message.textContent = '';
        refresh();
        panel.showModal();
      }, 'reward-node');
      control.setAttribute('aria-haspopup', 'dialog');
      if (node.finale) control.dataset.finale = '';
      control.dataset.kind = node.kind;
      control.style.setProperty('--node-x', node.x + '%');
      control.style.setProperty('--node-y', node.y + '%');
      const price = keyAmount('reward-node-price');
      price.count.textContent = node.cost;
      price.node.setAttribute('aria-hidden', 'true');
      const mark = resourceIcon('check');
      mark.classList.add('reward-node-check');
      control.append(resourceIcon(node.kind), price.node, mark);
      plot.append(control);
      return { node, control, incoming };
    });
    chart.append(plot);

    current.replaceChildren(tip, chart);
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
    description.textContent = descriptionText;
    const requirements = activeChapter.nodes.filter((node) => selected.parents.includes(node.id));
    const names = requirements.map((node) => `«${node.label}»`).join(' или ');
    status.textContent = availability === 'locked' ? `Сначала открой ${names}.`
      : availability === 'unaffordable' ? `Нужно ключей: ${selected.cost}. У тебя ${state.keys}.`
        : availability === 'unlocked' ? 'Награда открыта.' : '';
    action.disabled = busy || availability !== 'available';
    actionPrice.textContent = availability === 'unlocked' ? 'Открыто' : `Открыть за ${selected.cost}`;
  }

  async function openNode() {
    if (busy || !selected) return;
    const node = selected;
    busy = true;
    action.disabled = true;
    const outcome = await progress.unlock(node.id);
    busy = false;
    refresh();
    message.textContent = outcome === 'opened' ? `Открыто: ${node.label}. Потрачено ключей: ${node.cost}.`
      : outcome === 'unavailable' ? 'Не удалось сохранить открытие. Ключи не потрачены.' : stateLabels[outcome] ?? '';
    if (outcome === 'unavailable' && node === selected) status.textContent = message.textContent;
  }

  progress.subscribe(() => { if (book.open) refresh(); });
  return { dialog: book, prepare: drawSection };
}
