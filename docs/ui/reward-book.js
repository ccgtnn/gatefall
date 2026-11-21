import { button, element } from './dom.js?v=opponent-reveal-1';
import { REWARD_PAGES, rewardState } from '../game/rewards.js?v=economy-1';
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

  const chapter = element('section', 'reward-chapter');
  const chapterTitle = element('h3', 'reward-chapter-title', 'Глава I · Сигналы Врат');
  const tabs = element('div', 'reward-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Страницы главы');
  const current = element('div', 'reward-page');
  chapter.append(chapterTitle, tabs, current);
  const message = element('p', 'visually-hidden');
  message.setAttribute('role', 'status');
  shell.append(header, chapter, message);
  book.append(shell);
  document.body.append(book);

  let activePage = REWARD_PAGES[0];
  let selected;
  let busy = false;
  let nodeViews = [];
  let details;
  const tabViews = REWARD_PAGES.map((page) => {
    const tab = button(undefined, () => {
      if (page === activePage) return;
      activePage = page;
      message.textContent = '';
      drawPage();
    }, 'reward-tab');
    tab.dataset.faction = page.id;
    const title = element('span', 'reward-tab-name', page.name);
    const count = element('span', 'reward-tab-progress');
    tab.append(resourceIcon(page.id, true), title, count);
    tabs.append(tab);
    return { page, tab, count };
  });

  function drawPage() {
    const state = progress.get();
    const { id, name, title, image, nodes } = activePage;
    selected = nodes.find((node) => rewardState(node, state) === 'available') ?? nodes[0];
    current.dataset.faction = id;
    const pageHeading = element('h4', 'reward-page-title', title);
    const grid = element('div', 'reward-page-grid');
    const chart = element('div', 'reward-chart');
    chart.tabIndex = 0;
    chart.setAttribute('role', 'region');
    chart.setAttribute('aria-label', 'Маршруты · ' + name);
    const plot = element('div', 'reward-plot');
    plot.style.setProperty('--reward-map-image', `url('./art/${image}')`);
    const edges = document.createElementNS(svgNamespace, 'svg');
    edges.setAttribute('class', 'reward-edges');
    edges.setAttribute('viewBox', '0 0 100 100');
    edges.setAttribute('preserveAspectRatio', 'none');
    edges.setAttribute('aria-hidden', 'true');
    plot.append(edges);
    nodeViews = nodes.map((node) => {
      let edge;
      if (node.parent) {
        const parent = nodes.find((candidate) => candidate.id === node.parent);
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
    const label = element('h5', 'reward-label');
    const value = element('p', 'reward-value');
    const description = element('p', 'reward-description');
    const status = element('p', 'reward-status');
    const action = button(undefined, openNode, 'button reward-action');
    const actionPrice = element('span');
    action.append(resourceIcon('key'), actionPrice);
    panel.append(emblem, kind, label, value, description, status, action);
    details = { panel, emblem, kind, label, value, description, status, action, actionPrice };
    grid.append(chart, panel);
    current.replaceChildren(pageHeading, grid);
    refresh(state);
  }

  function refresh(state = progress.get()) {
    if (!details) return;
    for (const { page, tab, count } of tabViews) {
      const opened = page.nodes.filter((node) => state.unlocked.has(node.id)).length;
      count.textContent = `${opened}/${page.nodes.length}`;
      tab.setAttribute('aria-pressed', String(page === activePage));
      tab.setAttribute('aria-label', `${page.name}, открыто ${opened} из ${page.nodes.length}`);
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
    const parent = activePage.nodes.find((node) => node.id === selected.parent);
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
  return { dialog: book, header, prepare: drawPage };
}
