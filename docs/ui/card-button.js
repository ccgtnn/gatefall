import { button } from './dom.js';
import { decorateCard } from './card-badges.js';
import { cardInspection } from './card-inspection.js';

export function cardButton(card, handler, player, placement = false, { showProvision = false, showFaction = false, lazyArt = false, staticArt = false, inspect } = {}) {
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  decorateCard(node, card, player, { showProvision, showFaction, lazyArt, staticArt });
  cardInspection(node, card, placement, inspect);
  return node;
}
