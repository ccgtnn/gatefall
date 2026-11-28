import { FACTIONS } from '../game/cards/cards.js';
import { FORMERLY_NEUTRAL_CARDS, findCardDefinition } from '../game/cards/card-registry.js';
import { inspectDeck, MIN_CARDS, MIN_UNITS, STARTER_DECKS } from '../game/cards/decks.js';

export const DECK_STORAGE_KEY = 'gatefall.decks';
export const RECENT_DECKS_KEY = 'gatefall.recent-decks';
export const PRIMARY_DECK_KEY = 'gatefall.primary-deck';

const FORMAT = 'gatefall-deck';
const VERSION = 1;

export function newDeckId() {
  return globalThis.crypto?.randomUUID?.() ?? 'deck-' + Date.now() + '-' + Math.random();
}

function deckDocument({ name, factionId, leaderId, cardIds }) {
  return { format: FORMAT, version: VERSION, name, factionId, leaderId, cardIds };
}

export function serializeDeckJson(deck) {
  const document = Array.isArray(deck) ? deck.map(deckDocument) : deckDocument(deck);
  return JSON.stringify(document, null, 2) + '\n';
}

export function parseDeckJson(text, owned) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { errors: ['Некорректный JSON.'] };
  }
  if (!Array.isArray(data)) return parseDeckDocument(data, owned);
  if (!data.length) return { errors: ['В файле нет колод.'] };
  const decks = data.map((item) => parseDeckDocument(item, owned));
  const errors = decks.flatMap((item, index) => (item.errors ?? []).map((error) => `Колода ${index + 1}: ${error}`));
  return errors.length ? { errors } : { decks };
}

function parseDeckDocument(data, owned) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['Ожидается JSON-объект колоды.'] };
  }
  if (('format' in data || 'version' in data) && (data.format !== FORMAT || data.version !== VERSION)) {
    return { errors: ['Формат или версия колоды не поддерживается.'] };
  }
  const { name, factionId, leaderId, cardIds } = data;
  const errors = [];
  if (typeof name !== 'string' || !name.trim()) errors.push('Укажи название колоды.');
  if (typeof factionId !== 'string' || !Object.hasOwn(FACTIONS, factionId)) errors.push('Неизвестная фракция.');
  if (typeof leaderId !== 'string' || !leaderId) errors.push('Укажи лидера своей фракции.');
  if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === 'string')) {
    errors.push('Поле cardIds должно быть массивом идентификаторов карт.');
  }
  if (errors.length) return { errors };

  const deck = { name: name.trim(), factionId, leaderId, cardIds };
  const result = inspectDeck(deck, owned);
  const unknown = [...new Set(cardIds)].filter((id) => !findCardDefinition(id));
  const foreign = [...new Set(cardIds)].filter((id) => !result.counts.has(id) && findCardDefinition(id));
  const names = (ids) => [...ids].map((id) => findCardDefinition(id).name).join(', ');
  if (!result.leader) errors.push('Лидер неизвестен или недоступен этой фракции.');
  if (unknown.length) errors.push('Неизвестные карты: ' + unknown.map((id) => JSON.stringify(id)).join(', ') + '.');
  if (foreign.length) errors.push('Карты другой фракции: ' + names(foreign) + '.');
  if (result.issues.copies) errors.push('Превышен лимит копий: ' + names(result.overLimit) + '.');
  if (result.issues.cards) errors.push(`Нужно минимум ${MIN_CARDS} карт (сейчас ${result.cards.length}).`);
  if (result.issues.units) errors.push(`Нужно минимум ${MIN_UNITS} отрядов (сейчас ${result.units}).`);
  if (result.issues.provisions) errors.push(`Лимит провизии превышен: ${result.cost} из ${result.budget}.`);
  if (errors.length) return { errors };

  const missing = [...result.missing].map(([id, count]) => ({ id, name: findCardDefinition(id).name, count }));
  return { deck: { ...deck, leaderId: result.leader.id }, missing };
}

function recentPlayableDecks(decks, played, owned) {
  const all = new Map([...STARTER_DECKS, ...decks].map((deck) => [deck.id, deck]));
  const candidates = played.length ? played.map(({ id }) => all.get(id)).filter(Boolean) : STARTER_DECKS;
  return candidates.filter((deck) => inspectDeck(deck, owned).valid).slice(0, 4);
}

