import { createCard } from '../../docs/game/engine/board.js';
import { runEffect } from '../../docs/game/effects/effects.js';
import { applyAction, createMatch } from '../../docs/game/engine/match.js';

export function unit(id, power, traits = {}) {
  return createCard(id, { id, name: id, power, ...traits });
}

export function emptyPlayingMatch({ side = 'human', random } = {}) {
  const match = createMatch({ decks: { human: [], bot: [] }, random });
  match.phase = 'playing';
  match.turn = side;
  return match;
}

export function play(match, cardId, { side = match.turn, row = 'surface', position = 0, random } = {}) {
  return applyAction(match, side, { type: 'play', cardId, row, position }, { random });
}

export function pick(match, cardId, { side = match.pending.side, random } = {}) {
  return applyAction(match, side, { type: 'target', cardId }, { random });
}

export function drain(match, random) {
  while (match.effects.length && !match.pending) {
    const job = match.effects.shift();
    if (job.discard) match.players[job.side].discard.push(job.discard);
    else runEffect(match, job, random);
  }
  return match;
}
