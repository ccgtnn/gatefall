import { availableRows, cleansableStatuses, infectionDamage, isUnit, neighbors, opponent, restoreCard, ROW_LIMIT, statusCount, units } from './board.js';
import { ROWS } from './card-metadata.js';
import { canStart, eligiblePileCards, pileCandidates, playPiles, playTiming, rowArmor, rowSide, targets, valueOf } from './effect-queries.js';
import { cardAbilities, deathwishDefinitions, isLocked } from './events.js';

export function shouldProtectArmor(card, player) {
  return card?.definition.aiHints?.armorBreakCostsPower &&
    player.hand.some(({ definition }) => definition.aiHints?.spendsRowArmor);
}

export function rowDamage(player, row, amount, armorStrip = 0) {
  return player.board[row].filter(isUnit).reduce((sum, card) => {
    const armor = Math.max(0, (card.armor ?? 0) - armorStrip);
    const shielded = statusCount(card, 'shield') > 0;
    const breaks = card.armor > 0 && armor <= (shielded ? 0 : amount) &&
      cardAbilities(card).events?.['armor-break']?.steps.some((step) => step.action === 'discard' && step.target.scope === 'source');
    if (breaks) return sum + card.power;
    return sum + (shielded ? 0 : Math.min(card.power, Math.max(0, amount - armor)));
  }, 0);
}

export function rowScatterValue(player, row, amount) {
  const units = player.board[row].filter(isUnit);
  const perUnit = amount / Math.max(1, units.length);
  return units.reduce((sum, card) => sum +
    Math.min(card.power, Math.max(0, perUnit - (card.armor ?? 0) - statusCount(card, 'shield'))), 0);
}

export function armorTargetPriority(match, side, unit) {
  const { card } = unit;
  const armor = card.armor ?? 0;
  const player = match.players[side];
  const abilities = cardAbilities(card);
  const enablesCost = abilities.order?.cost?.select?.some(({ targets }) => targets.armorAtLeast > armor && targets.armorAtLeast <= armor + 2);
  const formations = player.hand.some(({ definition }) => definition.aiHints?.placement === 'armored-neighbors');
  return Number(Boolean(enablesCost)) * 3 + Number(Boolean(card.definition.aiHints?.armorBreakCostsPower)) * 3 +
    Number(formations && armor === 0) * (neighbors(match, unit).length + 1) + card.power * .1 - armor * .1;
}

export function infectionGain(card, amount, turns = Infinity) {
  const current = statusCount(card, 'infection');
  return Math.max(0, infectionDamage(card, Math.min(current + amount, turns)) -
    infectionDamage(card, Math.min(current, turns)));
}

export function lockPriority({ card, side }, actor) {
  const locked = isLocked(card);
  const { order, fee, sidePowerAura, fieldEvents, neighborEvents, endTurn, startTurnGrowth, events } = cardAbilities(card);
  const primary = Boolean(order || fee || sidePowerAura || fieldEvents || neighborEvents || (!locked && card.timer > 0));
  const secondary = Boolean(endTurn || startTurnGrowth || events ||
    (!locked && (card.counter > 0 || card.resilient)) || deathwishDefinitions(card).length);
  const value = Number(primary) * 3 + Number(secondary);
  return side === actor ? -value : 5 + value;
}

export function cleansePriority({ card, side }, actor) {
  const statuses = cleansableStatuses(card);
  let value = card.inheritedDeathwishes?.length ? 2 : 0;
  if (statuses.includes('shield')) value += 2;
  if (statuses.includes('lock')) value -= 5;
  if (statuses.includes('infection')) value -= Math.min(4, statusCount(card, 'infection')) + 1;
  if (statuses.includes('target')) value -= 2;
  if (statuses.includes('doomed')) value -= 1;
  return side === actor ? -value : value;
}

export function rowEffectValue(player, row, turns = 3, incremental = true) {
  if (player.passed) return 0;
  const candidates = player.board[row].filter(isUnit);
  if (!candidates.length) return 0;
  const previous = incremental ? player.rowEffects?.[row]?.remaining ?? 0 : 0;
  const horizon = Math.max(0, Math.min(turns, player.hand.length + 1) - previous);
  return horizon * candidates.reduce((sum, card) => sum +
    (statusCount(card, 'infection') ? Math.min(card.power, Math.max(0, 2 - (card.armor ?? 0))) : Math.min(card.power, 2) * .75), 0)
    / candidates.length;
}

