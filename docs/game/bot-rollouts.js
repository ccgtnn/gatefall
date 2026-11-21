import { FACTIONS, ROWS } from './cards.js?v=faction-filters-1';
import { createCard, isUnit, opponent, placementSide, ROW_LIMIT } from './board.js?v=faction-filters-1';
import { collection, copyLimit } from './decks.js?v=faction-filters-1';
import { applyAction, canPass, confirmMulligan, mulliganLimit, playableCards, totalScore } from './match.js?v=faction-filters-1';
import { availableOrders, canUseLeader, effectSwing, infectionGain, rowArmor } from './effects.js?v=faction-filters-1';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
export const ROLLOUT_SAMPLES = 9;

function seeded(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function shuffle(cards, random) {
  for (let index = cards.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1));
    [cards[index], cards[pick]] = [cards[pick], cards[index]];
  }
  return cards;
}

export function visibleSupply(match) {
  const player = match.players.human;
  const faction = FACTIONS[player.factionId];
  if (!faction) return [];
  const known = new Map();
  const field = Object.entries(match.players).flatMap(([side, owner]) =>
    Object.values(owner.board).flat().filter((card) => (card.owner ?? side) === 'human'));
  for (const card of [...player.discard, ...player.exile, ...field]) {
    if (!card.definition.token && !card.definition.stratagem) known.set(card.id, card.definition.id);
  }
  for (const event of match.log) {
    if (event.type === 'play' && event.side === 'human' && event.card?.definition && !event.card.definition.token) {
      known.set(event.cardId, event.card.definition.id);
    }
  }
  const available = collection(player.factionId);
  const presetCounts = new Map();
  const observedCounts = new Map();
  for (const { id } of faction.deck) presetCounts.set(id, (presetCounts.get(id) ?? 0) + 1);
  for (const id of known.values()) observedCounts.set(id, (observedCounts.get(id) ?? 0) + 1);
  return available.flatMap((card) => Array.from({
    length: Math.max(0, copyLimit(card) - (observedCounts.get(card.id) ?? 0)),
  }, (_, index) => ({ card, weight: index + (observedCounts.get(card.id) ?? 0) < (presetCounts.get(card.id) ?? 0) ? 1 : .14 })));
}

export function samplePosition(match, supply, random) {
  const { human, bot } = match.players;
  const cards = supply.map(({ card, weight }) => ({ card, key: random() ** (1 / weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, human.hand.length + human.deck.length)
    .map(({ card }, index) => createCard('sample-human-' + index, card));
  // The bot knows the contents of its own deck, but not its shuffled order.
  const order = bot.deck.toSorted((a, b) => a.definition.id.localeCompare(b.definition.id) || a.id.localeCompare(b.id));
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: shuffle(order, random) },
      human: { ...human, hand: cards.slice(0, human.hand.length), deck: cards.slice(human.hand.length) },
    },
  };
}

function printedValue(card) {
  const { definition: def } = card;
  return (card.power ?? def.power ?? (def.provision ?? 0) * .5) + (def.deploy || def.order || def.endTurn ? 1.1 : 0);
}

function rowValue(player, card, row, position) {
  const line = player.board[row];
  const id = card.definition.id;
  const adjacent = [line[position - 1], line[position]].filter(Boolean);
  const nearby = adjacent.filter(isUnit);
  if (card.definition.enemySide) {
    const step = card.definition.deploy?.steps.find(({ target, status }) => target?.scope === 'neighbors' && status === 'infection');
    return step && !player.passed ? nearby.reduce((sum, unit) => sum + infectionGain(unit, step.amount), 0) : 0;
  }
  if (id === 'gate-guardian' && player.hand.some(({ definition }) => definition.id === 'shield-overload')) {
    return -rowArmor(player, row) * .25;
  }
  if (id === 'colonel' || id === 'standard') return nearby.reduce((total, unit) => total + (unit.armor > 0 ? 1 : 0), 0);
  if (id === 'broodlord' || id === 'colossus' || id === 'gulper' || id === 'spitter') {
    const victims = id === 'colossus' ? nearby : line;
    return victims.reduce((sum, unit) => sum + (unit.definition.id === 'larva' || unit.definition.deathwish ? .8 : 0), 0);
  }
  return nearby.reduce((sum, unit) => sum + (unit.definition.endTurn ? .25 : 0), 0);
}

