import { assetUrl } from '../asset-url.js';
import { element } from './dom.js';

function symbol(name, size = 40) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', `0 0 ${size} ${size}`);
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', assetUrl('./art/stat-badges.svg#' + name));
  icon.append(use);
  return icon;
}

export function statBadge(kind, label, value, variant = kind) {
  const node = element('span', 'stat-badge stat-badge-' + kind);
  node.title = label;
  node.setAttribute('aria-label', label);
  node.setAttribute('role', 'img');
  if (kind !== 'power') node.append(symbol(variant));
  if (value !== undefined) {
    const digits = String(value).length > 1 ? 'stat-badge-multiple-digits' : '';
    node.append(element('strong', digits, value));
  }
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

export function orderBadge(ready, cooldown, label, charges) {
  return statBadge('order', label, charges ?? (cooldown || undefined), ready ? 'order-ready' : 'order-cooldown');
}
