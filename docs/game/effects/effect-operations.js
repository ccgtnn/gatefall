import { deathwishJobs, emit, inheritableDeathwishes, isLocked } from '../engine/events.js';
import {
  activeOrder, applyStatus, boost, capture, changeBasePower, changeCoins, cleanse, consume, damage, damageOverflow,
  findInPiles, findUnit, heal, isUnit, opponent, removeUnit, ROW_LIMIT, setRowEffect, spawnCards, statusCount,
  tickInfection, transformUnit, units, weaken,
} from '../engine/board.js';
import { ROWS } from '../shared/card-metadata.js';
import { canGrantZeal } from './effects.js';
import { pileOperations } from './effect-piles.js';
import { chooseSubset, eligibleRows, pauseForChoice, reference, rowSide, SCHEDULED, targets, valueOf } from './effect-queries.js';

function spawn(match, job, step) {
  const origin = reference(match, job, step.of);
  const fallback = step.fallbackPosition && job.refs[step.fallbackPosition];
  const { position, row } = step;
  const sourceRow = origin?.row ?? fallback?.row;
  const rows = row === 'all' ? [...ROWS] : [step.rowRef ? job.refs[step.rowRef] : row === 'source' ? sourceRow : row === 'death' ? job.row : row];
  if (step.overflow && row !== 'all' && rows[0]) rows.push(...ROWS.filter((row) => row !== rows[0]));
  let remaining = step.amount;
  for (const row of rows.filter(Boolean)) {
    if (remaining <= 0) break;
    const nearSource = origin?.row === row && (origin.side === job.side || step.row === 'source');
    const side = nearSource ? origin.side : job.side;
    const index = position === 'death' ? Math.min(job.position, match.players[side].board[row].length)
      : nearSource && position ? origin.position + Number(position === 'right')
        : Math.min(fallback?.position ?? Infinity, match.players[side].board[row].length);
    const count = step.overflow ? Math.min(remaining, ROW_LIMIT - match.players[side].board[row].length) : step.amount;
    spawnCards(match, side, row, index, count, step.card,
      step.power === undefined ? undefined : valueOf(match, job, step.power));
    if (step.overflow) remaining -= count;
  }
}

export function tickTimer(match, { card, side }) {
  if (isLocked(card) || !(card.timer > 0)) return false;
  card.timer -= 1;
  match.log.push({ type: 'tick', side, name: card.definition.name, cardId: card.id, remaining: card.timer });
  return card.timer === 0;
}

function reduceOrderCooldown(match, unit, amount) {
  const { card, side } = unit;
  const { turns } = match.players[side];
  if (!activeOrder(unit) || card.readyAt <= turns || card.orderUsedTurn === turns) return;
  card.readyAt = Math.max(match.players[side].turns, card.readyAt - amount);
  match.log.push({ type: 'order-ready', side, cardId: card.id, name: card.definition.name, readyAt: card.readyAt,
    cooldown: card.readyAt - match.players[side].turns });
}

// Queue the continuation before mutating a target, so reactions can see (and rebase) it.
function eachTarget(handler) {
  return (match, job, step, random) => {
    if (!job.remaining) {
      const eligible = targets(match, job, step.target);
      const count = step.count === undefined ? 1 : valueOf(match, job, step.count);
      job.remaining = step.mode === 'random' && eligible.length > count
        ? chooseSubset(eligible.map(({ card }) => card), count, random)
        : eligible.map(({ card }) => card.id);
      if (step.saveTargets) job.refs[step.saveTargets] = [...job.remaining];
      if (step.grouped && job.remaining.length) {
        const [receiver] = targets(match, job, step.receiver);
        if (receiver) emit(match, { type: 'consume-group', side: job.side, cardIds: [...job.remaining], eaterId: receiver.card.id });
      }
    }
    const next = job.remaining.shift();
    if (job.remaining.length === 0) {
      delete job.remaining;
      job.index += 1;
    }
    match.effects.unshift(job);

    const target = job.piles ? findInPiles(match, job.side, next, job.piles) : findUnit(match, next);
    if (!target) return SCHEDULED;
    if (step.savePosition) job.refs[step.savePosition] = { row: target.row, position: target.position };
    const result = handler(match, job, step, target);
    if (step.save) job.results[step.save] = (job.results[step.save] ?? 0) + (result ?? 0);
    return SCHEDULED;
  };
}

