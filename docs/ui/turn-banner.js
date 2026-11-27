import { animate, floatNode } from './card-motion-core.js';
import { MOTION } from './motion-tokens.js';
import { burstParticles } from './particles.js';

const banners = new WeakMap();
const compactViewport = '(pointer: coarse), (max-width: 720px), (max-height: 520px)';
const halfField = (screen, side) => screen.querySelector(`.field-center > .side[data-side="${side}"]`);

export function pairsWithTurn(empty, active) {
  return empty?.type === 'turn-start' && empty.empty &&
    active?.type === 'turn-start' && !active.empty && empty.side !== active.side;
}

export function clearTurnBanner(screen) {
  banners.get(screen)?.();
}

function layerFor(screen, field, type, side) {
  const { left, top, width, height } = field.getBoundingClientRect();
  if (!width || !height) return null;
  clearTurnBanner(screen);
  const layer = floatNode(screen, `turn-banner ${type}`, '', { x: left, y: top });
  layer.dataset.side = side;
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
  const remove = () => {
    layer.remove();
    if (banners.get(screen) === remove) banners.delete(screen);
  };
  banners.set(screen, remove);
  return { layer, remove };
}

function bannerPart(layer, className, text) {
  const part = layer.ownerDocument.createElement('div');
  part.className = className;
  part.textContent = text;
  layer.append(part);
  return part;
}

function overlayLength(screen, duration) {
  return screen.ownerDocument.defaultView?.matchMedia?.(compactViewport).matches
    ? Math.min(duration, MOTION.ms.phoneBannerMax)
    : duration;
}

export async function showTurnBanner(screen, event, duration, { skippedSide, compact }) {
  const field = halfField(screen, event.side);
  if (!field?.animate) return false;
  const mode = event.empty ? 'is-skipped' : compact ? 'is-compact' : '';
  const banner = layerFor(screen, field, mode, event.side);
  if (!banner) return false;
  const { layer, remove } = banner;
  const human = event.side === 'human';
  const text = event.empty ? 'ход пропущен'
    : skippedSide ? (human ? 'ПРОТИВНИК СПАСОВАЛ · СНОВА ТВОЙ ХОД' : 'ТЫ СПАСОВАЛ · ХОД ПРОТИВНИКА')
    : human ? 'ТВОЙ ХОД' : 'ХОД ПРОТИВНИКА';
  const ribbon = bannerPart(layer, 'turn-banner-ribbon', '');
  const label = bannerPart(layer, 'turn-banner-label', text);
  const pace = event.empty ? MOTION.pace.skippedTurn : compact ? MOTION.pace.compactTurnBanner : MOTION.pace.turnBanner;
  const total = duration * pace;
  const length = overlayLength(screen, total);

  void animate(ribbon, [
    { transform: 'scaleX(.2)' },
    { transform: 'scaleX(1)', offset: .22 },
    { transform: 'scaleX(1)' },
  ], length);
  void animate(layer, [
    { opacity: 0, transform: 'translateY(0)' },
    { opacity: 1, transform: 'translateY(0)', offset: .22 },
    { opacity: 1, transform: 'translateY(0)', offset: .62 },
    { opacity: 0, transform: 'translateY(-8px)' },
  ], length).finally(remove);
  await animate(label, [
    { transform: 'translateX(-30px)', opacity: 0 },
    { transform: 'translateX(0)', opacity: 1 },
  ], length * MOTION.pace.turnBannerEntrance);
  return true;
}

export function pulsePass(screen, side, duration) {
  const origin = side === 'bot' ? 'translateY(-50%) ' : '';
  const indicator = screen.querySelector(`[data-passed-side="${side}"]`);
  void animate(indicator, [
    { transform: origin + 'scale(1)', opacity: 1 },
    { transform: origin + 'scale(1.2)', opacity: .65, offset: .45 },
    { transform: origin + 'scale(1)', opacity: 1 },
  ], duration * MOTION.pace.passPulse);
}

export async function showPassStamp(screen, side, reason, duration) {
  const field = halfField(screen, side);
  if (!field?.animate) return;
  const banner = layerFor(screen, field, 'is-pass-stamp', side);
  if (!banner) return;
  const { layer, remove } = banner;
  const stamp = bannerPart(layer, 'turn-pass-copy', '');
  bannerPart(stamp, 'turn-pass-title', 'ПАС');
  bannerPart(stamp, 'turn-pass-reason', reason);
  const length = overlayLength(screen, duration * MOTION.pace.passStamp);
  const { left, top, width, height } = field.getBoundingClientRect();
  burstParticles(screen.ownerDocument, 'dust', left + width / 2, top + height / 2, width / 9,
    length * MOTION.pace.landingDust, length * MOTION.pace.passDustDelay);
  await Promise.all([
    animate(field, [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ], MOTION.ms.passShake),
    animate(stamp, [
      { transform: 'scale(1.8) rotate(-8deg)', opacity: 0 },
      { transform: 'scale(.95) rotate(0deg)', opacity: 1, offset: .35 },
      { transform: 'scale(1)', opacity: 1, offset: .52 },
      { transform: 'scale(1)', opacity: 1, offset: .72 },
      { transform: 'scale(1)', opacity: 0 },
    ], length),
  ]).finally(remove);
}

export function pulseTurnAction(screen, duration) {
  const action = screen.querySelector('#pass-button:enabled');
  void animate(action, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.07)', offset: .4 },
    { transform: 'scale(1)' },
  ], duration);
}
