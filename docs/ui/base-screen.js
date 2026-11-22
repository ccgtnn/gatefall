import { BASE_PLOTS, BUILDINGS, MATERIALS, constructionShortages } from '../game/base.js?v=base-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { dialogClose, sectionDialog } from './resources.js?v=interface-polish-1';
import { resourceIcon } from './resource-icon.js?v=1';

// Bottom-center anchors, ordered from the horizon toward the viewer.
const positions = [
  [52.8, 51.9, 12, 4.3], [68.8, 56.3, 20, 7.2], [37, 57.1, 20, 7.2],
  [58.8, 62.2, 15, 6.3], [77, 67.8, 23, 9.8], [27.4, 71.5, 25, 11.3],
];
const labels = { gold: 'Золото', ...MATERIALS };
const iconPath = {
  steel: 'm4 11 12-6 12 6-12 6Zm0 5 12 6 12-6M4 21l12 6 12-6',
  energyCells: 'M10 6h12v23H10zM13 3h6v3m-1 4-4 8h4l-3 6',
  gateShards: 'm16 3 9 10-9 16-9-16zm0 0v26M7 13h18M4 7v4m-2-2h4m21 13v4m-2-2h4',
};
const spritePath = './art/base-tavern.webp';

function materialIcon(key) {
  if (key === 'gold') return resourceIcon(key);
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 32 32');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', iconPath[key]);
  icon.append(path);
  return icon;
}

