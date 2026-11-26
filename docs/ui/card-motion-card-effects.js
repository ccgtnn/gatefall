import { burstParticles } from './particles.js';
import { animate, cardFlash, center, floatingCard, ghostCard, point } from './card-motion-core.js';

export async function revealOpponentCard(screen, event, duration) {
  const field = screen.querySelector('.side[data-side="bot"]');
  if (!field) return true;
  const view = screen.ownerDocument.defaultView;
  if (view.getComputedStyle(field).visibility === 'hidden') return true;
  const { right, top, height } = field.getBoundingClientRect();
  const card = floatingCard(screen, event, 'motion-opponent-reveal', {
    x: right - 8,
    y: top + height / 2,
  }, true);
  const label = screen.ownerDocument.createElement('span');
  label.className = 'opponent-reveal-name';
  label.textContent = event.name;
  card.append(label);

  try {
    await animate(card, [
      { transform: 'translate(-34%, -50%) scale(.9)', opacity: 0 },
      { transform: 'translate(-100%, -50%) scale(1)', opacity: 1, offset: 1 / 6 },
      { transform: 'translate(-100%, -50%) scale(1)', opacity: 1, offset: 5 / 6 },
      { transform: 'translate(-93%, -50%) scale(.96)', opacity: 0 },
    ], duration * 4.2);
    return card.isConnected && field.isConnected;
  } finally {
    card.remove();
  }
}

export function fly(screen, event, current, handOrigin, duration) {
  const target = current.get(event.cardId);
  const field = screen.querySelector('.field-center');
  if (!target && !field) return [];
  const destination = center(target?.rect ?? field.getBoundingClientRect());
  const view = screen.ownerDocument.defaultView;
  const from = handOrigin ?? { x: destination.x, y: -30 };
  const startY = Math.max(-40, Math.min(view.innerHeight + 40, from.y));
  const card = floatingCard(screen, event, 'motion-flight', destination);
  const slide = (factor) => point((from.x - destination.x) * factor, (startY - destination.y) * factor);
  const motion = animate(card, [
    { transform: 'translate(-50%, -50%) ' + slide(1) + ' scale(.92)', opacity: .3 },
    { transform: 'translate(-50%, -50%) ' + slide(.30) + ' scale(1)', opacity: 1, offset: .63 },
    { transform: 'translate(-50%, -50%) scale(' + (target ? '.36' : '.96') + ')', opacity: target ? .1 : 0 },
  ], duration).finally(() => card.remove());
  if (!target) return [motion];
  const { rect, node } = target;
  burstParticles(screen.ownerDocument, 'dust', destination.x, rect.bottom - 2, rect.width,
    duration * .5, duration * .53);
  return [motion, animate(node, [
    { opacity: 0, transform: 'scale(.88)' },
    { opacity: 0, transform: 'scale(.88)', offset: .55 },
    { opacity: 1, transform: 'translateY(3px) scale(1.08,.87)', offset: .66 },
    { opacity: 1, transform: 'translateY(-3px) scale(.98,1.07)', offset: .81 },
    { opacity: 1, transform: 'scale(1)' },
  ], duration)];
}


export function leave(screen, entry, faction, duration) {
  if (!entry) return [];
  const clone = ghostCard(screen, entry);
  const growth = faction === 'growth';
  const at = center(entry.rect);
  burstParticles(screen.ownerDocument, growth ? 'slime' : 'sparks', at.x, at.y, entry.rect.width,
    duration * .78, duration * .18);
  return [animate(clone, growth ? [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: .7, transform: 'translateY(3px) scale(.94,.84)', offset: .4 },
    { opacity: 0, transform: 'translateY(22px) scale(.54,.14)' },
  ] : [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: .78, transform: 'scale(1.03)', offset: .2 },
    { opacity: 0, transform: 'translateY(5px) scale(.72)' },
  ], duration).finally(() => clone.remove()), animate(clone.querySelector('.unit-face'), [
    { opacity: 1 }, { opacity: growth ? .58 : .28, offset: .42 }, { opacity: 0 },
  ], duration)];
}

export function annihilate(screen, entry, duration) {
  if (!entry) return [];
  const { rect } = entry;
  const { x, y } = center(rect);
  const clone = ghostCard(screen, entry);
  burstParticles(screen.ownerDocument, 'starlight', x, y, rect.width, duration * .8, duration * .18);
  return [
    animate(clone, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: .9, transform: 'scale(1.06)', offset: .2 },
      { opacity: 0, transform: 'scale(.75)', offset: .65 },
      { opacity: 0, transform: 'scale(.75)' },
    ], duration).finally(() => clone.remove()),
    ...cardFlash(screen, entry, 'motion-annihilation', [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.35)' },
      { opacity: .94, transform: 'translate(-50%, -50%) scale(1.1)', offset: .24 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.45)' },
    ], duration),
  ];
}

export function swallow(screen, victims, eater, duration) {
  if (!victims.length || !eater) return [];
  const to = center(eater.rect);
  const flights = victims.map((victim) => {
    const clone = ghostCard(screen, victim);
    victim.node.style.opacity = '0';
    const from = center(victim.rect);
    const slide = point(to.x - from.x, to.y - from.y);
    return animate(clone, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: .9, transform: slide + ' scale(.27)', offset: .68 },
      { opacity: 0, transform: slide + ' scale(.06)' },
    ], duration).finally(() => clone.remove());
  });
  return [...flights, animate(eater.node.querySelector('.unit-face'), [
    { transform: 'scale(1)' },
    { transform: 'scale(1)', offset: .5 },
    { transform: 'scale(1.17,1.13)', offset: .69 },
    { transform: 'scale(.96)', offset: .86 },
    { transform: 'scale(1)' },
  ], duration)];
}


export function hop(screen, entry, duration) {
  if (!entry) return [];
  const { rect, node } = entry;
  burstParticles(screen.ownerDocument, 'drops', center(rect).x, rect.bottom - 3, rect.width,
    duration * .82, duration * .13);
  return [animate(node, [
    { transform: 'translateY(12px) scale(.43,.28)', opacity: 0 },
    { transform: 'translateY(-9px) scale(.89,1.11)', opacity: 1, offset: .46 },
    { transform: 'translateY(3px) scale(1.13,.88)', opacity: 1, offset: .72 },
    { transform: 'translateY(0) scale(1)', opacity: 1 },
  ], duration)];
}
