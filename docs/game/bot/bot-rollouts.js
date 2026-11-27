import { evaluatePosition } from './bot-evaluation.js';
import { EVAL_WEIGHTS as W } from './bot-weights.js';
import { FACTIONS } from '../cards/cards.js';
import { ROWS } from '../shared/card-metadata.js';
import { shuffle } from '../shared/score.js';
import { createCard, isUnit, opponent, placementSide, ROW_LIMIT } from '../engine/board.js';
import { collection, copyLimit } from '../cards/decks.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, mulliganLimit, playableCards, totalScore } from '../engine/match.js';
import { availableOrders, canUseLeader } from '../effects/effects.js';
import { rowArmor } from '../effects/effect-queries.js';
import { handCount } from './bot-hand.js';
import { preferredLeaderUse } from './bot-leaders.js';
import { beneficialFee, effectSwing, infectionGain, shouldProtectArmor, tributeTarget } from './bot-effect-value.js';

import { armorBreakSwing, delayedCardValue, futureContext, wantsToHoldInheritance } from './bot-future-value.js';

const PASS = { type: 'pass' };
const END = { type: 'end-turn' };
export const ROLLOUT_SAMPLES = 9;

function seeded(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function visibleSupply(match, memory = true, knowsDeckList = false) {
  const player = match.players.human;
  if (knowsDeckList && player.knownDeck) return player.knownDeck.map((card) => ({ card, weight: 1 }));
  const faction = FACTIONS[player.factionId];
  const known = new Map();
  if (memory || knowsDeckList) {
    const field = Object.entries(match.players).flatMap(([side, owner]) =>
      Object.values(owner.board).flat().filter((card) => (card.owner ?? side) === 'human'));
    for (const card of [...player.discard, ...player.exile, ...field]) {
      if (!card.definition.token && !card.definition.stratagem) known.set(card.id, card.definition.id);
    }
    for (const event of match.log) {
      if (event.side !== 'human') continue;
      if (event.type === 'play' && event.card?.definition && !event.card.definition.token) {
        known.set(event.cardId, event.card.definition.id);
      }
      if (knowsDeckList && event.type === 'spawn' && event.from === 'deck') {
        for (const card of event.cards ?? []) known.set(card.id, card.definition.id);
      }
    }
  }
  if (knowsDeckList && player.startingDeck) {
    return player.startingDeck.filter(({ id }) => !known.has(id))
      .map(({ definition: card }) => ({ card, weight: 1 }));
  }
  if (!faction) return [];
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
  const handSize = handCount(human);
  const deckSize = human.publicDeckSize ?? human.deck.length;
  const cards = supply.map(({ card, weight }) => ({ card, key: random() ** (1 / weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, handSize + deckSize)
    .map(({ card }, index) => createCard('sample-human-' + index, card));
  // The bot knows the contents of its own deck, but not its shuffled order.
  const order = bot.deck.toSorted((a, b) => a.definition.id.localeCompare(b.definition.id) || a.id.localeCompare(b.id));
  return {
    ...match,
    log: [],
    players: {
      bot: { ...bot, deck: shuffle(order, random) },
      human: { ...human, startingDeck: undefined, knownDeck: undefined, publicHandSize: undefined, handMasked: undefined, publicDeckSize: undefined,
        hand: cards.slice(0, handSize), deck: cards.slice(handSize) },
    },
  };
}

function printedValue(card) {
  const { definition: def } = card;
  return (card.power ?? def.power ?? (def.provision ?? 0) * .5) + (def.deploy || def.order || def.endTurn ? 1.1 : 0);
}

function rowValue(player, card, row, position) {
  const line = player.board[row];
  const placement = card.definition.aiHints?.placement;
  const adjacent = [line[position - 1], line[position]].filter(Boolean);
  const nearby = adjacent.filter(isUnit);
  if (card.definition.enemySide) {
    const step = card.definition.deploy?.steps.find(({ target, status }) => target?.scope === 'neighbors' && status === 'infection');
    return step ? nearby.reduce((sum, unit) => sum + infectionGain(unit, step.amount), 0) : 0;
  }
  if (shouldProtectArmor(card, player)) {
    return -rowArmor(player, row) * .25;
  }
  if (placement === 'armored-neighbors') return nearby.reduce((total, unit) => total + (unit.armor > 0 ? 1 : 0), 0);
  if (placement === 'consume-row' || placement === 'consume-neighbors') {
    const victims = placement === 'consume-neighbors' ? nearby : line;
    return victims.reduce((sum, { definition }) =>
      sum + (definition.aiHints?.sacrificeBonus ?? (definition.deathwish ? .8 : 0)), 0);
  }
  return nearby.reduce((sum, unit) => sum + (unit.definition.endTurn ? .25 : 0), 0);
}

function armorSpendValue(player, row) {
  return rowArmor(player, row) + player.board[row].reduce((sum, card) =>
    sum + (armorBreakSwing(card) ?? 0), 0);
}

function fastPlays(match, side) {
  const player = match.players[side];
  const context = futureContext(match, side);
  const legal = playableCards(match, side);
  return legal.filter((card) => !wantsToHoldInheritance(context, card, legal)).map((card) => {
    const def = card.definition;
    const action = { type: 'play', cardId: card.id };
    const cost = printedValue(card);
    const scenarioTrigger = ROWS.some((row) => player.board[row].some((entry) =>
      entry.definition.scenario && entry.chapter < entry.definition.scenario.chapters.length &&
      def.categories?.includes(entry.definition.scenario.category))) ? 2 : 0;
    if (def.type === 'effect') {
      let points = effectSwing(match, side, card);
      if (def.aiHints?.spendsRowArmor) {
        points -= Math.max(...ROWS.map((row) => rowArmor(player, row))) -
          Math.max(...ROWS.map((row) => armorSpendValue(player, row)));
      }
      return { action, points: points + scenarioTrigger, cost, reserve: def.removalReserve ?? 0 };
    }
    const recipient = match.players[placementSide(side, card)];
    let choice;
    const preferred = def.preferredRow;
    const rows = def.requiredRow ? [def.requiredRow]
      : preferred && recipient.board[preferred].length < ROW_LIMIT ? [preferred] : ROWS;
    for (const row of rows) {
      const line = recipient.board[row];
      if (line.length >= ROW_LIMIT) continue;
      for (let position = 0; position <= line.length; position++) {
        const value = rowValue(recipient, card, row, position) - .02 * line.length;
        if (!choice || value > choice.value) choice = { row, position, value };
      }
    }
    const statusDeploy = def.deploy?.steps.some(({ status }) => status === 'infection' || status === 'target');
    const removal = (!def.deploy?.sourceRow || def.deploy.sourceRow === choice.row) &&
      (def.removalReserve || statusDeploy || def.scenario ||
      def.deploy?.steps.some((step) => step.target?.infected || step.amount?.count || step.amount?.markedThisMatch || step.action === 'replace-leader'))
      ? effectSwing(match, side, card) : 0;
    const scenario = def.scenario ? Math.min(def.scenario.chapters.length,
      player.hand.filter((entry) => entry.definition.categories?.includes(def.scenario.category)).length) * 2 : 0;
    return {
      action: { ...action, row: choice.row, position: choice.position },
      points: (card.power ?? 0) * (def.enemySide ? -1 : 1) + (def.deploy || def.endTurn || def.order ? 1 : 0)
        + choice.value + removal + scenario + scenarioTrigger + delayedCardValue(context, card, choice.row, true),
      cost, reserve: 0,
    };
  });
}

function unitsCanTakeLeaderDamage(player) {
  return ROWS.some((row) => player.board[row].some((card) => isUnit(card) && (card.armor ?? 0) < 2));
}

function quickAction(match, side, pickTarget) {
  if (match.pending) {
    if (match.pending.kind === 'tribute') return tributeTarget(match);
    if (match.pending.kind === 'armor-row') {
      const player = match.players[side];
      const rows = match.pending.options.toSorted((a, b) => armorSpendValue(player, b) - armorSpendValue(player, a));
      return { type: 'target', cardId: rows[0] };
    }
    return pickTarget(match);
  }
  const player = match.players[side];
  const enemy = match.players[opponent(side)];
  const lead = totalScore(player) - totalScore(enemy);
  const leaderPreference = preferredLeaderUse(match, side);
  if (!(enemy.passed && lead > 0) && (leaderPreference ??
      (player.leader?.order && canUseLeader(match, side) && unitsCanTakeLeaderDamage(enemy)))) {
    return { type: 'leader' };
  }
  if (match.playedCard) {
    const [order] = availableOrders(match, side);
    const fee = beneficialFee(match, side);
    if (enemy.passed && lead > 0) return fee ?? END;
    return order ? { type: 'order', cardId: order.card.id } : fee ?? END;
  }
  const legalPass = canPass(match, side);
  const plays = fastPlays(match, side);
  if (!plays.length) {
    if (canUseLeader(match, side)) return { type: 'leader' };
    const [order] = availableOrders(match, side);
    return order ? { type: 'order', cardId: order.card.id }
      : beneficialFee(match, side) ?? (canEndTurn(match, side) ? END : PASS);
  }
  const rank = ({ points, reserve }) => points - Math.max(0, reserve - points) * W.removalReserve;
  let best = plays.reduce((best, play) => rank(play) > rank(best) ? play : best);
  if (legalPass && match.round === 3 && plays.every(({ points }) => points < 0)) {
    return beneficialFee(match, side) ?? PASS;
  }
  if (legalPass && match.round < 3) {
    const rating = (play) => evaluatePosition(match, side, { ...play.action, gain: play.points });
    if (enemy.passed) {
      const cheapest = plays.filter(({ points }) => points + lead > 0).sort((a, b) => a.cost - b.cost)[0];
      if (cheapest && rating(cheapest) >= rating(best)) best = cheapest;
    }
    if (evaluatePosition(match, side, PASS) >= rating(best)) return PASS;
  }
  if (!enemy.passed && (match.round === 3 || (match.round === 2 && player.lives === 1)) && leaderPreference === undefined && canUseLeader(match, side) &&
      (player.leader.ability.select?.[0]?.kind !== 'marshal' || ROWS.some((row) => player.board[row].length > 1))) {
    return { type: 'leader' };
  }
  const fee = beneficialFee(match, side);
  if (fee && !(enemy.passed && lead > 0)) return fee;
  return best.action;
}

function assessment(match) {
  return Math.tanh(evaluatePosition(match, 'bot') / W.rolloutScale);
}

function rollout(sample, action, pickTarget, random, expired, horizon) {
  // This copy belongs to a single trial, so intermediate action states can share its nested storage.
  let match = structuredClone(sample);
  const round = match.round;
  const options = { random, copy: (state) => ({ ...state }) };
  let move = action;
  let answered = false;
  for (let step = 0; step < 300; step++) {
    if (expired()) return;
    const active = match.turn;
    const side = match.pending?.side ?? active;
    const next = applyAction(match, side, move, options);
    if (next === match) return;
    match = next;
    if (horizon === 'reply') {
      answered ||= active === 'human' && !match.pending && match.turn !== 'human';
      if (answered || match.phase !== 'playing' || (!match.pending && match.players.human.passed)) {
        return assessment(match);
      }
    }
    if (match.phase === 'finished') {
      return assessment(match);
    }
    if (match.phase === 'mulligan') {
      if (horizon === 'round' || round === 3) return assessment(match);
      const swaps = match.players.human.hand.toSorted((a, b) => printedValue(a) - printedValue(b))
        .slice(0, mulliganLimit(match, 'human')).map(({ id }) => id);
      match = confirmMulligan(match, swaps, options);
      if (match.phase !== 'playing') return assessment(match);
    }
    move = quickAction(match, match.pending?.side ?? match.turn, pickTarget);
  }
}

export function compareRollouts(match, candidates, {
  pickTarget, expired, horizon = 'match', memory = true, knowsDeckList = false, rolloutSamples = ROLLOUT_SAMPLES,
  random = seeded(match.round * 65537 + match.players.bot.turns * 31 + match.players.human.turns),
}) {
  if (!rolloutSamples) return [];
  const supply = visibleSupply(match, memory, knowsDeckList);
  const { human, bot } = match.players;
  const publicHandSize = handCount(human);
  const publicDeckSize = human.publicDeckSize ?? human.deck.length;
  if (supply.length < publicHandSize + publicDeckSize) return [];
  const masked = { ...match, log: [], players: { bot: { ...bot, startingDeck: undefined }, human: { ...human, startingDeck: undefined,
    hand: [], deck: [], handMasked: undefined, publicHandSize, publicDeckSize } } };
  const totals = candidates.map(() => 0);
  let samples = 0;
  for (; samples < rolloutSamples && !expired(); samples++) {
    const sampled = samplePosition(masked, supply, random);
    const seed = Math.floor(random() * 2 ** 32);
    const scores = [];
    for (const { action } of candidates) {
      const result = rollout(sampled, action, pickTarget, seeded(seed), expired, horizon);
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
    average: W.rolloutShare * totals[index] / samples + (1 - W.rolloutShare) * Math.tanh((candidate.rating - bestRating) / W.rolloutScale),
  }))
    .sort((a, b) => b.average - a.average || b.rating - a.rating);
}
