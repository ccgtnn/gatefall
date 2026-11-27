import { createCard, damage, findUnit } from '../../docs/game/engine/board.js';
import { CHOIR_CARDS, PSIONICS } from '../../docs/game/cards/factions/choir.js';
import { applyAction, createMatch } from '../../docs/game/engine/match.js';
import { drain as drainEffects, pick as pickTarget, play as playCard } from './battle-helpers.js';

export const cards = new Map(CHOIR_CARDS.map((definition) => [definition.id, definition]));
export const unit = (power) => ({ id: `unit-${power}`, name: `Отряд ${power}`, type: 'unit', power });
export const quiet = { id: 'psionic-test', name: 'Псионика', type: 'effect', categories: [PSIONICS], deploy: { steps: [] } };
export const fixed = () => 0;

export function setup({ count = 0, hand = [], deck = [], orbit = [], surface = [], enemies = [] } = {}) {
  const match = createMatch({ decks: { human: Array(count).fill(quiet), bot: [] },
    humanFaction: 'choir', botFaction: 'protectorate', random: fixed });
  match.phase = 'playing';
  match.turn = 'human';
  const pile = (items, label) => items.map((definition, i) => createCard(`${label}-${i}`, definition));
  Object.assign(match.players.human, {
    hand: pile([...hand, unit(3)], 'hand'),
    deck: pile(deck, 'deck'),
    board: { orbit: pile(orbit, 'orbit'), surface: pile(surface, 'surface') },
  });
  match.players.bot.hand = pile([unit(3)], 'enemy-hand');
  match.players.bot.board.orbit = pile(enemies, 'enemy');
  return match;
}
export const human = (match) => match.players.human;
export const get = (match, id) => findUnit(match, id)?.card;
export const action = (match, type, parameters) => applyAction(match, 'human', { type, ...parameters }, { random: fixed });
export const play = (match, row = 'orbit', position = human(match).board[row].length) =>
  playCard(match, 'hand-0', { side: 'human', row, position, random: fixed });
export const pick = (match, cardId) => pickTarget(match, cardId, { side: 'human', random: fixed });
export const drain = (match) => drainEffects(match, fixed);
export function hit(match, id, amount) {
  damage(match, findUnit(match, id), amount);
  return drain(match);
}
