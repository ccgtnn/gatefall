import { restoreCard } from '../game/board.js';
import { cardButton } from './cards.js';
import { button, element } from './dom.js';
import { tributeLabel } from './field-labels.js';

export function createFieldChoices({ playHuman }) {
  function deckChoice(match) {
    const { pending, players: { human } } = match;
    const panel = element('section', 'deck-offer panel');
    const title = element('h2', null, pending.prompt);
    title.id = 'deck-choice-title';
    panel.setAttribute('aria-labelledby', title.id);
    const choices = element('div', 'deck-choice-cards');
    const pile = pending.pile ?? 'deck';
    const options = new Set(pending.options);
    const selectable = (pending.cards ?? human[pile]).filter(({ id }) => pending.fullDeck || options.has(id));
    const scrollable = pending.fullDeck || pending.kind === 'deck-top' || pile === 'discard' || pile === 'hand';
    if (scrollable) {
      panel.classList.add('pile-offer');
      if (pile !== 'hand') selectable.sort((a, b) => a.definition.name.localeCompare(b.definition.name, 'ru'));
    }
    for (const item of selectable) {
      const card = pile === 'discard' ? restoreCard(item) : item;
      const node = cardButton(card, () => playHuman({ type: 'target', cardId: card.id }), human, false, { staticArt: true });
      node.disabled = !options.has(card.id);
      node.classList.toggle('effect-target', !node.disabled);
      if (!node.disabled) node.dataset.aimTarget = card.id;
      node.append(element('span', 'deck-choice-name', card.definition.name));
      choices.append(node);
    }
    panel.append(title, choices);
    return panel;
  }

  function tributeChoice(pending) {
    const offer = element('section', 'deck-offer panel');
    const heading = element('h2', null, pending.prompt);
    heading.id = 'deck-choice-title';
    offer.setAttribute('aria-labelledby', heading.id);
    const options = element('div', 'tribute-choices');
    for (const cost of pending.options) {
      const label = tributeLabel(pending, cost);
      options.append(button(label, () => playHuman({ type: 'target', cardId: cost }), 'button effect-target'));
    }
    offer.append(heading, options);
    return offer;
  }

  return { deckChoice, tributeChoice };
}
