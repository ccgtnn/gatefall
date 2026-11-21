import { button, element } from './dom.js?v=opponent-reveal-1';
import { REWARD_SECTIONS, rewardState } from '../game/rewards.js?v=golem-trio-1';
import { resourceIcon } from './resource-icon.js?v=1';

const svgNamespace = 'http://www.w3.org/2000/svg';
const rewardKinds = {
  gold: ['Золото', 'Для покупки бустеров.'],
  'gold-stack': ['Большой запас золота', 'Для покупки бустеров.'],
  essence: ['Эссенция', 'Для создания карт.'],
  booster: ['Бустер', 'Набор карт Gatefall.'],
  'card-back': ['Рубашка карт', 'Редкая награда в конце маршрута.'],
  battlefield: ['Фон игрового поля', 'Редкая награда в конце маршрута.'],
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
  const book = element('dialog', 'reward-book');
  book.id = 'reward-book';
  book.setAttribute('aria-labelledby', 'reward-book-title');
  const shell = element('div', 'reward-shell');
  const header = element('header', 'reward-header');
  const heading = element('h2', null, 'Книга наград');
  heading.id = 'reward-book-title';
  heading.tabIndex = -1;
  heading.autofocus = true;
  header.append(button('Назад', () => book.close(), 'button reward-back'), heading);

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
  shell.append(header, content, message);
  book.append(shell);
  document.body.append(book);

  let activeSection = REWARD_SECTIONS[0];
  const selectedChapters = new Map(REWARD_SECTIONS.map((section) => [section.id, section.chapters[0]]));
  let activeChapter = selectedChapters.get(activeSection.id);
  let selected;
  let busy = false;
  let nodeViews = [];
  let chapterViews = [];
  let details;
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
    selected = nodes.find((node) => rewardState(node, state) === 'available') ?? nodes[0];
    current.dataset.faction = faction;
    const pageHeading = element('h3', 'reward-page-title', title);
    const grid = element('div', 'reward-page-grid');
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
      let edge;
      if (node.parent) {
        const parent = nodesById.get(node.parent);
        edge = document.createElementNS(svgNamespace, 'line');
        edge.setAttribute('x1', parent.x);
        edge.setAttribute('y1', parent.y);
        edge.setAttribute('x2', node.x);
        edge.setAttribute('y2', node.y);
        edge.setAttribute('vector-effect', 'non-scaling-stroke');
        edges.append(edge);
      }
      const control = button(undefined, () => {
        selected = node;
        message.textContent = '';
        refresh();
      }, 'reward-node');
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
      return { node, control, edge };
    });
    chart.append(plot);

    const panel = element('aside', 'reward-details');
    const emblem = element('div', 'reward-emblem');
    const kind = element('p', 'reward-kind');
    const label = element('h4', 'reward-label');
    const value = element('p', 'reward-value');
    const description = element('p', 'reward-description');
    const status = element('p', 'reward-status');
    const action = button(undefined, openNode, 'button reward-action');
    const actionPrice = element('span');
    action.append(resourceIcon('key'), actionPrice);
    panel.append(emblem, kind, label, value, description, status, action);
    details = { panel, emblem, kind, label, value, description, status, action, actionPrice };
    grid.append(chart, panel);
    current.replaceChildren(pageHeading, tip, grid);
    refresh(state);
    const selectedControl = nodeViews.find(({ node }) => node === selected).control;
    requestAnimationFrame(() => {
      if (!chart.isConnected || !book.open || chart.scrollWidth <= chart.clientWidth) return;
      chart.scrollLeft = selectedControl.offsetLeft - chart.clientWidth / 2;
    });
  }

  function refresh(state = progress.get()) {
    if (!details) return;
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
    for (const { node, control, edge } of nodeViews) {
      const availability = rewardState(node, state);
      control.dataset.state = availability;
      control.setAttribute('aria-pressed', String(node === selected));
      control.setAttribute('aria-label', `${node.label} · ${rewardKinds[node.kind][0]} · ключей: ${node.cost} · ${stateLabels[availability]}`);
      control.title = control.getAttribute('aria-label');
      if (edge) edge.dataset.state = availability;
    }

    const availability = rewardState(selected, state);
    const [kind, description] = rewardKinds[selected.kind];
    const rare = typeof selected.value === 'string';
    details.panel.dataset.kind = selected.kind;
    details.emblem.replaceChildren(resourceIcon(selected.kind));
    details.kind.textContent = kind;
    details.label.textContent = selected.label;
    details.value.textContent = rare ? '' : '×' + selected.value;
    details.description.textContent = description;
    const parent = activeChapter.nodes.find((node) => node.id === selected.parent);
    details.status.textContent = availability === 'locked' ? `Сначала открой «${parent.label}».`
      : availability === 'unaffordable' ? `Нужно ключей: ${selected.cost}. У тебя ${state.keys}.`
        : availability === 'unlocked' ? 'Награда открыта.' : '';
    details.action.disabled = busy || availability !== 'available';
    details.actionPrice.textContent = availability === 'unlocked' ? 'Открыто' : `Открыть за ${selected.cost}`;
  }

  async function openNode() {
    if (busy || !selected) return;
    const node = selected;
    busy = true;
    details.action.disabled = true;
    const outcome = await progress.unlock(node.id);
    busy = false;
    refresh();
    message.textContent = outcome === 'opened' ? `Открыто: ${node.label}. Потрачено ключей: ${node.cost}.`
      : outcome === 'unavailable' ? 'Не удалось сохранить открытие. Ключи не потрачены.' : stateLabels[outcome] ?? '';
    if (outcome === 'unavailable' && node === selected) details.status.textContent = message.textContent;
  }

  progress.subscribe(() => { if (book.open) refresh(); });
  return { dialog: book, header, prepare: drawSection };
}
