import assert from 'node:assert/strict';
import test from 'node:test';
import { statSync } from 'node:fs';
import { CARD_DEFINITIONS } from '../../docs/game/cards/card-registry.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { inspectDeck, PRESETS } from '../../docs/game/cards/decks.js';
import { effectOperations } from '../../docs/game/effects/effect-operations.js';
import { EFFECT_SCHEMA } from '../../docs/game/shared/effect-schema.js';
import { LEAGUE_BOTS } from '../../docs/game/meta/league.js';
import { visitDefinitions } from '../helpers/effect-definitions.js';
import { hasPremiumArt } from '../../docs/ui/card-art.js';

const leaders = Object.values(FACTIONS).flatMap((faction) => faction.leaders);
const cards = new Set(CARD_DEFINITIONS);
visitDefinitions((value) => {
  if (typeof value.id === 'string' && typeof value.name === 'string' && (value.token || value.stratagem)) {
    cards.add(value);
  }
});

function checkKeys(value, kind, path) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkKeys(entry, kind, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const schema = EFFECT_SCHEMA[kind];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    const field = Object.hasOwn(schema, key) ? key : '*';
    assert.ok(Object.hasOwn(schema, field), `Unknown DSL key ${entryPath}`);
    if (schema[field]) checkKeys(entry, schema[field], entryPath);
  }
}

test('all registered cards have unique ids and complete metadata', () => {
  const seen = new Set();
  const duplicates = [];
  for (const card of CARD_DEFINITIONS) {
    if (seen.has(card.id)) duplicates.push(card.id);
    seen.add(card.id);
    assert.ok(typeof card.id === 'string' && card.id.trim(), 'Card id must be a non-empty string');
    assert.ok(typeof card.name === 'string' && card.name.trim(), `${card.id}: missing name`);
    assert.ok(typeof card.faction === 'string' && card.faction, `${card.id}: missing faction`);
    assert.ok(typeof card.rarity === 'string' && card.rarity, `${card.id}: missing rarity`);
    assert.ok(typeof card.provision === 'number' && Number.isFinite(card.provision), `${card.id}: missing provision`);
    if (card.type === 'unit') assert.ok(card.power > 0, `${card.id}: unit power must be positive`);
  }
  assert.deepEqual(duplicates, []);
});

test('both Plague engines have their printed stats and premium artwork', () => {
  for (const [id, power, provision, rarity, requiredRow] of [
    ['plague-leviathan', 3, 9, 'epic', 'orbit'],
    ['plague-sower', 4, 10, 'gold', undefined],
  ]) {
    const card = CARD_DEFINITIONS.find((definition) => definition.id === id);
    assert.deepEqual([card.faction, card.type, card.power, card.provision, card.rarity, card.requiredRow],
      ['growth', 'unit', power, provision, rarity, requiredRow]);
    assert.deepEqual(card.categories, ['Гниль']);
    assert.equal(card.art, id + '.webp');
    assert.equal(card.artCrop, id + '-crop.webp');
    assert.ok(hasPremiumArt(id), id);
    for (const file of [card.art, card.artCrop, id + '-card.mp4', id + '-preview.mp4']) {
      assert.ok(statSync(new URL('../../docs/art/' + file, import.meta.url)).size > 0, file);
    }
  }
});

test('Salfurion is a neutral gold effect with full, cropped, leader and premium art', () => {
  const id = 'salfurion';
  const card = CARD_DEFINITIONS.find((definition) => definition.id === id);
  assert.deepEqual([card.faction, card.type, card.rarity, card.provision], ['neutral', 'effect', 'gold', 18]);
  assert.deepEqual(card.keywords, ['Огненный шторм', 'Приказ', 'Перезарядка']);
  assert.equal(card.art, id + '.webp');
  assert.equal(card.artCrop, id + '-crop.webp');
  const portrait = card.deploy.steps.find(({ action }) => action === 'replace-leader').portrait;
  assert.equal(portrait, id + '-portrait.webp');
  assert.ok(hasPremiumArt(id));
  for (const file of [card.art, card.artCrop, portrait, id + '-card.mp4', id + '-preview.mp4']) {
    assert.ok(statSync(new URL('../../docs/art/' + file, import.meta.url)).size > 0, file);
  }
});

test('every preset and League character deck id exists in the card registry', () => {
  const known = new Set(CARD_DEFINITIONS.map(({ id }) => id));
  const leagueDecks = [...LEAGUE_BOTS.values()].map(({ id, deck }) => ({ ...deck, characterId: id }));
  for (const deck of [...PRESETS, ...leagueDecks]) {
    for (const cardId of deck.cardIds) {
      assert.ok(known.has(cardId), `${deck.characterId ?? deck.id}: unknown card ${cardId}`);
    }
  }
});

