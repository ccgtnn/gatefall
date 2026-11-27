import { ROWS } from '../shared/card-metadata.js';
import { refreshPlacedPower, refreshRowPower, refreshSidePower } from './board-power.js';
import { cardAbilities, emit, isLocked } from './events.js';

export const ROW_LIMIT = 9;
export const HAND_LIMIT = 10;
export const COIN_LIMIT = 9;
export const opponent = (side) => side === 'human' ? 'bot' : 'human';

export const cardType = ({ definition }) => definition.type ?? 'unit';
export const activeOrder = ({ card, row }) => {
  const { order } = cardAbilities(card);
  return order && card.orderCharges !== 0 && (!order.sourceRow || order.sourceRow === row) ? order : undefined;
};
export const isUnit = (card) => cardType(card) === 'unit';
export const basePower = (card) => card.basePower ?? card.definition.power;
export const placementSide = (side, card) => card.definition.enemySide ? opponent(side) : side;

export function createCard(id, definition) {
  const card = { id, definition, readyAt: 0 };
  if (isUnit(card)) Object.assign(card, { power: definition.power, basePower: definition.power, armor: definition.armor ?? 0 });
  if (definition.order?.charges !== undefined) card.orderCharges = definition.order.charges;
  if (definition.growth) card.growth = 0;
  if (definition.timer !== undefined) card.timer = definition.timer;
  if (definition.scenario) card.chapter = 0;
  if (definition.resilience) card.resilient = true;
  if (definition.counter) card.counter = definition.counter.amount;
  return card;
}

export function restoreCard(previous) {
  const card = createCard(previous.id, previous.definition);
  if (previous.orderCharges !== undefined) {
    card.orderCharges = previous.orderCharges;
  }
  if (previous.orderUsedTurn !== undefined) card.orderUsedTurn = previous.orderUsedTurn;
  if (previous.resilient === false) card.resilient = false;
  if (isLocked(previous)) card.statuses = { lock: 1 };
  if (isUnit(card)) card.power = card.basePower = basePower(previous);
  return card;
}

export function spendResilience(card) {
  if (!card.resilient || isLocked(card)) return false;
  card.resilient = false;
  return true;
}

function setOrderReadiness(player, card) {
  card.readyAt = player.turns + Number(!(card.definition.stratagem && card.definition.zeal));
}

export function placeCards(player, row, position, cards) {
  for (const card of cards) if (cardAbilities(card).order) setOrderReadiness(player, card);
  player.board[row].splice(position, 0, ...cards);
}

/**
 * @param {import('../../../types/contracts').PlayerState} player
 * @param {Partial<import('../../../types/contracts').Placement>} destination
 */
export function playDestination(player, { row, position }) {
  if (!ROWS.includes(row)) return null;
  const line = player.board[row];
  if (line.length >= ROW_LIMIT || !Number.isInteger(position) || position < 0 || position > line.length) return null;
  return { row, position };
}

export function availableRows(player, card) {
  const required = card?.definition.requiredRow;
  return ROWS.filter((row) => (!required || required === row) && player.board[row].length < ROW_LIMIT);
}

export function changeCoins(match, side, amount) {
  const player = match.players[side];
  const before = player.coins ?? 0;
  if (!Number.isInteger(amount) || before + amount < 0) return;
  const coins = Math.min(COIN_LIMIT, before + amount);
  player.coins = coins;
  if (coins !== before) match.log.push({ type: 'coins', side, coins, amount: coins - before });
}

export function recordCardPlay(player, card) {
  const categories = card?.definition.categories;
  if (categories?.length) {
    const counts = { ...player.categoryPlays };
    for (const category of new Set(categories)) counts[category] = (counts[category] ?? 0) + 1;
    player.categoryPlays = counts;
    if (cardType(card) === 'effect') {
      const effectCounts = { ...player.effectCategoryPlays };
      for (const category of new Set(categories)) effectCounts[category] = (effectCounts[category] ?? 0) + 1;
      player.effectCategoryPlays = effectCounts;
    }
  }
  for (const line of Object.values(player.board)) {
    for (const scenario of line) {
      const category = scenario.definition.scenario?.countPlayedEffects;
      if (category) scenario.playedEffects = player.effectCategoryPlays?.[category] ?? 0;
    }
  }
  const firstLegendary = card?.definition.rarity === 'gold' && !player.playedLegendary;
  if (firstLegendary) player.playedLegendary = true;
  return firstLegendary;
}

