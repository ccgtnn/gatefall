import { handCount } from './bot-hand.js';
import { leaderFirestormStep, leaderFirestormValue } from './bot-effect-value.js';
import { COIN_LIMIT, neighbors, opponent, ROW_LIMIT, statusCount } from '../engine/board.js';
import { canGrantZeal, canUseLeader } from '../effects/effects.js';
import { targets } from '../effects/effect-queries.js';
import { cardAbilities, deathwishDefinitions } from '../engine/events.js';

function canFitOffering(player, { card, row }, amount) {
  return player.board[row].length < ROW_LIMIT ||
    (!statusCount(card, 'shield') && amount >= card.power + (card.armor ?? 0));
}

export function offeringPriority(match, side, unit, amount) {
  const { card } = unit;
  const fits = canFitOffering(match.players[side], unit, amount);
  return Number(fits) * 100 - card.power;
}

export function leaderTargetPriority(match, side, kind) {
  if (kind === 'zeal') {
    const { turns } = match.players[side];
    return (unit) => (canGrantZeal(unit, turns) ? 30 : 0) + Math.min(unit.card.power ?? 0, 20);
  }
  if (kind === 'shield') {
    return ({ card }) => {
      const power = Math.min(card.power, 12) * .25;
      if (statusCount(card, 'shield')) return power;
      const { order, endTurn, fieldEvents } = cardAbilities(card);
      const danger = statusCount(card, 'target') * 2 + Math.min(2, statusCount(card, 'infection'));
      return 4 + power + danger + Number(Boolean(order || endTurn || fieldEvents)) * 2;
    };
  }
}

export function replacementVictims(ability, candidates) {
  const replacement = ability?.steps.find(({ action, replacement }) => action === 'consume' && replacement)?.replacement;
  return replacement ? candidates.filter(({ card }) => card.definition.id !== replacement.id) : candidates;
}

export function leaderBeforeReplacement(match, side, action) {
  if (action.type !== 'play') return false;
  const { hand, leader, board, coins } = match.players[side];
  const card = hand.find(({ id }) => id === action.cardId);
  if (!cardAbilities(card).deploy?.steps.some(({ action }) => action === 'replace-leader') ||
      !canUseBotLeader(match, side)) return false;

  const { ability, aiHints } = leader;
  if (aiHints?.leaderConsume || aiHints?.leaderOffering) return preferredLeaderUse(match, side) === true;
  if (ability.steps.some(({ action }) => action === 'spawn')) {
    return Object.values(board).some((row) => row.length < ROW_LIMIT) ||
      (coins ?? 0) < COIN_LIMIT && ability.steps.some(({ action, amount }) => action === 'coins' && amount > 0);
  }
  return true;
}

export function canUseBotLeader(match, side) {
  if (!canUseLeader(match, side)) return false;
  const { ability, aiHints } = match.players[side].leader;
  if (aiHints?.leaderOffering && preferredLeaderUse(match, side) === false) return false;
  if (aiHints?.leaderConsume && !replacementVictims(ability, targets(match, { side }, ability.select[0].targets, true)).length) return false;
  const weather = leaderFirestormStep(ability);
  return !weather || leaderFirestormValue(match, side, weather) > 0;
}

// Undefined leaves an existing leader to the usual difficulty-specific strategy.
export function preferredLeaderUse(match, side) {
  const player = match.players[side];
  const { leader } = player;
  const hints = leader?.aiHints;
  if (leaderFirestormStep(leader?.ability)) return canUseBotLeader(match, side);
  // Replacement orders use their own decision rules.
  if (!leader || leader.order?.sourceDefinitionId) return;
  const [first] = leader.ability?.select ?? [];
  if (first?.kind === 'infection' && !match.players[opponent(side)].passed && canUseLeader(match, side)) {
    const candidates = targets(match, { side }, first.targets, true);
    if (candidates.some((target) => [target, ...neighbors(match, target)]
      .filter(({ card }) => card.power > 1 && !statusCount(card, 'infection')).length >= 2)) return true;
  }
  if (!hints) return;
  if (!canUseLeader(match, side)) return false;
  if (hints.leaderCoinsAtMost !== undefined) return (player.coins ?? 0) <= hints.leaderCoinsAtMost;

  if (hints.leaderZeal || hints.leaderShield) {
    const [choice] = leader.ability.select;
    const candidates = targets(match, { side }, choice.targets, true);
    return handCount(player) <= 2 || candidates.some((unit) =>
      hints.leaderZeal ? canGrantZeal(unit, player.turns) : !statusCount(unit.card, 'shield'));
  }

  if (hints.leaderSpawn) return true;
  if (hints.leaderConsume) {
    const [choice] = leader.ability.select;
    return replacementVictims(leader.ability, targets(match, { side }, choice.targets, true)).some(({ card }) =>
      deathwishDefinitions(card).length > 0 || statusCount(card, 'infection') > 0);
  }

  if (!hints.leaderOffering) return;
  const [choice] = leader.ability.select;
  const candidates = targets(match, { side }, choice.targets, true)
    .filter((unit) => canFitOffering(player, unit, choice.amount));
  if (candidates.some(({ card }) => card.power <= choice.amount)) return true;

  const spawn = leader.ability.steps.find(({ action }) => action === 'spawn');
  const opensChapter = Object.values(player.board).some((row) => row.some((card) => {
    const scenario = cardAbilities(card).scenario;
    if (!scenario || scenario.trigger !== 'appearance' || !spawn.card.categories?.includes(scenario.category)) return false;
    const next = (card.chapter ?? 0) + 1;
    return next < scenario.chapters.length || next === scenario.chapters.length &&
      (player.effectCategoryPlays?.[scenario.countPlayedEffects] ?? 0) >= (scenario.finalChapterMinimum ?? 0);
  }));
  return candidates.length > 0 && opensChapter;
}
