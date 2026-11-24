import { FACTIONS, NEUTRAL_CARDS } from './cards.js?v=fugitive-monk-1';

export const MIN_CARDS = 25;
export const MIN_UNITS = 13;
export const BASE_PROVISIONS = 150;

const groups = new Map(Object.entries(FACTIONS));
const collections = new Map([...groups].map(([id, faction]) => [id, Object.freeze([...faction.pool, ...NEUTRAL_CARDS])]));

export function collection(factionId) {
  return collections.get(factionId) ?? [];
}

export function copyLimit(card) {
  return card.rarity === 'bronze' ? 2 : 1;
}

const factionPresets = [...groups].map(([factionId, faction]) => Object.freeze({
  id: 'preset-' + factionId,
  name: faction.name + ' · ' + faction.strategy,
  factionId,
  leaderId: faction.leader.id,
  cardIds: Object.freeze(faction.deck.map(({ id }) => id)),
}));
const plaguePreset = Object.freeze({
  id: 'preset-growth-plague', name: 'Поросль · Чума', factionId: 'growth', leaderId: 'carrier',
  cardIds: Object.freeze([
    'rot-midge', 'rot-midge', 'plague-carrier', 'plague-carrier', 'rot-scavenger', 'rot-scavenger',
    'boil', 'boil', 'rot', 'rot', 'rot-giant', 'pestilence', 'plague-burst', 'spore-season',
    'acid-gland', 'acid-gland', 'spitter', 'spitter', 'cocoon', 'colossus', 'gulper', 'nest',
    'annihilation', 'field-medic', 'veteran-mercenary',
  ]),
});

export const ORBITAL_STRIKE_PRESET = Object.freeze({
  id: 'preset-protectorate-orbital', name: 'Протекторат · Орбитальный удар',
  factionId: 'protectorate', leaderId: 'fleet-admiral',
  cardIds: Object.freeze([
    'spotter', 'spotter', 'fleet-gunner', 'fleet-gunner', 'scout-frigate', 'scout-frigate',
    'spear-battery', 'spear-battery', 'destruction-protocol', 'aggressor', 'aurelian', 'tiberius',
    'assault', 'assault', 'engineer', 'engineer', 'warden', 'warden', 'orbital-salvo', 'orbital-salvo',
    'anvil', 'commander', 'bastion', 'colonel', 'orbital-shield',
  ]),
});

export const REBIRTH_PRESET = Object.freeze({
  id: 'preset-growth-rebirth', name: 'Поросль · Перерождение', factionId: 'growth', leaderId: 'devourer',
  cardIds: Object.freeze([
    'thorn-screecher', 'thorn-screecher', 'synaptic-parasite', 'synaptic-parasite', 'acid-capsule', 'acid-capsule',
    'xylaris-bloom', 'bioreactor', 'genome-keeper',
    'cocoon', 'cocoon', 'vine', 'vine', 'spore-sac', 'spore-sac', 'acid-gland', 'acid-gland', 'spitter', 'spitter',
    'ravager', 'nest', 'colossus', 'broodlord', 'annihilation', 'carrion-devourer',
  ]),
});

export const PRESETS = Object.freeze([...factionPresets, plaguePreset, ORBITAL_STRIKE_PRESET, REBIRTH_PRESET]);

export function inspectDeck(deck, owned) {
  const faction = groups.get(deck?.factionId);
  const leader = faction?.leaders.find(({ id }) => id === deck.leaderId);
  const allowed = new Map(collection(deck?.factionId).map((card) => [card.id, card]));
  const cardIds = Array.isArray(deck?.cardIds) ? deck.cardIds : [];
  const cards = cardIds.map((id) => allowed.get(id)).filter(Boolean);
  const counts = new Map();
  for (const { id } of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = new Map();
  if (owned) {
    for (const [id, quantity] of counts) {
      const available = owned[id] ?? 0;
      if (available < quantity) missing.set(id, quantity - available);
    }
  }
  const overLimit = new Set([...counts].filter(([id, count]) => count > copyLimit(allowed.get(id))).map(([id]) => id));
  const units = cards.filter(({ type }) => type === 'unit').length;
  const cost = cards.reduce((total, { provision }) => total + provision, 0);
  const budget = BASE_PROVISIONS + (leader?.provisionBonus ?? 0);
  const issues = {
    cards: cards.length < MIN_CARDS,
    units: units < MIN_UNITS,
    provisions: cost > budget,
    copies: overLimit.size > 0,
    ownership: missing.size > 0,
    foreign: cards.length !== cardIds.length,
    leader: !leader,
    name: typeof deck?.name !== 'string' || !deck.name.trim(),
  };
  return { valid: !Object.values(issues).some(Boolean), cards, counts, units, cost, budget, overLimit, missing, leader, issues };
}
