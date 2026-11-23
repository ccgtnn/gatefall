import { totalScore } from './match.js?v=robot-art-28';

export const LEAGUE_DIALOGUE = Object.freeze({ chance: .35, strongSwing: 6, duration: 3000 });

const mandatory = new Set(['start', 'win', 'loss']);
const resultReason = { win: 'loss', loss: 'win' };
const margin = ({ human, bot }) => totalScore(bot) - totalScore(human);

export function pickLeagueLine(character, reason, previous, random = Math.random) {
  const lines = character.lines[reason]?.filter((line) => line !== previous) ?? [];
  if (!lines.length || (!mandatory.has(reason) && random() >= LEAGUE_DIALOGUE.chance)) return null;
  return lines[Math.floor(random() * lines.length)];
}

export function createLeagueDialogue(character, random = Math.random) {
  let previous;
  let voicedTurn;
  let pendingPlay;

  function speak(reason) {
    const line = pickLeagueLine(character, reason, previous, random);
    if (!line) return null;
    previous = line;
    return { type: 'league-speech', side: 'bot', name: character.name, reason, line, telepathic: character.telepathic };
  }

  return {
    start: () => speak('start'),
    concede: () => speak('win'),
    cancelPlay: () => { pendingPlay = undefined; },
    transition(before, next, journal) {
      if (before.phase !== 'playing') return null;
      const turn = before.players.human.turns + before.players.bot.turns;
      const roundEnd = journal.find(({ type }) => type === 'round-end');
      const play = journal.find(({ type }) => type === 'play');
      if (play && !pendingPlay) pendingPlay = { play, margin: margin(before.players) };
      if (next.pending) return null;

      const resolved = pendingPlay;
      pendingPlay = undefined;
      const result = next.phase === 'finished' && resultReason[next.result];
      if (result) return speak(result);
      if (voicedTurn === turn) return null;

      const reasons = [];
      if (roundEnd?.winner) reasons.push(roundEnd.winner === 'bot' ? 'roundWin' : 'roundLoss');
      if (resolved) {
        const difference = roundEnd ? roundEnd.scores.bot - roundEnd.scores.human : margin(next.players);
        const { rarity } = resolved.play.card.definition;
        if (rarity === 'gold' || rarity === 'epic' || Math.abs(difference - resolved.margin) >= LEAGUE_DIALOGUE.strongSwing) {
          reasons.push(resolved.play.side === 'bot' ? 'botStrong' : 'humanStrong');
        }
      }
      if (journal.some(({ side, type }) => side === 'bot' && type === 'pass')) reasons.push('pass');
      if (!reasons.length) return null;

      const speech = speak(reasons[0]);
      if (speech) voicedTurn = turn;
      return speech;
    },
  };
}
