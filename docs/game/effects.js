import { emit } from './events.js?v=step-13';
import { ROWS, ROW_LABELS } from './cards.js?v=step-14';
import {
  announcePlay, applyStatus, availableRows, boost, cardType, consume, damage, findUnit,
  isUnit, neighbors, opponent, placeCards, removeUnit, spawnCards, statusEndTurn, tickInfection, units,
} from './board.js?v=step-14';

function reference(match, job, key = 'source') {
  return findUnit(match, key === 'source' ? job.sourceId : job.refs?.[key]);
}

function targets(match, job, query) {
  const origin = reference(match, job, query.of);
  const row = query.row === 'source' ? reference(match, job)?.row : query.rowRef ? job.refs?.[query.rowRef] : query.row;
  if (query.row && !row) return [];
  let candidates;
  switch (query.scope) {
    case 'source': candidates = [reference(match, job)].filter(Boolean); break;
    case 'ref': candidates = [reference(match, job, query.ref)].filter(Boolean); break;
    case 'neighbors': candidates = neighbors(match, origin); break;
    case 'ally': candidates = units(match, job.side); break;
    case 'field': candidates = [...units(match, job.side), ...units(match, opponent(job.side))]; break;
    case 'enemy': candidates = units(match, opponent(job.side)); break;
    default: throw new Error(`Unknown target scope: ${query.scope}`);
  }
  const eligible = candidates.filter((unit) =>
    (!row || unit.row === row) &&
    (!query.type || cardType(unit.card) === query.type) &&
    (!query.unitOrOrder || isUnit(unit.card) || unit.card.definition.order) &&
    (!query.token || unit.card.definition.token) &&
    (!query.definitionId || unit.card.definition.id === query.definitionId) &&
    (!query.exclude || unit.card.id !== reference(match, job, query.exclude)?.card.id) &&
    (query.armorAtLeast === undefined || (unit.card.armor ?? 0) >= query.armorAtLeast) &&
    (query.powerAtLeast === undefined || (unit.card.power ?? 0) >= query.powerAtLeast));
  if (!query.strongest) return eligible;
  const strongest = Math.max(...eligible.map(({ card }) => card.power));
  return eligible.filter(({ card }) => card.power === strongest);
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

export function rowArmor(player, row) {
  return player.board[row].reduce((sum, card) => sum + (card.armor ?? 0), 0);
}

function deckCandidates(player, filter) {
  return player.deck.filter(({ definition }) => (definition.type ?? 'unit') === 'unit' &&
    (!filter.rarity || definition.rarity === filter.rarity) &&
    (!filter.faction || definition.faction === filter.faction) &&
    (filter.maxPower === undefined || definition.power <= filter.maxPower));
}

function chooseSubset(cards, count, random) {
  return Array.from({ length: Math.min(count, cards.length) }, () =>
    cards.splice(Math.floor(random() * cards.length), 1)[0].id);
}

function eligibleRows(player, filter) {
  return filter === 'space' ? availableRows(player) : ROWS.filter((row) => rowArmor(player, row));
}

function canStart(match, job) {
  const { when, select, steps } = job.ability;
  const player = match.players[job.side];
  if (steps.some((step) => step.action === 'play-from-deck' &&
    (!availableRows(player).length || !deckCandidates(player, step.filter).length))) return false;
  if (steps.some((step) => step.action === 'select-row' && !eligibleRows(player, step.filter).length)) return false;
  return (!when || targets(match, job, when.targets).length >= (when.atLeast ?? 1)) &&
    (!select?.length || viableChoices(match, job, 0).length > 0);
}

export function playTiming(match, side, card) {
  return card.definition.initiative && !match.players[side].roundActed ? 'initiative' : 'deploy';
}

export function canCast(match, side, card) {
  const ability = card.definition[playTiming(match, side, card)];
  return Boolean(ability && canStart(match, { ability, side }));
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
  if (ability) match.effects.push({ ability, side, sourceId: card.id, sourceDefinitionId: card.definition.id, requiredSource });
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
  const rows = row === 'all' ? ROWS : [step.rowRef ? job.refs[step.rowRef] : row === 'source' ? origin?.row : row === 'death' ? job.row : row];
  for (const row of rows.filter(Boolean)) {
    const index = position === 'death' ? job.position
      : origin?.row === row ? origin.position + (position === 'right' ? 1 : 0)
        : match.players[job.side].board[row].length;
    spawnCards(match, job.side, row, index, step.amount, step.card);
  }
}

function pause(match, job, kind, key, options, prompt, extra) {
  match.pending = { side: job.side, kind, key, options, prompt, job, ...extra };
}

function playFromDeck(match, job, step, random) {
  const player = match.players[job.side];
  const rows = availableRows(player);
  if (!rows.length) return true;
  if (!job.refs.deckCard) {
    const options = chooseSubset(deckCandidates(player, step.filter), step.choose ?? 1, random);
    if (!options.length) return true;
    if (step.choose) {
      pause(match, job, 'deck-card', 'deckCard', options, 'Выбери отряд из колоды.');
      return false;
    }
    [job.refs.deckCard] = options;
  }
  if (!job.refs.deckPlacement) {
    pause(match, job, 'deck-placement', 'deckPlacement', rows, 'Выбери ряд и позицию для отряда.',
      { cardId: job.refs.deckCard });
    return false;
  }
  const index = player.deck.findIndex(({ id }) => id === job.refs.deckCard);
  if (index < 0) return true;
  const [card] = player.deck.splice(index, 1);
  const destination = job.refs.deckPlacement;
  placeCards(player, destination.row, destination.position, [card]);
  announcePlay(match, job.side, card, destination, { from: 'deck' });
  if (step.after) match.effects.unshift({ side: job.side, sourceId: card.id, requiredSource: true,
    ability: { steps: [step.after] } });
  const ability = card.definition.deploy;
  if (ability) match.effects.unshift({ ability, side: job.side, sourceId: card.id,
    sourceDefinitionId: card.definition.id, requiredSource: true });
  delete job.refs.deckCard;
  delete job.refs.deckPlacement;
  return true;
}

export function enqueueEndTurn(match, side) {
  const field = units(match, side);
  for (const { card } of field) match.effects.push(...emit(match, { type: 'turn-end', side },
    { source: card, journal: false }));
  for (const { card } of field) {
    const steps = statusEndTurn(card);
    if (steps.length) match.effects.push({
      ability: { steps },
      side, sourceId: card.id, requiredSource: true,
    });
  }
}

const operations = {
  armor: (match, target, amount) => applyStatus(match, target, 'armor', amount),
  'infection-tick': tickInfection,
  'ready-order': (match, { card, side }) => {
    if (!card.definition.order || card.readyAt <= match.players[side].turns) return;
    card.readyAt = match.players[side].turns;
    match.log.push({ type: 'order-ready', side, cardId: card.id, name: card.definition.name, readyAt: card.readyAt });
  },
  boost,
  damage,
  tick: (match, target) => {
    const { card, side } = target;
    if (!(card.timer > 0)) return;
    card.timer -= 1;
    match.log.push({ type: 'tick', side, name: card.definition.name, cardId: card.id, remaining: card.timer });
    if (card.timer === 0) removeUnit(match, target, 'timer');
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
  if (step.action === 'select-row') {
    if (!job.refs[step.ref]) {
      const player = match.players[job.side];
      const rows = eligibleRows(player, step.filter);
      if (rows.length) {
        pause(match, job, step.filter === 'space' ? 'spawn-row' : 'armor-row', step.ref, rows, step.prompt);
        return;
      }
    }
    job.index += 1;
    match.effects.unshift(job);
    return;
  }
  if (step.action === 'play-from-deck') {
    const queued = match.effects.length;
    if (playFromDeck(match, job, step, random)) {
      job.index += 1;
      match.effects.splice(match.effects.length - queued, 0, job);
    }
    return;
  }
  if (step.action === 'scatter') {
    job.hits ??= valueOf(match, job, step.amount);
    const enemies = units(match, opponent(job.side)).filter(({ card }) => isUnit(card));
    if (!enemies.length || job.hits <= 0) {
      delete job.hits;
      job.index += 1;
      match.effects.unshift(job);
      return;
    }
    job.hits -= 1;
    match.effects.unshift(job);
    damage(match, enemies[Math.floor(random() * enemies.length)], 1, job.sourceDefinitionId, { scattered: true, attacker: job.side, sourceRow: job.refs.row });
    return;
  }
  if (step.action === 'spawn') {
    spawn(match, job, step);
    job.index += 1;
    match.effects.unshift(job);
    return;
  }

  if (!job.remaining) {
    const eligible = targets(match, job, step.target);
    const selected = step.mode === 'random' && eligible.length > 1 ? [eligible[Math.floor(random() * eligible.length)]] : eligible;
    job.remaining = selected.map(({ card }) => card.id);
    if (step.grouped && job.remaining.length) {
      const [receiver] = targets(match, job, step.receiver);
      emit(match, { type: 'consume-group', side: job.side, cardIds: [...job.remaining], eaterId: receiver.card.id });
    }
  }
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
  } else if (step.action === 'destroy') {
    removeUnit(match, target, 'destroy', undefined, step.visual ? { visual: step.visual } : undefined);
  } else if (step.action === 'status') {
    result = applyStatus(match, target, step.status, valueOf(match, job, step.amount, target));
  } else {
    const operation = operations[step.action];
    if (!operation) throw new Error(`Unknown action: ${step.action}`);
    result = operation(match, target, valueOf(match, job, step.amount, target), job.sourceDefinitionId);
  }
  if (step.save) job.results[step.save] = (job.results[step.save] ?? 0) + (result ?? 0);
}

function strongestDestruction(match, side, card) {
  const ability = card.definition[playTiming(match, side, card)];
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
  const ability = card.definition.deploy;
  const player = match.players[side];
  const job = { ability, side };
  let swing = destructionSwing(match, side, card) ?? 0;
  for (const step of ability?.steps ?? []) {
    if (step.action === 'consume') swing += step.extra ?? 0;
    if (step.action === 'play-from-deck') {
      const deck = deckCandidates(player, step.filter);
      swing += deck.reduce((sum, candidate) => sum + candidate.definition.power, 0) / Math.max(1, deck.length)
        + Number(Boolean(step.after));
    }
    if (step.action === 'scatter') {
      const health = units(match, opponent(side)).reduce((sum, { card }) => sum + (card.power ?? 0), 0);
      swing += Math.min(health, Math.max(...ROWS.map((row) => rowArmor(player, row))));
    }
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
