import { assetUrl } from './asset-url.js';
import { BOOSTER_FACTIONS } from '../game/meta/collection-economy.js';
import { element } from './dom.js';
import { resourceIcon } from './resource-icon.js';
import { sectionDialog } from './resources.js';

export function economyDialog(id, title) {
  const { dialog, shell } = sectionDialog(id, title, 'economy-page');
  const body = element('div', 'economy-content');
  shell.append(body);
  return { dialog, body };
}

export function capsule(page) {
  const pack = element('span', 'booster-capsule');
  pack.dataset.faction = page.id;
  pack.setAttribute('aria-hidden', 'true');
  pack.append(resourceIcon(page.id, true), element('span', 'booster-capsule-rim'));
  return pack;
}

export function packOptions(className) {
  return BOOSTER_FACTIONS.map((page) => {
    const item = element('article', 'booster-option ' + className);
    item.dataset.faction = page.id;
    item.style.setProperty('--booster-art', `url('${assetUrl('./art/' + page.image)}')`);
    item.append(capsule(page), element('h3', null, page.name));
    return { page, item };
  });
}

export function liveStatus() {
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  return status;
}
