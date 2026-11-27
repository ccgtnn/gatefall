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
  if (!source) return Promise.resolve();
  const from = center(source.getBoundingClientRect());
  const to = center(entry.rect);
  const shot = floatNode(screen, 'motion-projectile', '', from);
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

export function hit(screen, entry, event, duration) {
  if (!entry) return [];
  const { node, rect } = entry;
  const motions = [animate(node.querySelector('.unit-face'), [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-4px) rotate(-2deg)', offset: .17 },
    { transform: 'translateX(4px) rotate(2deg)', offset: .34 },
    { transform: 'translateX(-2px)', offset: .56 },
    { transform: 'translateX(0)' },
  ], duration)];
  motions.push(...cardFlash(screen, entry, 'motion-scratches', [
    { transform: 'translate(-50%, -50%) scale(.95)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.03)', opacity: 1, offset: .23 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ], duration));
  if (event.absorbed && !node.querySelector('.armor-stat')) {
    const { x, y } = center(rect);
    burstParticles(screen.ownerDocument, 'shards', x, y, rect.width, duration);
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
