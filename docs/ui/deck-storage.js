import { FACTIONS } from '../game/cards.js';
import { findCardDefinition } from '../game/card-registry.js';
import { inspectDeck, MIN_CARDS, MIN_UNITS, PRESETS } from '../game/decks.js';

const STORAGE_KEY = 'gatefall.decks';
const RECENT_KEY = 'gatefall.recent-decks';

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
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['Ожидается JSON-объект одной колоды.'] };
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

  function save(deck) {
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
  }

  return {
    recent(owned) { return recentPlayableDecks(decks, [...played].sort((a, b) => b.at - a.at), owned); },
    recordPlay(id, at = Date.now()) {
      played = [{ id, at }, ...played.filter((entry) => entry.id !== id)];
      try { storage?.setItem(RECENT_KEY, JSON.stringify(played)); } catch {}
    },
    list() { return structuredClone(decks); },
    save,
    importJson(text, owned) {
      const result = parseDeckJson(text, owned);
      if (result.errors) return result;
      let id = newDeckId();
      while (decks.some((deck) => deck.id === id)) id = newDeckId();
      const deck = { id, ...result.deck };
      return { deck, missing: result.missing, saved: save(deck) };
    },
  };
}
