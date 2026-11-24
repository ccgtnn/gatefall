import { inspectDeck, PRESETS } from '../game/decks.js?v=fugitive-monk-1';

const STORAGE_KEY = 'gatefall.decks';
const RECENT_KEY = 'gatefall.recent-decks';

function recentPlayableDecks(decks, played, owned) {
  const all = new Map([...PRESETS, ...decks].map((deck) => [deck.id, deck]));
  const candidates = played.length ? played.map(({ id }) => all.get(id)).filter(Boolean) : PRESETS;
  return candidates.filter((deck) => inspectDeck(deck, owned).valid).slice(0, 4);
}

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

  let played = [];
  try {
    const stored = JSON.parse(storage.getItem(RECENT_KEY));
    if (Array.isArray(stored)) {
      played = stored.filter((entry) => typeof entry?.id === 'string' && Number.isFinite(entry.at));
    }
  } catch {}

  return {
    recent(owned) { return recentPlayableDecks(decks, [...played].sort((a, b) => b.at - a.at), owned); },
    recordPlay(id, at = Date.now()) {
      played = [{ id, at }, ...played.filter((entry) => entry.id !== id)];
      try { storage?.setItem(RECENT_KEY, JSON.stringify(played)); } catch {}
    },
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
