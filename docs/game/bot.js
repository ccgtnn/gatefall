import { ROWS } from './cards.js';
import { findUnit, neighbors, units } from './board.js';
import { availableOrders, canUseLeader } from './effects.js';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, playableCards, totalScore } from './match.js';

export const BOT_RULES = Object.freeze({ passLead: 12, cardDeficitLimit: 1 });
export const BOT_DELAY_MS = 700;

export function createBotView(match) {
  const { human, bot } = match.players;
  return {
    cards: playableCards(bot),
    rowLengths: Object.fromEntries(ROWS.map((row) => [row, bot.board[row].length])),
    score: totalScore(bot),
    opponentScore: totalScore(human),
    opponentPassed: human.passed,
    lives: bot.lives,
    opponentLives: human.lives,
    handSize: bot.hand.length,
    opponentHandSize: human.hand.length,
  };
}

function weakestWinningCards(ordered, rowLengths, target) {
  const freeSlots = Object.fromEntries(ROWS.map((row) => [row, ROW_LIMIT - rowLengths[row]]));
  let best = null;
  let bestPower = Infinity;
  const chosen = [];

  function search(end, power) {
    if (power >= target) {
      if (best === null || chosen.length < best.length ||
          (chosen.length === best.length && power < bestPower)) {
        best = [...chosen];
        bestPower = power;
      }
      return;
    }
    if (best !== null && chosen.length >= best.length) return;

    // Visit weaker highest cards first, so equal totals leave the strongest cards in hand.
    for (let index = 0; index < end; index += 1) {
      const card = ordered[index];
      const { row } = card.definition;
      if (freeSlots[row] === 0) continue;

      freeSlots[row] -= 1;
      chosen.push(card);
      search(index, power + card.power);
      chosen.pop();
      freeSlots[row] += 1;
    }
  }

  search(ordered.length, 0);
  return best?.reverse() ?? [];
}

function playCard(card, view) {
  return { type: 'play', cardId: card.id, position: view.rowLengths[card.definition.row] };
}

export function chooseBotAction(view, rules = BOT_RULES) {
  const { cards, rowLengths, score, opponentScore, opponentPassed, lives, opponentLives } = view;
  const lead = score - opponentScore;
  const pass = { type: 'pass' };
  if (cards.length === 0) return pass;

  const ordered = [...cards].sort((left, right) => left.power - right.power);
  if (opponentPassed) {
    if (lead > 0) return pass;
    const winningCards = weakestWinningCards(ordered, rowLengths, 1 - lead);
    if (winningCards.length === 0) return pass;

    const handAfterWin = Math.min(HAND_LIMIT, view.handSize - winningCards.length + ROUND_DRAW);
    const opponentAfterDraw = Math.min(HAND_LIMIT, view.opponentHandSize + ROUND_DRAW);
    const matchAtStake = lives === 1 || opponentLives === 1;
    const affordable = handAfterWin + rules.cardDeficitLimit >= opponentAfterDraw;
    return matchAtStake || affordable ? playCard(winningCards[0], view) : pass;
  }

  if (lives > 1 && lead >= rules.passLead) return pass;
  const middle = ordered[Math.floor((ordered.length - 1) / 2)];
  return playCard(middle, view);
}

function damagePriority(card, amount) {
  const lethal = amount >= card.power + (card.armor ?? 0);
  return (lethal ? 100 : 0) + card.power;
}

function sacrificePriority(card) {
  if (card.definition.token) return 100;
  if (card.definition.deathwish) return 50;
  return -card.power;
}

function bestTarget(candidates, priority) {
  return candidates.reduce((best, unit) => priority(unit) > priority(best) ? unit : best);
}

function pickBotTarget(match) {
  const { kind, amount, options } = match.pending;
  const candidates = options.map((id) => findUnit(match, id));
  const priorities = {
    damage: ({ card }) => damagePriority(card, amount),
    consume: ({ card }) => sacrificePriority(card),
    'spend-armor': ({ card }) => amount ? card.armor : card.armor * 100 + card.power,
    marshal: (unit) => neighbors(match, unit).length * 100 + unit.card.power,
  };
  const target = bestTarget(candidates, priorities[kind] ?? (({ card }) => card.power));
  return { type: 'target', cardId: target.card.id };
}

function beneficialLeader(match, view, allies) {
  const player = match.players.bot;
  if (!canUseLeader(match, 'bot')) return false;
  if (player.leader.effect === 'marshal') {
    return !view.opponentPassed && allies.some((unit) => neighbors(match, unit).length > 0);
  }

  const sacrifices = allies.filter((unit) => neighbors(match, unit).length > 0);
  const { card } = bestTarget(sacrifices, ({ card }) => sacrificePriority(card));
  return card.power >= 2 || Boolean(card.definition.deathwish) || view.score === view.opponentScore;
}

export function chooseBotTurn(match) {
  if (match.pending) return pickBotTarget(match);
  const view = createBotView(match);
  const enemies = units(match, 'human');
  const allies = units(match, 'bot');
  const [order] = availableOrders(match, 'bot');
  const alreadyWon = view.opponentPassed && view.score > view.opponentScore;
  if (!alreadyWon) {
    if (order && enemies.some(({ card }) => damagePriority(card, 3) >= 100 || (card.armor ?? 0) <= 1)) {
      return { type: 'order', cardId: order.card.id };
    }
    if (beneficialLeader(match, view, allies)) return { type: 'leader' };
  }
  return chooseBotAction(view);
}