function overloadValue(player, row) {
  return rowArmor(player, row) - player.board[row].reduce((sum, card) =>
    sum + (card.definition.id === 'gate-guardian' ? card.power : 0), 0);
}

function fastPlays(match, side) {
  const player = match.players[side];
  return playableCards(match, side).map((card) => {
    const def = card.definition;
    const action = { type: 'play', cardId: card.id };
    const cost = printedValue(card);
    const scenarioTrigger = ROWS.some((row) => player.board[row].some((entry) =>
      entry.definition.scenario && entry.chapter < entry.definition.scenario.chapters.length &&
      def.categories?.includes(entry.definition.scenario.category))) ? 2 : 0;
    if (def.type === 'effect') {
      let points = effectSwing(match, side, card);
      if (def.id === 'shield-overload') {
        points -= Math.max(...ROWS.map((row) => rowArmor(player, row))) -
          Math.max(...ROWS.map((row) => overloadValue(player, row)));
      }
      return { action, points: points + scenarioTrigger, cost, reserve: def.removalReserve ?? 0 };
    }
    const recipient = match.players[placementSide(side, card)];
    let choice;
    for (const row of ROWS) {
      const line = recipient.board[row];
      if (line.length >= ROW_LIMIT) continue;
      for (let position = 0; position <= line.length; position++) {
        const value = rowValue(recipient, card, row, position) - .02 * line.length;
        if (!choice || value > choice.value) choice = { row, position, value };
      }
    }
    const infection = def.deploy?.steps.some((step) => step.status === 'infection');
    const removal = (def.removalReserve || infection || def.scenario ||
      def.deploy?.steps.some((step) => step.target?.infected || step.amount?.count || step.action === 'replace-leader'))
      ? effectSwing(match, side, card) : 0;
    const scenario = def.scenario ? Math.min(def.scenario.chapters.length,
      player.hand.filter((entry) => entry.definition.categories?.includes(def.scenario.category)).length) * 2 : 0;
    return {
      action: { ...action, row: choice.row, position: choice.position },
      points: (card.power ?? 0) * (def.enemySide ? -1 : 1) + (def.deploy || def.endTurn || def.order ? 1 : 0)
        + choice.value + removal + scenario + scenarioTrigger,
      cost, reserve: 0,
    };
  });
}

function unitsCanTakeLeaderDamage(player) {
  return ROWS.some((row) => player.board[row].some((card) => isUnit(card) && (card.armor ?? 0) < 2));
}

function quickAction(match, side, pickTarget) {
  if (match.pending) {
    if (match.pending.kind === 'armor-row') {
      const player = match.players[side];
      const rows = match.pending.options.toSorted((a, b) => overloadValue(player, b) - overloadValue(player, a));
      return { type: 'target', cardId: rows[0] };
    }
    return pickTarget(match);
  }
  const player = match.players[side];
  const enemy = match.players[opponent(side)];
  const lead = totalScore(player) - totalScore(enemy);
  if (player.leader?.order && !(enemy.passed && lead > 0) && canUseLeader(match, side) &&
      unitsCanTakeLeaderDamage(enemy)) return { type: 'leader' };
  if (match.playedCard) {
    const [order] = availableOrders(match, side);
    return order && !(enemy.passed && lead > 0) ? { type: 'order', cardId: order.card.id } : END;
  }
  const legalPass = canPass(match, side);
  if (legalPass && lead > 0 && (enemy.passed || !enemy.hand.length)) return PASS;

  const plays = fastPlays(match, side);
  if (!plays.length) {
    if (canUseLeader(match, side)) return { type: 'leader' };
    const [order] = availableOrders(match, side);
    return order ? { type: 'order', cardId: order.card.id } : PASS;
  }
  if (legalPass && match.round === 1 && !enemy.passed && player.turns >= 4 && lead > 9) return PASS;
  if (legalPass && match.round === 1 && !enemy.passed && lead > 13 && player.turns > 1) return PASS;
  if (legalPass && match.round === 2 && enemy.lives < player.lives && !enemy.passed &&
      (player.hand.length + 1 < enemy.hand.length || player.hand.length <= 5 ||
        (player.turns >= 3 && lead < 8))) return PASS;
  if (enemy.passed) {
    const winning = plays.filter(({ points }) => points + lead >= 1).sort((a, b) => a.cost - b.cost);
    if (winning.length) return winning[0].action;
    if (legalPass && match.round < 3 && player.lives > 1 &&
        (match.round === 2 || plays.toSorted((a, b) => b.points - a.points).slice(0, 2)
          .reduce((sum, play) => sum + play.points, lead) < 1)) return PASS;
  }
  if (!enemy.passed && (match.round === 3 || (match.round === 2 && player.lives === 1)) && canUseLeader(match, side) &&
      (player.leader.id !== 'marshal' || ROWS.some((row) => player.board[row].length > 1))) {
    return { type: 'leader' };
  }
  const weight = match.round === 3 ? .12 : .45;
  function rank(play) {
    return play.points - weight * play.cost - Math.max(0, play.reserve - play.points) * 1.5;
  }
  return plays.reduce((best, play) => rank(play) > rank(best) ? play : best).action;
}

