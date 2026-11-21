import { ROWS } from './cards.js?v=step-16';
import { cardType, findUnit, isUnit, neighbors, units } from './board.js?v=step-16';
import { availableOrders, canUseLeader, destructionSwing, effectSwing, rowArmor, rowDamage } from './effects.js?v=step-16';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, playableCards, totalScore } from './match.js?v=step-17';

import { chooseStrategicTarget, chooseStrategicTurn } from './bot-strategy.js?v=step-18';

export const BOT_RULES = Object.freeze({ passLead: 12, cardDeficitLimit: 1 });
export const BOT_DELAY_MS = 700;

export function createBotView(match) {
  const { human, bot } = match.players;
  return {
    cards: playableCards(match, 'bot').filter((card) => bot.usedAbility || !(destructionSwing(match, 'bot', card) < 0)).map((card) => {
      if (cardType(card) === 'effect') return { ...card, swing: effectSwing(match, 'bot', card) };
      if (card.definition.id !== 'broodlord') return card;
      const rows = ROWS.filter((row) => bot.board[row].length < ROW_LIMIT);
      const larvae = (row) => bot.board[row].filter(({ definition }) => definition.id === 'larva')
        .reduce((sum, unit) => sum + unit.power, 0);
      const preferredRow = rows.reduce((best, row) => larvae(row) > larvae(best) ? row : best);
      return { ...card, preferredRow, swing: card.power + larvae(preferredRow) };
    }),
    rowLengths: Object.fromEntries(ROWS.map((row) => [row, bot.board[row].length])),
    score: totalScore(bot),
    opponentScore: totalScore(human),
    opponentPassed: human.passed,
    lives: bot.lives,
    opponentLives: human.lives,
    handSize: bot.hand.length,
    opponentHandSize: human.hand.length,
    mustPlay: bot.usedAbility,
  };
}

const scoreValue = (card) => card.swing ?? card.power ?? 0;

function weakestWinningCards(ordered, rowLengths, target) {
  let openPlaces = ROWS.reduce((total, row) => total + ROW_LIMIT - rowLengths[row], 0);
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
      const occupiesSlot = cardType(card) !== 'effect';
      if (occupiesSlot && openPlaces === 0) continue;

      if (occupiesSlot) openPlaces -= 1;
      chosen.push(card);
      search(index, power + scoreValue(card));
      chosen.pop();
      if (occupiesSlot) openPlaces += 1;
    }
  }

  search(ordered.length, 0);
  return best?.reverse() ?? [];
}

function playCard(card, view) {
  if (cardType(card) === 'effect') return { type: 'play', cardId: card.id };
  const row = card.preferredRow ?? ROWS.reduce((best, next) => view.rowLengths[next] < view.rowLengths[best] ? next : best);
  return { type: 'play', cardId: card.id, row, position: view.rowLengths[row] };
}

export function chooseBotAction(view, rules = BOT_RULES) {
  const { cards, rowLengths, score, opponentScore, opponentPassed, lives, opponentLives, mustPlay } = view;
  const lead = score - opponentScore;
  const pass = { type: 'pass' };
  if (cards.length === 0) return pass;

  const ordered = [...cards].sort((left, right) => scoreValue(left) - scoreValue(right));
  if (opponentPassed) {
    const fallback = mustPlay ? playCard(ordered[0], view) : pass;
    if (lead > 0) return fallback;
    const winningCards = weakestWinningCards(ordered, rowLengths, 1 - lead);
    if (winningCards.length === 0) return fallback;

    const handAfterWin = Math.min(HAND_LIMIT, view.handSize - winningCards.length + ROUND_DRAW);
    const opponentAfterDraw = Math.min(HAND_LIMIT, view.opponentHandSize + ROUND_DRAW);
    const matchAtStake = lives === 1 || opponentLives === 1;
    const affordable = handAfterWin + rules.cardDeficitLimit >= opponentAfterDraw;
    return matchAtStake || affordable || mustPlay ? playCard(winningCards[0], view) : pass;
  }

  if (!mustPlay && lives > 1 && lead >= rules.passLead) return pass;
  const middle = ordered[Math.floor((ordered.length - 1) / 2)];
  return playCard(middle, view);
}

function lethalDamage(card, amount) {
  return amount >= card.power + (card.armor ?? 0);
}

function sacrificePriority(card) {
  if (card.definition.token) return 100;
  if (card.definition.deathwish) return 50;
  return -card.power;
}

function bestTarget(candidates, priority) {
  return candidates.reduce((best, unit) => priority(unit) > priority(best) ? unit : best);
}

