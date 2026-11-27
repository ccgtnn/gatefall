import { cardBack } from './card-back.js';
import {
  animate, center, copyCardFace, floatingCard, floatingNumber, floatNode, handRects, moveNeighbors, pileAnchor,
  point, takeRememberedRect, visibleRect,
} from './card-motion-core.js';
import { MOTION } from './motion-tokens.js';

const { arc, flipStart, flipEnd, revealAt, landAt, squeezeX, squeezeY, botWidth, botHeight, counterPulse } = MOTION.hand;

function animateFlight(node, keyframes, duration, delay) {
  if (!node.isConnected || !node.animate) return Promise.resolve();
  const motion = node.animate(keyframes, { duration, delay, easing: MOTION.ease.draw, fill: 'both' });
  return motion.finished.catch(() => {}).finally(() => motion.cancel());
}

function flightCard(screen, faction, { width, height }, start, face) {
  const overlay = floatNode(screen, 'motion-draw', '', { x: start.x - width / 2, y: start.y - height / 2 });
  overlay.style.width = width + 'px';
  overlay.style.height = height + 'px';
  const flip = screen.ownerDocument.createElement('div');
  flip.className = 'motion-draw-flip';
  const back = cardBack(faction, 'motion-draw-back');
  if (face) {
    face.classList.add('motion-draw-face');
    flip.append(face);
  } else {
    flip.classList.add('motion-draw-back-only');
  }
  if (back) flip.append(back);
  overlay.append(flip);
  return { overlay, flip };
}

async function fly(screen, faction, size, start, end, duration, delay, { face, landing, returning } = {}) {
  const { overlay, flip } = flightCard(screen, faction, size, start, face);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fromAngle = returning ? 0 : 180;
  const toAngle = returning ? 180 : 0;
  const motions = [animateFlight(overlay, [
    { transform: point(0, 0), opacity: 1 },
    { transform: point(dx / 2, dy / 2 - arc), opacity: 1, offset: .5 },
    { transform: point(dx, dy), opacity: 1, offset: revealAt },
    { transform: point(dx, dy) + (landing ? ` scale(${squeezeX}, ${squeezeY})` : ''), opacity: landing ? 0 : 1, offset: landAt },
    { transform: point(dx, dy), opacity: landing || !face ? 0 : 1 },
  ], duration, delay)];
  if (face) motions.push(animateFlight(flip, [
    { transform: `rotateY(${fromAngle}deg)` },
    { transform: `rotateY(${fromAngle}deg)`, offset: flipStart },
    { transform: `rotateY(${toAngle}deg)`, offset: flipEnd },
    { transform: `rotateY(${toAngle}deg)` },
  ], duration, delay));
  if (landing) motions.push(animateFlight(landing, [
    { opacity: 0, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(1)', offset: revealAt },
    { opacity: 1, transform: `scale(${squeezeX}, ${squeezeY})`, offset: landAt },
    { opacity: 1, transform: 'scale(1)' },
  ], duration, delay));
  await Promise.all(motions).finally(() => overlay.remove());
}

function drawTiming(base, count, opponent) {
  const { pace, ms } = MOTION;
  const feedback = opponent ? Math.min(base * pace.drawFeedback, ms.drawMax * pace.drawFeedback / (pace.draw + pace.drawFeedback)) : 0;
  const duration = Math.min(base * pace.draw, ms.drawMax - feedback);
  const step = count > 1 ? Math.min(base * pace.drawStep, (ms.drawMax - feedback - duration) / (count - 1)) : 0;
  return { duration, step, feedback };
}

export async function presentHandEvent(screen, event, commit, render, base) {
  const { type, reason, side, cardId, count, cards } = event;
  if (!base || reason === 'round' || !screen.isConnected) {
    if (type !== 'draw') takeRememberedRect(cardId);
    commit();
    return;
  }

  const drawing = type === 'draw';
  const opponent = side === 'bot';
  const previous = opponent ? null : handRects(screen);
  const origin = drawing ? pileAnchor(screen, side, 'deck') : null;
  const remembered = drawing ? null : takeRememberedRect(cardId);
  const leaving = previous?.get(cardId);
  if (leaving && remembered) leaving.rect = remembered;
  const state = commit();
  render(state);
  if (!screen.isConnected) return;

  const player = state.players[side];
  const faction = player.factionId;
  const counter = opponent ? [...screen.querySelectorAll('.bot-hand-count, .field-hand-stack[data-hand-side="bot"]')]
    .find((node) => node.isConnected && visibleRect(node)) : null;
  const counterEntry = counter ? { rect: visibleRect(counter) } : null;
  const current = opponent ? null : handRects(screen);
  if (!drawing) {
    const duration = base * MOTION.pace.handReturn;
    const target = pileAnchor(screen, side, 'deck');
    const motions = current ? moveNeighbors(previous, current, duration) : [];
    const rect = leaving?.rect ?? remembered;
    if (rect?.width && rect.height && target) {
      const card = !leaving && player.deck.find(({ id }) => id === cardId);
      const face = leaving ? copyCardFace(screen, leaving.node)
        : card ? floatingCard(screen, { card, side, name: card.definition.name }, 'motion-draw-fallback', { x: 0, y: 0 }) : null;
      motions.push(fly(screen, faction, rect, center(rect), target, duration, 0, { face, returning: true }));
    } else if (opponent && counterEntry && target) {
      motions.push(fly(screen, faction, { width: botWidth, height: botHeight }, center(counterEntry.rect), target, duration, 0));
    }
    await Promise.all(motions);
    return;
  }

  const { duration, step, feedback } = drawTiming(base, count, opponent);
  if (opponent) {
    if (!origin || !counterEntry || !count) return;
    const target = center(counterEntry.rect);
    await Promise.all(Array.from({ length: count }, (_, index) =>
      fly(screen, faction, { width: botWidth, height: botHeight }, origin, target, duration, index * step)));
    if (!screen.isConnected || !counter.isConnected) return;
    await Promise.all([
      ...floatingNumber(screen, counterEntry, '+' + count, 'boost', feedback),
      animate(counter, [
        { transform: 'scale(1)' }, { transform: `scale(${counterPulse})` }, { transform: 'scale(1)' },
      ], feedback),
    ]);
    return;
  }

  const motions = moveNeighbors(previous, current, duration);
  if (origin) {
    for (const [index, { id }] of (cards ?? []).entries()) {
      const entry = current.get(id);
      if (!entry?.node.isConnected || !entry.rect.width || !entry.rect.height || previous.has(id)) continue;
      const face = copyCardFace(screen, entry.node);
      motions.push(fly(screen, faction, entry.rect, origin, center(entry.rect), duration, index * step,
        { face, landing: entry.node }));
    }
  }
  await Promise.all(motions);
}
