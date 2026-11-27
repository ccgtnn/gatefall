import { handCount } from './bot-hand.js';
import { ROWS } from '../shared/card-metadata.js';
import { cardType, findUnit, isUnit, neighbors, placementSide, restoreCard, statusCount, units } from '../engine/board.js';
import { availableOrders } from '../effects/effects.js';
import { rowArmor } from '../effects/effect-queries.js';
import { armorTargetPriority, beneficialFee, cleansePriority, deckCardValue, destructionSwing, effectSwing, immediateWeatherOrder, immediateWeatherValue, infectionGain, holdUntargetedDamage, lockPriority, pendingUnitPriority, rowDamage, rowEffectValue, rowScatterValue, usefulWeatherOrder } from './bot-effect-value.js';
import { armorBreakSwing, consumeBonus, delayedCardValue, futureContext, inheritancePayoff, remainingTurns, wantsToHoldInheritance } from './bot-future-value.js';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, availableRows, canEndTurn, canPass, playableCards, totalScore } from '../engine/match.js';

import { canUseBotLeader, leaderTargetPriority, offeringPriority, preferredLeaderUse } from './bot-leaders.js';
import { deathwishDefinitions } from '../engine/events.js';
import { BOT_LEVELS, readBotLevel } from './bot-levels.js';
import { botSearchState, chooseStrategicTarget, chooseStrategicTurn } from './bot-strategy.js';

export { BOT_LEVELS } from './bot-levels.js';

export const BOT_RULES = Object.freeze({ passLead: 12, cardDeficitLimit: 1 });
export const BOT_DELAY_MS = 700;

export function createBotView(match) {
  const { human, bot } = match.players;
  const context = futureContext(match, 'bot');
  const legal = holdUntargetedDamage(match, 'bot', playableCards(match, 'bot')
    .filter((card) => bot.usedAbility || !(destructionSwing(match, 'bot', card) < 0)));
  return {
    cards: legal.filter((card) => !wantsToHoldInheritance(context, card, legal)).map((card) => {
      if (card.definition.enemySide) {
        const lengths = Object.fromEntries(ROWS.map((row) => [row, human.board[row].length]));
        const preferredRow = ROWS.filter((row) => lengths[row] < ROW_LIMIT).reduce((best, row) =>
          lengths[row] > lengths[best] ? row : best);
        return { ...card, preferredRow, destinationLengths: lengths, swing: -(card.power ?? 0) };
      }
      if (cardType(card) === 'effect') return { ...card, swing: effectSwing(match, 'bot', card) };
      const delayed = delayedCardValue(context, card, undefined, true);
      const rowPreference = card.definition.preferredRow;
      if (rowPreference || card.definition.deploy?.steps.some(({ status }) => status === 'target')) {
        const row = rowPreference && bot.board[rowPreference].length < ROW_LIMIT ? rowPreference : undefined;
        const swing = card.definition.deploy?.sourceRow && !row ? 0 : effectSwing(match, 'bot', card);
        return { ...card, preferredRow: row, swing: (card.power ?? 0) + swing + delayed + immediateWeatherValue(match, 'bot', card, row) };
      }
      if (card.definition.deploy?.steps.some((step) => step.amount?.playedCategory || step.amount?.startingCategory ||
          step.action === 'play-from-hand' || step.chooseAll)) {
        return { ...card, swing: (card.power ?? 0) + effectSwing(match, 'bot', card) + delayed };
      }
      if (card.definition.deploy?.steps.some((step) => step.status === 'infection' || step.action === 'replace-leader')) {
        return { ...card, swing: (card.power ?? 0) + effectSwing(match, 'bot', card) + delayed };
      }
      const preferRowWith = card.definition.aiHints?.preferRowWith;
      if (!preferRowWith) return delayed ? { ...card, swing: (card.power ?? 0) + delayed } : card;
      const rows = ROWS.filter((row) => bot.board[row].length < ROW_LIMIT);
      const allyPower = (row) => bot.board[row].filter(({ definition }) => definition.id === preferRowWith)
        .reduce((sum, unit) => sum + unit.power, 0);
      const preferredRow = rows.reduce((best, row) => allyPower(row) > allyPower(best) ? row : best);
      return { ...card, preferredRow, swing: card.power + allyPower(preferredRow) };
    }),
    rowLengths: Object.fromEntries(ROWS.map((row) => [row, bot.board[row].length])),
    score: totalScore(bot),
    opponentScore: totalScore(human),
    opponentPassed: human.passed,
    lives: bot.lives,
    opponentLives: human.lives,
    handSize: handCount(bot),
    opponentHandSize: handCount(human),
    mustPlay: bot.usedAbility,
  };
}

