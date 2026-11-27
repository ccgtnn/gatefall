// @ts-check

/** @typedef {import('../../../types/contracts').Action} Action */
/** @typedef {import('../../../types/contracts').ActionOptions} ActionOptions */
/** @typedef {import('../../../types/contracts').MatchState} MatchState */
/** @typedef {import('../../../types/contracts').Side} Side */

import { announcePlay, cardType, placementSide, placeCards, playDestination } from './board.js';
import { availableFees, availableOrders, canUseLeader, enqueueCardEffect, orderAbility, playTiming } from '../effects/effects.js';
import { canEndTurn, canPass, canPlayCard, markPassed, progress } from './match-rounds.js';

function resumeEffect(match, side, action, random, copy) {
  const { pending } = match;
  if (side !== pending.side) return match;
  const placement = pending.kind === 'deck-placement';
  const selection = placement && action.type === 'place' && pending.options.includes(action.row)
    ? playDestination(match.players[pending.selectionSide ?? side], action)
    : !placement && action.type === 'target' && pending.options.includes(action.cardId) && action.cardId;
  if (!selection) return match;
  const next = copy(match);
  const choice = next.pending;
  choice.job.refs[choice.key] = selection;
  next.effects.unshift(choice.job);
  next.pending = null;
  progress(next, random);
  return next;
}

/**
 * @param {MatchState} match
 * @param {Side} side
 * @param {Action} action
 * @param {ActionOptions} [options]
 * @returns {MatchState}
 */
export function applyAction(match, side, action, { random = Math.random, copy = structuredClone } = {}) {
  if (match.phase !== 'playing') return match;
  if (match.pending) return resumeEffect(match, side, action, random, copy);
  if (match.turn !== side || match.players[side].passed) return match;

  const player = match.players[side];
  const { type, cardId } = action;
  if (type === 'pass' && !canPass(match, side)) return match;
  if (type === 'end-turn' && !canEndTurn(match, side)) return match;
  if (type === 'order' && !availableOrders(match, side).some(({ card }) => card.id === cardId)) return match;
  const fee = type === 'fee' && availableFees(match, side).find(({ card }) => card.id === cardId)?.card.definition.fee;
  if (type === 'fee' && !fee) return match;
  if (type === 'leader' && !canUseLeader(match, side)) return match;
  if (type !== 'play' && type !== 'pass' && type !== 'order' && type !== 'leader' && type !== 'end-turn' && type !== 'fee') return match;
  const cardIndex = type === 'play' ? player.hand.findIndex(({ id }) => id === cardId) : -1;
  let destination;
  if (type === 'play') {
    const card = player.hand[cardIndex];
    if (match.playedCard || !card || !canPlayCard(match, side, card)) return match;
    if (cardType(card) !== 'effect') {
      if (card.definition.requiredRow && card.definition.requiredRow !== action.row) return match;
      destination = playDestination(match.players[placementSide(side, card)], action);
      if (!destination) return match;
    }
  }

  const next = copy(match);
  const current = next.players[side];
  if (type === 'pass') {
    markPassed(next, side, 'manual');
    next.ending = 'effects';
  } else if (type === 'end-turn') {
    next.ending = 'effects';
  } else if (type === 'play') {
    const [card] = current.hand.splice(cardIndex, 1);
    if (destination) {
      const { row, position } = destination;
      const recipient = placementSide(side, card);
      if (recipient !== side) card.owner = side;
      placeCards(next.players[recipient], row, position, [card]);
    }
    const timing = playTiming(next, side, card);
    const priorCategoryPlays = current.categoryPlays ?? {};
    const reactions = announcePlay(next, side, card, destination, timing === 'initiative' ? { initiative: true } : undefined);
    current.roundActed = true;
    enqueueCardEffect(next, side, card, timing, Boolean(destination), priorCategoryPlays);
    next.effects.push(...reactions);
    if (!destination) next.effects.push({ discard: card, side });
    next.playedCard = true;
  } else if (type === 'leader') {
    current.usedAbility = true;
    current.roundActed = true;
    const { leader } = current;
    if (leader.order) leader.lastUsedTurn = current.turns;
    const spendsCharge = !leader.order || leader.order.usesCharges;
    if (spendsCharge) leader.charges -= 1;
    const sourceDefinitionId = leader.order?.sourceDefinitionId;
    next.log.push({ type: 'leader', side, name: leader.name, ...(sourceDefinitionId && { sourceDefinitionId }),
      ...(leader.order && { lastUsedTurn: leader.lastUsedTurn }), ...(spendsCharge && { charges: leader.charges }) });
    next.effects.push({ ability: leader.ability, side, sourceDefinitionId });
  } else if (type === 'fee') {
    current.usedAbility = true;
    current.roundActed = true;
    next.effects.push({ ability: { ...fee, steps: [{ action: 'coins', amount: -fee.coins }, ...fee.steps] },
      side, sourceId: cardId, requiredSource: true, cardAbility: true });
  } else {
    current.usedAbility = true;
    current.roundActed = true;
    const { card } = availableOrders(next, side).find((unit) => unit.card.id === cardId);
    const order = card.definition.order;
    delete card.orderPlayedTurn;
    card.readyAt = current.turns + (order.cooldown ?? 0) + 1;
    if (card.orderCharges !== undefined) card.orderCharges -= 1;
    if (order.oncePerTurn || card.orderCharges !== undefined) card.orderUsedTurn = current.turns;
    next.log.push({ type: 'order', side, name: card.definition.name, cardId: card.id, readyAt: card.readyAt,
      ...(card.orderCharges !== undefined && { orderCharges: card.orderCharges }),
      ...(card.orderUsedTurn !== undefined && { orderUsedTurn: card.orderUsedTurn }) });
    next.effects.push({ ability: orderAbility(order), side, sourceId: card.id, requiredSource: true, cardAbility: true });
  }

  progress(next, random);
  return next;
}
