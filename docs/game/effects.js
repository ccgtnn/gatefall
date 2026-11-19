import { ROWS, ROW_LABELS } from './cards.js';
import {
  boost, cardType, changeArmor, consume, damage, findUnit, neighbors, opponent, removeUnit, spawnCards, units,
} from './board.js';

function reference(match, job, key = 'source') {
  return findUnit(match, key === 'source' ? job.sourceId : job.refs?.[key]);
}

function targets(match, job, query) {
  const origin = reference(match, job, query.of);
  const row = query.row === 'source' ? reference(match, job)?.row : query.row;
  if (query.row && !row) return [];
  let candidates;
  switch (query.scope) {
    case 'source': candidates = [reference(match, job)].filter(Boolean); break;
    case 'ref': candidates = [reference(match, job, query.ref)].filter(Boolean); break;
    case 'neighbors': candidates = neighbors(match, origin); break;
    case 'ally': candidates = units(match, job.side); break;
    case 'enemy': candidates = units(match, opponent(job.side)); break;
    default: throw new Error(`Unknown target scope: ${query.scope}`);
  }
  return candidates.filter((unit) =>
    (!row || unit.row === row) &&
    (!query.type || cardType(unit.card) === query.type) &&
    (!query.token || unit.card.definition.token) &&
    (!query.exclude || unit.card.id !== reference(match, job, query.exclude)?.card.id) &&
    (query.armorAtLeast === undefined || (unit.card.armor ?? 0) >= query.armorAtLeast) &&
    (query.powerAtLeast === undefined || (unit.card.power ?? 0) >= query.powerAtLeast));
}

function viableChoices(match, job, index) {
  const selection = job.ability.select ?? [];
  const pick = selection[index];
  if (!pick) return [];
  const candidates = targets(match, job, pick.targets);
  if (index === selection.length - 1) return candidates;
  return candidates.filter(({ card }) => viableChoices(match, {
    ...job, refs: { ...job.refs, [pick.ref]: card.id },
  }, index + 1).length);
}

function canStart(match, job) {
  const { when, select } = job.ability;
  return (!when || targets(match, job, when.targets).length >= (when.atLeast ?? 1)) &&
    (!select?.length || viableChoices(match, job, 0).length > 0);
}

export function canCast(match, side, card) {
  return Boolean(card.definition.deploy && canStart(match, { ability: card.definition.deploy, side }));
}

export function canUseLeader(match, side) {
  const { leader } = match.players[side];
  return Boolean(leader?.charges > 0 && canStart(match, { ability: leader.ability, side }));
}

export function orderAbility(order) {
  if (!order.cost) return order;
  return {
    ...order,
    select: [...(order.cost.select ?? []), ...(order.select ?? [])],
    steps: [...order.cost.steps, ...order.steps],
  };
}

export function availableOrders(match, side) {
  const player = match.players[side];
  return units(match, side).filter(({ card }) => card.definition.order && card.readyAt <= player.turns &&
    canStart(match, { ability: orderAbility(card.definition.order), side, sourceId: card.id }));
}

export function enqueueCardEffect(match, side, card, timing, requiredSource = true) {
  const ability = card.definition[timing];
  if (ability) match.effects.push({ ability, side, sourceId: card.id, requiredSource });
}

function valueOf(match, job, expression, target) {
  if (typeof expression === 'number') return expression;
  if (expression?.result) return job.results?.[expression.result] ?? 0;
  if (expression?.row) return target?.row === expression.row ? expression.then : expression.otherwise;
  if (expression?.stat) {
    const unit = expression.ref ? reference(match, job, expression.ref) : target;
    return (unit?.card[expression.stat] ?? 0) * (expression.scale ?? 1);
  }
  return 0;
}

