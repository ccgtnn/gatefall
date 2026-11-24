import { PRESETS } from './decks.js?v=fugitive-monk-1';

const presets = Object.fromEntries(PRESETS.map((deck) => [deck.id, deck]));

function leagueDeck(id, presetId, replacements) {
  const base = presets['preset-' + presetId];
  const cardIds = [...base.cardIds];
  for (const [out, incoming] of replacements) cardIds[cardIds.indexOf(out)] = incoming;
  return { ...base, id: 'league-' + id, cardIds };
}

const decks = {
  protectorate: presets['preset-protectorate'],
  growth: presets['preset-growth'],
  plague: presets['preset-growth-plague'],
  rebirth: presets['preset-growth-rebirth'],
  formation: leagueDeck('formation', 'protectorate', [
    ['reinforcements', 'imperial-golem'], ['shield-overload', 'liaison'],
  ]),
  'orbit-gold': leagueDeck('orbit-gold', 'protectorate-orbital', [
    ['destruction-protocol', 'imperial-golem'], ['aggressor', 'liaison'],
  ]),
  'formation-diamond': leagueDeck('formation-diamond', 'protectorate', [
    ['reinforcements', 'imperial-golem'], ['shield-overload', 'liaison'], ['commander', 'field-medic'],
  ]),
  'orbit-diamond': leagueDeck('orbit-diamond', 'protectorate-orbital', [
    ['destruction-protocol', 'imperial-golem'], ['aggressor', 'liaison'], ['commander', 'field-medic'],
  ]),
  'plague-diamond': leagueDeck('plague-diamond', 'growth-plague', [
    ['nest', 'carrion-devourer'], ['veteran-mercenary', 'liaison'],
  ]),
  falura: leagueDeck('falura', 'protectorate', [
    ['annihilation', 'falura'], ['shield-overload', 'field-medic'], ['gate-guardian', 'imperial-golem'],
    ['standard', 'spotter'], ['reinforcements', 'spotter'], ['anvil', 'bounty-hunter'],
  ]),
};

// Добавьте сюда пресет новой фракции, чтобы переключить её персонажей одновременно.
const liveFactionDecks = {};

export function leagueDeckFor(character, liveDecks = liveFactionDecks) {
  return liveDecks[character.loreFaction] ?? decks[character.deckNow];
}