const applyAmount = (handler) => eachTarget((match, job, step, target) =>
  handler(match, target, valueOf(match, job, step.amount, target), job.sourceDefinitionId, { attacker: job.side }));

function chooseTribute(match, job, step) {
  const player = match.players[job.side];
  const origin = reference(match, job);
  if (!origin || player.board[origin.row].length >= ROW_LIMIT) return;
  const options = Object.keys(step.tiers).filter((cost) => Number(cost) <= (player.coins ?? 0));
  if (!job.refs.tribute && options.length) {
    return pauseForChoice(match, job, 'tribute', 'tribute', ['0', ...options], 'Выбери размер взноса.', { tiers: step.tiers });
  }
  if (step.tiers[job.refs.tribute]) {
    changeCoins(match, job.side, -Number(job.refs.tribute));
    spawn(match, job, { ...step.spawn, amount: step.tiers[job.refs.tribute] });
  }
  // Tribute advances before reactions from the summoned cards.
  job.index += 1;
  match.effects.unshift(job);
  return SCHEDULED;
}

function chooseUnit(match, job, step) {
  if (job.refs[step.ref]) return;
  const options = targets(match, job, step.target, true).map(({ card }) => card.id);
  if (options.length) return pauseForChoice(match, job, step.kind, step.ref, options, step.prompt);
}

function inheritDeathwishes(match, job) {
  const unit = reference(match, job);
  if (unit) {
    const inheritedDeathwishes = inheritableDeathwishes(match.players[job.side]);
    unit.card.inheritedDeathwishes = inheritedDeathwishes;
    match.log.push({ type: 'inherit-deathwishes', side: unit.side, cardId: unit.card.id, inheritedDeathwishes });
  }
}

function grantDeathwish(match, job, step, unit) {
  const source = reference(match, job)?.card.definition;
  if (!source) return;
  const wish = { id: source.id, name: source.name, deathwish: step.deathwish, grantedBy: job.side };
  const inheritedDeathwishes = [...(unit.card.inheritedDeathwishes ?? []), wish];
  unit.card.inheritedDeathwishes = inheritedDeathwishes;
  match.log.push({ type: 'inherit-deathwishes', side: unit.side, cardId: unit.card.id, inheritedDeathwishes });
}

function selectRow(match, job, step) {
  if (!job.refs[step.ref]) {
    const selectionSide = rowSide(job.side, step);
    const player = match.players[selectionSide];
    const markRow = job.ability.steps.some((part) => part.status === 'target' && part.target?.rowRef === step.ref);
    const rows = eligibleRows(player, step.filter).filter((row) => !markRow ||
      player.board[row].some((card) => isUnit(card) && !statusCount(card, 'target')));
    if (rows.length) {
      const kind = markRow ? 'mark-row' : { space: 'spawn-row', armor: 'armor-row', units: 'enemy-row', any: 'row-effect' }[step.filter];
      const damage = job.ability.steps.find((part) => part.action === 'damage' && part.target?.rowRef === step.ref);
      const armor = job.ability.steps.find((part) => part.action === 'armor' && part.target?.rowRef === step.ref);
      const scatter = job.ability.steps.find((part) => part.action === 'scatter' && part.rowRef === step.ref);
      const amount = scatter && valueOf(match, job, scatter.amount);
      const prompt = scatter ? `Выбери вражеский ряд · Ударов: ${amount} по 1 урону.` : step.prompt;
      const weather = kind === 'row-effect' && job.ability.steps.find((part) => part.action === 'row-effect' && part.rowRef === step.ref);
      return pauseForChoice(match, job, kind, step.ref, rows, prompt, {
        selectionSide,
        ...(weather && { amount: weather.amount, rowWeather: weather.effect }),
        ...(damage && { amount: damage.amount, armorStrip: -(armor?.amount ?? 0) }),
        ...(scatter && { amount, scatter: true }),
      });
    }
  }
}