function selectTargets(match, job, random) {
  job.refs ??= {};
  const choices = job.ability.select ?? [];
  for (let index = 0; index < choices.length; index += 1) {
    const pick = choices[index];
    if (job.refs[pick.ref]) continue;
    const options = viableChoices(match, job, index);
    if (!options.length) return false;
    if (pick.mode === 'random') {
      job.refs[pick.ref] = options[Math.floor(random() * options.length)].card.id;
      continue;
    }
    const amounts = Object.fromEntries(options.map((target) =>
      [target.card.id, valueOf(match, job, pick.amount, target)]));
    const values = [...new Set(Object.values(amounts))];
    const amount = values.length === 1 ? values[0] : 0;
    let prompt = pick.prompt;
    if (pick.kind === 'damage') {
      const detail = amount ? String(amount) : Object.entries(pick.amount?.row ? ROW_LABELS : {})
        .map(([row, label]) => `${label}: ${row === pick.amount.row ? pick.amount.then : pick.amount.otherwise}`).join(' · ');
      if (detail) prompt = `Выбери врага для урона: ${detail}.`;
    }
    match.pending = {
      side: job.side, options: options.map(({ card }) => card.id), prompt, kind: pick.kind, amount, amounts,
      preferHigherAmount: Boolean(pick.amount?.row), key: pick.ref, job,
    };
    return false;
  }
  return true;
}

function spawn(match, job, step) {
  const origin = reference(match, job);
  const { position, row } = step;
  const rows = row === 'all' ? ROWS : [row === 'source' ? origin?.row : row === 'death' ? job.row : row];
  for (const row of rows.filter(Boolean)) {
    const index = position === 'death' ? job.position
      : origin?.row === row ? origin.position + (position === 'right' ? 1 : 0)
        : match.players[job.side].board[row].length;
    spawnCards(match, job.side, row, index, step.amount, step.card);
  }
}

const operations = {
  armor: changeArmor,
  boost,
  damage,
  destroy: (match, target) => removeUnit(match, target, 'destroy'),
  tick: (match, target) => {
    if (target.card.timer > 0 && --target.card.timer === 0) removeUnit(match, target, 'timer');
  },
};

export function runEffect(match, job, random) {
  if (!job.started) {
    if (job.requiredSource && !reference(match, job)) return;
    if (job.deathwish && !job.announced) {
      match.log.push({ type: 'deathwish', side: job.side, name: job.deathwish });
      job.announced = true;
    }
    const { when } = job.ability;
    if (when && targets(match, job, when.targets).length < (when.atLeast ?? 1)) return;
    if (!selectTargets(match, job, random)) return;
    job.started = true;
    job.index = 0;
    job.results = {};
  }

  const step = job.ability.steps[job.index];
  if (!step) return;
  if (step.action === 'spawn') {
    spawn(match, job, step);
    job.index += 1;
    match.effects.unshift(job);
    return;
  }

  job.remaining ??= targets(match, job, step.target).map(({ card }) => card.id);
  const next = job.remaining.shift();
  if (job.remaining.length === 0) {
    delete job.remaining;
    job.index += 1;
  }
  match.effects.unshift(job);

  const target = findUnit(match, next);
  if (!target) return;
  let result;
  if (step.action === 'consume') {
    const [receiver] = targets(match, job, step.receiver);
    result = consume(match, target, receiver, step);
  } else {
    const operation = operations[step.action];
    if (!operation) throw new Error(`Unknown action: ${step.action}`);
    result = operation(match, target, valueOf(match, job, step.amount, target));
  }
  if (step.save) job.results[step.save] = (job.results[step.save] ?? 0) + (result ?? 0);
}

// Estimate immediate score swing from public targets for the bot's existing pass calculation.
export function effectSwing(match, side, card) {
  const ability = card.definition.deploy;
  const job = { ability, side };
  let swing = 0;
  for (const step of ability?.steps ?? []) {
    if (step.action === 'consume') swing += step.extra ?? 0;
    if (step.action !== 'damage') continue;
    const index = (ability.select ?? []).findIndex(({ ref }) => ref === step.target.ref);
    const options = index < 0 ? targets(match, job, step.target) : targets(match, job, ability.select[index].targets);
    const amounts = options.map((target) => valueOf(match, job, step.amount, target));
    const highest = Math.max(0, ...amounts);
    swing += Math.max(0, ...options.map(({ card }, index) =>
      step.amount?.row && amounts[index] !== highest ? 0
        : Math.min(card.power, Math.max(0, amounts[index] - (card.armor ?? 0)))));
  }
  return swing;
}