function strongestDestruction(match, side, card) {
  const ability = cardAbilities(card)[playTiming(match, side, card)];
  const step = ability?.steps.find(({ action, target }) => action === 'destroy' && target.strongest);
  if (!step) return;
  const options = targets(match, { side }, step.target);
  return { options, random: step.mode === 'random' };
}

export function destructionSwing(match, side, card) {
  const destruction = strongestDestruction(match, side, card);
  if (!destruction) return;
  const { options, random } = destruction;
  const swing = options.reduce((sum, target) => sum + (target.side === side ? -1 : 1) * target.card.power, 0);
  return swing / (random ? Math.max(1, options.length) : 1);
}

export function destructionRolls(match, side, card) {
  const destruction = card && strongestDestruction(match, side, card);
  const count = destruction?.random ? destruction.options.length : 0;
  return count > 1 ? Array.from({ length: count }, (_, index) => (index + .5) / count) : [.5];
}

function rowEffectSwing({ match, job }, step) {
  const defender = match.players[rowSide(job.side, step)];
  const values = ROWS.map((row) => rowEffectValue(defender, row, step.amount));
  return step.row === 'all' ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
}

function boostSwing({ match, job }, { amount }) {
  return amount?.count || amount?.markedThisMatch || amount?.startingCategory ? valueOf(match, job, amount) : 0;
}

function playChoiceSwing({ match, job }, step) {
  const candidates = eligiblePileCards(match, job.side, playPiles[step.action], step);
  return Math.max(0, ...candidates.map((candidate) => deckCardValue(match, job.side, candidate)));
}

function deckPlaySwing(context, step) {
  if (step.fullDeck || step.chooseAll) return playChoiceSwing(context, step);
  const cards = pileCandidates(context.player.deck, step.filter);
  return cards.reduce((sum, card) => sum + card.definition.power, 0) / Math.max(1, cards.length)
    + Number(Boolean(step.after));
}

function discardPlaySwing(context, step) {
  const choice = step.chooseAll ? playChoiceSwing(context, step) : 0;
  if (!step.filter.anyType) return choice;
  const { match, job } = context;
  const candidates = eligiblePileCards(match, job.side, 'discard', step);
  return choice + Math.max(0, ...candidates.map((card) => deckCardValue(match, job.side, restoreCard(card))));
}

function summonSwing({ player }, step) {
  if (!availableRows(player).some((row) => player.board[row].length < ROW_LIMIT - 1)) return 0;
  const cards = pileCandidates(player.deck, step.filter);
  return cards.reduce((sum, card) => sum + card.power, 0) / Math.max(1, cards.length);
}

function spawnSwing({ player }, step) {
  let swing = 0;
  if (step.rowRef) {
    const free = ROW_LIMIT - Math.min(...ROWS.map((row) => player.board[row].length));
    swing += Math.min(step.amount, free) * step.card.power;
  }
  if (step.overflow) {
    const free = ROWS.reduce((sum, row) => sum + ROW_LIMIT - player.board[row].length, 0) - 1;
    swing += Math.min(step.amount, Math.max(0, free)) * step.card.power;
  }
  return swing;
}

function scatterSwing({ match, job, player }, step) {
  const side = opponent(job.side);
  if (step.rowRef) {
    const amount = step.amount?.result === 'armor'
      ? Math.max(...ROWS.map((row) => rowArmor(player, row))) : valueOf(match, job, step.amount);
    return Math.max(...ROWS.map((row) => rowScatterValue(match.players[side], row, amount)));
  }
  const health = units(match, side).reduce((sum, { card }) => sum + (card.power ?? 0), 0);
  return Math.min(health, Math.max(...ROWS.map((row) => rowArmor(player, row))));
}

function markSwing({ match, job }, step) {
  const candidates = units(match, opponent(job.side)).filter(({ card }) => isUnit(card) && !statusCount(card, 'target'));
  return step.target.rowRef ? Math.max(...ROWS.map((row) => candidates.filter((unit) => unit.row === row).length)) * 1.3
    : Number(candidates.length > 0) * 1.3;
}

