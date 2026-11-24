import { createBaseGrid } from './base-grid.js?v=choir-art-6';
import { BASE_OVERLAYS, BASE_POSITIONS, baseLayout, overlayStyle } from './base-layout.js?v=base-mine-1';
import { BASE_PLOTS, BUILDING_BY_PLOT, BUILDINGS, MATERIALS, buildingEffect, constructionShortages } from '../game/base.js?v=tavern-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { dialogClose, resourceGlyph as materialIcon, resourceLabel, sectionDialog } from './resources.js?v=essence-gain-1';

const labels = { gold: resourceLabel('gold'), ...MATERIALS };
const USE_BASE_OVERLAYS = false;
const reserved = 'Участок под будущую постройку';

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
  const materials = element('div', 'base-materials');
  materials.setAttribute('aria-label', 'Ресурсы базы');
  const figures = Object.keys(labels).map((key) => {
    const resource = element('span', 'base-resource');
    resource.dataset.material = key;
    resource.title = labels[key];
    const count = element('strong');
    resource.append(materialIcon(key), element('span', 'base-resource-label', labels[key]), count);
    materials.append(resource);
    return { key, count };
  });
  function updateMaterials(scene, gold) {
    const values = { gold, ...scene.materials };
    for (const { key, count } of figures) count.textContent = values[key];
  }

  if (USE_BASE_OVERLAYS) {
    shell.append(materials);
    return createOverlayBaseScreen(progress, dialog, shell, updateMaterials);
  }

  dialog.classList.add('base-screen-grid');
  dialog.querySelector('.section-back').after(materials);
  const grid = createBaseGrid(shell, progress, labels, materialIcon);
  let timer;
  function update() {
    const scene = progress.base();
    const { gold } = progress.inventory();
    updateMaterials(scene, gold);
    grid.update(scene, gold);
  }
  progress.subscribe(() => { if (dialog.open) update(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearInterval(timer);
    void progress.checkpointProduction();
  });
  document.addEventListener('visibilitychange', () => {
    if (!dialog.open) return;
    if (document.hidden) void progress.checkpointProduction();
    else grid.updateProduction();
  });
  return () => {
    if (dialog.open) return;
    update();
    dialog.showModal();
    dialog.scrollTop = 0;
    clearInterval(timer);
    timer = setInterval(grid.updateProduction, 1000);
  };
}

function createOverlayBaseScreen(progress, dialog, shell, updateMaterials) {
  const stage = element('div', 'base-stage');
  const tooltip = element('span', 'base-tooltip');
  tooltip.hidden = true;
  shell.prepend(stage);

  function resizeStage({ width, height }) {
    if (!width || !height) return;
    for (const [key, value] of Object.entries(baseLayout(width, height))) {
      stage.style[key] = value + 'px';
    }
  }
  new ResizeObserver(([entry]) => resizeStage(entry.contentRect)).observe(shell);

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
  let scene = progress.base();
  const plots = BASE_PLOTS.map((id, index) => {
    const [x, y, width, height] = BASE_POSITIONS[index];
    const lot = element('div', 'base-lot');
    const control = button(undefined, () => openPlot(id), 'base-plot');
    control.setAttribute('aria-haspopup', 'dialog');
    control.style.setProperty('--plot-x', x + '%');
    control.style.setProperty('--plot-y', y + '%');
    control.style.setProperty('--plot-size', width + '%');
    control.style.setProperty('--plot-height', height + '%');
    const pad = element('span', 'base-pad');
    if (!BUILDING_BY_PLOT[id]) control.classList.add('is-reserved');
    const view = { id, x, y, lot, control, pad, kind: BUILDING_BY_PLOT[id] };
    control.append(pad);
    const overlay = BASE_OVERLAYS[id];
    if (overlay) {
      const layer = element('div', 'base-overlay');
      layer.hidden = true;
      Object.assign(layer.style, overlayStyle(overlay.rect));
      for (const [role, source] of [['art', overlay.image], ['silhouette', overlay.silhouette]]) {
        const image = element('img', 'base-overlay-' + role);
        image.alt = '';
        image.draggable = false;
        image.src = source;
        layer.append(image);
        if (role === 'silhouette') {
          image.decode().then(() => { view.mask = makeMask(image); }).catch(() => {});
        }
      }
      view.layer = layer;
      lot.append(layer);
    }
    lot.append(control);
    stage.append(lot);
    return view;
  });
  stage.append(tooltip);

  function plotAt(event) {
    const { clientX: x, clientY: y } = event;
    return plots.findLast(({ id, layer, pad, mask }) => scene.buildings[id]
      ? mask && contains(layer.getBoundingClientRect(), x, y, mask)
      : contains(pad.getBoundingClientRect(), x, y));
  }

  function highlight(plot) {
    if (plot === hovered) return;
    hovered?.lot.removeAttribute('data-hover');
    hovered = plot;
    tooltip.hidden = !plot || !matchMedia('(hover: hover)').matches;
    if (!plot) return;
    plot.lot.dataset.hover = '';
    const building = scene.buildings[plot.id];
    tooltip.textContent = building ? BUILDINGS[building.kind].name
      : plot.kind ? 'Построить: ' + BUILDINGS[plot.kind].name : reserved;
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
      body.replaceChildren(element('strong', null, 'Уровень ' + building.level),
        element('p', null, buildingEffect(building.kind, building.level)));
      return;
    }
    const kind = BUILDING_BY_PLOT[selected];
    if (!kind) {
      title.textContent = reserved;
      body.replaceChildren();
      return;
    }
    const definition = BUILDINGS[kind];
    title.textContent = definition.name;
    const item = element('div', 'base-build-option');
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
        done: 'Постройка завершена.',
        occupied: 'Участок уже занят.',
        unaffordable: 'Не хватает ресурсов.',
        unavailable: 'Не удалось сохранить постройку.',
      }[outcome] ?? '';
      update();
      if (details.open) details.querySelector('.chrome-button').focus({ preventScroll: true });
    }, 'button primary');
    build.disabled = busy || shortage.length > 0;
    item.append(element('p', null, buildingEffect(kind)), element('p', null, cost), build);
    if (shortage.length) item.append(element('p', 'base-shortage',
      'Не хватает · ' + shortage.map(([key, amount]) => `${labels[key]} ${amount}`).join(' · ')));
    body.replaceChildren(item);
  }

  function update() {
    scene = progress.base();
    const { gold } = progress.inventory();
    updateMaterials(scene, gold);
    for (const { id, control, layer, kind } of plots) {
      const building = scene.buildings[id];
      if (layer) layer.hidden = !building;
      control.classList.toggle('is-built', Boolean(building));
      control.setAttribute('aria-label', building
        ? `Участок ${id} · ${BUILDINGS[building.kind].name} · Уровень ${building.level}`
        : `Участок ${id} · ${kind ? BUILDINGS[kind].name : reserved}`);
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
    resizeStage(shell.getBoundingClientRect());
  };
}
