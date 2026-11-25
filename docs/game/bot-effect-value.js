import { availableRows, cleansableStatuses, infectionDamage, isUnit, opponent, restoreCard, ROW_LIMIT, statusCount, units } from './board.js';
import { ROWS } from './card-metadata.js';
import { canStart, eligiblePileCards, pileCandidates, playPiles, playTiming, rowArmor, rowSide, targets, valueOf } from './effect-queries.js';
import { cardAbilities, deathwishDefinitions, isLocked } from './events.js';

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

export function infectionGain(card, amount, turns = Infinity) {
  const current = statusCount(card, 'infection');
  return Math.max(0, infectionDamage(card, Math.min(current + amount, turns)) -
    infectionDamage(card, Math.min(current, turns)));
}

export function lockPriority({ card, side }, actor) {
  const locked = isLocked(card);
  const { order, fee, houndAura, fieldEvents, neighborEvents, endTurn, startTurnGrowth, events } = cardAbilities(card);
  const primary = Boolean(order || fee || houndAura || fieldEvents || neighborEvents || (!locked && card.timer > 0));
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

// Estimate immediate score swing from public targets for the bot's existing pass calculation.
export function effectSwing(match, side, card) {
  const { deploy, scenario } = cardAbilities(card);
  const ability = deploy ?? scenario?.prologue;
  const player = match.players[side];
  const job = { ability, side };
  let swing = destructionSwing(match, side, card) ?? 0;
  const applyInfection = ability?.steps.some((step) => step.status === 'infection') && canStart(match, job);
  for (const step of ability?.steps ?? []) {
    if (step.action === 'row-effect') {
      const defender = match.players[rowSide(side, step)];
      const values = ROWS.map((row) => rowEffectValue(defender, row, step.amount));
      swing += step.row === 'all' ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
    }
    if (step.action === 'boost' && (step.amount?.count || step.amount?.markedThisMatch || step.amount?.startingCategory)) swing += valueOf(match, job, step.amount);
    if (step.action === 'consume') swing += step.extra ?? 0;
    if (step.action === 'play-from-hand' || step.chooseAll) {
      const candidates = eligiblePileCards(match, side, playPiles[step.action], step);
      swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, candidate)));
    } else if (step.action === 'play-from-deck') {
      if (step.fullDeck) {
        const candidates = eligiblePileCards(match, side, 'deck', step);
        swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, candidate)));
      } else {
        const deck = pileCandidates(player.deck, step.filter);
        swing += deck.reduce((sum, candidate) => sum + candidate.definition.power, 0) / Math.max(1, deck.length)
          + Number(Boolean(step.after));
      }
    }
    if (step.action === 'play-from-discard' && step.filter.anyType) {
      const candidates = eligiblePileCards(match, side, 'discard', step);
      swing += Math.max(0, ...candidates.map((candidate) => deckCardValue(match, side, restoreCard(candidate))));
    }
    if (step.action === 'summon-from-deck' && availableRows(player).some((row) => player.board[row].length < ROW_LIMIT - 1)) {
      const deck = pileCandidates(player.deck, step.filter);
      swing += deck.reduce((sum, candidate) => sum + candidate.power, 0) / Math.max(1, deck.length);
    }
    if (step.action === 'spawn' && step.rowRef) {
      const free = ROW_LIMIT - Math.min(...ROWS.map((row) => player.board[row].length));
      swing += Math.min(step.amount, free) * step.card.power;
    }
    if (step.action === 'spawn' && step.overflow) {
      const free = ROWS.reduce((sum, row) => sum + ROW_LIMIT - player.board[row].length, 0) - 1;
      swing += Math.min(step.amount, Math.max(0, free)) * step.card.power;
    }
    if (step.action === 'replace-leader') swing += 2;
    if (step.action === 'scatter') {
      const enemy = match.players[opponent(side)];
      if (step.rowRef) {
        const amount = valueOf(match, job, step.amount);
        swing += Math.max(...ROWS.map((row) => rowScatterValue(enemy, row, amount)));
      } else {
        const health = units(match, opponent(side)).reduce((sum, { card }) => sum + (card.power ?? 0), 0);
        swing += Math.min(health, Math.max(...ROWS.map((row) => rowArmor(player, row))));
      }
    }
    if (step.action === 'status' && step.status === 'infection' && applyInfection) {
      const selection = ability.select?.find(({ ref }) => ref === step.target.ref);
      const candidates = targets(match, job, selection?.targets ?? step.target, Boolean(selection && selection.mode !== 'random'));
      const gains = candidates.map((target) => {
        const player = match.players[target.side];
        return player.passed ? 0 : (target.side === side ? -1 : 1) *
          infectionGain(target.card, valueOf(match, job, step.amount, target), Math.max(1, player.hand.length));
      });
      swing += (selection ? Math.max(0, ...gains) : gains.reduce((sum, gain) => sum + gain, 0)) * .75;
    }
    if (step.status === 'target') {
      const candidates = units(match, opponent(side)).filter(({ card }) => isUnit(card) && !statusCount(card, 'target'));
      swing += step.target.rowRef ? Math.max(...ROWS.map((row) => candidates.filter((unit) => unit.row === row).length)) * 1.3
        : Number(candidates.length > 0) * 1.3;
    }
    if (step.action !== 'damage') continue;
    if (step.target.scope === 'source') {
      if (!statusCount(card, 'shield')) swing -= Math.min(card.power ?? 0,
        Math.max(0, valueOf(match, job, step.amount) - (card.armor ?? 0)));
      continue;
    }
    if (step.target.rowRef) {
      const strip = ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.target.rowRef);
      swing += Math.max(0, ...ROWS.map((row) => rowDamage(match.players[opponent(side)], row, step.amount, -(strip?.amount ?? 0))));
      continue;
    }
    const index = (ability.select ?? []).findIndex(({ ref }) => ref === step.target.ref);
    const options = index < 0 ? targets(match, job, step.target) : targets(match, job, ability.select[index].targets, ability.select[index].mode !== 'random');
    const stripArmor = step.amount?.result === 'armor' && step.amount.base !== undefined;
    const amounts = options.map((target) => valueOf(match, job, step.amount, target) + (stripArmor ? target.card.armor : 0));
    const highest = Math.max(0, ...amounts);
    const points = options.map(({ card, side: targetSide }, index) =>
      statusCount(card, 'shield') || (step.amount?.row && amounts[index] !== highest) ? 0
        : (targetSide === side ? -1 : 1) * Math.min(card.power, Math.max(0, amounts[index] - (stripArmor ? 0 : card.armor ?? 0))));
    swing += (step.target.infected || step.target.marked) && !step.mode ? points.reduce((sum, value) => sum + value, 0)
      : points.length ? Math.max(...points) : 0;
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
