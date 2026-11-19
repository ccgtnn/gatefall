import { playableCards, totalScore } from './match.js';

export const BOT_RULES = Object.freeze({ passLead: 12 });
export const BOT_DELAY_MS = 700;

export function createBotView(match) {
  const { human, bot } = match.players;
  return {
    cards: playableCards(bot),
    score: totalScore(bot),
    opponentScore: totalScore(human),
    opponentPassed: human.passed,
  };
}

export function chooseBotAction(view, rules = BOT_RULES) {
  const { cards, score, opponentScore, opponentPassed } = view;
  const lead = score - opponentScore;
  const pass = { type: 'pass' };
  if (cards.length === 0) return pass;

  const ordered = [...cards].sort((left, right) => left.power - right.power);
  if (opponentPassed) {
    if (lead > 0) return pass;
    const cheapestWin = ordered.find((card) => card.power > -lead);
    return cheapestWin ? { type: 'play', cardId: cheapestWin.id } : pass;
  }

  if (lead >= rules.passLead) return pass;
  const middle = ordered[Math.floor((ordered.length - 1) / 2)];
  return { type: 'play', cardId: middle.id };
}
