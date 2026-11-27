import { NEUTRAL } from '../shared/card-metadata.js';
import { creationCandidates, matchesPileFilter } from '../shared/card-filters.js';
import { CARD_DEFINITIONS, cardsForFaction } from './card-registry.js';
import { FACTIONS } from './cards.js';

export function relatedEffectCards(definition) {
  const fixed = new Map();
  const possible = new Map();
  const visited = new WeakSet();
  function visit(node) {
    if (node === null || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (['spawn', 'transform'].includes(node.action) && node.card) fixed.set(node.card.id, node.card);
    if (node.action === 'consume' && node.replacement) fixed.set(node.replacement.id, node.replacement);
    if (node.action === 'create-play') {
      const faction = node.faction === 'enemy' ? undefined : node.faction;
      for (const card of creationCandidates(CARD_DEFINITIONS, definition.id, node, faction)) {
        if (node.faction !== 'enemy' || Object.hasOwn(FACTIONS, card.faction)) possible.set(card.id, card);
      }
    }
    if (node.action === 'summon-from-deck' && node.filter) {
      const pool = Object.hasOwn(FACTIONS, definition.faction) ? cardsForFaction(definition.faction) : CARD_DEFINITIONS;
      const matches = node.filter.definitionId ? CARD_DEFINITIONS : new Set([...pool, ...cardsForFaction(NEUTRAL)]);
      for (const card of matches) {
        if (matchesPileFilter(card, node.filter)) (node.filter.definitionId ? fixed : possible).set(card.id, card);
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'card') visit(child);
  }
  visit(definition);
  fixed.delete(definition.id);
  possible.delete(definition.id);
  for (const id of fixed.keys()) possible.delete(id);
  return { fixed: [...fixed.values()], possible: [...possible.values()] };
}
