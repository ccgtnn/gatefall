import { createCard } from '../../docs/game/board.js';
import { FACTIONS } from '../../docs/game/cards.js';
import { confirmMulligan, createMatch } from '../../docs/game/match.js';

export const standard = (id, definition) => createCard(id, definition);
export const plain = (id, power) => standard(id, { id, name: id, type: 'unit', power });
export const member = (id, faction, definition) =>
  standard(id, FACTIONS[faction].deck.find((card) => card.id === definition));
export const pass = { type: 'pass' };

export function position(round = 1, winner = null) {
  const match = confirmMulligan(createMatch({ random: () => .99 }));
  match.turn = 'bot';
  match.round = round;
  if (round === 2 && winner) match.players[winner === 'bot' ? 'human' : 'bot'].lives = 1;
  match.log = round === 1 ? [] : [{ type: 'round-end', round: 1, winner }];
  match.log.push({ type: 'round-start', round, side: 'bot' });
  for (const player of Object.values(match.players)) {
    player.board = { orbit: [], surface: [] };
    player.hand = [plain('a', 3), plain('b', 4), plain('c', 5), plain('d', 6)];
    player.leader = null;
  }
  return match;
}