const scoreValue = (card) => card.swing ?? card.power ?? 0;

function weakestWinningCards(ordered, rowLengths, target) {
  const capacity = (lengths) => ROWS.reduce((total, row) => total + ROW_LIMIT - lengths[row], 0);
  const places = { own: capacity(rowLengths), enemy: capacity(ordered.find((card) => card.destinationLengths)?.destinationLengths ?? rowLengths) };
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
      const side = card.definition.enemySide ? 'enemy' : 'own';
      if (occupiesSlot && places[side] === 0) continue;

      if (occupiesSlot) places[side] -= 1;
      chosen.push(card);
      search(index, power + scoreValue(card));
      chosen.pop();
      if (occupiesSlot) places[side] += 1;
    }
  }

  search(ordered.length, 0);
  return best?.reverse() ?? [];
}

function playCard(card, view) {
  if (cardType(card) === 'effect') return { type: 'play', cardId: card.id };
  const row = card.definition.requiredRow ?? card.preferredRow ?? ROWS.reduce((best, next) => view.rowLengths[next] < view.rowLengths[best] ? next : best);
  return { type: 'play', cardId: card.id, row, position: (card.destinationLengths ?? view.rowLengths)[row] };
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
  const ordinary = ordered.filter(({ definition }) => !definition.startTurnGrowth);
  const playable = ordered.length >= 3 && ordinary.length ? ordinary : ordered;
  const middle = playable[Math.floor((playable.length - 1) / 2)];
  return playCard(middle, view);
}

function lethalDamage(card, amount) {
  return !statusCount(card, 'shield') && amount >= card.power + (card.armor ?? 0);
}

function bestTarget(candidates, priority) {
  return candidates.reduce((best, unit) => priority(unit) > priority(best) ? unit : best);
}

