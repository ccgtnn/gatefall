import { createCard } from '../../game/board.js';
import { cardArt, hasPremiumArt } from '../card-art.js';
import { cardButton, showCard } from '../cards.js';
import { element } from '../dom.js';
import { cardStateFixtures, fieldSide, fixtureMatch } from './fixtures.js';

export function createCardSection() {
  const section = element('section', 'sandbox-section');
  section.dataset.section = 'card';

  function update(factionId, definition) {
    const states = cardStateFixtures(definition);
    if (hasPremiumArt(definition.id)) {
      const ordinary = states.find(({ kind }) => kind === 'face');
      states.splice(states.indexOf(ordinary) + 1, 0, {
        ...ordinary, key: 'premium', kind: 'premium', label: 'Премиальная',
        card: createCard('sandbox-premium-' + definition.id, definition),
      });
    }
    const fieldStates = states.filter(({ kind }) => kind === 'field');
    const { match, player } = fixtureMatch(factionId);
    player.board.surface = fieldStates.map(({ card }) => card);
    const ready = new Set(fieldStates.filter(({ key }) => key === 'order-ready').map(({ card }) => card.id));
    const side = fieldSide(match, 'human', ready);
    const slots = [...side.querySelector('[data-row="surface"]').children];
    let fieldIndex = 0;
    const grid = element('div', 'sandbox-card-states');
    for (const state of states) {
      const entry = element('article', 'sandbox-card-state');
      entry.dataset.state = state.key;
      entry.append(element('h3', null, state.label));
      if (state.kind === 'field') entry.append(slots[fieldIndex++]);
      else {
        const inspect = () => showCard(state.card);
        const face = cardButton(state.card, inspect, { factionId }, false,
          { showProvision: true, showFaction: true, inspect });
        if (state.kind === 'premium') {
          face.querySelector('.card-art-crop')?.replaceWith(cardArt(definition, 'card-art-crop', { animated: true }));
        }
        entry.append(face);
      }
      grid.append(entry);
    }
    const heading = element('h2', null, definition.name);
    const description = element('p', 'muted', definition.text || 'Без эффекта.');
    section.replaceChildren(heading, description, grid);
  }

  return { section, update };
}
