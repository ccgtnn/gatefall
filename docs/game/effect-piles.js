import { announcePlay, appearanceJobs, availableRows, cardType, changeBasePower, createCard, opponent,
  placementSide, placeCards, playDestination, refreshPlacedPower, restoreCard, takeCards } from './board.js';
import { NEUTRAL } from './card-metadata.js';
import { CARD_DEFINITIONS, cardsForFaction } from './card-registry.js';
import { FACTIONS } from './cards.js';
import { cardAbilities } from './events.js';
import { chooseSubset, eligiblePileCards, matchesPileFilter, pauseForChoice, pileCandidates,
  playPiles, playTiming, reference, REPEAT, valueOf } from './effect-queries.js';

function creationCandidates(sourceId, step, faction) {
  return CARD_DEFINITIONS.filter((definition) => !definition.token &&
    definition.id !== sourceId && definition.rarity === step.rarity &&
    (!faction || definition.faction === faction) && (!step.type || definition.type === step.type));
}

export function relatedEffectCards(definition) {
  const fixed = new Map();
  const possible = new Map();
  const visited = new WeakSet();
  function visit(node) {
    if (node === null || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (['spawn', 'transform'].includes(node.action) && node.card) fixed.set(node.card.id, node.card);
    if (node.action === 'consume' && node.replacement) fixed.set(node.replacement.id, node.replacement);
    if (node.action === 'create-play') {
      for (const card of creationCandidates(definition.id, node, node.faction === 'enemy' ? undefined : node.faction)) {
        if (node.faction !== 'enemy' || Object.hasOwn(FACTIONS, card.faction)) possible.set(card.id, card);
      }
    }
    if (node.action === 'summon-from-deck' && node.filter) {
      const pool = Object.hasOwn(FACTIONS, definition.faction) ? cardsForFaction(definition.faction) : CARD_DEFINITIONS;
      const matches = node.filter.definitionId ? CARD_DEFINITIONS : new Set([...pool, ...cardsForFaction(NEUTRAL)]);
      for (const card of matches) {
        if (matchesPileFilter(card, node.filter)) (node.filter.definitionId ? fixed : possible).set(card.id, card);
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'card') visit(child);
  }
  visit(definition);
  fixed.delete(definition.id);
  possible.delete(definition.id);
  for (const id of fixed.keys()) possible.delete(id);
  return { fixed: [...fixed.values()], possible: [...possible.values()] };
}

function createOffer(match, job, step, random) {
  const other = match.players[opponent(job.side)];
  const faction = step.faction === 'enemy' ? other.factionId : step.faction;
  if (step.faction === 'enemy' && !faction) return [];
  const candidates = creationCandidates(job.sourceDefinitionId, step, faction)
    .map((definition) => createCard(definition.id, definition));
  const eligible = candidates.filter((card) => cardType(card) === 'effect' ||
    availableRows(match.players[placementSide(job.side, card)], card).length);
  const offered = chooseSubset(eligible, valueOf(match, job, step.amount), random);
  return offered.map((id) => {
    const { definition } = candidates.find((card) => card.id === id);
    return createCard(`token-${++match.tokenCount}`, step.counter ? { ...definition, counter: step.counter } : definition);
  });
}

function playFromPile(match, job, step, random) {
  const pile = playPiles[step.action];
  const player = match.players[job.side];
  if (pile === 'created') job.created ??= createOffer(match, job, step, random);
  const cards = pile === 'created' ? job.created : player[pile];
  if (!job.refs.deckCard) {
    const eligible = pile === 'created' ? cards : eligiblePileCards(match, job.side, pile, step);
    const offerAll = pile !== 'deck' || step.fullDeck || step.chooseAll;
    const options = offerAll ? eligible.map(({ id }) => id) : chooseSubset(eligible, step.choose ?? 1, random);
    if (!options.length) return;
    if (offerAll || step.choose) {
      return pauseForChoice(match, job, 'deck-card', 'deckCard', options,
        step.prompt ?? (pile === 'created' ? 'Выбери карту для Сотворения.' : pile === 'discard' ? 'Выбери обычный отряд из сброса.'
          : step.fullDeck ? 'Выбери карту, которую хочешь сыграть из колоды.' : 'Выбери отряд из колоды.'),
        { pile, ...(step.fullDeck && { fullDeck: true }), ...(pile === 'created' && { cards }) });
    }
    [job.refs.deckCard] = options;
  }
  const index = cards.findIndex(({ id }) => id === job.refs.deckCard);
  if (index < 0) return;
  const isEffect = cardType(cards[index]) === 'effect';
  const destinationSide = placementSide(job.side, cards[index]);
  const recipient = match.players[destinationSide];
  if (!isEffect && !job.refs.deckPlacement) {
    const rows = availableRows(recipient, cards[index]);
    if (!rows.length) return;
    const type = cardType(cards[index]) === 'artifact' ? 'артефакта' : 'отряда';
    return pauseForChoice(match, job, 'deck-placement', 'deckPlacement', rows, `Выбери ряд и позицию для ${type}.`,
      { cardId: job.refs.deckCard, pile, ...(pile === 'created' && { cards }),
        ...(destinationSide !== job.side && { selectionSide: destinationSide }) });
  }
  const [chosen] = cards.splice(index, 1);
  const card = pile === 'discard' ? restoreCard(chosen) : chosen;
  const destination = job.refs.deckPlacement;
  if (destination) {
    if (destinationSide !== job.side) card.owner = job.side;
    placeCards(recipient, destination.row, destination.position, [card]);
  }
  if (isEffect) match.effects.unshift({ discard: card, side: job.side });
  const priorCategoryPlays = player.categoryPlays ?? {};
  const reactions = announcePlay(match, job.side, card, destination, { from: pile });
  match.effects.unshift(...reactions);
  if (step.after) match.effects.unshift({ side: job.side, sourceId: card.id, requiredSource: true,
    ability: { steps: [step.after] } });
  const timing = pile === 'created' || pile === 'hand' ? playTiming(match, job.side, card) : 'deploy';
  const abilities = cardAbilities(card);
  const nestedAbility = abilities[timing] ?? abilities.scenario?.prologue;
  if (nestedAbility) match.effects.unshift({ ability: nestedAbility, side: job.side, sourceId: card.id,
    sourceDefinitionId: card.definition.id, requiredSource: !isEffect, cardAbility: true, priorCategoryPlays });
  delete job.refs.deckCard;
  delete job.refs.deckPlacement;
  delete job.created;
}

function summonFromDeck(match, job, step, random) {
  const source = reference(match, job);
  if (step.row === 'random') {
    if (source?.pile !== 'deck') return;
    const player = match.players[job.side];
    const rows = availableRows(player, source.card);
    if (!rows.length) return;
    const row = rows.length === 1 ? rows[0] : rows[Math.floor(random() * rows.length)];
    placeSummonedCard(match, job.side, row, player.board[row].length, source.card);
    return;
  }
  const location = source ?? (step.position === 'death' ? job : undefined);
  if (!location?.row) return;
  const { side, row, position } = location;
  const player = match.players[side];
  const index = Math.min(player.board[row].length,
    position + Number(step.position === 'right' || (step.position === 'death' && Boolean(source))));
  if (!playDestination(player, { row, position: index })) return;
  const candidates = pileCandidates(player.deck, step.filter).filter((card) => availableRows(player, card).includes(row));
  if (!candidates.length) return;
  const selected = candidates[Math.floor(random() * candidates.length)];
  placeSummonedCard(match, side, row, index, selected);
}

function placeSummonedCard(match, side, row, index, selected) {
  const player = match.players[side];
  const [card] = player.deck.splice(player.deck.indexOf(selected), 1);
  placeCards(player, row, index, [card]);
  match.log.push({ type: 'spawn', from: 'deck', side, row, position: index,
    name: card.definition.name, count: 1, cards: [{ ...card }] });
  refreshPlacedPower(match, side, row, card.definition);
  match.effects.unshift(...appearanceJobs(match, side, card));
}

function chooseDeckTop(match, job) {
  const { deck } = match.players[job.side];
  if (deck.length && !job.refs.topCard) {
    return pauseForChoice(match, job, 'deck-top', 'topCard', deck.map(({ id }) => id), 'Выбери карту на верх колоды.');
  }
  const index = deck.findIndex(({ id }) => id === job.refs.topCard);
  if (index > 0) deck.unshift(...deck.splice(index, 1));
  if (deck.length) match.log.push({ type: 'deck-top', side: job.side });
}

function chooseHandBottom(match, job) {
  const player = match.players[job.side];
  if (player.hand.length) {
    if (!job.refs.bottomCard) {
      return pauseForChoice(match, job, 'hand-bottom', 'bottomCard', player.hand.map(({ id }) => id),
        'Выбери карту из руки на дно колоды.', { pile: 'hand' });
    }
    const index = player.hand.findIndex(({ id }) => id === job.refs.bottomCard);
    if (index >= 0) {
      const [card] = player.hand.splice(index, 1);
      player.deck.push(card);
      match.log.push({ type: 'hand-bottom', side: job.side, cardId: card.id, name: card.definition.name });
    }
  }
}

function returnHand(match, job, step, random) {
  const { hand, deck } = match.players[job.side];
  job.returns ??= valueOf(match, job, step.amount);
  if (job.returns > 0 && hand.length) {
    if (!job.refs.returnCard) {
      return pauseForChoice(match, job, 'hand-return', 'returnCard', hand.map(({ id }) => id),
        `Верни карту из руки в колоду. Осталось: ${job.returns}.`, { pile: 'hand' });
    }
    const [card] = hand.splice(hand.findIndex(({ id }) => id === job.refs.returnCard), 1);
    const position = Math.floor(random() * (deck.length + 1));
    deck.splice(position, 0, card);
    match.log.push({ type: 'hand-return', side: job.side, cardId: card.id, position });
    job.returns -= 1;
    delete job.refs.returnCard;
    return REPEAT;
  }
  delete job.returns;
}

function drawCards(match, job, step) {
  const cards = takeCards(match.players[job.side], valueOf(match, job, step.amount));
  if (step.save) job.results[step.save] = cards.length;
  if (cards.length) match.log.push({ type: 'draw', side: job.side, count: cards.length, cards });
}

function boostDeck(match, job, step) {
  for (const card of match.players[job.side].deck) {
    if (card.definition.categories?.includes(step.category)) changeBasePower(match, { card, side: job.side, pile: 'deck' }, step.amount);
  }
}

export const pileOperations = {
  ...Object.fromEntries(Object.keys(playPiles).map((action) => [action, playFromPile])),
  'choose-deck-top': chooseDeckTop,
  'choose-hand-bottom': chooseHandBottom,
  'return-hand': returnHand,
  draw: drawCards,
  'summon-from-deck': summonFromDeck,
  'boost-deck': boostDeck,
};
