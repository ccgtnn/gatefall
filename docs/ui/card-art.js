import { assetUrl } from './asset-url.js';
import { motionDuration } from './turn-playback.js';
import { setCardRarity } from './dom.js';

export const PREMIUM_ART_KEY = 'gatefall.premium-card-art';
const clips = new Map([
  ['synaptic-parasite', { small: 'synaptic-parasite-hand.mp4', large: 'synaptic-parasite-preview.mp4' }],
  ['carrion-devourer', { small: 'carrion-devourer-card.mp4', large: 'carrion-devourer-preview.mp4' }],
  ['falura', { small: 'falura-card.mp4', large: 'falura-preview.mp4' }],
  ['world-gates', { small: 'world-gates-card.mp4', large: 'world-gates-preview.mp4' }],
  ['great-sacrifice', { small: 'great-sacrifice-card.mp4', large: 'great-sacrifice-preview.mp4' }],
  ['abyss-shepherd', { small: 'abyss-shepherd-card.mp4', large: 'abyss-shepherd-preview.mp4' }],
  ['ulmarin-awakening', { small: 'ulmarin-awakening-card.mp4', large: 'ulmarin-awakening-preview.mp4' }],
  ['genome-keeper', { small: 'genome-keeper-card.mp4', large: 'genome-keeper-preview.mp4' }],
  ['xylaris-bloom', { small: 'xylaris-bloom-card.mp4', large: 'xylaris-bloom-preview.mp4' }],
  ['hound-good-deal', { small: 'hound-good-deal-card.mp4', large: 'hound-good-deal-preview.mp4' }],
  ['whisper-interpreter', { small: 'whisper-interpreter-card.mp4', large: 'whisper-interpreter-preview.mp4' }],
  ['forbidden-scroll-keeper', { small: 'forbidden-scroll-keeper-card.mp4', large: 'forbidden-scroll-keeper-preview.mp4' }],
  ['ulmarin-large-tentacle', { small: 'ulmarin-large-tentacle-card.mp4', large: 'ulmarin-large-tentacle-preview.mp4' }],
  ['altar-guardian', { small: 'altar-guardian-card.mp4', large: 'altar-guardian-preview.mp4' }],
  ['ulmarin-sleeper', { small: 'ulmarin-sleeper-card.mp4', large: 'ulmarin-sleeper-preview.mp4' }],
  ['call-of-the-deep', { small: 'call-of-the-deep-card.mp4', large: 'call-of-the-deep-preview.mp4' }],
  ['ulmarin-tentacle', { small: 'ulmarin-tentacle-card.mp4', large: 'ulmarin-tentacle-preview.mp4' }],
  ['ulmarin-fanatic', { small: 'ulmarin-fanatic-card.mp4', large: 'ulmarin-fanatic-preview.mp4' }],
  ['cult-dreamer', { small: 'cult-dreamer-card.mp4', large: 'cult-dreamer-preview.mp4' }],
  ['mind-strike', { small: 'mind-strike-card.mp4', large: 'mind-strike-preview.mp4' }],
]);
let premiumEnabled = false;
const premiumOverrides = new Map();
try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(PREMIUM_ART_KEY) ?? 'null');
  premiumEnabled = saved?.enabled === true;
  const entries = Array.isArray(saved) ? saved.map((id) => [id, true]) : Object.entries(saved?.overrides ?? {});
  for (const [id, enabled] of entries) {
    if (clips.has(id) && typeof enabled === 'boolean' && enabled !== premiumEnabled) premiumOverrides.set(id, enabled);
  }
} catch {}

export function hasPremiumArt(id) { return clips.has(id); }
export function usesPremiumArt(id) { return hasPremiumArt(id) && (premiumOverrides.get(id) ?? premiumEnabled); }
export function premiumArtEnabled() { return premiumEnabled; }

function savePremiumArt(id) {
  const settings = { enabled: premiumEnabled, overrides: Object.fromEntries(premiumOverrides) };
  try { globalThis.localStorage?.setItem(PREMIUM_ART_KEY, JSON.stringify(settings)); } catch {}
  if (globalThis.document) refreshPremiumArt(document, id);
}

export function selectPremiumArt(id, enabled) {
  if (!hasPremiumArt(id)) return;
  if (enabled === premiumEnabled) premiumOverrides.delete(id);
  else premiumOverrides.set(id, enabled);
  savePremiumArt(id);
}

