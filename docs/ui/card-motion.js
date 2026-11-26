import {
  VISUAL_EVENTS, animate, cardFlash, center, floatingNumber, moveNeighbors, oldHandPosition, rects, updateScores,
} from './card-motion-core.js';
import { annihilate, fly, hop, leave, revealOpponentCard, swallow } from './card-motion-card-effects.js';
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

export function animateCoin(notice, coin, label, duration, noticeDuration) {
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
    { opacity: 1, offset: 170 / noticeDuration },
    { opacity: 1, offset: 1 - 250 / noticeDuration },
    { opacity: 0 },
  ], noticeDuration);
}

export function animateHandTurn(screen, duration) {
  if (!duration) return;
  const cards = screen.querySelectorAll('.battle-hand-cards > .hand-card');
  const step = Math.round(duration / 6);
  cards.forEach((card, index) => {
    card.animate?.([
      { boxShadow: '0 0 0 2px #ffdf4100, 0 0 12px #ffdf4100' },
      { boxShadow: '0 0 0 2px #ffdf41, 0 0 12px #ffdf41c9', offset: .35 },
      { boxShadow: '0 0 0 2px #ffdf4100, 0 0 12px #ffdf4100' },
    ], { delay: index * step, duration: step * 2, easing: 'ease-out' });
  });
}

export function animateTurnSparks(screen, side, duration) {
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
      ], { duration: Math.round(duration * 1.8), delay: (rowIndex + index) * 35 });
      void flight.finished.then(() => spark.remove(), () => spark.remove());
    }
  }
}

export async function presentJournalEvent(screen, event, commit, render, duration) {
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

  if (event.type === 'play' && event.side === 'bot' && !(await revealOpponentCard(screen, event, duration))) return;

  if (event.type === 'armor' && event.scattered) {
    commit();
    return;
  }
  if (event.scattered && (event.visual !== 'lightning' || event.type === 'damage' || event.blockedDamage)) {
    const entry = rects(screen).get(event.cardId);
    if (event.visual === 'lightning') await lightning(screen, entry, duration * .54);
    else await projectile(screen, event, entry, duration * .43);
    duration *= .52;
  }
  if (event.type === 'consume' && event.grouped) {
    commit();
    return;
  }

  const previous = rects(screen);
  const previousScores = new Map(Array.from(screen.querySelectorAll('[data-score]'),
    (node) => [node.dataset.score, Number(node.textContent)]));
  const pile = event.from ? screen.querySelector('[data-pile-side="' + event.side + '"][data-pile="' + event.from + '"]') : null;
  const origin = pile ? center(pile.getBoundingClientRect())
    : event.type === 'play' && event.side === 'human' ? oldHandPosition(screen, event.cardId) : null;
  render(commit());
  const current = rects(screen);
  const entry = current.get(event.cardId);
  const motions = moveNeighbors(previous, current, duration);
  motions.push(updateScores(screen, previousScores, duration * .88));

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
