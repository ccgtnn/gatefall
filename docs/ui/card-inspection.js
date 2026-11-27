import { showCard } from './card-preview.js';

export function cardInspection(node, card, placement = false, show = () => showCard(card)) {
  if (card.definition.text?.includes('\n')) node.title = card.definition.text;
  let holdTimer;
  let activated;
  let firstX, firstY;
  function inspect(event) {
    event.preventDefault();
    clearTimeout(holdTimer);
    if (node.isConnected) show();
  }
  node.addEventListener('dblclick', (event) => {
    if (node.dataset.choiceCard === undefined) inspect(event);
  });
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (event.pointerType !== 'touch' && !event.sourceCapabilities?.firesTouchEvents) inspect(event);
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) inspect(event);
  });
  if (!placement) {
    node.addEventListener('pointerdown', (event) => {
      activated = false;
      if (!event.isPrimary || event.pointerType !== 'touch') return;
      firstX = event.clientX;
      firstY = event.clientY;
      holdTimer = setTimeout(() => {
        activated = true;
        if (node.isConnected) show();
      }, 450);
    });
    node.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - firstX, event.clientY - firstY) > 6) clearTimeout(holdTimer);
    });
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
      node.addEventListener(end, () => clearTimeout(holdTimer));
    }
  }
  node.addEventListener('click', (event) => {
    if (activated || node.dataset.suppressClick) {
      event.stopImmediatePropagation();
      activated = false;
      delete node.dataset.suppressClick;
      return;
    }
    if (event.detail > 1 && node.dataset.choiceCard === undefined) {
      event.stopImmediatePropagation();
    }
  }, { capture: true });
}