export function setPremiumArtEnabled(enabled) {
  premiumEnabled = enabled;
  premiumOverrides.clear();
  savePremiumArt();
}

function playPremium(id, doc) {
  const speed = doc?.getElementById?.('app')?.dataset.animationSpeed ?? 'system';
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  return usesPremiumArt(id) && Boolean(motionDuration(speed, reduced));
}

function artwork(id, poster, className, size, doc, { animated = playPremium(id, doc), lazyArt = false, focus, zoom } = {}) {
  const node = doc.createElement(animated ? 'video' : 'img');
  node.className = className;
  node.width = 480;
  node.height = 720;
  node.draggable = false;
  if (focus) {
    node.style.objectPosition = focus;
    node.style.transformOrigin = focus;
    node.style.scale = zoom ?? '1';
  }
  if (hasPremiumArt(id)) {
    node.dataset.premiumCard = id;
    node.dataset.premiumPoster = poster;
    node.dataset.premiumSize = size;
    if (lazyArt) node.dataset.premiumLazyArt = '';
  }
  if (!animated) {
    if (lazyArt) node.loading = 'lazy';
    node.src = poster;
    node.alt = '';
    return node;
  }
  node.classList.add('card-art-video');
  node.poster = poster;
  node.muted = node.defaultMuted = node.loop = node.playsInline = node.autoplay = true;
  node.preload = 'none';
  node.setAttribute('aria-hidden', 'true');
  node.addEventListener('error', () => {
    node.replaceWith(artwork(id, poster, className, size, doc, { animated: false, lazyArt, focus, zoom }));
  }, { once: true });
  node.src = assetUrl('./art/' + clips.get(id)[size]);
  return node;
}

export function cardArt(definition, className, { fullArt = false, lazyArt = false, doc = document, animated } = {}) {
  const art = !fullArt && className === 'card-art-crop' ? definition.artCrop ?? definition.art : definition.art;
  return artwork(definition.id, assetUrl('./art/' + art), className, fullArt ? 'large' : 'small', doc, {
    animated, lazyArt, focus: fullArt ? undefined : definition.artFocus, zoom: String(definition.artZoom ?? 1),
  });
}

export function addCardCrop(node, definition, { fullArt = false, lazyArt = false } = {}) {
  setCardRarity(node, definition.rarity ?? (definition.token ? 'bronze' : undefined));
  if (!definition.art) return;
  node.classList.add('has-art');
  node.prepend(cardArt(definition, 'card-art-crop', { fullArt, lazyArt }));
}

export function refreshPremiumArt(root, id) {
  for (const node of root.querySelectorAll('[data-premium-card]')) {
    const { premiumCard, premiumPoster, premiumSize, premiumLazyArt } = node.dataset;
    if (id && id !== premiumCard) continue;
    const animated = playPremium(premiumCard, node.ownerDocument ?? root);
    if (Boolean(node.poster) === animated) continue;
    const className = node.className.replace(/\s+card-art-video\b/, '');
    node.replaceWith(artwork(premiumCard, premiumPoster, className, premiumSize, node.ownerDocument ?? document,
      { animated, lazyArt: premiumLazyArt !== undefined, focus: node.style.objectPosition, zoom: node.style.scale }));
  }
}

export function resumeCardVideos(root) {
  const videos = root.querySelectorAll('.card-art-video');
  if (!videos.length) return;
  // The browser can pause moved video elements while updating their layout.
  requestAnimationFrame(() => {
    for (const video of videos) {
      if (video.isConnected && !video.error && video.getClientRects().length) video.play().catch(() => {});
    }
  });
}

export function keepCardVideos(current, next) {
  const key = (node) => {
    const card = node.closest('[data-card-id], [data-board-card]');
    return card?.dataset.cardId ?? card?.dataset.boardCard;
  };
  const videos = new Map(Array.from(current.querySelectorAll('.card-art-video'), (node) => [key(node), node]));
  for (const replacement of next.querySelectorAll('.card-art-video')) {
    const id = key(replacement);
    const previous = id && videos.get(id);
    if (!previous || previous.src !== replacement.src) continue;
    replacement.replaceWith(previous);
  }
}