export function pickBotTarget(match) {
  const { kind, amount, amounts, options, preferHigherAmount } = match.pending;
  const player = match.players[match.pending.side];
  if (kind === 'armor-row') {
    const row = bestTarget(options, (row) => rowArmor(player, row));
    return { type: 'target', cardId: row };
  }
  if (kind === 'spawn-row') {
    const row = bestTarget(options, (row) => -player.board[row].length);
    return { type: 'target', cardId: row };
  }
  if (kind === 'enemy-row') {
    const enemy = match.players[match.pending.selectionSide];
    const row = bestTarget(options, (row) => rowDamage(enemy, row, 1));
    return { type: 'target', cardId: row };
  }
  if (kind === 'deck-card' || kind === 'deck-top') {
    const optionsSet = new Set(options);
    const card = bestTarget(player[match.pending.pile ?? 'deck'].filter(({ id }) => optionsSet.has(id)), ({ definition }) =>
      (definition.power ?? definition.provision ?? 0) + (definition.armor ?? 0) * .15 + Number(Boolean(definition.deploy)));
    return { type: 'target', cardId: card.id };
  }
  if (kind === 'deck-placement') {
    const row = bestTarget(options, (row) => -player.board[row].length);
    return { type: 'place', row, position: player.board[row].length };
  }
  const optionsWithUnits = options.map((id) => findUnit(match, id));
  const highest = Math.max(0, ...Object.values(amounts ?? {}));
  const candidates = preferHigherAmount ? optionsWithUnits.filter(({ card }) => amounts[card.id] === highest) : optionsWithUnits;
  const lethal = kind === 'damage' ? candidates.filter(({ card }) => lethalDamage(card, amounts?.[card.id] ?? amount)) : [];
  const priorities = {
    'friendly-damage': ({ card }) => card.definition.id === 'gate-guardian' && card.armor > 0 && card.armor <= 2 ? -card.power
      : -Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0))),
    emp: ({ card }) => Math.min(card.power, 2 + (card.armor ?? 0)) + (card.armor ?? 0) * .1,
    consume: ({ card }) => sacrificePriority(card),
    'spend-armor': ({ card }) => amount ? card.armor : card.armor * 100 + card.power,
    'ready-order': ({ card }) => card.definition.order && card.readyAt > player.turns ? 20 + (card.power ?? 0) : card.power ?? 0,
    infection: (unit) => [unit, ...neighbors(match, unit)].reduce((sum, { card }) =>
      sum + Math.max(0, Math.min(3, card.power ?? 0) - (card.statuses?.infection ?? 0)), 0),
    marshal: (unit) => neighbors(match, unit).length * 100 + unit.card.power,
  };
  const target = bestTarget(lethal.length ? lethal : candidates, priorities[kind] ?? (({ card }) => card.power));
  return { type: 'target', cardId: target.card.id };
}

function beneficialLeader(match, view, allies) {
  const player = match.players.bot;
  if (!canUseLeader(match, 'bot')) return false;
  if (player.leader.ability.select?.[0]?.kind === 'marshal') {
    return !view.opponentPassed && allies.some((unit) => neighbors(match, unit).some(({ card }) => isUnit(card)));
  }

  if (player.leader.id !== 'devourer' && player.leader.ability.select?.[0]?.kind !== 'consume') return !view.opponentPassed;
  const sacrifices = allies.filter((unit) => isUnit(unit.card) && neighbors(match, unit).some(({ card }) => isUnit(card)));
  const { card } = bestTarget(sacrifices, ({ card }) => sacrificePriority(card));
  return card.power >= 2 || Boolean(card.definition.deathwish) || view.score === view.opponentScore;
}

function chooseEasyTurn(match) {
  if (match.pending) return pickBotTarget(match);
  const view = createBotView(match);
  const enemies = units(match, 'human').filter(({ card }) => isUnit(card));
  const allies = units(match, 'bot');
  const [order] = availableOrders(match, 'bot');
  const alreadyWon = view.opponentPassed && view.score > view.opponentScore;
  if (!alreadyWon) {
    if (order) {
      const damage = order.card.definition.order.steps.find(({ action }) => action === 'damage');
      if (!damage || enemies.some(({ card }) => lethalDamage(card, damage.amount) || (card.armor ?? 0) <= 1)) {
        return { type: 'order', cardId: order.card.id };
      }
    }
    if (!match.playedCard && beneficialLeader(match, view, allies)) return { type: 'leader' };
  }
  if (match.playedCard) return { type: 'end-turn' };
  return chooseBotAction(view);
}

export function chooseBotTurn(match, difficulty = 'easy', options = {}) {
  let decision;
  const strategy = { ...options, pickTarget: pickBotTarget, onDecision: (trace) => { decision = trace; } };
  let action;
  if (match.pending && (difficulty !== 'easy' || match.pending.kind === 'deck-placement')) {
    action = chooseStrategicTarget(match, pickBotTarget, difficulty, strategy);
  } else {
    const fallback = chooseEasyTurn(match);
    action = difficulty === 'normal' || difficulty === 'hard'
      ? chooseStrategicTurn(match, difficulty, fallback, strategy) : fallback;
  }
  if (action.type === 'pass' && match.round === 3) {
    const { bot, human } = match.players;
    const [card] = playableCards(match, 'bot');
    if (card && (totalScore(bot) <= totalScore(human) || (!human.passed && human.hand.length))) {
      const row = ROWS.find((name) => bot.board[name].length < ROW_LIMIT);
      action = { type: 'play', cardId: card.id, ...(row && { row, position: bot.board[row].length }) };
      decision = { reason: 'В решающем раунде продолжаю играть, пока соперник может ответить или ведёт по очкам.' };
    }
  }
  options.onDecision?.({ reason: 'Ход по правилам лёгкого бота.', candidates: [], ...decision, action });
  return action;
}