function scatter(match, job, step, random) {
  job.hits ??= valueOf(match, job, step.amount);
  const rows = step.rowRef ? [job.refs[step.rowRef]].filter(Boolean) : ROWS;
  const side = step.side === 'ally' ? job.side : opponent(job.side);
  const candidates = units(match, side, rows).filter(({ card }) => isUnit(card));
  if (!candidates.length || job.hits <= 0) {
    delete job.hits;
    return;
  }
  job.hits -= 1;
  match.effects.unshift(job);
  damage(match, candidates[Math.floor(random() * candidates.length)], 1, job.sourceDefinitionId, {
    scattered: true, attacker: job.side, sourceRow: step.rowRef ? reference(match, job)?.row : job.refs.row,
    ...(step.visual && { visual: step.visual }),
    ...(step.visual === 'turret' && { sourceId: job.sourceId }),
  });
  return SCHEDULED;
}

function rowEffect(match, job, step) {
  const side = step.row === 'death' ? job.deathSide : rowSide(job.side, step);
  if (!side) return;
  const player = match.players[side];
  const score = (row) => player.board[row].reduce((sum, card) => sum + (card.power ?? 0), 0);
  const rows = step.row === 'all' ? ROWS : [step.row === 'strongest'
    ? ROWS.reduce((best, row) => score(row) > score(best) ? row : best)
    : step.row === 'death' ? job.row : step.rowRef ? job.refs[step.rowRef] : step.row];
  for (const row of rows.filter((row) => ROWS.includes(row))) {
    setRowEffect(match, side, row, { type: step.effect, remaining: step.amount,
      sourceDefinitionId: job.sourceDefinitionId ?? reference(match, job)?.card.definition.id, attacker: job.side });
  }
}

function replaceLeader(match, job, step) {
  const player = match.players[job.side];
  const { ability, text, ...order } = step.order;
  const art = step.portrait ?? step.art;
  const identityChanged = Boolean(step.name || art);
  const previous = player.leader;
  const leader = { ...(previous ?? { name: 'Файлура' }), ability, text,
    order: { ...order, sourceDefinitionId: job.sourceDefinitionId } };
  if (identityChanged) {
    leader.id = job.sourceDefinitionId ?? previous?.id;
    leader.name = step.name ?? leader.name;
    leader.charges = 0;
    leader.readyAtTurn = player.turns + 1;
    delete leader.lastUsedTurn;
    delete leader.aiHints;
    delete leader.keywords;
    if (art) {
      leader.art = art;
      delete leader.artFocus;
      delete leader.artZoom;
    }
  }
  player.leader = leader;
  match.log.push({ type: 'leader-replaced', side: job.side, name: leader.name, leader,
    ...(identityChanged && { identityChanged }) });
}

const applyTargetStatus = eachTarget((match, job, step, target) =>
  applyStatus(match, target, step.status, valueOf(match, job, step.amount, target), {
    sourceDefinitionId: job.sourceDefinitionId, ...(step.status === 'infection' && { attacker: job.side }),
  }));

function status(match, job, step, random) {
  if (step.status !== 'target') return applyTargetStatus(match, job, step, random);

  // Mark the entire group before any reaction fires, and keep reactions in target order.
  const reactions = [];
  const queued = match.effects.length;
  for (const unit of targets(match, job, step.target)) {
    applyStatus(match, unit, 'target', 1, { attacker: job.side, sourceDefinitionId: job.sourceDefinitionId });
    reactions.push(...match.effects.splice(0, match.effects.length - queued));
  }
  match.effects.unshift(...reactions);
}

function damageTarget(match, job, step, target) {
  const amount = valueOf(match, job, step.amount, target);
  const overflow = step.slay ? damageOverflow(target.card, amount) : 0;
  const powerBefore = target.card.power ?? 0;
  const killed = damage(match, target, amount, job.sourceDefinitionId, { attacker: job.side });
  if (killed && step.slay) {
    match.effects.splice(match.effects.indexOf(job), 0, {
      ability: step.slay, side: job.side, sourceId: job.sourceId, sourceDefinitionId: job.sourceDefinitionId,
      cardAbility: job.cardAbility, refs: { slain: target.card.id }, results: { overflow },
    });
  }
  return step.measureDamage ? powerBefore - (target.card.power ?? 0) : killed;
}

