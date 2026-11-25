import { button, element } from './dom.js';
import { resourceIcon } from './resource-icon.js';

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

    option.append(resourceIcon(id || 'all', true), element('span', null, label));
    group.append(option);
  }
  return group;
}
