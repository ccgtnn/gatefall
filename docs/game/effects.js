import { ROWS } from './cards.js';
import {
  boost, changeArmor, consume, damage, findUnit, neighbors, opponent, removeUnit, spawnLarvae, units,
} from './board.js';

export function canUseLeader(match, side) {
  const { leader } = match.players[side];
  if (!leader || leader.charges === 0) return false;
  return leader.effect === 'marshal'
    ? units(match, side).length > 0
    : ROWS.some((row) => match.players[side].board[row].length >= 2);
}

export function availableOrders(match, side) {
  const player = match.players[side];
  if (units(match, opponent(side)).length === 0) return [];
  const allies = units(match, side);
  if (!allies.some(({ card }) => card.armor >= 2)) return [];
  return allies.filter(({ card }) => card.definition.order && card.readyAt <= player.turns);
}

export function enqueueCardEffect(match, side, card, timing) {
  const effect = card.definition[timing];
  if (effect) match.effects.push({ effect, side, sourceId: card.id, requiredSource: true });
}

function pick(match, job, key, options, prompt, kind, amount = 0) {
  if (options.length === 0) return undefined;
  if (job[key]) return options.find(({ card }) => card.id === job[key]);
  match.pending = {
    side: job.side, options: options.map(({ card }) => card.id), prompt, kind, amount, key, job,
  };
  return undefined;
}

function enemyTarget(match, job, targets, amount) {
  return pick(match, job, 'enemyId', targets, `Выбери врага для урона: ${amount}.`, 'damage', amount);
}

function giveArmor(match, job, targets, amount) {
  const target = pick(match, job, 'allyId', targets, `Выбери свою карту для ${amount} брони.`, 'armor', amount);
  changeArmor(match, target, amount);
}

function consumeTarget(match, job, targets, prompt = 'Выбери карту для поглощения.') {
  return pick(match, job, 'victimId', targets, prompt, 'consume');
}

function consumeBatch(match, job, targets) {
  match.effects.unshift(...targets.map(({ card }) => ({
    effect: 'consume-one', side: job.side, sourceId: job.sourceId, requiredSource: true, victimId: card.id,
  })));
}

function armorToDamage(match, job, allies, enemies) {
  if (enemies.length === 0) return;
  const fixedCost = job.effect === 'commander';
  const payers = allies.filter(({ card }) => card.armor >= (fixedCost ? 2 : 1));
  const payer = pick(match, job, 'allyId', payers,
    fixedCost ? 'Выбери свою карту, с которой снять 2 брони.' : 'Выбери свою карту, с которой снять всю броню.',
    'spend-armor', fixedCost ? 2 : 0);
  if (!payer) return;
  const amount = fixedCost ? 3 : payer.card.armor;
  const enemy = enemyTarget(match, job, enemies, amount);
  if (!enemy) return;
  changeArmor(match, payer, fixedCost ? -2 : -amount);
  damage(match, enemy, amount);
}

function consumeAndDamage(match, job, allies, enemies, source) {
  if (enemies.length === 0) return;
  const spitter = job.effect === 'spitter';
  const victims = allies.filter(({ card }) => spitter ? card.definition.token : card.id !== source.card.id);
  const victim = consumeTarget(match, job, victims);
  if (!victim) return;
  const amount = spitter ? 4 : victim.card.power;
  const enemy = enemyTarget(match, job, enemies, amount);
  if (!enemy) return;
  consume(match, victim, source, { multiplier: spitter ? 1 : 0 });
  // Resolve the victim's deathwish before continuing with the damage.
  const queuedDeathwish = victim.card.definition.deathwish ? 1 : 0;
  match.effects.splice(queuedDeathwish, 0, { effect: 'damage-target', side: job.side, enemyId: enemy.card.id, amount });
}

