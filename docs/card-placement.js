const DRAG_DISTANCE = 6;
const INSPECT_DELAY = 450;

export function placementEffectRows(definition) {
  if (definition.type === 'effect') return [];
  const abilities = [
    definition.deploy, definition.initiative, definition.order, definition.endTurn,
    definition.startTurn, definition.startTurnPulse, definition.scenario?.prologue,
    ...Object.values(definition.fieldEvents ?? {}).map(({ ability }) => ability),
  ];
  return [...new Set(abilities.filter(Boolean).flatMap((ability) =>
    ability.sourceRow ? [ability.sourceRow] : (ability.steps ?? []).map(({ sourceRow }) => sourceRow).filter(Boolean)))];
}

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
  let gesture = null;

  function dropPosition(active, x, y) {
    const hit = doc.elementFromPoint(x, y);
    const row = active.rows.find((line) => line.contains(hit));
    if (!row) return null;
    const cards = Array.from(row.querySelectorAll('.slot.filled'), (card) => card.getBoundingClientRect());
    return {
      row: row.dataset.playRow,
      element: row,
      empty: cards.length === 0,
      ...insertionPoint(row.getBoundingClientRect(), cards, x),
    };
  }

  function showTarget(active) {
    const target = dropPosition(active, active.x, active.y);
    for (const row of active.rows) row.classList.toggle('is-cast-target', active.isEffect && target?.element === row);
    active.marker.hidden = target === null || active.isEffect;
    if (target && !active.isEffect) {
      target.element.append(active.marker);
      active.marker.classList.toggle('is-center', target.empty);
      active.marker.style.left = `${target.offset}px`;
    }
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
    const effectRows = active.card.dataset.effectRows?.split(' ') ?? [];
    screen.classList.add('is-dragging-card');
    for (const row of active.rows) {
      row.classList.add('is-available');
      row.classList.toggle('is-drag-effect-row', effectRows.includes(row.dataset.playRow));
    }

    const marker = doc.createElement('span');
    marker.className = 'drop-marker';
    marker.setAttribute('aria-hidden', 'true');
    active.marker = marker;
  }

  function cancel() {
    const active = gesture;
    if (!active) return;
    gesture = null;
    clearTimeout(active.holdTimer);
    if (active.ghost) {
      active.ghost.remove();
      active.marker.remove();
      active.card.classList.remove('is-dragged');
      screen.classList.remove('is-dragging-card');
      for (const row of active.rows) row.classList.remove('is-available', 'is-cast-target', 'is-drag-effect-row');
    }
    if (active.card.hasPointerCapture(active.pointerId)) {
      active.card.releasePointerCapture(active.pointerId);
    }
  }

  screen.addEventListener('pointerdown', (event) => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    const card = event.target.closest('button[data-play-card]');
    if (!card) return;
    delete card.dataset.suppressClick;
    const isEffect = card.dataset.type === 'effect';
    const rows = [...screen.querySelectorAll(isEffect ? '[data-cast-zone]' : '[data-play-row]')].filter((row) => isEffect || (row.dataset.side === (card.dataset.enemySide ? 'bot' : 'human') && row.dataset.full !== 'true'));
    if (!rows.length) return;
    gesture = { pointerId: event.pointerId, card, rows, isEffect, startX: event.clientX, startY: event.clientY };
    card.setPointerCapture(event.pointerId);
    if (inspect && event.pointerType === 'touch') {
      const active = gesture;
      active.holdTimer = setTimeout(() => {
        active.inspected = true;
        card.dataset.suppressClick = 'true';
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

    const drop = active.ghost ? dropPosition(active, event.clientX, event.clientY) : null;
    if (active.ghost || active.inspected) active.card.dataset.suppressClick = 'true';
    cancel();
    if (drop) play(active.card.dataset.cardId, drop.row, drop.position);
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
