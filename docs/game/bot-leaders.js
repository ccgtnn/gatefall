import { ROW_LIMIT, statusCount } from './board.js';
import { canUseLeader } from './effects.js';
import { targets } from './effect-queries.js';
import { cardAbilities } from './events.js';

function canFitOffering(player, { card, row }, amount) {
  return player.board[row].length < ROW_LIMIT ||
    (!statusCount(card, 'shield') && amount >= card.power + (card.armor ?? 0));
}

export function offeringPriority(match, side, unit, amount) {
  const { card } = unit;
  const fits = canFitOffering(match.players[side], unit, amount);
  return Number(fits) * 100 - card.power;
}

// Undefined leaves an existing leader to the usual difficulty-specific strategy.
export function preferredLeaderUse(match, side) {
  const player = match.players[side];
  const { leader } = player;
  const hints = leader?.aiHints;
  // A replacement order keeps the portrait but has its own ability.
  if (!hints || leader.order?.sourceDefinitionId) return;
  if (!canUseLeader(match, side)) return false;
  if (hints.leaderCoinsAtMost !== undefined) return (player.coins ?? 0) <= hints.leaderCoinsAtMost;

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