export function createDeckStorage(storage) {
  let decks = [];
  let lastRead;
  const drafts = new Map();

  function refresh() {
    try {
      const text = storage.getItem(DECK_STORAGE_KEY);
      if (text === lastRead) return;
      const saved = JSON.parse(text);
      decks = Array.isArray(saved) ? saved.filter((deck) =>
        typeof deck?.id === 'string' && !deck.id.startsWith('preset-') &&
        typeof deck.name === 'string' && typeof deck.factionId === 'string' && typeof deck.leaderId === 'string' &&
        Array.isArray(deck.cardIds) && deck.cardIds.every((id) => typeof id === 'string')) : [];
      let migrated = false;
      for (const deck of decks) {
        const cardIds = deck.cardIds.filter((id) =>
          !FORMERLY_NEUTRAL_CARDS.includes(id) || findCardDefinition(id).faction === deck.factionId);
        if (cardIds.length === deck.cardIds.length) continue;
        deck.cardIds = cardIds;
        migrated = true;
      }
      if (migrated) persist();
      else lastRead = text;
    } catch {}
  }

  refresh();
  let played = [];
  function refreshRecent() {
    try {
      const stored = JSON.parse(storage?.getItem(RECENT_DECKS_KEY));
      played = Array.isArray(stored)
        ? stored.filter((entry) => typeof entry?.id === 'string' && Number.isFinite(entry.at)) : [];
    } catch {}
  }
  refreshRecent();

  function readPrimary() {
    try {
      const id = storage?.getItem(PRIMARY_DECK_KEY);
      return typeof id === 'string' && id ? id : undefined;
    } catch {
      return undefined;
    }
  }

  function clearPrimary(id) {
    if (id !== undefined && readPrimary() !== id) return;
    try {
      if (typeof storage?.removeItem === 'function') storage.removeItem(PRIMARY_DECK_KEY);
      else storage?.setItem(PRIMARY_DECK_KEY, '');
    } catch {}
  }

  function primary(owned) {
    refresh();
    const id = readPrimary();
    if (!id) return undefined;
    const deck = [...STARTER_DECKS, ...decks].find((deck) => deck.id === id);
    if (!deck || !inspectDeck(deck, owned).valid) {
      clearPrimary(id);
      return undefined;
    }
    return structuredClone(deck);
  }

  function setPrimary(id, owned) {
    if (!id) {
      clearPrimary();
      return true;
    }
    refresh();
    const deck = [...STARTER_DECKS, ...decks].find((deck) => deck.id === id);
    if (!deck || !inspectDeck(deck, owned).valid) {
      clearPrimary(id);
      return false;
    }
    try {
      storage?.setItem(PRIMARY_DECK_KEY, id);
      return readPrimary() === id;
    } catch {
      return false;
    }
  }

  function save(deck) {
    if (deck.id.startsWith('preset-')) return false;
    refresh();
    drafts.delete(deck.id);
    const index = decks.findIndex(({ id }) => id === deck.id);
    if (index < 0) decks.push(structuredClone(deck));
    else decks[index] = structuredClone(deck);
    return persist();
  }

  function remove(deckId) {
    if (typeof deckId !== 'string' || deckId.startsWith('preset-')) return false;
    refresh();
    const index = decks.findIndex(({ id }) => id === deckId);
    if (index < 0 && !drafts.has(deckId)) return false;
    if (index >= 0) decks.splice(index, 1);
    drafts.delete(deckId);
    refreshRecent();
    played = played.filter(({ id }) => id !== deckId);
    try { storage?.setItem(RECENT_DECKS_KEY, JSON.stringify(played)); } catch {}
    clearPrimary(deckId);
    return persist();
  }

  function persist() {
    try {
      const text = JSON.stringify(decks);
      storage.setItem(DECK_STORAGE_KEY, text);
      lastRead = text;
      return true;
    } catch {
      return false;
    }
  }

  return {
    recent(owned) { return recentPlayableDecks(decks, [...played].sort((a, b) => b.at - a.at), owned); },
    recordPlay(id, at = Date.now()) {
      refreshRecent();
      played = [{ id, at }, ...played.filter((entry) => entry.id !== id)];
      try { storage?.setItem(RECENT_DECKS_KEY, JSON.stringify(played)); } catch {}
    },
    primary,
    setPrimary,
    remove,
    list() { return structuredClone(decks); },
    get(id) { return structuredClone(decks.find((deck) => deck.id === id) ?? drafts.get(id)); },
    stageDraft(deck) {
      if (!decks.some(({ id }) => id === deck.id)) drafts.set(deck.id, structuredClone(deck));
    },
    refresh,
    save,
    importJson(text, owned) {
      const result = parseDeckJson(text, owned);
      if (result.errors) return result;
      refresh();
      const ids = new Set([...decks.map(({ id }) => id), ...drafts.keys()]);
      const imported = (result.decks ?? [result]).map(({ deck, missing }) => {
        let id = newDeckId();
        while (ids.has(id)) id = newDeckId();
        ids.add(id);
        return { deck: { id, ...deck }, missing };
      });
      decks.push(...imported.map(({ deck }) => structuredClone(deck)));
      const saved = persist();
      return result.decks ? { decks: imported, saved } : { ...imported[0], saved };
    },
  };
}

export function deckAutosave(deck, save) {
  let dirty = false;
  return {
    changed() { dirty = true; },
    save() {
      dirty = false;
      return save(deck);
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      return save(deck);
    },
  };
}
