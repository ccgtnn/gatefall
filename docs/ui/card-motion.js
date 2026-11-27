import { MOTION, scaleMotion } from './motion-tokens.js';
import { element } from './dom.js';
import {
  VISUAL_EVENTS, animate, cardFlash, floatingNumber, handRects, moveNeighbors, oldHandPosition, pileAnchor, rects, updateScores,
} from './card-motion-core.js';
import { annihilate, fly, hop, leave, revealOpponentCard, swallow } from './card-motion-card-effects.js';
import { presentHandEvent } from './card-motion-hand.js';
import { hit, lightning, projectile, shield, showActivation } from './card-motion-hit-effects.js';

export function animateLifeLoss(screen, winner, duration) {
  for (const lives of screen.querySelectorAll('[data-life-side]')) {
    if (lives.dataset.lifeSide === winner) continue;
    const live = lives.querySelectorAll('.is-live');
    const stone = live[live.length - 1];
    if (!stone) continue;
    lives.setAttribute('aria-label', 'Жизни ' + (live.length - 1) + '/2');
    if (!duration) {
      stone.textContent = '◇';
      continue;
    }
    stone.classList.add('life-lost');
    const crack = stone.ownerDocument.createElement('span');
    crack.className = 'life-crack';
    stone.append(crack);
    animate(stone, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.18) rotate(-7deg)', opacity: 1, offset: .35 },
      { transform: 'scale(.87) rotate(6deg)', opacity: .44, offset: .66 },
      { transform: 'scale(1)', opacity: .38 },
    ], duration);
    animate(crack, [
      { transform: 'scale(.35)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: .36 },
      { transform: 'scale(1)', opacity: .85 },
    ], duration);
  }
}

export function animateCoin(notice, coin, label, duration, noticeDuration, scale = 1) {
  animate(coin, [
    { transform: 'translateY(9px) rotateY(0deg) scale(.45)', opacity: 0 },
    { transform: 'translateY(-24px) rotateY(435deg) scale(1.12)', opacity: 1, offset: .42 },
    { transform: 'translateY(2px) rotateY(720deg) scale(1.02,.92)', opacity: 1, offset: .81 },
    { transform: 'translateY(0) rotateY(720deg) scale(1)', opacity: 1 },
  ], duration);
  animate(label, [
    { opacity: 0, transform: 'translateY(4px)' },
    { opacity: 0, transform: 'translateY(4px)', offset: .58 },
    { opacity: 1, transform: 'translateY(0)' },
  ], duration);
  return animate(notice, [
    { opacity: 0 },
    { opacity: 1, offset: scaleMotion(MOTION.ms.coinNoticeFadeIn, scale) / noticeDuration },
    { opacity: 1, offset: 1 - scaleMotion(MOTION.ms.coinNoticeFadeOut, scale) / noticeDuration },
    { opacity: 0 },
  ], noticeDuration);
}

export function animateHandTurn(screen, duration) {
  if (!duration) return;
  const cards = screen.querySelectorAll('.battle-hand-cards > .hand-card');
  const step = Math.round(duration * MOTION.pace.handStep);
  cards.forEach((card, index) => {
    card.animate?.([
      { boxShadow: '0 0 0 2px #ffdf4100, 0 0 12px #ffdf4100' },
      { boxShadow: '0 0 0 2px #ffdf41, 0 0 12px #ffdf41c9', offset: .35 },
      { boxShadow: '0 0 0 2px #ffdf4100, 0 0 12px #ffdf4100' },
    ], { delay: index * step, duration: step * MOTION.pace.handPulse, easing: MOTION.ease.cssOut });
  });
}

export function animateTurnSparks(screen, side, duration, scale = 1) {
  if (!duration) return;
  const rows = screen.querySelectorAll(`.field-center > .side[data-side="${side}"] > .board-row`);
  for (const [rowIndex, row] of rows.entries()) {
    for (let index = 0; index < 3; index += 1) {
      const spark = screen.ownerDocument.createElement('span');
      if (!spark.animate) continue;
      spark.className = 'turn-spark';
      spark.setAttribute('aria-hidden', 'true');
      row.append(spark);
      const flight = spark.animate([
        { offsetDistance: '0%', opacity: 0 },
        { offsetDistance: '10%', opacity: 1, offset: .1 },
        { offsetDistance: '82%', opacity: 1, offset: .82 },
        { offsetDistance: '100%', opacity: 0 },
      ], { duration: Math.round(duration * MOTION.pace.turnSparks), delay: (rowIndex + index) * scaleMotion(MOTION.ms.turnSparkStagger, scale) });
      void flight.finished.then(() => spark.remove(), () => spark.remove());
    }
  }
}

