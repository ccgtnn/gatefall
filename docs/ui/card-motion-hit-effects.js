import { impactTier, MOTION } from './motion-tokens.js';
import { burstParticles } from './particles.js';
import { animate, cardFlash, center, floatingNumber, floatNode, point } from './card-motion-core.js';

export function shield(screen, entry, duration) {
  return cardFlash(screen, entry, 'motion-shield-outline', [
    { transform: 'translate(-50%, -50%) scale(.92)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.02)', opacity: .95, offset: .27 },
    { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 0 },
  ], duration);
}

function orbitalBeam(screen, rect, duration) {
  const { x, y } = center(rect);
  const beam = floatNode(screen, 'motion-orbital-beam', '', { x, y: 0 });
  beam.style.height = Math.max(1, y) + 'px';
  return animate(beam, [
    { transform: 'translateX(-50%) scale(.3,0)', opacity: 0 },
    { transform: 'translateX(-50%) scale(1,1)', opacity: 1, offset: .27 },
    { transform: 'translateX(-50%) scale(.2,1)', opacity: 0 },
  ], duration).finally(() => beam.remove());
}

export function projectile(screen, event, entry, duration) {
  if (!entry) return Promise.resolve();
  const sourceCard = event.sourceId ? screen.querySelector(`[data-board-card="${CSS.escape(event.sourceId)}"]`) : null;
  const sourceLine = screen.querySelector('[data-side="' + event.attacker + '"] [data-row="' + event.sourceRow + '"]');
  const floor = screen.querySelector('.field-center');
  const source = sourceCard ?? sourceLine ?? floor;
  const firestorm = event.visual === 'firestorm';
  if (!source && !firestorm) return Promise.resolve();
  const to = center(entry.rect);
  const from = firestorm ? { x: to.x, y: 0 } : center(source.getBoundingClientRect());
  const shot = floatNode(screen, firestorm ? 'motion-projectile motion-firestorm-drop' : 'motion-projectile', '', from);
  return animate(shot, [
    { transform: point(0, 0) + ' scale(.65)', opacity: .8 },
    { transform: point(to.x - from.x, to.y - from.y) + ' scale(1.2)', opacity: 1 },
  ], duration).finally(() => shot.remove());
}

export function lightning(screen, entry, duration) {
  if (!entry) return Promise.resolve();
  const bolt = floatNode(screen, 'motion-lightning', '', center(entry.rect));
  return animate(bolt, [
    { opacity: 0, transform: 'translate(-50%, -100%) scaleY(.8)' },
    { opacity: .95, transform: 'translate(-50%, -100%) scaleY(1)', offset: .28 },
    { opacity: 0, transform: 'translate(-50%, -100%) scaleY(1)' },
  ], duration).finally(() => bolt.remove());
}

function recoil(node, distance, tilt, duration, peak = 1) {
  return animate(node, [
    { transform: 'translateX(0)' },
    { transform: `translateX(${-distance}px) rotate(${-tilt}deg) scale(${peak})`, offset: .17 },
    { transform: `translateX(${distance}px) rotate(${tilt}deg) scale(${peak})`, offset: .34 },
    { transform: `translateX(${-distance / 2}px)`, offset: .56 },
    { transform: 'translateX(0)' },
  ], duration);
}

export function impactFlash(screen, entry, kind, duration) {
  return cardFlash(screen, entry, kind, [
    { transform: 'translate(-50%, -50%) scale(.9)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 0 },
  ], duration);
}

export function boostImpact(screen, entry, amount, duration) {
  const motions = floatingNumber(screen, entry, '+' + amount, 'boost', duration);
  const tier = impactTier(amount);
  if (!entry || tier === 'light') return motions;
  const peak = tier === 'heavy' ? 1.12 : 1.06;
  motions.push(recoil(entry.node.querySelector('.unit-face'), tier === 'heavy' ? 5 : 3, 0, duration, peak));
  if (tier === 'heavy') {
    motions.push(recoil(entry.node.closest('.row-line'), 4, 0, duration * MOTION.pace.rowRecoil));
    motions.push(...impactFlash(screen, entry, 'motion-heal', duration));
  }
  return motions;
}

export function hit(screen, entry, event, duration) {
  if (!entry) return [];
  const { node, rect } = entry;
  const tier = impactTier(event.amount);
  const motions = [recoil(node.querySelector('.unit-face'), { light: 4, medium: 6, heavy: 9 }[tier],
    { light: 2, medium: 3, heavy: 5 }[tier], duration)];
  if (tier === 'heavy') {
    motions.push(recoil(node.closest('.row-line'), 4, 0, duration * MOTION.pace.rowRecoil));
    motions.push(...impactFlash(screen, entry, 'motion-heavy-hit', duration));
  }
  if (event.power === 0) motions.push(...impactFlash(screen, entry, 'motion-hit-crack', duration));
  motions.push(...cardFlash(screen, entry, 'motion-scratches', [
    { transform: 'translate(-50%, -50%) scale(.95)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.03)', opacity: 1, offset: .23 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ], duration));
  if (event.visual === 'firestorm') {
    const { x, y } = center(rect);
    burstParticles(screen.ownerDocument, 'sparks', x, y, rect.width, duration);
  }
  if (event.sourceDefinitionId === 'orbital-salvo') motions.push(orbitalBeam(screen, rect, duration));
  motions.push(...floatingNumber(screen, entry, '−' + event.amount, 'damage', duration));
  return motions;
}


export function showActivation(screen, event, duration) {
  const field = screen.querySelector('.field-center');
  if (!field) return [];
  const labels = { deathwish: 'Завещание', leader: 'Лидер', order: 'Приказ' };
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
