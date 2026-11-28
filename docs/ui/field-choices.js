import { findUnit, restoreCard } from '../game/engine/board.js';
import { pendingEffectSource } from '../game/effects/effect-queries.js';
import { cardButton, decorateCard } from './cards.js';
import { cardArt } from './card-art.js';
import { button, element } from './dom.js';
import { tributeLabel } from './field-labels.js';
import { MOTION } from './motion-tokens.js';
const pileLabels = { deck: 'из колоды', discard: 'из сброса', hand: 'из руки', created: 'сотворение' };
const touchLayout = '(pointer: coarse), (hover: none), (max-height: 540px)';

function setFanOrigin(overlay, choices) {
  // Measure the mounted grid before painting. Layout offsets ignore the entrance transform.
  queueMicrotask(() => {
    if (!overlay.isConnected || !overlay.classList.contains('choice-enter') || !choices.clientWidth) return;
    const first = choices.firstElementChild;
    if (!first) return;
    const x = choices.clientWidth / 2 + choices.scrollLeft;
    const y = first.offsetTop + first.offsetHeight * 1.1;
    for (const item of choices.children) {
      item.style.setProperty('--from-x', `${x - item.offsetLeft - item.offsetWidth / 2}px`);
      item.style.setProperty('--from-y', `${y - item.offsetTop - item.offsetHeight / 2}px`);
    }
  });
}

