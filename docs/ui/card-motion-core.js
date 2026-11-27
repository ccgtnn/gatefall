import { MOTION } from './motion-tokens.js';
import { setCardRarity } from './dom.js';
import { cardArt } from './card-art.js';
import { NEUTRAL } from '../game/shared/card-metadata.js';

export const VISUAL_EVENTS = new Set([
  'play', 'damage', 'boost', 'weaken', 'armor', 'status', 'cleanse', 'death', 'destroy', 'discard', 'spawn', 'deathwish', 'consume', 'consume-group', 'leader', 'order', 'aura-power', 'transform',
]);

export function rects(screen) {
  return new Map(Array.from(screen.querySelectorAll('[data-board-card]'), (node) =>
    [node.dataset.boardCard, { node, rect: node.getBoundingClientRect() }]));
}

const rememberedRects = new Map();

export function rememberRect(cardId, rect) {
  rememberedRects.set(cardId, rect);
}

export function takeRememberedRect(cardId) {
  const rect = rememberedRects.get(cardId);
  rememberedRects.delete(cardId);
  return rect;
}

export function clearRememberedRects() {
  rememberedRects.clear();
}

function visibleRect(node) {
  const rect = node?.getBoundingClientRect();
  return rect?.width > 0 && rect.height > 0 ? rect : undefined;
}

export function pileAnchor(screen, side, pile) {
  for (const node of screen.querySelectorAll(`[data-pile-side="${side}"][data-pile="${pile}"]`)) {
    const rect = visibleRect(node);
    if (rect) return center(rect);
  }
  const stack = visibleRect(screen.querySelector(`.field-hand-stack[data-hand-side="${side}"]`));
  if (stack) return center(stack);
  const count = visibleRect(screen.querySelector(side === 'bot' ? '.bot-hand-count' : '.field-corner .field-hand-count'));
  if (count) return center(count);
  const half = visibleRect(screen.querySelector(`.side[data-side="${side}"]`));
  return half ? center(half) : null;
}

export function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function point(x, y) {
  return 'translate3d(' + x + 'px, ' + y + 'px, 0)';
}

export function animate(node, keyframes, duration) {
  if (!node?.animate || !duration) return Promise.resolve();
  const motion = node.animate(keyframes, { duration, easing: MOTION.ease.out, fill: 'both' });
  return motion.finished.catch(() => {}).finally(() => motion.cancel());
}

export function floatNode(screen, className, text, { x, y }) {
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

export function moveNeighbors(previous, current, duration) {
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

export function oldHandPosition(screen, id) {
  const card = Array.from(screen.querySelectorAll('.hand [data-card-id]')).find(({ dataset }) => dataset.cardId === id);
  return card ? center(card.getBoundingClientRect()) : null;
}

export function floatingCard(screen, event, className, destination, fullArt = false) {
  const definition = event.card?.definition;
  const art = fullArt ? definition?.art : definition?.artCrop ?? definition?.art;
  const card = floatNode(screen, className, art || fullArt ? '' : event.name, destination);
  setCardRarity(card, definition?.rarity);
  if (art) {
    card.classList.add('has-art');
    card.append(cardArt(definition, 'card-art-crop', { fullArt, doc: screen.ownerDocument }));
  }
  card.dataset.faction = definition?.faction === NEUTRAL ? NEUTRAL
    : screen.querySelector('[data-side="' + event.side + '"]')?.dataset.faction ?? '';
  return card;
}

export function ghostCard(screen, entry) {
  const clone = entry.node.cloneNode(true);
  for (const video of clone.querySelectorAll('video')) {
    const image = screen.ownerDocument.createElement('img');
    image.className = video.className;
    image.classList.remove('card-art-video');
    image.alt = '';
    image.style.cssText = video.style.cssText;
    const poster = video.poster || video.dataset.premiumPoster;
    if (poster) image.src = poster;
    video.replaceWith(image);
  }
  clone.classList.add('motion-overlay', 'motion-departure');
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    left: entry.rect.left + 'px', top: entry.rect.top + 'px',
    width: entry.rect.width + 'px', height: entry.rect.height + 'px',
  });
  screen.ownerDocument.body.append(clone);
  return clone;
}

export function floatingNumber(screen, entry, value, kind, duration) {
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

export function cardFlash(screen, entry, kind, keyframes, duration) {
  if (!entry) return [];
  const flash = floatNode(screen, 'motion-card-flash ' + kind, '', center(entry.rect));
  flash.style.width = entry.rect.width + 'px';
  flash.style.height = entry.rect.height + 'px';
  return [animate(flash, keyframes, duration).finally(() => flash.remove())];
}

export function updateScores(screen, previous, duration) {
  const changing = [];
  for (const node of screen.querySelectorAll('[data-score]')) {
    const from = previous.get(node.dataset.score);
    const to = Number(node.textContent);
    if (from === undefined || from === to) continue;
    node.textContent = from;
    changing.push({ node, from, to });
  }
  if (!changing.length) return Promise.resolve();

  const view = screen.ownerDocument.defaultView;
  const start = view.performance.now();
  return new Promise((resolve) => {
    let frame;
    const finish = () => {
      view.cancelAnimationFrame(frame);
      view.clearTimeout(timeout);
      for (const { node, to } of changing) node.textContent = to;
      resolve();
    };
    const update = (now) => {
      const fraction = Math.min(1, (now - start) / duration);
      if (fraction >= 1 || !changing.some(({ node }) => node.isConnected)) {
        finish();
        return;
      }
      const progress = 1 - (1 - fraction) ** 2;
      for (const { node, from, to } of changing) node.textContent = Math.round(from + (to - from) * progress);
      frame = view.requestAnimationFrame(update);
    };
    const timeout = view.setTimeout(finish, duration + MOTION.ms.scoreTimeoutMargin);
    frame = view.requestAnimationFrame(update);
  });
}
