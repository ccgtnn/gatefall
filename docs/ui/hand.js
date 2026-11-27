import { placementEffectRows } from './card-placement.js';
import { button, element } from './dom.js';
import { availableRows, cardType, placementSide } from '../game/engine/board.js';
import { canPlayCard, confirmMulligan, mulliganRemaining, replaceMulliganCard } from '../game/engine/match.js';
import { cardButton, showCard } from './cards.js';
import { animate, ghostCard } from './card-motion-core.js';
import { MOTION } from './motion-tokens.js';

export function updatePlacementSelection(screen, match, selectedCardId) {
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  for (const node of screen.querySelectorAll('.hand [data-card-id]')) {
    node.setAttribute('aria-pressed', String(node.dataset.cardId === selectedCardId));
  }
  const effectRows = card ? placementEffectRows(card.definition) : [];
  for (const row of screen.querySelectorAll('[data-play-row]')) {
    const available = Boolean(card && placementSide('human', card) === row.dataset.side &&
      (cardType(card) === 'effect' || availableRows(match.players[row.dataset.side], card).includes(row.dataset.playRow)));
    row.classList.toggle('is-selectable', available);
    const activeEffect = available && effectRows.includes(row.dataset.playRow);
    row.classList.toggle('is-placement-effect-row', activeEffect);
    const label = row.parentElement.querySelector('button.row-label');
    label.disabled = !available;
    if (activeEffect) label.setAttribute('aria-description', 'В этом ряду действует способность выбранной карты.');
    else label.removeAttribute('aria-description');
  }
}

function hasMulliganChoice(match) {
  if (mulliganRemaining(match) <= 0) return false;
  const { hand, deck } = match.players.human;
  const excluded = new Set(match.mulligan.excluded);
  return deck.some(({ definition }) => !excluded.has(definition.id) &&
    hand.some((card) => card.definition.id !== definition.id));
}

async function dealMulligan(panel, nodes, match, motion, deal) {
  if (deal.round === match.round) return;
  if (match.round === 1 && deal.ready && motion()) {
    panel.classList.add('mulligan-deal-pending');
    await deal.ready;
    panel.classList.remove('mulligan-deal-pending');
  } else {
    // The caller attaches the panel after constructing it.
    await Promise.resolve();
  }
  if (!panel.isConnected || deal.round === match.round) return;
  deal.round = match.round;
  const base = motion();
  if (!base) return;
  const draw = match.log.findLast(({ type, side, reason }) => type === 'draw' && side === 'human' && reason === 'round');
  const newIds = new Set(draw?.cards?.map(({ id }) => id));
  const dealt = match.round === 1 ? nodes : nodes.filter(({ dataset }) => newIds.has(dataset.cardId));
  panel.style.setProperty('--deal-duration', base * MOTION.pace.deal + 'ms');
  panel.style.setProperty('--deal-step', base * MOTION.pace.dealStep + 'ms');
  panel.style.setProperty('--deal-ease', MOTION.ease.draw);
  for (const [index, node] of dealt.entries()) {
    node.style.setProperty('--deal-i', String(index));
    node.classList.add('is-dealt');
    if (match.round > 1) node.classList.add('is-dealt-new');
  }
  await Promise.all(dealt.flatMap((node) => (node.getAnimations?.() ?? []).map((motion) => motion.finished.catch(() => {}))));
  for (const node of dealt) node.classList.remove('is-dealt', 'is-dealt-new');
}

async function replaceChoice(panel, previous, replacement, base) {
  if (!base || !panel.isConnected || !previous.isConnected || !previous.animate) {
    previous.replaceWith(replacement);
    return;
  }
  const ghost = ghostCard(panel, { node: previous, rect: previous.getBoundingClientRect() });
  ghost.classList.add('motion-mulligan-out');
  previous.replaceWith(replacement);
  const outgoing = animate(ghost, [
    { transform: 'translateY(0)', opacity: 1 },
    { transform: `translateY(${MOTION.hand.mulliganDrop}px)`, opacity: 0 },
  ], base * MOTION.pace.mulliganOut).finally(() => ghost.remove());
  const flip = replacement.animate([
    { transform: 'perspective(650px) rotateY(90deg)' },
    { transform: 'perspective(650px) rotateY(0deg)' },
  ], { duration: base * MOTION.pace.mulliganIn, delay: base * MOTION.pace.mulliganOut,
    easing: MOTION.ease.draw, fill: 'both' });
  await Promise.all([outgoing, flip.finished.catch(() => {})]);
  flip.cancel();
}