export function createFieldChoices({ playHuman, canCancel = () => false, cancelTargeting = () => {},
  getTargetAction = () => undefined, choiceLocked = () => false, phoneChoice }) {
  const opened = new WeakSet();
  const interactions = new WeakMap();
  const compact = () => phoneChoice?.() || globalThis.matchMedia?.(touchLayout).matches;

  function choiceWindow(match, subtitle) {
    const { pending, players: { human } } = match;
    const overlay = element('div', 'choice-overlay');
    overlay.inert = choiceLocked();
    const entering = !opened.has(pending);
    if (entering) {
      opened.add(pending);
      overlay.classList.add('choice-enter');
    }
    const { pace, ease } = MOTION;
    overlay.style.cssText = `--choice-backdrop-pace:${pace.choiceBackdrop};--choice-panel-pace:${pace.choicePanel};` +
      `--choice-card-pace:${pace.choiceCard};--choice-step:${pace.choiceStep};--choice-ease:${ease.back}`;

    let state = interactions.get(pending);
    if (!state) {
      state = { handOpen: false, picked: undefined };
      interactions.set(pending, state);
    }
    const panel = element('section', 'deck-offer panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'deck-choice-title');
    panel.setAttribute('aria-describedby', 'deck-choice-subtitle');
    if (compact()) overlay.dataset.choicePhone = 'true';

    const header = element('header', 'choice-header');
    const targetAction = getTargetAction();
    const sourceId = pending.job?.sourceId ?? targetAction?.cardId;
    const source = sourceId
      ? pendingEffectSource(match, targetAction).card?.definition ?? findUnit(match, sourceId)?.card.definition
      : human.leader;
    if (source?.art) header.append(cardArt(source, 'choice-source-art', { staticArt: true }));
    const label = element('div', 'choice-heading');
    const title = element('h2', null, pending.prompt);
    title.id = 'deck-choice-title';
    const caption = element('p', 'choice-subtitle', subtitle);
    caption.id = 'deck-choice-subtitle';
    label.append(title, caption);

    const hand = element('div', 'choice-hand');
    hand.id = 'choice-hand';
    hand.setAttribute('aria-label', 'Карты в твоей руке');
    let handBuilt = false;
    const controls = element('div', 'choice-controls');
    const handToggle = button('Рука', () => {
      state.handOpen = !state.handOpen;
      updateHand();
    });
    handToggle.setAttribute('aria-controls', hand.id);
    controls.append(handToggle);
    if (canCancel()) controls.append(button('Отмена', cancelTargeting));
    function updateHand() {
      if (state.handOpen && !handBuilt) {
        handBuilt = true;
        for (const card of human.hand) hand.append(cardButton(card, () => {}, human, false, { staticArt: true }));
        if (!human.hand.length) hand.append(element('p', 'muted', 'Рука пуста'));
      }
      hand.hidden = !state.handOpen;
      handToggle.setAttribute('aria-expanded', String(state.handOpen));
    }
    updateHand();
    header.append(label, controls);
    panel.append(header, hand);
    overlay.append(panel);
    return { overlay, panel, controls, state, entering };
  }

  function deckChoice(match) {
    const { pending, players: { human } } = match;
    const pile = pending.pile ?? 'deck';
    const options = new Set(pending.options);
    const offered = (pending.cards ?? human[pile]).filter(({ id }) => pending.fullDeck || options.has(id));
    const wholePile = pending.fullDeck || pending.kind === 'deck-top' || pile === 'discard';
    if (wholePile) offered.sort((a, b) => Number(options.has(b.id)) - Number(options.has(a.id)) ||
      a.definition.name.localeCompare(b.definition.name, 'ru'));

    const { overlay, panel, controls, state, entering } = choiceWindow(match, (pileLabels[pile] ?? pile) + ' · ' + offered.length);
    const many = offered.length > 5;
    const confirmTwice = wholePile || many;
    panel.dataset.choiceSize = many ? 'many' : offered.length <= 3 ? 'few' : 'medium';
    const layout = element('div', 'choice-layout');
    const choices = element('div', 'deck-choice-cards');
    choices.style.cssText = '--n:' + Math.max(1, offered.length);
    const detail = many ? element('aside', 'choice-detail') : null;
    const entries = new Map();
    const confirm = button('Выбрать', () => {
      const picked = entries.get(state.picked);
      if (picked) submit(state.picked, picked);
    });
    confirm.hidden = true;
    if (confirmTwice) controls.append(confirm);

    function submit(cardId, node) {
      if (!overlay.inert && options.has(cardId)) playHuman({ type: 'target', cardId }, node);
    }
    function focusCard(card) {
      if (!detail || detail.dataset.cardId === card.id) return;
      detail.dataset.cardId = card.id;
      const art = element('div', 'hand-card choice-detail-art');
      decorateCard(art, card, human, { showProvision: true, fullArt: true, staticArt: true });
      detail.replaceChildren(art, element('h3', null, card.definition.name),
        element('p', null, card.definition.text || 'Без эффекта.'));
    }
    function refreshPicked() {
      for (const [id, node] of entries) node.setAttribute('aria-pressed', String(id === state.picked));
      confirm.hidden = !entries.has(state.picked);
    }

    for (const [index, item] of offered.entries()) {
      const card = pile === 'discard' ? restoreCard(item) : item;
      const allowed = options.has(card.id);
      const node = cardButton(card, (event) => {
        if (!allowed || overlay.inert) return;
        const touch = compact() || event?.pointerType === 'touch' || event?.sourceCapabilities?.firesTouchEvents;
        if (confirmTwice && touch && state.picked !== card.id) {
          state.picked = card.id;
          refreshPicked();
          return;
        }
        submit(card.id, node);
      }, human, false, { showProvision: true, staticArt: true });
      const entry = element('div', 'choice-item');
      const offset = index - (offered.length - 1) / 2;
      const fan = Math.max(-7, Math.min(7, offset)) * 3;
      entry.style.cssText = `--choice-index:${Math.min(index, 10)};--fan:${fan}deg`;
      if (allowed) {
        node.classList.add('effect-target');
        node.dataset.choiceCard = card.id;
        entries.set(card.id, node);
      } else node.setAttribute('aria-disabled', 'true');
      node.setAttribute('aria-label', card.definition.name);
      node.addEventListener('pointerenter', () => focusCard(card));
      node.addEventListener('focus', () => focusCard(card));
      entry.append(node, element('p', 'deck-choice-name', card.definition.name),
        element('p', 'deck-choice-text', card.definition.text || 'Без эффекта.'));
      choices.append(entry);
      if (index === 0) focusCard(card);
    }
    if (confirmTwice) refreshPicked();
    layout.append(choices);
    if (many) {
      // Phone strip: explicit arrows, because touch browsers hide the scrollbar of a horizontal list.
      for (const [dir, symbol, label] of [[-1, '‹', 'Листать влево'], [1, '›', 'Листать вправо']]) {
        const arrow = button(symbol, () => choices.scrollBy?.({ left: dir * Math.max(120, (choices.clientWidth || 0) * .8), behavior: 'smooth' }),
          'button choice-scroll');
        arrow.dataset.dir = String(dir);
        arrow.setAttribute('aria-label', label);
        layout.append(arrow);
      }
    }
    if (detail) layout.append(detail);
    panel.append(layout);
    if (entering) setFanOrigin(overlay, choices);
    return overlay;
  }

  function tributeChoice(match) {
    const { pending } = match;
    const { overlay, panel, entering } = choiceWindow(match, 'Взнос');
    panel.classList.add('tribute-offer');
    const options = element('div', 'tribute-choices');
    for (const [index, cost] of pending.options.entries()) {
      const choice = button(tributeLabel(pending, cost), () => {
        if (!overlay.inert) playHuman({ type: 'target', cardId: cost }, choice);
      }, 'button effect-target tribute-option');
      choice.style.cssText = '--choice-index:' + Math.min(index, 10);
      options.append(choice);
    }
    panel.append(options);
    if (entering) setFanOrigin(overlay, options);
    return overlay;
  }

  return { deckChoice, tributeChoice };
}
