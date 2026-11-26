import { createBaseGrid } from './base-grid.js';
import { MATERIALS } from '../game/base.js';
import { element } from './dom.js';
import { resourceGlyph as materialIcon, resourceLabel } from './resources.js';

const labels = { gold: resourceLabel('gold'), ...MATERIALS };

export function mountBaseScreen(progress, { dialog, shell }) {
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
    update();
    dialog.scrollTop = 0;
    clearInterval(timer);
    timer = setInterval(grid.updateProduction, 1000);
  };
}