function makeMask(sprite) {
  const { naturalWidth: width, naturalHeight: height } = sprite;
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(sprite, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  return { width, height, pixels };
}

function contains(rect, x, y, mask) {
  const u = (x - rect.left) / rect.width;
  const v = (y - rect.top) / rect.height;
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return false;
  if (mask) {
    const pixel = Math.floor(v * mask.height) * mask.width + Math.floor(u * mask.width);
    return mask.pixels[pixel * 4 + 3] >= 32;
  }
  return (u - .5) ** 2 + (v - .5) ** 2 <= .25;
}

export function createBaseScreen(progress) {
  const { dialog, shell } = sectionDialog('base-screen', 'База', 'base-screen');
  const stage = element('div', 'base-stage');
  const materials = element('div', 'base-materials');
  materials.setAttribute('aria-label', 'Ресурсы базы');
  const heading = element('h2', 'base-heading', 'База');
  const tooltip = element('span', 'base-tooltip');
  tooltip.hidden = true;
  const figures = Object.keys(labels).map((key) => {
    const resource = element('span', 'base-resource');
    resource.dataset.material = key;
    resource.title = labels[key];
    const count = element('strong');
    resource.append(materialIcon(key), element('span', 'base-resource-label', labels[key]), count);
    materials.append(resource);
    return { key, count };
  });
  shell.append(stage, heading, materials);

  const details = element('dialog', 'panel base-details');
  details.setAttribute('aria-labelledby', 'base-details-title');
  const detailHeader = element('header', 'drawer-header');
  const title = element('h3');
  title.id = 'base-details-title';
  const body = element('div', 'base-details-content');
  const status = element('p', 'base-status');
  status.setAttribute('role', 'status');
  detailHeader.append(title, dialogClose(details));
  details.append(detailHeader, body, status);
  document.body.append(details);

  let selected;
  let hovered;
  let busy = false;
  let mask;
  let scene = progress.base();
  const plots = BASE_PLOTS.map((id, index) => {
    const [x, y, width, height] = positions[index];
    const control = button(undefined, () => openPlot(id), 'base-plot');
    control.setAttribute('aria-haspopup', 'dialog');
    control.style.setProperty('--plot-x', x + '%');
    control.style.setProperty('--plot-y', y + '%');
    control.style.setProperty('--plot-size', width + '%');
    control.style.setProperty('--plot-height', height + '%');
    const pad = element('span', 'base-pad');
    const sprite = element('img', 'base-building');
    sprite.alt = '';
    sprite.draggable = false;
    sprite.hidden = true;
    sprite.src = spritePath;
    if (!index) sprite.decode().then(() => { mask = makeMask(sprite); }).catch(() => {});
    control.append(pad, sprite);
    stage.append(control);
    return { id, x, y, control, pad, sprite };
  });
  stage.append(tooltip);

  function plotAt(event) {
    const { clientX: x, clientY: y } = event;
    return plots.findLast(({ id, sprite, pad }) => scene.buildings[id]
      ? mask && contains(sprite.getBoundingClientRect(), x, y, mask)
      : contains(pad.getBoundingClientRect(), x, y));
  }

  function highlight(plot) {
    if (plot === hovered) return;
    hovered?.control.removeAttribute('data-hover');
    hovered = plot;
    tooltip.hidden = !plot || !matchMedia('(hover: hover)').matches;
    if (!plot) return;
    plot.control.dataset.hover = '';
    const building = scene.buildings[plot.id];
    tooltip.textContent = building ? BUILDINGS[building.kind].name
      : 'Пустой участок · ' + Object.values(BUILDINGS).map(({ name }) => name).join(', ');
    tooltip.style.left = plot.x + '%';
    tooltip.style.top = plot.y + '%';
  }

  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') highlight(plotAt(event));
  });
  stage.addEventListener('pointerleave', () => highlight(undefined));
  stage.addEventListener('click', (event) => {
    // Keyboard activation is handled by the actual plot button.
    if (event.target.closest('.base-plot')) return;
    const plot = plotAt(event);
    if (plot) openPlot(plot.id);
  });

  function openPlot(plot) {
    selected = plot;
    status.textContent = '';
    highlight(plots.find(({ id }) => id === plot));
    update();
    details.showModal();
  }

  function renderDetails(gold) {
    if (!selected) return;
    const building = scene.buildings[selected];
    if (building) {
      const definition = BUILDINGS[building.kind];
      title.textContent = definition.name;
      const slots = definition.dailySlots[building.level - 1];
      body.replaceChildren(element('strong', null, 'Уровень ' + building.level),
        element('p', null, definition.description),
        element('p', null, 'Ежедневные задания — скоро' + (slots ? ' · Слотов: ' + slots : '')));
      return;
    }
    title.textContent = 'Пустой участок';
    const list = element('ul', 'base-buildings');
    for (const [kind, definition] of Object.entries(BUILDINGS)) {
      const item = element('li', 'base-build-option');
      const cost = Object.entries(definition.cost).map(([key, price]) => `${labels[key]} ${price}`).join(' · ');
      const shortage = constructionShortages(definition.cost, gold, scene.materials);
      const plot = selected;
      const build = button('Построить', async () => {
        if (busy) return;
        busy = true;
        build.disabled = true;
        const outcome = await progress.build(plot, kind);
        busy = false;
        if (selected === plot) status.textContent = {
          done: 'Таверна построена.',
          occupied: 'Участок уже занят.',
          unaffordable: 'Не хватает ресурсов.',
          unavailable: 'Не удалось сохранить постройку.',
        }[outcome] ?? '';
        update();
        if (details.open) details.querySelector('.chrome-button').focus({ preventScroll: true });
      }, 'button primary');
      build.disabled = busy || shortage.length > 0;
      item.append(element('strong', null, definition.name), element('p', null, cost), build);
      if (shortage.length) item.append(element('p', 'base-shortage',
        'Не хватает · ' + shortage.map(([key, amount]) => `${labels[key]} ${amount}`).join(' · ')));
      list.append(item);
    }
    body.replaceChildren(list);
  }

  function update() {
    scene = progress.base();
    const { gold } = progress.inventory();
    const values = { gold, ...scene.materials };
    for (const { key, count } of figures) count.textContent = values[key];
    for (const { id, control, sprite } of plots) {
      const building = scene.buildings[id];
      sprite.hidden = !building;
      control.classList.toggle('is-built', Boolean(building));
      control.setAttribute('aria-label', building
        ? `Участок ${id} · ${BUILDINGS[building.kind].name} · Уровень ${building.level}`
        : `Участок ${id} · Пустой участок`);
    }
    renderDetails(gold);
  }

  progress.subscribe(() => { if (dialog.open) update(); });
  details.addEventListener('close', () => {
    plots.find(({ id }) => id === selected)?.control.focus({ preventScroll: true });
    selected = undefined;
    highlight(undefined);
  });
  return () => {
    update();
    dialog.showModal();
  };
}