export function pickBotTarget(match) {
  const { kind, amount, amounts, armorStrip, options, preferHigherAmount, scatter } = match.pending;
  const player = match.players[match.pending.side];
  if (kind === 'armor-row') {
    const row = bestTarget(options, (row) => rowArmor(player, row) + player.board[row]
      .reduce((sum, card) => sum + (armorBreakSwing(card) ?? 0), 0));
    return { type: 'target', cardId: row };
  }
  if (kind === 'spawn-row') {
    const row = bestTarget(options, (row) => -player.board[row].length);
    return { type: 'target', cardId: row };
  }
  if (kind === 'row-effect') {
    const { selectionSide, rowWeather } = match.pending;
    const enemy = match.players[selectionSide];
    const horizon = rowWeather === 'firestorm' || enemy.passed ? remainingTurns(match, selectionSide) : undefined;
    return { type: 'target', cardId: bestTarget(options, (row) => rowEffectValue(enemy, row, amount, true, horizon, rowWeather)) };
  }
  if (kind === 'mark-row') {
    const enemy = match.players[match.pending.selectionSide];
    const count = (row) => enemy.board[row].filter((card) => isUnit(card) && !statusCount(card, 'target')).length;
    return { type: 'target', cardId: bestTarget(options, count) };
  }
  if (kind === 'enemy-row') {
    const enemy = match.players[match.pending.selectionSide];
    const row = bestTarget(options, (row) => scatter
      ? rowScatterValue(enemy, row, amount) : rowDamage(enemy, row, amount, armorStrip));
    return { type: 'target', cardId: row };
  }
  if (kind === 'tribute') {
    return { type: 'target', cardId: bestTarget(options, Number) };
  }
  if (kind === 'hand-return' || kind === 'hand-bottom') {
    const eligible = player.hand.filter(({ id }) => options.includes(id));
    const card = bestTarget(eligible, (card) => -deckCardValue(match, match.pending.side, card));
    return { type: 'target', cardId: card.id };
  }
  if (kind === 'deck-card' || kind === 'deck-top') {
    const optionsSet = new Set(options);
    const candidates = (match.pending.cards ?? player[match.pending.pile ?? 'deck']).filter(({ id }) => optionsSet.has(id));
    const card = bestTarget(candidates, (card) => {
      if (['created', 'hand'].includes(match.pending.pile)) return deckCardValue(match, match.pending.side, card);
      if (match.pending.pile === 'discard') return deckCardValue(match, match.pending.side, restoreCard(card));
      if (match.pending.fullDeck) return deckCardValue(match, match.pending.side, card);
      const { definition, power } = card;
      return (power ?? definition.power ?? definition.provision ?? 0) + (definition.armor ?? 0) * .15 + Number(Boolean(definition.deploy));
    });
    return { type: 'target', cardId: card.id };
  }
  if (kind === 'deck-placement') {
    const recipient = match.players[match.pending.selectionSide ?? match.pending.side];
    const card = (match.pending.cards ?? player[match.pending.pile ?? 'deck']).find(({ id }) => id === match.pending.cardId);
    const preferred = card?.definition.preferredRow;
    const row = options.includes(preferred) ? preferred : bestTarget(options, (row) => -recipient.board[row].length);
    return { type: 'place', row, position: recipient.board[row].length };
  }
  const optionsWithUnits = options.map((id) => findUnit(match, id));
  const highest = Math.max(0, ...Object.values(amounts ?? {}));
  const allies = kind === 'transform' ? optionsWithUnits.filter(({ side }) => side === match.pending.side) : [];
  const candidates = allies.length ? allies
    : preferHigherAmount ? optionsWithUnits.filter(({ card }) => amounts[card.id] === highest) : optionsWithUnits;
  const lethal = kind === 'damage' ? candidates.filter(({ card, side }) =>
    side !== match.pending.side && lethalDamage(card, amounts?.[card.id] ?? amount) && (armorBreakSwing(card) ?? -card.power) < 0) : [];
  const forecast = kind === 'consume' && futureContext(match, match.pending.side);
  const priorities = {
    damage: ({ card, side }) => {
      if (statusCount(card, 'shield')) return side === match.pending.side ? -.5 : 0;
      const hit = amounts?.[card.id] ?? amount;
      const swing = hit >= card.armor ? armorBreakSwing(card) : undefined;
      if (side !== match.pending.side) return swing === undefined ? card.power : -swing;
      return swing ?? (-1 - Math.min(card.power, Math.max(0, hit - (card.armor ?? 0))));
    },
    'friendly-damage': ({ card }) => {
      if (statusCount(card, 'shield')) return -.5;
      const hit = amount || 2;
      const swing = card.armor <= hit ? armorBreakSwing(card) : undefined;
      return swing ?? -Math.min(card.power, Math.max(0, hit - (card.armor ?? 0)));
    },
    emp: ({ card }) => Math.min(card.power, 2 + (card.armor ?? 0)) + (card.armor ?? 0) * .1,
    consume: (unit) => 4 * consumeBonus(forecast, unit) - .03 * (unit.card.power ?? 0),
    'leader-offering': (unit) => offeringPriority(match, match.pending.side, unit, amount),
    sacrifice: ({ card }) => -card.power,
    deathwish: ({ card }) => deathwishDefinitions(card).length * 10 + card.power,
    lock: (unit) => lockPriority(match, match.pending.side, unit),
    cleanse: (unit) => cleansePriority(unit, match.pending.side),
    armor: (unit) => armorTargetPriority(match, match.pending.side, unit),
    'spend-armor': ({ card }) => (amount ? card.armor : card.armor + card.power * .01) +
      (card.armor <= (amount || Infinity) ? armorBreakSwing(card) ?? 0 : 0),
    'infection-target': ({ card, side }) => infectionGain(card, amount, remainingTurns(match, side)),
    infection: (unit) => [unit, ...neighbors(match, unit)].reduce((sum, { card }) =>
      sum + infectionGain(card, 3), 0),
    'target-mark': ({ card }) => Math.min(3, card.power) - (card.armor ?? 0) * .3 - statusCount(card, 'shield') * 2,
    marshal: (unit) => neighbors(match, unit).length * 100 + unit.card.power,
  };
  const target = bestTarget(lethal.length ? lethal : candidates, priorities[kind] ?? pendingUnitPriority(match, match.pending) ?? leaderTargetPriority(match, match.pending.side, kind) ?? (({ card }) => card.power));
  return { type: 'target', cardId: target.card.id };
}

