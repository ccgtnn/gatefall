const VISUAL_EVENTS = new Set([
  'play', 'damage', 'boost', 'armor', 'death', 'destroy', 'spawn', 'deathwish', 'consume', 'leader', 'order',
]);

function rects(screen) {
  return new Map(Array.from(screen.querySelectorAll('[data-board-card]'), (node) =>
    [node.dataset.boardCard, { node, rect: node.getBoundingClientRect() }]));
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function point(x, y) {
  return 'translate3d(' + x + 'px, ' + y + 'px, 0)';
}

function animate(node, keyframes, duration) {
  if (!node?.animate || !duration) return Promise.resolve();
  const motion = node.animate(keyframes, { duration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
  return motion.finished.catch(() => {}).finally(() => motion.cancel());
}

function floatNode(screen, className, text, { x, y }) {
  const doc = screen.ownerDocument;
  const node = doc.createElement('div');
  node.className = 'motion-overlay ' + className;
  node.textContent = text;
  node.setAttribute('aria-hidden', 'true');
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  doc.body.append(node);
  return node;
}

function moveNeighbors(previous, current, duration) {
  const movements = [];
  for (const [id, entry] of current) {
    const old = previous.get(id);
    if (!old) continue;
    const dx = old.rect.left - entry.rect.left;
    const dy = old.rect.top - entry.rect.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    movements.push(animate(entry.node, [{ transform: point(dx, dy) }, { transform: point(0, 0) }], duration));
  }
  return movements;
}

function oldHandPosition(screen, id) {
  const card = Array.from(screen.querySelectorAll('.hand [data-card-id]')).find(({ dataset }) => dataset.cardId === id);
  return card ? center(card.getBoundingClientRect()) : null;
}

function fly(screen, event, current, handOrigin, duration) {
  const target = current.get(event.cardId);
  const field = screen.querySelector('.field-center');
  if (!target && !field) return [];
  const destination = center(target?.rect ?? field.getBoundingClientRect());
  const view = screen.ownerDocument.defaultView;
  const from = handOrigin ?? { x: destination.x, y: -30 };
  const startY = Math.max(-40, Math.min(view.innerHeight + 40, from.y));
  const art = event.card?.definition.art;
  const card = floatNode(screen, 'motion-flight', art ? '' : event.name, destination);
  if (art) {
    const image = screen.ownerDocument.createElement('img');
    image.className = 'card-art-crop';
    image.src = './art/' + art;
    image.alt = '';
    card.classList.add('has-art');
    card.append(image);
  }
  card.dataset.faction = screen.querySelector('[data-side="' + event.side + '"]')?.dataset.faction ?? '';
  const slide = (factor) => point((from.x - destination.x) * factor, (startY - destination.y) * factor);
  const motion = animate(card, [
    { transform: 'translate(-50%, -50%) ' + slide(1) + ' scale(.92)', opacity: .3 },
    { transform: 'translate(-50%, -50%) ' + slide(.30) + ' scale(1)', opacity: 1, offset: .63 },
    { transform: 'translate(-50%, -50%) scale(' + (target ? '.36' : '.96') + ')', opacity: target ? .1 : 0 },
  ], duration).finally(() => card.remove());
  if (!target) return [motion];
  return [motion, animate(target.node, [
    { opacity: 0 }, { opacity: 0, offset: .61 }, { opacity: 1 },
  ], duration)];
}

function leave(screen, entry, duration) {
  if (!entry) return [];
  const clone = entry.node.cloneNode(true);
  clone.classList.add('motion-overlay', 'motion-departure');
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    left: entry.rect.left + 'px', top: entry.rect.top + 'px',
    width: entry.rect.width + 'px', height: entry.rect.height + 'px',
  });
  screen.ownerDocument.body.append(clone);
  return [animate(clone, [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: .30, transform: 'scale(.96)', offset: .57 },
    { opacity: 0, transform: 'translateY(8px) scale(.79)' },
  ], duration).finally(() => clone.remove())];
}

function floatingNumber(screen, entry, value, kind, duration) {
  if (!entry) return [];
  const anchor = center(entry.rect);
  anchor.y -= entry.rect.height / 4;
  const number = floatNode(screen, 'motion-number motion-' + kind, value, anchor);
  return [animate(number, [
    { transform: 'translate(-50%, -45%) scale(.86)', opacity: .2 },
    { transform: 'translate(-50%, -92%) scale(1.08)', opacity: 1, offset: .34 },
    { transform: 'translate(-50%, -152%) scale(1)', opacity: 0 },
  ], duration).finally(() => number.remove())];
}

function shield(screen, entry, duration) {
  if (!entry) return [];
  const flash = floatNode(screen, 'motion-shield', '⬟', center(entry.rect));
  return [animate(flash, [
    { transform: 'translate(-50%, -50%) scale(.70)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.18)', opacity: .95, offset: .35 },
    { transform: 'translate(-50%, -50%) scale(1.45)', opacity: 0 },
  ], duration).finally(() => flash.remove())];
}

function showActivation(screen, event, duration) {
  const field = screen.querySelector('.field-center');
  if (!field) return [];
  const labels = { deathwish: 'Завещание', consume: 'Поглощение', leader: 'Лидер', order: 'Приказ' };
  const name = event.eater ?? event.name;
  const banner = floatNode(screen, 'motion-activation', labels[event.type] + ' · ' + name,
    center(field.getBoundingClientRect()));
  return [animate(banner, [
    { opacity: 0, transform: 'translate(-50%, -40%)' },
    { opacity: 1, transform: 'translate(-50%, -50%)', offset: .36 },
    { opacity: .95, transform: 'translate(-50%, -64%)', offset: .77 },
    { opacity: 0, transform: 'translate(-50%, -72%)' },
  ], duration).finally(() => banner.remove())];
}

export async function presentJournalEvent(screen, event, commit, render, duration) {
  if (duration === 0 || !VISUAL_EVENTS.has(event.type)) {
    commit();
    return;
  }

  const previous = rects(screen);
  const origin = event.type === 'play' && event.side === 'human' ? oldHandPosition(screen, event.cardId) : null;
  render(commit());
  const current = rects(screen);
  const entry = current.get(event.cardId);
  const motions = moveNeighbors(previous, current, duration);

  switch (event.type) {
    case 'play':
      motions.push(...fly(screen, event, current, origin, duration));
      break;
    case 'spawn':
      for (const { id } of event.cards) {
        motions.push(animate(current.get(id)?.node, [
          { transform: 'translateY(11px) scale(.45)', opacity: 0 },
          { transform: 'translateY(-4px) scale(1.12)', opacity: 1, offset: .56 },
          { transform: 'translateY(0) scale(1)', opacity: 1 },
        ], duration));
      }
      break;
    case 'armor':
      motions.push(...shield(screen, entry, duration));
      break;
    case 'damage':
      motions.push(animate(entry?.node.querySelector('.unit-face'), [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)', offset: .18 },
        { transform: 'translateX(4px)', offset: .36 },
        { transform: 'translateX(-2px)', offset: .57 },
        { transform: 'translateX(0)' },
      ], duration));
      motions.push(...floatingNumber(screen, entry, '−' + event.amount, 'damage', duration));
      break;
    case 'boost':
      motions.push(...floatingNumber(screen, entry, '+' + event.amount, 'boost', duration));
      break;
    case 'death':
    case 'destroy':
      motions.push(...leave(screen, previous.get(event.cardId), duration));
      break;
    default:
      motions.push(...showActivation(screen, event, duration));
  }
  await Promise.all(motions);
}