test('every deck preset passes inspectDeck without issues', () => {
  for (const preset of PRESETS) {
    const inspection = inspectDeck(preset);
    assert.deepEqual(Object.entries(inspection.issues).filter(([, issue]) => issue), [], preset.id);
    assert.ok(inspection.valid, preset.id);
  }
});

test('every effect operation has a registered handler', () => {
  const missing = new Set();
  visitDefinitions((value) => {
    if (typeof value.action === 'string' && typeof effectOperations[value.action] !== 'function') {
      missing.add(value.action);
    }
  });
  assert.deepEqual([...missing].sort(), []);
});

test('all card, token, and leader effects conform to the effect schema', () => {
  for (const card of cards) checkKeys(card, 'card', `${card.name} (${card.id})`);
  for (const leader of leaders) checkKeys(leader, 'leader', `${leader.name} (${leader.id})`);
});

test('every token, summon, and transformation target resolves to a known card id', () => {
  const known = new Set([...cards].map(({ id }) => id));
  const missing = [];
  visitDefinitions((value) => {
    if (!['spawn', 'transform'].includes(value.action)) return;
    const target = value.card;
    const id = typeof target === 'string' ? target : target?.id;
    if (!id || !known.has(id)) missing.push({ action: value.action, id: id ?? null });
  });
  assert.deepEqual(missing, []);
});

test('every leader has an Order and an ability', () => {
  for (const leader of leaders) {
    assert.ok(leader.order, `${leader.id}: missing Order`);
    assert.ok(leader.ability, `${leader.id}: missing ability`);
  }
});

test('every leader has at least one charge after applying the default', () => {
  for (const leader of leaders) {
    const charges = leader.charges ?? 1;
    assert.ok(Number.isInteger(charges) && charges >= 1,
      `${leader.id}: effective charges must be an integer greater than or equal to one`);
  }
});

test('Firestorm and both ships have their printed stats and all four art assets', () => {
  for (const [id, faction, type, power, provision, rarity, row, ship] of [
    ['firestorm', 'neutral', 'effect', undefined, 7, 'epic', undefined, undefined],
    ['emperors-hand', 'protectorate', 'unit', 4, 13, 'gold', 'orbit', 'Тяжёлый корабль'],
    ['brander', 'protectorate', 'unit', 2, 6, 'bronze', 'surface', 'Лёгкий корабль'],
  ]) {
    const card = CARD_DEFINITIONS.find((definition) => definition.id === id);
    assert.deepEqual([card.faction, card.type, card.power, card.provision, card.rarity, card.preferredRow, card.shipClass],
      [faction, type, power, provision, rarity, row, ship]);
    assert.equal(card.art, id + '.webp');
    assert.equal(card.artCrop, id + '-crop.webp');
    assert.ok(hasPremiumArt(id), id);
    for (const file of [card.art, card.artCrop, id + '-card.mp4', id + '-preview.mp4']) {
      assert.ok(statSync(new URL('../../docs/art/' + file, import.meta.url)).size > 0, file);
    }
  }
});

test('Protectorate bronzes have full and cropped art, with premium video only for Flame Inquisitor', () => {
  for (const [id, power, premium] of [['flame-inquisitor', 2, true], ['assault-tank', 3, false]]) {
    const card = CARD_DEFINITIONS.find((definition) => definition.id === id);
    assert.deepEqual([card.faction, card.type, card.rarity, card.provision, card.power],
      ['protectorate', 'unit', 'bronze', 5, power]);
    assert.equal(card.art, id + '.webp');
    assert.equal(card.artCrop, id + '-crop.webp');
    assert.equal(hasPremiumArt(id), premium);
    const files = [card.art, card.artCrop];
    if (premium) files.push(id + '-card.mp4', id + '-preview.mp4');
    for (const file of files) assert.ok(statSync(new URL('../../docs/art/' + file, import.meta.url)).size > 0, file);
  }
});

test('Gonets has full and cropped artwork', () => {
  const card = CARD_DEFINITIONS.find(({ id }) => id === 'gonets');
  assert.equal(card.art, 'gonets.webp');
  assert.equal(card.artCrop, 'gonets-crop.webp');
  assert.equal(hasPremiumArt(card.id), false);
  for (const file of [card.art, card.artCrop]) {
    assert.ok(statSync(new URL('../../docs/art/' + file, import.meta.url)).size > 0, file);
  }
});
