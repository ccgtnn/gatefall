// @ts-check

/** @typedef {import('../../types/contracts').MatchOptions} MatchOptions */
/** @typedef {import('../../types/contracts').MatchState} MatchState */

import { createCard, HAND_LIMIT } from './board.js';
import { FACTIONS } from './cards.js';
import { inspectDeck, ORBITAL_STRIKE_PRESET, REBIRTH_PRESET } from './decks.js';

const STARTING_LIVES = 2;

export const MATCH_RULES = Object.freeze({
  nextStarter: 'winner',
  leaderCharges: 1,
  coinCarryRatio: 0.5,
});

/** @param {MatchState} match */
export function carriedCoins(match, coins) {
  return Math.floor(coins * (match.rules.coinCarryRatio ?? MATCH_RULES.coinCarryRatio));
}

function emptyBoard() {
  return { orbit: [], surface: [] };
}

function shuffle(cards, random) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
  return cards;
}

function createLeader(leader, charges) {
  return leader ? { ...leader, charges: leader.ability ? (leader.charges ?? charges) : 0 } : null;
}

function createPlayer(side, definitions, random, factionId, leader, charges) {
  const faction = FACTIONS[factionId];
  const cards = definitions.map((definition, index) => createCard(`${side}-${index + 1}`, definition));
  const deck = shuffle(cards, random);
  const startingCategories = {};
  for (const { categories } of definitions) {
    for (const category of new Set(categories)) startingCategories[category] = (startingCategories[category] ?? 0) + 1;
  }
  return {
    startingCategories,
    startingDeck: cards.map(({ id, definition }) => ({ id, definition }))
      .toSorted((a, b) => a.definition.id.localeCompare(b.definition.id) || a.id.localeCompare(b.id)),
    lives: STARTING_LIVES,
    hand: deck.splice(0, HAND_LIMIT),
    deck,
    board: emptyBoard(),
    rowEffects: {},
    discard: [],
    exile: [],
    turns: 0,
    coins: 0,
    marksPlaced: 0,
    usedAbility: false,
    roundActed: false,
    extraSwaps: 0,
    leader: createLeader(leader, charges),
    faction: faction?.name,
    factionId,
    passed: false,
  };
}

/**
 * @param {MatchOptions} [options]
 * @returns {MatchState}
 */
export function createMatch({ decks, humanFaction = decks ? undefined : 'protectorate', humanLeader, botLeader, botFaction: selectedBotFaction, random = Math.random, rules = MATCH_RULES } = {}) {
  const settings = { ...MATCH_RULES, ...rules };
  const human = FACTIONS[humanFaction];
  const botFaction = selectedBotFaction ?? (human ? (humanFaction === 'growth' ? 'protectorate' : 'growth') : undefined);
  const bot = FACTIONS[botFaction];
  const selectedDecks = decks ?? { human: human.deck, bot: bot.deck };
  const leader = human?.leaders.find(({ id }) => id === humanLeader) ?? human?.leader;
  const players = {
    human: createPlayer('human', selectedDecks.human, random, humanFaction, leader, settings.leaderCharges),
    bot: createPlayer('bot', selectedDecks.bot, random, botFaction, undefined, settings.leaderCharges),
  };
  const starter = random() < 0.5 ? 'human' : 'bot';
  if (bot) {
    const leader = bot.leaders.find(({ id }) => id === botLeader) ?? bot.leaders[Math.floor(random() * bot.leaders.length)];
    players.bot.leader = createLeader(leader, settings.leaderCharges);
  }
  return {
    rules: settings,
    players,
    phase: 'mulligan',
    mulligan: { used: 0, excluded: [] },
    round: 1,
    starter,
    turn: null,
    result: null,
    log: [],
    tokenCount: 0,
    effects: [],
    pending: null,
    playedCard: false,
    ending: null,
    startingTurn: false,
  };
}

export function createDeckMatch(deck, options = {}) {
  const result = inspectDeck(deck);
  if (!result.valid) return null;
  const random = options.random ?? Math.random;
  if (options.botDeck) {
    const rival = inspectDeck(options.botDeck);
    if (!rival.valid) return null;
    return createMatch({
      random, rules: options.rules,
      decks: { human: result.cards, bot: rival.cards },
      humanFaction: deck.factionId, humanLeader: result.leader.id,
      botFaction: options.botDeck.factionId, botLeader: rival.leader.id,
    });
  }
  const roll = random();
  const faction = deck.factionId;
  const botFaction = faction === 'growth' ? 'protectorate'
    : faction === 'choir' && roll >= .5 ? 'captains'
      : faction === 'captains' && roll >= .5 ? 'choir' : 'growth';
  const alternate = botFaction === 'protectorate'
    ? (roll < .5 && ORBITAL_STRIKE_PRESET)
    : (botFaction === 'growth' && roll >= .5 && REBIRTH_PRESET);
  const botPreset = alternate ? inspectDeck(alternate) : null;
  return createMatch({
    random,
    rules: options.rules,
    decks: { human: result.cards, bot: botPreset?.cards ?? FACTIONS[botFaction].deck },
    botFaction, botLeader: botPreset?.leader.id,
    humanFaction: deck.factionId,
    humanLeader: result.leader.id,
  });
}
