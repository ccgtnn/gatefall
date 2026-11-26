import { FACTIONS } from '../game/cards.js';
import { UPCOMING_FACTIONS } from '../game/faction-catalog.js';
import { addCardCrop } from './cards.js';
import { button, element } from './dom.js';
import { resourceIcon } from './resource-icon.js';
import { sectionBack } from './resources.js';

export function factionPicker(phaseLabel, select, back) {
  phaseLabel.textContent = '';
  const screen = element('section', 'intro');
  screen.setAttribute('aria-label', 'Выбери фракцию');
  const options = element('div', 'deck-choices');
  for (const [id, faction] of Object.entries(FACTIONS)) {
    const choice = button(undefined, () => select(id), 'button deck-choice');
    choice.dataset.faction = id;
    addCardCrop(choice, faction.leader);
    choice.append(element('strong', null, faction.name), element('span', 'muted', faction.strategy));
    options.append(choice);
  }
  screen.append(sectionBack(back), options);
  const upcoming = element('section', 'upcoming-factions');
  upcoming.append(element('h2', null, 'Будущие фракции'));
  const preview = element('div', 'deck-choices');
  for (const [id, faction] of Object.entries(UPCOMING_FACTIONS)) {
    if (Object.hasOwn(FACTIONS, id)) continue;
    const card = element('article', 'deck-choice faction-preview');
    card.dataset.faction = id;
    card.append(resourceIcon(id, true), element('strong', null, faction.name),
      element('p', 'muted', faction.description));
    preview.append(card);
  }
  if (preview.children.length) {
    upcoming.append(preview);
    screen.append(upcoming);
  }
  return screen;
}
