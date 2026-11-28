import { MOTION, respectReducedMotion, scaleMotion } from './motion-tokens.js';
import { element } from './dom.js';
import { burstParticles } from './particles.js';
import {
  VISUAL_EVENTS, animate, cardFlash, center, floatingNumber, handRects, moveNeighbors, oldHandPosition, pileAnchor, rects, takeRememberedRect, updateScores,
} from './card-motion-core.js';
import { annihilate, fly, hop, leave, revealOpponentCard, swallow } from './card-motion-card-effects.js';
import { passReasonText } from './match-log.js';
import { showPassStamp, showTurnBanner, pulsePass, pairsWithTurn } from './turn-banner.js';
import { presentHandEvent } from './card-motion-hand.js';
import { prepareFeedback, showFeedback } from './card-motion-feedback.js';
import { boostImpact, hit, lightning, projectile, shield, showActivation } from './card-motion-hit-effects.js';

const IMAGE_DECODE_TIMEOUT_MS = 300;
const ROUND_ANIMATION_GRACE_MS = 300;

async function waitForVisual(run, timeoutMs) {
  let timer;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([timeout, run()]);
  } catch {
    // Visual effects can be interrupted while the match continues.
  } finally {
    clearTimeout(timer);
  }
}

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

export async function presentJournalEvent(screen, event, commit, render, duration, { next, previous: previousEvent, state } = {}) {
  duration = respectReducedMotion(duration, screen.ownerDocument?.defaultView);
  if (event.type === 'turn-start') {
    const state = commit();
    // The active turn renders the shared banner when the two events are adjacent.
    if (pairsWithTurn(event, next)) return false;
    render(state);
    if (!duration) return false;
    const skippedSide = pairsWithTurn(previousEvent, event) ? previousEvent.side : event.empty ? event.side : undefined;
    if (skippedSide) pulsePass(screen, skippedSide, duration);
    const opponentSide = event.side === 'human' ? 'bot' : 'human';
    const compact = !event.empty && state.players[opponentSide].passed && previousEvent?.type !== 'pass';
    return showTurnBanner(screen, event, duration, { skippedSide, compact });
  }
  if (event.type === 'pass') {
    render(commit());
    if (duration) await showPassStamp(screen, event.side, passReasonText(event.reason), duration);
    return;
  }
  const playRect = event.type === 'play' ? takeRememberedRect(event.cardId) : undefined;
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
    if (image?.decode) await waitForVisual(() => image.decode(), IMAGE_DECODE_TIMEOUT_MS);
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
  if (event.type === 'leader-replaced' && event.identityChanged) {
    render(commit());
    if (!duration) return;
    const portrait = screen.querySelector(`[data-aim-leader="${event.side}"]`);
    await animate(portrait, [
      { opacity: .4, filter: 'brightness(2.6) drop-shadow(0 0 8px #ff6424)' },
      { opacity: 1, filter: 'brightness(1.5) drop-shadow(0 0 4px #ff9d42)', offset: .35 },
      { opacity: 1, filter: 'brightness(1)' },
    ], duration);
    return;
  }
  if (event.type === 'inherit-deathwishes') {
    render(commit());
    return;
  }
  const feedback = duration ? prepareFeedback(screen, event, state) : null;
  if (event.type === 'row-effect' && duration) {
    render(commit());
    if (feedback) showFeedback(screen, event, feedback, duration);
    return;
  }
  if (feedback && !['armor', 'status'].includes(event.type)) {
    render(commit());
    showFeedback(screen, event, feedback, duration);
    return;
  }
  if (!duration || !VISUAL_EVENTS.has(event.type)) {
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
    if (feedback) {
      render(commit());
      showFeedback(screen, event, feedback, duration);
    } else commit();
    return;
  }
  if (event.scattered && (event.type === 'damage' || event.blockedDamage ||
      !['firestorm', 'lightning'].includes(event.visual))) {
    const entry = rects(screen).get(event.cardId);
    if (event.visual === 'lightning') await lightning(screen, entry, duration * MOTION.pace.lightning);
    else await projectile(screen, event, entry, duration * (event.visual === 'firestorm'
      ? MOTION.pace.firestormDrop : MOTION.pace.projectile));
    duration *= MOTION.pace.afterProjectile;
  }
  if (event.type === 'consume' && event.grouped) {
    commit();
    return;
  }

  const previous = rects(screen);
  const previousScores = new Map(Array.from(screen.querySelectorAll('[data-score]'),
    (node) => [node.dataset.score, Number(node.textContent)]));
  let origin = playRect ? center(playRect) : revealOrigin;
  if (!origin && event.type === 'play') {
    if (event.from === 'deck' || event.from === 'discard') origin = pileAnchor(screen, event.side, event.from);
    else if (event.side === 'human') origin = oldHandPosition(screen, event.cardId);
  }
  const previousHand = event.type === 'play' ? handRects(screen) : null;
  render(commit());
  const current = rects(screen);
  const entry = current.get(event.cardId);
  if (feedback) showFeedback(screen, event, feedback, duration);
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
      if (feedback?.kind !== 'armor-break') motions.push(...shield(screen, entry, duration));
      break;
    case 'status':
      if (event.status === 'shield') motions.push(...shield(screen, entry, duration));
      if (event.visual === 'firestorm' && event.blockedDamage) {
        motions.push(...floatingNumber(screen, entry, '−1', 'damage', duration));
      }
      if (event.status === 'infection') {
        motions.push(...cardFlash(screen, entry, 'motion-infection', [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' },
          { opacity: .9, transform: 'translate(-50%, -50%) scale(1)', offset: .4 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.12)' },
        ], duration));
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
      motions.push(...boostImpact(screen, entry, event.amount, duration));
      break;
    case 'weaken':
      motions.push(...floatingNumber(screen, entry, '−' + event.amount, 'damage', duration));
      break;
    case 'discard':
    case 'banish':
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

export function animateRoundWinner(screen, winner, duration) {
  if (!duration || !winner) return;
  const score = screen.querySelector(`[data-score="${winner}"]`);
  if (!score) return;
  const time = duration * MOTION.pace.roundWinner;
  void animate(score, [
    { scale: '1', filter: 'brightness(1)' },
    { scale: '1.24', filter: 'brightness(1.8) drop-shadow(0 0 8px #ffda72)', offset: .29 },
    { scale: '1', filter: 'brightness(1)' },
  ], time);
  const at = center(score.getBoundingClientRect());
  const wreath = floatNode(screen, 'motion-round-wreath', '❦', { x: at.x, y: score.getBoundingClientRect().top });
  void animate(wreath, [
    { transform: 'translate(-50%, -40%) scale(.7)', opacity: 0 },
    { transform: 'translate(-50%, -93%) scale(1.18)', opacity: 1, offset: .32 },
    { transform: 'translate(-50%, -118%) scale(1)', opacity: 0 },
  ], time).finally(() => wreath.remove());
}

export function animateMatchResult(screen, result, duration) {
  if (!duration || (result !== 'win' && result !== 'loss')) return;
  const heading = screen.querySelector('.match-result-heading');
  if (!heading) return;
  const won = result === 'win';
  const time = duration * (won ? MOTION.pace.matchWin : MOTION.pace.matchLoss);
  const glow = won ? '#ffcb54' : '#a691be';
  void animate(heading, [
    { opacity: .25, transform: 'scale(.85)', textShadow: '0 0 0 transparent' },
    { opacity: 1, transform: won ? 'scale(1.1)' : 'scale(1.02)', textShadow: `0 0 24px ${glow}`, offset: .3 },
    { opacity: 1, transform: 'scale(1)', textShadow: '0 0 0 transparent' },
  ], time);
  const rect = heading.getBoundingClientRect();
  const { x, y } = center(rect);
  if (won) burstParticles(screen.ownerDocument, 'gold', x, y, rect.width, time);
  else {
    const shade = floatNode(screen, 'motion-match-shade', '', { x: 0, y: 0 });
    void animate(shade, [{ opacity: .55 }, { opacity: .3, offset: .36 }, { opacity: 0 }], time)
      .finally(() => shade.remove());
  }
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
    await waitForVisual(() => overlay.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration, easing: MOTION.ease.cssOut,
    }).finished, duration + ROUND_ANIMATION_GRACE_MS);
  }
  await wait(scaleMotion(duration ? MOTION.ms.roundTitle : MOTION.ms.roundTitleReduced, scale));
  return overlay;
}

export async function dismissRoundTransition(overlay, duration) {
  if (duration) {
    await waitForVisual(() => overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration, easing: MOTION.ease.cssIn, fill: 'forwards',
    }).finished, duration + ROUND_ANIMATION_GRACE_MS);
  }
  overlay.remove();
}