function assessment(match, round) {
  const { bot, human } = match.players;
  const last = match.log.findLast((event) => event.type === 'round-end' && event.round === round);
  if (match.result || round === 3) {
    if (!last) return 0;
    const lead = last.scores.bot - last.scores.human;
    const outcome = match.result === 'loss' ? 1 : match.result === 'win' ? -1
      : match.result === 'draw' ? 0 : Math.sign(lead);
    return .90 * outcome + .10 * Math.tanh(lead / 20);
  }
  if (!last) return Math.tanh((totalScore(bot) - totalScore(human)) / 18) * .5;
  const worth = (player) => player.hand.reduce((sum, card) => sum + 3.5 + printedValue(card) * .6, 0)
    + (player.leader?.order ? 4.5 : (player.leader?.charges ?? 0) * 4.5);
  const cards = worth(bot) - worth(human);
  // A life lead means the opponent needs both remaining rounds. Extra cards carry over.
  const lives = (bot.lives - human.lives) * (round === 1 ? 12 : 4);
  const opening = match.starter === 'bot' ? -.6 : .6;
  return Math.tanh((cards + lives + opening) / (round === 1 ? 14 : 11));
}

function rollout(sample, action, pickTarget, random, expired) {
  // This copy belongs to a single trial, so intermediate action states can share its nested storage.
  let match = structuredClone(sample);
  const round = match.round;
  const options = { random, copy: (state) => ({ ...state }) };
  let move = action;
  let firstRoundValue;
  for (let step = 0; step < 150; step++) {
    if (expired()) return;
    const side = match.pending?.side ?? match.turn;
    const next = applyAction(match, side, move, options);
    if (next === match) return;
    match = next;
    if (match.phase === 'finished') {
      const outcome = assessment(match, match.round);
      return firstRoundValue === undefined ? outcome : .75 * outcome + .25 * firstRoundValue;
    }
    if (match.phase === 'mulligan') {
      if (round === 3) return assessment(match, round);
      firstRoundValue ??= assessment(match, round);
      const swaps = match.players.human.hand.toSorted((a, b) => printedValue(a) - printedValue(b))
        .slice(0, mulliganLimit(match, 'human')).map(({ id }) => id);
      match = confirmMulligan(match, swaps, options);
      if (match.phase !== 'playing') return firstRoundValue;
    }
    move = quickAction(match, match.pending?.side ?? match.turn, pickTarget);
  }
}

export function compareRollouts(match, candidates, { pickTarget, expired, random = seeded(match.round * 65537 + match.players.bot.turns * 31 + match.players.human.turns), rolloutSamples = ROLLOUT_SAMPLES }) {
  const supply = visibleSupply(match);
  const human = match.players.human;
  if (supply.length < human.hand.length + human.deck.length) return [];
  const totals = candidates.map(() => 0);
  let samples = 0;
  for (; samples < rolloutSamples && !expired(); samples++) {
    const sampled = samplePosition(match, supply, random);
    const seed = Math.floor(random() * 2 ** 32);
    const scores = [];
    for (const { action } of candidates) {
      const result = rollout(sampled, action, pickTarget, seeded(seed), expired);
      if (result === undefined) break;
      scores.push(result);
    }
    if (scores.length !== candidates.length) break;
    for (const [index, score] of scores.entries()) totals[index] += score;
  }
  if (!samples) return [];
  const bestRating = Math.max(...candidates.map(({ rating }) => rating));
  return candidates.map((candidate, index) => ({
    ...candidate, samples,
    average: .85 * totals[index] / samples + .15 * Math.tanh((candidate.rating - bestRating) / 6),
  }))
    .sort((a, b) => b.average - a.average || b.rating - a.rating);
}
