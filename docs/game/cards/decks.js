// @ts-check

/** @typedef {import('../../../types/contracts').Counts} Counts */
/** @typedef {import('../../../types/contracts').Deck} Deck */
/** @typedef {import('../../../types/contracts').DeckInspection} DeckInspection */

import { FACTIONS } from './cards.js';
import { NEUTRAL } from '../shared/card-metadata.js';
import { cardsForFaction } from './card-registry.js';

export const MIN_CARDS = 25;
export const MIN_UNITS = 13;
export const BASE_PROVISIONS = 150;

const groups = new Map(Object.entries(FACTIONS));
const collections = new Map([...groups.keys()].map((id) => [id, Object.freeze([...cardsForFaction(id), ...cardsForFaction(NEUTRAL)])]));

export function collection(factionId) {
  return collections.get(factionId) ?? [];
}

export function copyLimit(card) {
  return card.rarity === 'bronze' ? 2 : 1;
}

function factionPreset(factionId) {
  const faction = groups.get(factionId);
  return Object.freeze({
    id: 'preset-' + factionId,
    name: faction.name + ' · ' + faction.strategy,
    factionId,
    leaderId: faction.leader.id,
    cardIds: Object.freeze(faction.deck.map(({ id }) => id)),
  });
}
const plaguePreset = Object.freeze({
  id: 'preset-growth-plague', name: 'Поросль · Чума', factionId: 'growth', leaderId: 'carrier',
  cardIds: Object.freeze([
    'rot-midge', 'rot-midge', 'plague-carrier', 'plague-carrier', 'rot-scavenger', 'rot-scavenger',
    'boil', 'boil', 'rot', 'rot', 'rot-giant', 'pestilence', 'plague-burst', 'spore-season',
    'acid-gland', 'acid-gland', 'spitter', 'spitter', 'cocoon', 'colossus', 'gulper', 'nest',
    'annihilation', 'old-golem', 'veteran-mercenary',
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

export const PRESETS = Object.freeze([
  factionPreset('protectorate'), factionPreset('growth'), plaguePreset, ORBITAL_STRIKE_PRESET, REBIRTH_PRESET, factionPreset('choir'),
  factionPreset('captains'),
]);

/** Стартовые колоды, собранные геймдизайнером: их видит игрок и берёт бот быстрого матча. Старые PRESETS остаются только для Лиги и тестов. */
export const STARTER_DECKS = Object.freeze([
  Object.freeze({
    id: 'preset-starter-protectorate', name: 'Протекторат - огненный шторм', factionId: 'protectorate', leaderId: 'supreme-commander',
    cardIds: Object.freeze([
      'assault-tank', 'assault-tank', 'assault', 'assault', 'flame-inquisitor', 'flame-inquisitor', 'reinforcements',
      'reinforcements', 'brander', 'brander', 'gonets', 'emperors-hand', 'field-medic', 'recon-drone', 'firestorm',
      'salfurion', 'armor-piercing-shot', 'suppressor', 'armor-piercing-shot', 'shield-generator', 'warden',
      'warden', 'recon-drone', 'engineer', 'world-gates',
    ]),
  }),
  Object.freeze({
    id: 'preset-starter-choir', name: 'Безмолвный хор - спящий (без сценария)', factionId: 'choir', leaderId: 'high-priest',
    cardIds: Object.freeze([
      'abyss-shepherd', 'great-sacrifice', 'sleeper-revelation', 'altar-guardian', 'cult-dreamer', 'forbidden-scroll-keeper',
      'call-of-the-deep', 'call-of-the-deep', 'sleeper-litany', 'sleeper-litany', 'mind-strike', 'mind-strike',
      'depth-neophyte', 'depth-neophyte', 'whisper-interpreter', 'whisper-interpreter', 'minor-offering', 'minor-offering',
      'ulmarin-fanatic', 'ulmarin-fanatic', 'alien-dream', 'alien-dream', 'carrion-devourer', 'suppressor', 'gate-guardian',
    ]),
  }),
  Object.freeze({
    id: 'preset-starter-captains', name: 'Вольные капитаны - гончие', factionId: 'captains', leaderId: 'skara-reinhold',
    cardIds: Object.freeze([
      'black-hound', 'hound-eyes', 'bounty-hunter', 'hound-recruiter', 'hound-captain', 'hound-pack', 'hound-pack',
      'hound-good-deal', 'hound-good-deal', 'broken-turret', 'hound-claw', 'hound-claw', 'hound-left-fang', 'stolen-goods-fence',
      'hound-foreman', 'hound-foreman', 'scrapped-pilot', 'scrapped-pilot', 'broken-turret', 'debtor', 'debtor',
      'helper-robot', 'falura', 'world-gates', 'recon-drone',
    ]),
  }),
  Object.freeze({
    id: 'preset-starter-growth', name: 'Поросль - заражение', factionId: 'growth', leaderId: 'carrier',
    cardIds: Object.freeze([
      'rot-midge', 'rot-midge', 'rot', 'rot', 'plague-leviathan', 'plague-sower', 'spore-season', 'pestilence',
      'infected-carcass', 'infected-carcass', 'colossus', 'bioreactor', 'xylaris-bloom', 'acid-gland', 'acid-gland',
      'rot-giant', 'recon-drone', 'armor-piercing-shot', 'carrion-devourer', 'world-gates', 'recon-drone', 'rot-scavenger',
      'rot-scavenger', 'suppressor', 'armor-piercing-shot',
    ]),
  }),
]);

/**
 * @param {Partial<Deck> | null} [deck]
 * @param {Counts} [owned]
 * @returns {DeckInspection}
 */
export function inspectDeck(deck, owned) {
  const faction = groups.get(deck?.factionId);
  const leader = faction?.leaders.find(({ id, legacyId }) => id === deck.leaderId || (legacyId && legacyId === deck.leaderId));
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
