const STORAGE_KEY = 'gatefall.decks';

export function createDeckStorage(storage) {
  let decks = [];
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) {
      decks = saved.filter((deck) => typeof deck?.id === 'string' && !deck.id.startsWith('preset-') &&
        typeof deck.name === 'string' && typeof deck.factionId === 'string' && typeof deck.leaderId === 'string' &&
        Array.isArray(deck.cardIds) && deck.cardIds.every((id) => typeof id === 'string'));
    }
  } catch {}

  return {
    list() { return structuredClone(decks); },
    save(deck) {
      if (deck.id.startsWith('preset-')) return false;
      const index = decks.findIndex(({ id }) => id === deck.id);
      if (index < 0) decks.push(structuredClone(deck));
      else decks[index] = structuredClone(deck);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(decks));
        return true;
      } catch {
        return false;
      }
    },
  };
}