export function mulliganScreen({ getMatch, setMatch, updateMatch, setMulliganField, settingsButton, motion, mulliganDeal }) {
  const match = getMatch();
  const panel = element('section', 'mulligan mulligan-overlay');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'mulligan-title');
  const heading = element('h2', null, 'Раунд ' + match.round);
  heading.id = 'mulligan-title';
  heading.tabIndex = -1;
  const counter = element('p', 'selection-count');
  counter.setAttribute('aria-live', 'polite');
  const cards = element('div', 'hand-grid');
  function updateCounter() {
    counter.textContent = 'Осталось замен: ' + mulliganRemaining(getMatch());
  }

  async function finishMulligan() {
    const current = getMatch();
    if (current.phase !== 'mulligan' || panel.inert || !panel.isConnected) return;
    panel.inert = true;
    const duration = motion();
    if (duration && panel.animate) {
      const fade = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' });
      await fade.finished.catch(() => {});
    }
    if (panel.isConnected && current === getMatch()) updateMatch(confirmMulligan(current));
  }

  function choice(card, index) {
    return cardButton(card, async (event) => {
      if (panel.inert || !panel.isConnected) return;
      const match = getMatch();
      if (!mulliganRemaining(match)) return;
      const next = replaceMulliganCard(match, card.id);
      if (next === match) {
        counter.textContent = 'Нет подходящей карты для замены · осталось: ' + mulliganRemaining(getMatch());
        return;
      }
      setMatch(next);
      const previous = event.currentTarget;
      const focused = document.activeElement === previous;
      const replacement = choice(next.players.human.hand[index], index);
      const replacing = replaceChoice(panel, previous, replacement, motion());
      updateCounter();
      if (focused) replacement.focus({ preventScroll: true });
      await replacing;
      if (next === getMatch() && !hasMulliganChoice(next)) void finishMulligan();
    }, match.players.human);
  }

  const confirm = button('Готово', finishMulligan, 'button primary');
  const header = element('header', 'mulligan-header');
  header.append(heading, counter);
  const actions = element('div', 'mulligan-actions');
  actions.append(button('Посмотреть поле', () => setMulliganField(true)), confirm);
  const nodes = match.players.human.hand.map(choice);
  cards.append(...nodes);
  panel.append(header, cards, actions, settingsButton());
  updateCounter();
  const deal = mulliganDeal();
  const dealing = dealMulligan(panel, nodes, match, motion, deal);
  if (!hasMulliganChoice(match)) void dealing.then(finishMulligan);
  return panel;
}

export function playerHand(match, active, selectCard, isReplaying) {
  const { human } = match.players;
  const hand = element('section', 'hand battle-hand');
  hand.setAttribute('aria-label', 'Твоя рука · ' + human.hand.length);
  const cards = element('div', 'battle-hand-cards');
  for (const card of human.hand) {
    const available = active && canPlayCard(match, 'human', card);
    const node = cardButton(card, () => {
      if (!available) {
        if (!isReplaying()) showCard(card);
        return;
      }
      selectCard(card.id);
    }, human, available);
    if (available) {
      node.dataset.playCard = '';
      if (card.definition.requiredRow) node.dataset.requiredRow = card.definition.requiredRow;
      const effectRows = placementEffectRows(card.definition);
      if (effectRows.length) node.dataset.effectRows = effectRows.join(' ');
    }
    if (active && !available) node.classList.add('is-unavailable');
    cards.append(node);
  }
  hand.append(cards);
  return hand;
}
