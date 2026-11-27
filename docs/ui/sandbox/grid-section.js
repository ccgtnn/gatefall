import { createCard } from '../../game/engine/board.js';
import { cardButton, showCard } from '../cards.js';
import { element } from '../dom.js';
import { factionCards } from './fixtures.js';

export function createGridSection() {
  const section = element('section', 'sandbox-section');
  section.dataset.section = 'grid';

  function update(factionId) {
    const grid = element('div', 'catalog-grid sandbox-catalog-grid');
    for (const definition of factionCards(factionId)) {
      const card = createCard('sandbox-grid-' + definition.id, definition);
      const item = element('article', 'catalog-entry');
      const inspect = () => showCard(card);
      const face = cardButton(card, inspect, { factionId: definition.faction }, false,
        { showProvision: true, showFaction: true, lazyArt: true, inspect });
      item.append(face, element('h3', null, definition.name),
        element('p', 'sandbox-card-text', definition.text || 'Без эффекта.'));
      grid.append(item);
    }
    section.replaceChildren(element('h2', null, 'Все карты фракции'), grid);
  }

  return { section, update };
}
