import { animate, center, floatingNumber, floatNode, rects, visibleRect } from './card-motion-core.js';
import { fly } from './card-motion-card-effects.js';
import { impactFlash } from './card-motion-hit-effects.js';
import { MOTION } from './motion-tokens.js';
import { burstParticles } from './particles.js';

// The journal records several effect triggers as status changes.
export function feedbackKind(event) {
  if (event.type === 'armor' && event.amount < 0 && event.armor === 0) return 'armor-break';
  if (event.type === 'status' && event.status === 'target' && event.amount > 0) return 'target-marked';
  if (event.type === 'status' && event.status === 'infection' && event.tick && !event.blocked) return 'power-loss';
  return event.type;
}

export function weatherApplied(event, state) {
  if (!event.effect) return false;
  const previous = state?.players?.[event.side]?.rowEffects?.[event.row];
  return previous?.type !== event.effect.type || previous.remaining < event.effect.remaining;
}

const feedbackEvents = new Set([
  'heal', 'armor-break', 'capture', 'target-marked', 'row-effect', 'power-loss', 'growth', 'counter', 'order-ready',
]);

const badges = { 'armor-break': '.armor-stat', counter: '.counter-stat', 'order-ready': '.unit-order' };

export function prepareFeedback(screen, event, state) {
  const kind = feedbackKind(event);
  if (!feedbackEvents.has(kind)) return;
  const { side, cardId, row } = event;
  const player = state?.players?.[side];
  const card = player && (kind === 'heal' || kind === 'growth')
    ? Object.values(player.board).flat().find(({ id }) => id === cardId)
    : undefined;
  const unit = cardId && (kind === 'capture' || badges[kind])
    ? screen.querySelector(`[data-board-card="${CSS.escape(cardId)}"]`)
    : null;
  const badge = badges[kind] && unit?.querySelector(badges[kind]);
  return {
    kind, power: card?.power, growth: card?.growth, applied: kind === 'row-effect' && weatherApplied(event, state),
    origin: kind === 'capture' && visibleRect(unit),
    badge: visibleRect(badge),
    brokenArmor: kind === 'armor-break' && badge?.cloneNode(true),
  };
}

export function showFeedback(screen, event, feedback, duration) {
  const { kind, power, growth, applied, origin, badge, brokenArmor } = feedback;
  duration *= MOTION.pace.journalFeedback;
  if (kind === 'row-effect') {
    if (!applied) return;
    const node = screen.querySelector?.(`[data-side="${event.side}"] [data-row="${event.row}"]`);
    const rect = visibleRect(node);
    if (!rect) return;
    const wave = floatNode(screen, 'motion-weather-wave', '', center(rect));
    wave.dataset.weather = event.effect.type;
    wave.style.width = rect.width + 'px';
    wave.style.height = rect.height + 'px';
    void animate(wave, [
      { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
      { opacity: 1, clipPath: 'inset(0 22% 0 0)', offset: .48 },
      { opacity: 0, clipPath: 'inset(0 0 0 0)' },
    ], duration).finally(() => wave.remove());
    return;
  }
  const current = rects(screen);
  const entry = current.get(event.cardId);
  if (!entry) return;
  const badgeRect = badges[kind] && (visibleRect(entry.node.querySelector(badges[kind])) ?? badge);
  switch (kind) {
    case 'capture':
      if (origin) fly(screen, event, current, center(origin), duration);
      break;
    case 'armor-break': {
      const rect = badge ?? entry.rect;
      const { x, y } = center(rect);
      if (brokenArmor && badge) {
        const icon = floatNode(screen, 'motion-broken-armor', '', { x, y });
        icon.style.width = badge.width + 'px';
        icon.append(brokenArmor);
        void animate(icon, [
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          { opacity: .9, transform: 'translate(-50%, -50%) scale(1.16)', offset: .26 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(.84)' },
        ], duration).finally(() => icon.remove());
      }
      burstParticles(screen.ownerDocument, 'shards', x, y, rect.width, duration);
      impactFlash(screen, { rect }, 'motion-hit-crack', duration);
      break;
    }
    case 'target-marked':
      impactFlash(screen, entry, 'motion-target-mark', duration);
      break;
    case 'power-loss': {
      const drop = floatNode(screen, 'motion-infection-drop', '', center(entry.rect));
      void animate(drop, [
        { opacity: 0, transform: 'translate(-50%, -120%) scale(.6) rotate(45deg)' },
        { opacity: 1, transform: 'translate(-50%, -25%) scale(1) rotate(45deg)', offset: .44 },
        { opacity: 0, transform: 'translate(-50%, 90%) scale(.6) rotate(45deg)' },
      ], duration).finally(() => drop.remove());
      // The infection status tick records the new power and always removes one point.
      const loss = event.amount < 0 ? -event.amount : event.amount ?? 1;
      floatingNumber(screen, entry, '−' + loss, 'poison', duration);
      break;
    }
    case 'heal':
    case 'growth': {
      const delta = event.amount ?? (kind === 'heal'
        ? event.power - (power ?? event.power)
        : event.growth - (growth ?? 0));
      if (delta > 0) {
        impactFlash(screen, entry, 'motion-heal', duration);
        floatingNumber(screen, entry, '+' + delta, 'boost', duration);
      }
      break;
    }
    case 'counter':
    case 'order-ready':
      if (badgeRect) impactFlash(screen, { rect: badgeRect },
        kind === 'counter' ? 'motion-counter-pulse' : 'motion-order-glint', duration);
      break;
  }
}