export async function presentJournalEvent(screen, event, commit, render, duration) {
  if (event.type === 'draw' || event.type === 'hand-return' || event.type === 'hand-bottom') {
    return presentHandEvent(screen, event, commit, render, duration);
  }
  if (event.type === 'art-state') {
    if (!duration) {
      commit();
      return;
    }
    render(commit());
    const image = rects(screen).get(event.cardId)?.node.querySelector('img.card-art-crop');
    if (image?.decode) await image.decode().catch(() => {});
    return;
  }
  if (event.type === 'coins') {
    render(commit());
    const counter = screen.querySelector(`[data-coins-side="${event.side}"]`);
    if (counter && duration) {
      const delta = event.amount > 0 ? '+' + event.amount : '−' + Math.abs(event.amount);
      await Promise.all(floatingNumber(screen, { rect: counter.getBoundingClientRect() }, delta,
        event.amount > 0 ? 'boost' : 'coin-spend', duration));
    }
    return;
  }
  if (event.type === 'row-effect') {
    render(commit());
    return;
  }
  if (duration === 0 || !VISUAL_EVENTS.has(event.type)) {
    commit();
    return;
  }

  let revealOrigin;
  if (event.type === 'play' && event.side === 'bot') {
    const reveal = await revealOpponentCard(screen, event, duration);
    if (!reveal) return;
    revealOrigin = reveal.origin;
  }

  if (event.type === 'armor' && event.scattered) {
    commit();
    return;
  }
  if (event.scattered && (event.visual !== 'lightning' || event.type === 'damage' || event.blockedDamage)) {
    const entry = rects(screen).get(event.cardId);
    if (event.visual === 'lightning') await lightning(screen, entry, duration * MOTION.pace.lightning);
    else await projectile(screen, event, entry, duration * MOTION.pace.projectile);
    duration *= MOTION.pace.afterProjectile;
  }
  if (event.type === 'consume' && event.grouped) {
    commit();
    return;
  }

  const previous = rects(screen);
  const previousScores = new Map(Array.from(screen.querySelectorAll('[data-score]'),
    (node) => [node.dataset.score, Number(node.textContent)]));
  let origin = revealOrigin;
  if (!origin && event.type === 'play') {
    if (event.from === 'deck' || event.from === 'discard') origin = pileAnchor(screen, event.side, event.from);
    else if (event.side === 'human') origin = oldHandPosition(screen, event.cardId);
  }
  const previousHand = event.type === 'play' ? handRects(screen) : null;
  render(commit());
  const current = rects(screen);
  const entry = current.get(event.cardId);
  const motions = moveNeighbors(previous, current, duration);
  if (previousHand) motions.push(...moveNeighbors(previousHand, handRects(screen), duration));
  motions.push(updateScores(screen, previousScores, duration * MOTION.pace.score));

  switch (event.type) {
    case 'aura-power':
    case 'cleanse':
    case 'transform':
      break;
    case 'play':
      motions.push(...fly(screen, event, current, origin, duration));
      break;
    case 'spawn':
      for (const { id } of event.cards) motions.push(...hop(screen, current.get(id), duration));
      break;
    case 'armor':
      motions.push(...shield(screen, entry, duration));
      break;
    case 'status':
      if (event.status === 'shield') motions.push(...shield(screen, entry, duration));
      if (event.status === 'infection') {
        motions.push(...cardFlash(screen, entry, 'motion-infection', [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' },
          { opacity: .9, transform: 'translate(-50%, -50%) scale(1)', offset: .4 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.12)' },
        ], duration));
        if (event.tick && !event.blocked) motions.push(...floatingNumber(screen, entry, '−1', 'poison', duration));
      }
      break;
    case 'damage':
      motions.push(...hit(screen, entry, event, duration));
      break;
    case 'consume':
      motions.push(...swallow(screen, entry ? [entry] : [], current.get(event.eaterId), duration));
      break;
    case 'consume-group':
      motions.push(...swallow(screen, event.cardIds.map((id) => current.get(id)).filter(Boolean),
        current.get(event.eaterId), duration));
      break;
    case 'boost':
      motions.push(...floatingNumber(screen, entry, '+' + event.amount, 'boost', duration));
      break;
    case 'weaken':
      motions.push(...floatingNumber(screen, entry, '−' + event.amount, 'damage', duration));
      break;
    case 'discard':
    case 'death':
    case 'destroy':
      if (event.visual === 'annihilation') {
        motions.push(...annihilate(screen, previous.get(event.cardId), duration));
      } else if (event.reason !== 'consume') {
        const faction = screen.querySelector('[data-side="' + event.side + '"]')?.dataset.faction;
        motions.push(...leave(screen, previous.get(event.cardId), faction, duration));
      }
      break;
    default:
      motions.push(...showActivation(screen, event, duration));
  }
  await Promise.all(motions);
}

export function roundResultLabel({ scores, winner }) {
  const result = winner === 'human' ? 'Раунд за тобой' : winner === 'bot' ? 'Раунд за противником' : 'Раунд: ничья';
  return `${result} · ${scores.human} : ${scores.bot}`;
}

export async function showRoundTransition(app, round, duration, scale = 1, wait = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))) {
  const overlay = element('div', 'motion-overlay round-transition');
  overlay.setAttribute('role', 'status');
  overlay.append(element('span', 'round-transition-title', `Раунд ${round}`));
  app.append(overlay);
  if (duration) {
    await overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: MOTION.ease.cssOut }).finished;
  }
  await wait(scaleMotion(duration ? MOTION.ms.roundTitle : MOTION.ms.roundTitleReduced, scale));
  return overlay;
}

export function dismissRoundTransition(overlay, duration) {
  if (!duration) {
    overlay.remove();
    return Promise.resolve();
  }
  const fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration, easing: MOTION.ease.cssIn, fill: 'forwards',
  });
  return fade.finished.then(() => overlay.remove(), () => overlay.remove());
}
