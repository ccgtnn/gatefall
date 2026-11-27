import { CARD_DEFINITIONS } from '../cards/card-registry.js';
import { FACTIONS, FIRST_SIGNAL } from '../cards/cards.js';
import { BOT_LEVELS, readBotLevel } from './bot-levels.js';
import { botSearchState } from './bot-strategy.js';

function isDefinition(value) {
  return typeof value?.id === 'string' && typeof value.name === 'string' && !value.definition;
}

let catalog;
function definitionsById() {
  if (catalog) return catalog;
  const seen = new WeakSet();
  catalog = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (isDefinition(value)) catalog.set(value.id, value);
    for (const child of Object.values(value)) visit(child);
  }
  visit([CARD_DEFINITIONS, FIRST_SIGNAL, ...Object.values(FACTIONS).map(({ leaders }) => leaders)]);
  return catalog;
}

export function serializeBotPosition(match, mastery) {
  const level = readBotLevel(mastery);
  const masked = botSearchState(match, BOT_LEVELS[level].knowsDeckList);
  const { pending, effects, mulligan } = masked;
  // Player choices in progress can contain offered cards and references into private piles.
  const privateChoice = pending?.side === 'human';
  const state = { ...masked, pending: privateChoice ? null : pending,
    effects: privateChoice ? [] : effects, mulligan: { ...mulligan, excluded: [] } };
  const catalog = definitionsById();
  const extras = [];
  const extraIndices = new Map();
  const signatures = new WeakMap();

  function signature(value) {
    if (!signatures.has(value)) signatures.set(value, JSON.stringify(value));
    return signatures.get(value);
  }

  function encode(value, skipDefinition = false) {
    if (Array.isArray(value)) return value.map((item) => encode(item));
    if (!value || typeof value !== 'object') return value;
    if (!skipDefinition && isDefinition(value)) {
      const printed = catalog.get(value.id);
      if (printed === value || (printed && signature(printed) === signature(value))) return { $card: value.id };
      const key = signature(value);
      if (!extraIndices.has(key)) {
        extraIndices.set(key, extras.length);
        extras.push(undefined);
        extras[extraIndices.get(key)] = encode(value, true);
      }
      return { $card: extraIndices.get(key) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
  }

  const compact = encode(state);
  if (extras.length) compact.$definitions = extras;
  return JSON.stringify({ level, state: compact });
}

export function restoreBotPosition(position) {
  const { level, state: { $definitions = [], ...state } } = typeof position === 'string' ? JSON.parse(position) : position;
  const catalog = definitionsById();
  const restored = new Map();
  function decode(value) {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$card')) {
      const key = value.$card;
      if (typeof key === 'string' && catalog.has(key)) return catalog.get(key);
      if (Number.isInteger(key) && $definitions[key]) {
        if (!restored.has(key)) restored.set(key, decode($definitions[key]));
        return restored.get(key);
      }
      throw new Error('Unknown card definition: ' + key);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
  }
  return { level, state: decode(state) };
}
