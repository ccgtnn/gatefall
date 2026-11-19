const DRAG_DISTANCE = 6;
const SCROLL_EDGE = 56;
const INSPECT_DELAY = 450;

export function insertionPoint(row, cards, clientX) {
  if (cards.length === 0) return { position: 0, offset: row.width / 2 };

  const next = cards.findIndex(({ left, right }) => clientX < (left + right) / 2);
  const position = next < 0 ? cards.length : next;
  const before = cards[position - 1];
  const after = cards[position];
  const leftEdge = before?.right ?? after.left - 4;
  const rightEdge = after?.left ?? before.right + 4;
  return { position, offset: (leftEdge + rightEdge) / 2 - row.left };
}

export function bindCardPlacement(screen, play, inspect) {
  const doc = screen.ownerDocument;
  const view = doc.defaultView;
  let gesture = null;

  function dropPosition(active, x, y) {
    if (!active.row.contains(doc.elementFromPoint(x, y))) return null;
    const cards = Array.from(active.row.querySelectorAll('.slot.filled'), (card) => card.getBoundingClientRect());
    return insertionPoint(active.row.getBoundingClientRect(), cards, x);
  }

  function showTarget(active) {
    const target = dropPosition(active, active.x, active.y);
    active.marker.hidden = target === null;
    if (target !== null) active.marker.style.left = `${target.offset}px`;
  }

  function scrollNearEdge() {
    const active = gesture;
    if (!active?.ghost) return;

    const { y } = active;
    const bottomDistance = view.innerHeight - y;
    const direction = y < SCROLL_EDGE ? -1 : bottomDistance < SCROLL_EDGE ? 1 : 0;
    if (direction !== 0) {
      const previousY = view.scrollY;
      view.scrollBy(0, direction * 12);
      if (view.scrollY !== previousY) showTarget(active);
    }
    active.frame = view.requestAnimationFrame(scrollNearEdge);
  }

  function beginDrag(active) {
    const ghost = active.card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.style.width = `${active.card.getBoundingClientRect().width}px`;
    active.ghost = ghost;
    doc.body.append(ghost);
    active.card.classList.add('is-dragged');
    active.row.classList.add('is-available');

    const marker = doc.createElement('span');
    marker.className = 'drop-marker';
    marker.classList.toggle('is-center', active.row.querySelector('.slot.filled') === null);
    marker.setAttribute('aria-hidden', 'true');
    active.marker = marker;
    active.row.append(marker);
    active.frame = view.requestAnimationFrame(scrollNearEdge);
  }

  function cancel() {
    const active = gesture;
    if (!active) return;
    gesture = null;
    clearTimeout(active.holdTimer);
    if (active.ghost) {
      view.cancelAnimationFrame(active.frame);
      active.ghost.remove();
      active.marker.remove();
      active.card.classList.remove('is-dragged');
      active.row.classList.remove('is-available');
    }
    if (active.card.hasPointerCapture(active.pointerId)) {
      active.card.releasePointerCapture(active.pointerId);
    }
  }

  screen.addEventListener('pointerdown', (event) => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    const card = event.target.closest('button[data-card-row]:enabled');
    if (!card) return;
    const row = screen.querySelector(`[data-play-row="${card.dataset.cardRow}"]`);
    if (!row) return;
    gesture = { pointerId: event.pointerId, card, row, startX: event.clientX, startY: event.clientY };
    card.setPointerCapture(event.pointerId);
    if (inspect && event.pointerType === 'touch') {
      const active = gesture;
      active.holdTimer = setTimeout(() => {
        active.inspected = true;
        inspect(card);
      }, INSPECT_DELAY);
    }
  });

  screen.addEventListener('pointermove', (event) => {
    const active = gesture;
    if (active?.pointerId !== event.pointerId || active.inspected) return;

    active.x = event.clientX;
    active.y = event.clientY;
    if (!active.ghost && Math.hypot(active.x - active.startX, active.y - active.startY) < DRAG_DISTANCE) return;
    if (!active.ghost) {
      clearTimeout(active.holdTimer);
      beginDrag(active);
    }
    active.ghost.style.left = `${active.x}px`;
    active.ghost.style.top = `${active.y}px`;
    showTarget(active);
  });

  screen.addEventListener('pointerup', (event) => {
    const active = gesture;
    if (active?.pointerId !== event.pointerId) return;

    if (active.inspected) {
      cancel();
      return;
    }
    const { clientX, clientY } = event;
    const hit = doc.elementFromPoint(clientX, clientY);
    const position = active.ghost
      ? dropPosition(active, clientX, clientY)?.position
      : active.card.contains(hit) ? active.row.querySelectorAll('.slot.filled').length : undefined;
    cancel();
    if (position !== undefined) play(active.card.dataset.cardId, position);
  });

  function cancelPointer(event) {
    if (gesture?.pointerId === event.pointerId) cancel();
  }

  screen.addEventListener('pointercancel', cancelPointer);
  screen.addEventListener('lostpointercapture', cancelPointer);
  screen.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel();
  });
  return cancel;
}
