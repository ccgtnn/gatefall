import { element } from './dom.js?v=opponent-reveal-1';

function symbol(name, size = 40) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', `0 0 ${size} ${size}`);
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', './demo/stat-badges.svg?v=orbital-strike-1#' + name);
  icon.append(use);
  return icon;
}

const badgeArt = {
  'hud-power': { file: 'hud-power.webp' },
  'hud-provision': { file: 'hud-provision.webp' },
  'hud-power-4': { file: 'hud-power-4.webp', numbered: true },
  'hud-power-4-detail': { file: 'hud-power-4-detail.webp', numbered: true },
  'hud-provision-8': { file: 'hud-provision-8.webp', numbered: true },
};

export function statBadge(kind, label, value, variant = kind) {
  const node = element('span', 'stat-badge stat-badge-' + kind);
  node.title = label;
  node.setAttribute('aria-label', label);
  node.setAttribute('role', 'img');
  const art = Object.hasOwn(badgeArt, variant) ? badgeArt[variant] : undefined;
  if (art) {
    const image = element('img', art.numbered ? 'stat-badge-art stat-badge-number-art' : 'stat-badge-art');
    image.src = './art/' + art.file;
    image.alt = '';
    image.draggable = false;
    node.append(image);
  } else {
    node.append(symbol(variant));
  }
  if (value !== undefined && !art?.numbered) node.append(element('strong', null, value));
  return node;
}

export function scenarioBadge(played, total) {
  const node = element('span', 'stat-badge stat-badge-chapters');
  node.setAttribute('role', 'img');
  node.title = `Главы сценария: ${played} из ${total}`;
  node.setAttribute('aria-label', node.title);
  for (let index = 0; index < total; index++) {
    node.append(symbol(index < played ? 'chapter-filled' : 'chapter-empty', 20));
  }
  return node;
}

export function orderBadge(ready, cooldown, label) {
  return statBadge('order', label, cooldown || undefined, ready ? 'order-ready' : 'order-cooldown');
}
