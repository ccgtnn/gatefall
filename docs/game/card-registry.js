import { CAPTAIN_CARDS } from './captains.js?v=captains-independent-1';
import { NEUTRAL } from './card-metadata.js';
import { FACTIONS, NEUTRAL_CARDS } from './cards.js?v=world-gates-premium-1-nc1';

const factionPools = new Map(Object.entries(FACTIONS).map(([id, { pool }]) => [id, pool]));
factionPools.set(NEUTRAL, NEUTRAL_CARDS);
factionPools.set('captains', CAPTAIN_CARDS);

const emptyPool = Object.freeze([]);
export function cardsForFaction(id) {
  return factionPools.get(id) ?? emptyPool;
}

export const CARD_DEFINITIONS = Object.freeze([...factionPools.values()].flat());
const cardsById = new Map(CARD_DEFINITIONS.map((card) => [card.id, card]));

export function findCardDefinition(id) {
  return cardsById.get(id);
}

// Keep the catalog's neutral-first order. Tokens remain available through effect definitions.
export const CATALOG_CARDS = Object.freeze([
  ...NEUTRAL_CARDS, ...CARD_DEFINITIONS.filter(({ faction }) => faction !== NEUTRAL),
].filter(({ token }) => !token));
