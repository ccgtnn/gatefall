import { ROWS } from './cards.js?v=sleeper-name-1';
import { cardType, findUnit, isUnit, neighbors, restoreCard, statusCount, units } from './board.js?v=sleeper-name-1';
import { availableOrders, canUseLeader, cleansePriority, deckCardValue, destructionSwing, effectSwing, infectionGain, lockPriority, rowArmor, rowDamage, rowEffectValue, rowScatterValue } from './effects.js?v=choir-art-1';
import { HAND_LIMIT, ROUND_DRAW, ROW_LIMIT, playableCards, totalScore } from './match.js?v=choir-art-1';

import { deathwishDefinitions } from './events.js?v=ulmarin-1';
import { chooseStrategicTarget, chooseStrategicTurn } from './bot-strategy.js?v=choir-art-1';

export const BOT_RULES = Object.freeze({ passLead: 12, cardDeficitLimit: 1 });
export const BOT_DELAY_MS = 700;

export function createBotView(match) {
  const { human, bot } = match.players;
  return {
    cards: playableCards(match, 'bot').filter((card) => bot.usedAbility || !(destructionSwing(match, 'bot', card) < 0)).map((card) => {
      if (card.definition.enemySide) {
        const lengths = Object.fromEntries(ROWS.map((row) => [row, human.board[row].length]));
        const preferredRow = ROWS.filter((row) => lengths[row] < ROW_LIMIT).reduce((best, row) =>
          lengths[row] > lengths[best] ? row : best);
        return { ...card, preferredRow, destinationLengths: lengths, swing: -(card.power ?? 0) };
      }
      if (cardType(card) === 'effect') return { ...card, swing: effectSwing(match, 'bot', card) };
      const rowPreference = card.definition.preferredRow;
      if (rowPreference || card.definition.deploy?.steps.some(({ status }) => status === 'target')) {
        const row = rowPreference && bot.board[rowPreference].length < ROW_LIMIT ? rowPreference : undefined;
        const swing = card.definition.deploy?.sourceRow && !row ? 0 : effectSwing(match, 'bot', card);
        return { ...card, preferredRow: row, swing: (card.power ?? 0) + swing };
      }
      if (card.definition.deploy?.steps.some((step) => step.amount?.playedCategory || step.amount?.startingCategory ||
          step.action === 'play-from-hand' || step.chooseAll)) {
        return { ...card, swing: (card.power ?? 0) + effectSwing(match, 'bot', card) };
      }
      if (card.definition.deploy?.steps.some((step) => step.status === 'infection' || step.action === 'replace-leader')) {
        return { ...card, swing: (card.power ?? 0) + effectSwing(match, 'bot', card) };
      }
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
  const row = card.preferredRow ?? ROWS.reduce((best, next) => view.rowLengths[next] < view.rowLengths[best] ? next : best);
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

function sacrificePriority(card) {
  const wishes = deathwishDefinitions(card).length;
  if (wishes) return 100 + 10 * wishes - card.power;
  if (card.definition.token) return 50;
  return -card.power;
}

function bestTarget(candidates, priority) {
  return candidates.reduce((best, unit) => priority(unit) > priority(best) ? unit : best);
}

export function pickBotTarget(match) {
  const { kind, amount, amounts, armorStrip, options, preferHigherAmount, scatter } = match.pending;
  const player = match.players[match.pending.side];
  if (kind === 'armor-row') {
    const row = bestTarget(options, (row) => rowArmor(player, row));
    return { type: 'target', cardId: row };
  }
  if (kind === 'spawn-row') {
    const row = bestTarget(options, (row) => -player.board[row].length);
    return { type: 'target', cardId: row };
  }
  if (kind === 'row-effect') {
    const enemy = match.players[match.pending.selectionSide];
    return { type: 'target', cardId: bestTarget(options, (row) => rowEffectValue(enemy, row, amount)) };
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
  if (kind === 'hand-return') {
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
  const candidates = preferHigherAmount ? optionsWithUnits.filter(({ card }) => amounts[card.id] === highest) : optionsWithUnits;
  const lethal = kind === 'damage' ? candidates.filter(({ card, side }) =>
    side !== match.pending.side && lethalDamage(card, amounts?.[card.id] ?? amount)) : [];
  const priorities = {
    damage: ({ card, side }) => {
      const shielded = statusCount(card, 'shield');
      if (side !== match.pending.side) return shielded ? 0 : card.power;
      return shielded ? -.5 : -1 - Math.min(card.power, Math.max(0, (amounts?.[card.id] ?? amount) - (card.armor ?? 0)));
    },
    'friendly-damage': ({ card }) => {
      if (statusCount(card, 'shield')) return -.5;
      if (card.definition.id === 'gate-guardian' && card.armor > 0 && card.armor <= 2) return -card.power;
      return -Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0)));
    },
    emp: ({ card }) => Math.min(card.power, 2 + (card.armor ?? 0)) + (card.armor ?? 0) * .1,
    consume: ({ card }) => sacrificePriority(card),
    sacrifice: ({ card }) => -card.power,
    deathwish: ({ card }) => deathwishDefinitions(card).length * 10 + card.power,
    lock: (unit) => lockPriority(unit, match.pending.side),
    cleanse: (unit) => cleansePriority(unit, match.pending.side),
    'spend-armor': ({ card }) => amount ? card.armor : card.armor * 100 + card.power,
    'ready-order': ({ card }) => card.definition.order && card.readyAt > player.turns ? 20 + (card.power ?? 0) : card.power ?? 0,
    'infection-target': ({ card }) => infectionGain(card, amount, Math.max(1, match.players[match.pending.side === 'human' ? 'bot' : 'human'].hand.length)),
    infection: (unit) => [unit, ...neighbors(match, unit)].reduce((sum, { card }) =>
      sum + infectionGain(card, 3), 0),
    'target-mark': ({ card }) => Math.min(3, card.power) - (card.armor ?? 0) * .3 - statusCount(card, 'shield') * 2,
    marshal: (unit) => neighbors(match, unit).length * 100 + unit.card.power,
  };
  const target = bestTarget(lethal.length ? lethal : candidates, priorities[kind] ?? (({ card }) => card.power));
  return { type: 'target', cardId: target.card.id };
}

function beneficialLeader(match, view, allies) {
  const player = match.players.bot;
  if (!canUseLeader(match, 'bot')) return false;
  if (player.leader.order) return units(match, 'human').some(({ card }) => isUnit(card) && (card.armor ?? 0) < 2);
  if (player.leader.ability.select?.[0]?.kind === 'marshal') {
    return !view.opponentPassed && allies.some((unit) => neighbors(match, unit).some(({ card }) => isUnit(card)));
  }

  if (player.leader.id !== 'devourer' && player.leader.ability.select?.[0]?.kind !== 'consume') return !view.opponentPassed;
  const sacrifices = allies.filter((unit) => isUnit(unit.card) && neighbors(match, unit).some(({ card }) => isUnit(card)));
  const { card } = bestTarget(sacrifices, ({ card }) => sacrificePriority(card));
  return card.power >= 2 || deathwishDefinitions(card).length > 0 || view.score === view.opponentScore;
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
      if (!damage || damage.amount?.count || enemies.some(({ card }) => lethalDamage(card, damage.amount) || (card.armor ?? 0) <= 1)) {
        return { type: 'order', cardId: order.card.id };
      }
    }
    if (beneficialLeader(match, view, allies) || (!view.cards.length && !match.playedCard && canUseLeader(match, 'bot') && !view.opponentPassed)) return { type: 'leader' };
  }
  if (match.playedCard) return { type: 'end-turn' };
  return chooseBotAction(view);
}

export function chooseBotTurn(match, difficulty = 'easy', options = {}) {
  let decision;
  const strategy = { ...options, pickTarget: pickBotTarget, onDecision: (trace) => { decision = trace; } };
  let action;
  if (match.pending?.kind === 'sacrifice') {
    action = pickBotTarget(match);
  } else if (match.pending && (difficulty !== 'easy' || match.pending.kind === 'deck-placement')) {
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
      const view = createBotView(match);
      action = playCard(view.cards.find(({ id }) => id === card.id) ?? card, view);
      decision = { reason: 'В решающем раунде продолжаю играть, пока соперник может ответить или ведёт по очкам.' };
    }
  }
  options.onDecision?.({ reason: 'Ход по правилам лёгкого бота.', candidates: [], ...decision, action });
  return action;
}