function beneficialLeader(match, view, allies) {
  const player = match.players.bot;
  const preference = preferredLeaderUse(match, 'bot');
  if (preference !== undefined) return preference;
  if (!canUseBotLeader(match, 'bot')) return false;
  if (player.leader.order && !player.leader.order.usesCharges) return units(match, 'human').some(({ card }) => isUnit(card) && (card.armor ?? 0) < 2);
  const kind = player.leader.ability.select?.[0]?.kind;
  if (kind === 'marshal') {
    return !view.opponentPassed && allies.some((unit) => neighbors(match, unit).some(({ card }) => isUnit(card)));
  }

  if (kind !== 'consume') return !view.opponentPassed;
  const sacrifices = allies.filter((unit) => isUnit(unit.card) && neighbors(match, unit).some(({ card }) => isUnit(card)));
  if (!sacrifices.length) return false;
  const context = futureContext(match, 'bot');
  const { card } = bestTarget(sacrifices, (unit) => consumeBonus(context, unit));
  return card.power >= 2 || deathwishDefinitions(card).length > 0 || view.score === view.opponentScore;
}

export function chooseEasyTurn(match) {
  if (match.pending) return pickBotTarget(match);
  const view = createBotView(match);
  const enemies = units(match, 'human').filter(({ card }) => isUnit(card));
  const allies = units(match, 'bot');
  const orders = availableOrders(match, 'bot');
  const weatherOrder = immediateWeatherOrder(match, 'bot', orders);
  if (weatherOrder) return { type: 'order', cardId: weatherOrder.card.id };
  const order = orders.find((unit) => !unit.card.definition.aiHints?.useOrderWhenReady && usefulWeatherOrder(match, 'bot', unit));
  const alreadyWon = view.opponentPassed && view.score > view.opponentScore;
  if (!alreadyWon) {
    if (order) {
      const damage = order.card.definition.order.steps.find(({ action }) => action === 'damage');
      if (!damage || damage.amount?.count || enemies.some(({ card }) => lethalDamage(card, damage.amount) || (card.armor ?? 0) <= 1)) {
        return { type: 'order', cardId: order.card.id };
      }
    }
    const fee = beneficialFee(match, 'bot');
    if (fee) return fee;
    if (beneficialLeader(match, view, allies) || (!view.cards.length && !match.playedCard && canUseBotLeader(match, 'bot') && !view.opponentPassed)) return { type: 'leader' };
  }
  if (canEndTurn(match, 'bot')) return { type: 'end-turn' };
  const forecast = futureContext(match, 'bot');
  if (!view.opponentPassed && forecast.turns > 1) {
    const keeper = view.cards.find((card) => inheritancePayoff(forecast, card) >= 5);
    if (keeper) return playCard(keeper, view);
  }
  const action = chooseBotAction(view);
  if (action.type !== 'pass' || match.round !== 3) return action;
  if (canPass(match, 'bot')) {
    const card = view.cards.find((candidate) => scoreValue(candidate) >= 0);
    return card ? playCard(card, view) : action;
  }
  const [card] = playableCards(match, 'bot');
  if (!card) return action;
  if (cardType(card) === 'effect') return { type: 'play', cardId: card.id };
  const player = match.players[placementSide('bot', card)];
  const [row] = availableRows(player, card);
  return { type: 'play', cardId: card.id, row, position: player.board[row].length };
}

export function chooseBotTurn(match, mastery, options = {}) {
  const level = BOT_LEVELS[readBotLevel(mastery)];
  const strategy = { ...options, pickTarget: pickBotTarget };
  const state = botSearchState(match, level.knowsDeckList);
  if (state.pending?.rowWeather === 'firestorm' || state.pending?.kind === 'weather-deathwish') return pickBotTarget(state);
  if (!state.pending && state.turn === 'bot' && state.playedCard) {
    const order = immediateWeatherOrder(state, 'bot', availableOrders(state, 'bot'));
    if (order) return { type: 'order', cardId: order.card.id };
  }
  return state.pending ? chooseStrategicTarget(state, level, strategy) : chooseStrategicTurn(state, level, strategy);
}
