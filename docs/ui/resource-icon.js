import { assetUrl } from '../asset-url.js';
const svgNamespace = 'http://www.w3.org/2000/svg';

export function resourceIcon(id, faction = false) {
  const node = document.createElementNS(svgNamespace, 'svg');
  node.setAttribute('viewBox', faction ? '0 0 24 24' : '0 0 32 32');
  node.setAttribute('aria-hidden', 'true');
  if (!faction) {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  }
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', assetUrl('./art/' + (faction ? 'faction-icons.svg' : 'reward-icons.svg') + '#' + id));
  node.append(use);
  return node;
}
