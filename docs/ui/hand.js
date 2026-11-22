import { button, element } from './dom.js?v=opponent-reveal-1';
import { cardType, placementSide } from '../game/board.js?v=rebirth-1';
import { canPlayCard, confirmMulligan, mulliganRemaining, replaceMulliganCard } from '../game/match.js?v=rebirth-1';
import { cardButton, showCard } from './cards.js?v=rebirth-1';

export function updatePlacementSelection(screen, match, selectedCardId) {
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  for (const node of screen.querySelectorAll('.hand [data-card-id]')) {
    node.setAttribute('aria-pressed', String(node.dataset.cardId === selectedCardId));
  }
  for (const row of screen.querySelectorAll('[data-play-row]')) {
    const available = Boolean(card && placementSide('human', card) === row.dataset.side &&
      (cardType(card) === 'effect' || row.dataset.full !== 'true'));
    row.classList.toggle('is-selectable', available);
    row.parentElement.querySelector('button.row-label').disabled = !available;
  }
}

export function mulliganScreen({ getMatch, setMatch, updateMatch, setMulliganField, settingsButton }) {
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
    const remaining = mulliganRemaining(getMatch());
    counter.textContent = 'Осталось замен: ' + remaining;
    for (const choice of cards.children) choice.classList.toggle('is-unavailable', remaining === 0);
  }

  function choice(card, index) {
    return cardButton(card, (event) => {
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
      previous.replaceWith(replacement);
      updateCounter();
      if (focused) replacement.focus({ preventScroll: true });
    }, match.players.human);
  }

  const confirm = button('Готово', () => updateMatch(confirmMulligan(getMatch())), 'button primary');
  const header = element('header', 'mulligan-header');
  header.append(heading, counter);
  const actions = element('div', 'mulligan-actions');
  actions.append(button('Посмотреть поле', () => setMulliganField(true)), confirm);
  cards.append(...match.players.human.hand.map(choice));
  panel.append(header, cards, actions, settingsButton());
  updateCounter();
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
    if (available) node.dataset.playCard = '';
    if (active && !available) node.classList.add('is-unavailable');
    cards.append(node);
  }
  hand.append(cards);
  return hand;
}
