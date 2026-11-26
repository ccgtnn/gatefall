import assert from 'node:assert/strict';
import { createCard } from '../../docs/game/board.js';
import { FACTIONS, FIRST_SIGNAL } from '../../docs/game/cards.js';
import { confirmMulligan, createMatch } from '../../docs/game/match.js';
import { pick, play as playCard } from './battle-helpers.js';

const definitions = new Map(Object.values(FACTIONS).flatMap(({ deck }) => deck.map((card) => [card.id, card])));
export const basic = { id: 'basic', name: 'Обычная карта', type: 'unit', power: 4 };
definitions.set('shieldbearer', { ...basic, id: 'shieldbearer', name: 'Щитоносец', power: 3, armor: 2 });
definitions.set('frigate', { ...basic, id: 'frigate', name: 'Патрульный фрегат' });
definitions.set('relay', { ...basic, id: 'relay', name: 'Наводчик щитов', power: 3,
  deploy: {
    select: [{ ref: 'ally', targets: { scope: 'ally', type: 'unit', row: 'surface' }, kind: 'armor' }],
    steps: [{ action: 'armor', target: { scope: 'ref', ref: 'ally' }, amount: 2 }],
  },
});
definitions.set('nursery', { ...basic, id: 'nursery', name: 'Рассадник', power: 3 });

export function unit(id, definitionId, overrides = {}) {
  return createCard(id, { ...definitions.get(definitionId), ...overrides });
}

export function fixture({ faction = 'protectorate', charges = 0 } = {}) {
  const match = createMatch({ humanFaction: faction, random: () => 0.999, rules: { leaderCharges: charges } });
  match.starter = 'human';
  const started = confirmMulligan(match, []);
  if (!charges && started.players.human.leader) started.players.human.leader.charges = 0;
  // Isolate the card under test from the opening stratagem.
  const surface = started.players.human.board.surface;
  assert.equal(surface.pop().id, FIRST_SIGNAL.id);
  return started;
}

export function board(match, side, row, ...cards) {
  match.players[side].board[row] = cards;
}

export function hand(match, ...cards) {
  match.players.human.hand = [...cards, createCard('spare', basic)];
}

export function play(match, id, position = 0, side = 'human', row = ['relay', 'nest'].includes(id) ? 'orbit' : 'surface') {
  return playCard(match, id, { side, row, position, random: () => 0 });
}

export function target(match, id, side = match.pending.side) {
  return pick(match, id, { side, random: () => 0 });
}

export function events(match, type) {
  return match.log.filter((event) => event.type === type);
}