export function announcePlay(match, side, card, destination, extra) {
  const firstLegendary = recordCardPlay(match.players[side], card);
  const boardSide = destination && placementSide(side, card);
  if (boardSide && cardAbilities(card).order) {
    const { turns } = match.players[boardSide];
    card.orderPlayedTurn = turns;
    if (card.definition.zeal) card.readyAt = turns;
  }
  const reactions = emit(match, { type: 'play', side, ...(boardSide && boardSide !== side && { boardSide }), row: destination?.row, name: card.definition.name,
    power: card.power, cardType: cardType(card), cardId: card.id,
    card: { ...card }, position: destination?.position, ...extra }, { played: card, firstLegendary });
  if (card.armor) emit(match, { type: 'armor', side: boardSide ?? side, name: card.definition.name, cardId: card.id,
    armor: card.armor, amount: card.armor });
  if (boardSide) {
    refreshPlacedPower(match, boardSide, destination.row, card.definition);
    reactions.push(...appearanceJobs(match, boardSide, card));
    const category = card.definition.scenario?.countPlayedEffects;
    if (category) card.playedEffects = match.players[boardSide].effectCategoryPlays?.[category] ?? 0;
  }
  return reactions;
}

export function appearanceJobs(match, side, card) {
  if (!isUnit(card) || !findUnit(match, card.id)) return [];
  return emit(match, { type: 'appearance', side }, { played: card, journal: false });
}

export function captureDestination(match, side, unit) {
  const player = match.players[side];
  return [unit.row, ...ROWS.filter((row) => row !== unit.row)].find((row) => player.board[row].length < ROW_LIMIT);
}

export function capture(match, side, unit) {
  if (!isUnit(unit.card) || unit.side === side) return;
  const row = captureDestination(match, side, unit);
  if (!row) return;
  const { card } = unit;
  const previous = match.players[unit.side];
  const player = match.players[side];
  previous.board[unit.row].splice(unit.position, 1);
  card.owner ??= unit.side;
  delete card.orderPlayedTurn;
  card.readyAt = player.turns + Math.max(0, card.readyAt - previous.turns);
  if (card.orderUsedTurn === previous.turns) card.orderUsedTurn = player.turns;
  else delete card.orderUsedTurn;
  for (const job of match.effects) {
    if (job.sourceId === card.id && (job.requiredSource || job.scenarioChapter) && !job.piles) job.side = side;
  }
  const position = player.board[row].length;
  player.board[row].push(card);
  match.log.push({ type: 'capture', side, row, position, fromSide: unit.side, fromRow: unit.row,
    cardId: card.id, name: card.definition.name, card: { ...card } });
  refreshSidePower(match, unit.side);
  refreshSidePower(match, side);
  refreshRowPower(match, unit.side, unit.row);
  refreshRowPower(match, side, row);
  match.effects.unshift(...appearanceJobs(match, side, card));
}

export function units(match, side, rows = ROWS) {
  return rows.flatMap((row) => match.players[side].board[row].map((card, position) => ({
    side, row, card, position,
  })));
}

export function findUnit(match, id) {
  if (!id) return undefined;
  return units(match, 'human').find(({ card }) => card.id === id) ??
    units(match, 'bot').find(({ card }) => card.id === id);
}

export function findInPiles(match, side, id, piles) {
  for (const pile of piles) {
    const card = match.players[side][pile].find((entry) => entry.id === id);
    if (card) return { card, side, pile };
  }
}

export function neighbors(match, unit) {
  if (!unit) return [];
  return units(match, unit.side, [unit.row]).filter(({ position }) =>
    Math.abs(position - unit.position) === 1);
}

export function transformUnit(match, unit, definition, preservePower = false) {
  const { side, row, position, card } = unit;
  const replacement = createCard(card.id, definition);
  if (preservePower) replacement.power = card.power;
  if (card.owner) replacement.owner = card.owner;
  if (isLocked(card)) replacement.statuses = { lock: 1 };
  const player = match.players[side];
  if (definition.order) setOrderReadiness(player, replacement);
  player.board[row][position] = replacement;
  match.log.push({ type: 'transform', side, cardId: card.id, name: card.definition.name, card: { ...replacement } });
  refreshSidePower(match, side);
  refreshRowPower(match, side, row);
  match.effects.unshift(...appearanceJobs(match, side, replacement));
}

export function discardCard(match, side, card, exile = false) {
  const player = match.players[card.owner ?? side];
  player[exile ? 'exile' : 'discard'].push(card);
}

export function takeCards(player, amount) {
  const cards = player.deck.splice(0, Math.max(0, Math.min(amount, HAND_LIMIT - player.hand.length)));
  player.hand.push(...cards);
  return cards;
}

export function spawnCards(match, side, row, position, count, definition, power) {
  const line = match.players[side].board[row];
  const added = Math.min(count, ROW_LIMIT - line.length);
  if (added <= 0) return;
  const tokens = Array.from({ length: added }, () => createCard(`token-${++match.tokenCount}`, definition));
  if (power !== undefined) for (const token of tokens) token.power = power;
  placeCards(match.players[side], row, position, tokens);
  emit(match, { type: 'spawn', side, row, count: added, name: definition.name, position, cards: tokens.map((card) => ({ ...card })) });
  refreshPlacedPower(match, side, row, definition);
  match.effects.unshift(...tokens.flatMap((card) => appearanceJobs(match, side, card)));
}
