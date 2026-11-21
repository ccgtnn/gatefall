import { button, element } from './dom.js?v=opponent-reveal-1';

export function factionFilters(choices, onChange) {
  const group = element('div', 'faction-filters');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Фракция');
  let active;
  for (const [id, label] of choices) {
    const option = button(undefined, () => {
      if (active === option) return;
      active.setAttribute('aria-pressed', 'false');
      active = option;
      option.setAttribute('aria-pressed', 'true');
      onChange(id);
    }, 'button faction-filter');
    option.dataset.faction = id;
    option.setAttribute('aria-pressed', String(!id));
    if (!id) active = option;

    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(namespace, 'use');
    use.setAttribute('href', './art/faction-icons.svg?v=1#' + (id || 'all'));
    icon.append(use);
    option.append(icon, element('span', null, label));
    group.append(option);
  }
  return group;
}
