import { handCount } from './bot-hand.js';
import { neighbors, opponent, ROW_LIMIT, statusCount } from './board.js';
import { canGrantZeal, canUseLeader } from './effects.js';
import { targets } from './effect-queries.js';
import { cardAbilities, deathwishDefinitions } from './events.js';

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

// Undefined leaves an existing leader to the usual difficulty-specific strategy.
export function preferredLeaderUse(match, side) {
  const player = match.players[side];
  const { leader } = player;
  const hints = leader?.aiHints;
  // A replacement order keeps the portrait but has its own ability.
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
    return targets(match, { side }, choice.targets, true).some(({ card }) =>
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
