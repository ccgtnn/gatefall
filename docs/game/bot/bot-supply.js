import { FACTIONS } from '../cards/cards.js';
import { collection, copyLimit } from '../cards/decks.js';

export function visibleSupply(match, memory = true, knowsDeckList = false) {
  const player = match.players.human;
  if (knowsDeckList && player.knownDeck) return player.knownDeck.map((card) => ({ card, weight: 1 }));
  const faction = FACTIONS[player.factionId];
  const known = new Map();
  if (memory || knowsDeckList) {
    const field = Object.entries(match.players).flatMap(([side, owner]) =>
      Object.values(owner.board).flat().filter((card) => (card.owner ?? side) === 'human'));
    for (const card of [...player.discard, ...player.exile, ...field]) {
      if (!card.definition.token && !card.definition.stratagem) known.set(card.id, card.definition.id);
    }
    for (const event of match.log) {
      if (event.side !== 'human') continue;
      if (event.type === 'play' && event.card?.definition && !event.card.definition.token) {
        known.set(event.cardId, event.card.definition.id);
      }
      if (knowsDeckList && event.type === 'spawn' && event.from === 'deck') {
        for (const card of event.cards ?? []) known.set(card.id, card.definition.id);
      }
    }
  }
  if (knowsDeckList && player.startingDeck) {
    return player.startingDeck.filter(({ id }) => !known.has(id))
      .map(({ definition: card }) => ({ card, weight: 1 }));
  }
  if (!faction) return [];
  const available = collection(player.factionId);
  const presetCounts = new Map();
  const observedCounts = new Map();
  for (const { id } of faction.deck) presetCounts.set(id, (presetCounts.get(id) ?? 0) + 1);
  for (const id of known.values()) observedCounts.set(id, (observedCounts.get(id) ?? 0) + 1);
  return available.flatMap((card) => Array.from({
    length: Math.max(0, copyLimit(card) - (observedCounts.get(card.id) ?? 0)),
  }, (_, index) => ({ card, weight: index + (observedCounts.get(card.id) ?? 0) < (presetCounts.get(card.id) ?? 0) ? 1 : .14 })));
}