function infectionSwing({ match, job, applyInfection }, step) {
  if (step.status !== 'infection' || !applyInfection) return 0;
  const selection = job.ability.select?.find(({ ref }) => ref === step.target.ref);
  const candidates = targets(match, job, selection?.targets ?? step.target, Boolean(selection && selection.mode !== 'random'));
  const gains = candidates.map((target) => {
    const defender = match.players[target.side];
    return defender.passed ? 0 : (target.side === job.side ? -1 : 1) *
      infectionGain(target.card, valueOf(match, job, step.amount, target), Math.max(1, defender.hand.length));
  });
  return (selection ? Math.max(0, ...gains) : gains.reduce((sum, gain) => sum + gain, 0)) * .75;
}

function damageSwing({ match, job, card }, step) {
  const { ability, side } = job;
  if (step.target.scope === 'source') {
    return statusCount(card, 'shield') ? 0 : -Math.min(card.power ?? 0,
      Math.max(0, valueOf(match, job, step.amount) - (card.armor ?? 0)));
  }
  if (step.target.rowRef) {
    const strip = ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.target.rowRef);
    const defender = match.players[opponent(side)];
    return Math.max(0, ...ROWS.map((row) => rowDamage(defender, row, step.amount, -(strip?.amount ?? 0))));
  }
  const selection = ability.select?.find(({ ref }) => ref === step.target.ref);
  const options = selection ? targets(match, job, selection.targets, selection.mode !== 'random') : targets(match, job, step.target);
  const stripArmor = step.amount?.result === 'armor' && step.amount.base !== undefined;
  const amounts = options.map((target) => valueOf(match, job, step.amount, target) + (stripArmor ? target.card.armor : 0));
  const highest = Math.max(0, ...amounts);
  const points = options.map(({ card, side: targetSide }, index) =>
    statusCount(card, 'shield') || (step.amount?.row && amounts[index] !== highest) ? 0
      : (targetSide === side ? -1 : 1) * Math.min(card.power, Math.max(0, amounts[index] - (stripArmor ? 0 : card.armor ?? 0))));
  return !selection && !step.mode && ['ally', 'enemy', 'field'].includes(step.target.scope) ? points.reduce((sum, value) => sum + value, 0)
    : points.length ? Math.max(...points) : 0;
}

const stepValues = {
  'row-effect': rowEffectSwing,
  boost: boostSwing,
  consume: (_context, step) => step.extra ?? 0,
  'play-from-hand': playChoiceSwing,
  'play-from-deck': deckPlaySwing,
  'play-from-discard': discardPlaySwing,
  'summon-from-deck': summonSwing,
  spawn: spawnSwing,
  'replace-leader': () => 2,
  scatter: scatterSwing,
  status: infectionSwing,
  damage: damageSwing,
};

// Estimate immediate score swing from public targets for the bot's existing pass calculation.
export function effectSwing(match, side, card) {
  const { deploy, scenario } = cardAbilities(card);
  const ability = deploy ?? scenario?.prologue;
  let swing = destructionSwing(match, side, card) ?? 0;
  if (!ability) return swing;

  const job = { ability, side };
  const applyInfection = ability.steps.some((step) => step.status === 'infection') && canStart(match, job);
  const context = { match, job, card, player: match.players[side], applyInfection };
  for (const step of ability.steps) {
    if (step.status === 'target') {
      swing += markSwing(context, step);
    } else if (Object.hasOwn(stepValues, step.action)) {
      swing += stepValues[step.action](context, step);
    }
  }
  return swing;
}

export function deckCardValue(match, side, card) {
  const { definition } = card;
  const { deploy, order, endTurn, scenario } = cardAbilities(card);
  const value = (card.power ?? 0) * (definition.enemySide ? -1 : 1) + (card.armor ?? 0) * .15;
  const swing = deploy?.steps.some((step) => step.fullDeck || step.action === 'play-from-discard') ? 0 : effectSwing(match, side, card);
  return value + swing + Number(Boolean(deploy || order || endTurn || scenario));
}