export const effectOperations = Object.freeze({
  ...pileOperations,
  coins: (match, job, step) => changeCoins(match, job.side, step.amount),
  'choose-tribute': chooseTribute,
  'choose-unit': chooseUnit,
  'inherit-deathwishes': inheritDeathwishes,
  'grant-deathwish': eachTarget(grantDeathwish),
  'select-row': selectRow,
  scatter,
  'row-effect': rowEffect,
  'replace-leader': replaceLeader,
  spawn,
  'remember-row': (match, job, step) => { job.refs[step.ref] = targets(match, job, step.target)[0]?.row; },
  consume: eachTarget((match, job, step, target) => {
    const [receiver] = step.receiver ? targets(match, job, step.receiver) : [];
    return consume(match, target, receiver, step);
  }),
  capture: eachTarget((match, job, _step, target) => capture(match, job.side, target)),
  transform: eachTarget((match, _job, step, target) => transformUnit(match, target, step.card, step.preservePower)),
  'art-state': eachTarget((match, _job, step, target) => {
    target.card.artState = step.state;
    match.log.push({ type: 'art-state', side: target.side, cardId: target.card.id, artState: step.state });
  }),
  'activate-deathwish': eachTarget((match, _job, _step, target) => {
    match.effects.unshift(...deathwishJobs(target.card, {
      side: target.side, row: target.row, position: target.position, sourceId: target.card.id,
    }));
  }),
  destroy: eachTarget((match, job, step, target) => removeUnit(match, target, 'destroy', undefined, {
    sourceDefinitionId: job.sourceDefinitionId,
    ...(step.visual && { visual: step.visual }),
  })),
  discard: eachTarget((match, job, _step, target) => removeUnit(match, target, 'discard', undefined, { sourceDefinitionId: job.causeDefinitionId })),
  status,
  damage: eachTarget(damageTarget),
  'base-power': applyAmount(changeBasePower),
  heal: applyAmount(heal),
  weaken: applyAmount(weaken),
  cleanse: applyAmount(cleanse),
  counter: eachTarget((match, _job, _step, { card, side }) => {
    if (isLocked(card) || !(card.counter > 0)) return;
    card.counter -= 1;
    match.log.push({ type: 'counter', side, cardId: card.id, name: card.definition.name, remaining: card.counter });
    if (card.counter === 0) match.effects.unshift({ ability: card.definition.counter.effect,
      side, sourceId: card.id, sourceDefinitionId: card.definition.id, requiredSource: true, cardAbility: true });
  }),
  armor: applyAmount((match, target, amount, sourceDefinitionId) => applyStatus(match, target, 'armor', amount, { sourceDefinitionId })),
  'infection-tick': applyAmount(tickInfection),
  'grant-zeal': eachTarget((match, _job, _step, target) => {
    if (canGrantZeal(target, match.players[target.side].turns)) reduceOrderCooldown(match, target, Infinity);
  }),
  'ready-order': eachTarget((match, _job, _step, target) => reduceOrderCooldown(match, target, Infinity)),
  'reduce-order-cooldown': applyAmount(reduceOrderCooldown),
  boost: applyAmount(boost),
  'advance-growth': applyAmount((match, { card, side }, amount) => {
    if (card.growth === undefined) return;
    card.growth += amount;
    match.log.push({ type: 'growth', side, cardId: card.id, growth: card.growth });
  }),
  kill: eachTarget((match, _job, _step, target) => removeUnit(match, target, 'vulnerability')),
  break: eachTarget((match, _job, _step, target) => removeUnit(match, target, 'timer')),
  tick: eachTarget((match, _job, _step, target) => {
    if (tickTimer(match, target)) removeUnit(match, target, 'timer');
  }),
});