export function runEffect(match, job, random) {
  const { effect, side } = job;
  const source = findUnit(match, job.sourceId);
  if (job.requiredSource && !source) return;
  const allies = units(match, side);
  const enemies = units(match, opponent(side));
  const adjacent = neighbors(match, source);
  if (job.deathwish && !job.announced) {
    match.log.push({ type: 'deathwish', side, name: job.deathwish });
    job.announced = true;
  }

  switch (effect) {
    case 'armor-neighbors':
    case 'bastion':
      for (const unit of adjacent) changeArmor(match, unit, effect === 'bastion' ? 3 : 1);
      break;
    case 'engineer':
      giveArmor(match, job, allies, 3);
      break;
    case 'relay':
      giveArmor(match, job, allies.filter(({ row }) => row === 'surface'), 2);
      break;
    case 'standard':
      for (const unit of adjacent) {
        if (unit.card.armor > 0) boost(match, unit, 2);
      }
      break;
    case 'colonel':
      for (const unit of allies.filter(({ row }) => row === source.row)) changeArmor(match, unit, unit.card.armor ?? 0);
      break;
    case 'smelter': {
      let armor = 0;
      for (const unit of adjacent) {
        const removed = unit.card.armor ?? 0;
        changeArmor(match, unit, -removed);
        armor += removed;
      }
      boost(match, source, armor);
      break;
    }
    case 'anvil':
    case 'commander':
      armorToDamage(match, job, allies, enemies);
      break;
    case 'cocoon':
      spawnLarvae(match, side, source.row, source.position, 1);
      spawnLarvae(match, side, source.row, findUnit(match, job.sourceId).position + 1, 1);
      break;
    case 'spawn-right':
      spawnLarvae(match, side, source.row, source.position + 1, 1);
      break;
    case 'nest':
      for (const row of ROWS) {
        const position = row === source.row ? source.position + 1 : match.players[side].board[row].length;
        spawnLarvae(match, side, row, position, 1);
      }
      break;
    case 'spore-wish':
      spawnLarvae(match, side, job.row, job.position, 3);
      break;
    case 'cocoon-wish':
      boost(match, findUnit(match, job.consumerId), 2);
      break;
    case 'vine-wish':
      damage(match, enemies[Math.floor(random() * enemies.length)], 2);
      break;
    case 'acid-wish':
      damage(match, enemyTarget(match, job, enemies, 4), 4);
      break;
    case 'scavenger':
    case 'mutant': {
      const mutant = effect === 'mutant';
      const candidates = mutant ? adjacent.filter(({ card }) => card.definition.token) : adjacent;
      consume(match, consumeTarget(match, job, candidates), source, { extra: mutant ? 3 : 0 });
      break;
    }
    case 'gulper':
      consumeBatch(match, job, allies.filter(({ row, card }) => row === source.row && card.definition.token));
      break;
    case 'colossus':
      consumeBatch(match, job, adjacent);
      break;
    case 'consume-one':
      consume(match, findUnit(match, job.victimId), source);
      break;
    case 'spitter':
    case 'ravager':
      consumeAndDamage(match, job, allies, enemies, source);
      break;
    case 'damage-target':
      damage(match, findUnit(match, job.enemyId), job.amount);
      break;
    case 'marshal': {
      const target = pick(match, job, 'allyId', allies, 'Выбери карту для брони Маршала и её соседей.', 'marshal', 3);
      if (!target) break;
      for (const unit of [target, ...neighbors(match, target)]) changeArmor(match, unit, 3);
      break;
    }
    case 'devourer': {
      const victims = allies.filter((unit) => neighbors(match, unit).length > 0);
      const victim = consumeTarget(match, job, victims, 'Выбери жертву для Пожирателя.');
      if (!victim) break;
      const target = pick(match, job, 'allyId', neighbors(match, victim),
        'Выбери соседа, который получит удвоенную силу.', 'boost', victim.card.power * 2);
      consume(match, victim, target, { multiplier: 2 });
      break;
    }
    case 'destroy': {
      const target = pick(match, job, 'enemyId', enemies, 'Выбери вражескую карту для уничтожения.', 'destroy');
      if (target) removeUnit(match, target, 'destroy');
      break;
    }
  }
}
