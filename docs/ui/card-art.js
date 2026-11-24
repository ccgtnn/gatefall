import { setCardRarity } from './dom.js?v=opponent-reveal-1';

export const PREMIUM_ART_KEY = 'gatefall.premium-card-art';
const clips = new Map([
  ['synaptic-parasite', { small: 'synaptic-parasite-hand.mp4', large: 'synaptic-parasite-preview.mp4' }],
  ['carrion-devourer', { small: 'carrion-devourer-card.mp4', large: 'carrion-devourer-preview.mp4' }],
  ['falura', { small: 'falura-card.mp4', large: 'falura-preview.mp4' }],
  ['world-gates', { small: 'world-gates-card.mp4', large: 'world-gates-preview.mp4' }],
]);
const premiumCards = new Set();
try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(PREMIUM_ART_KEY) ?? '[]');
  if (Array.isArray(saved)) {
    for (const id of saved) if (clips.has(id)) premiumCards.add(id);
  }
} catch {}

export function hasPremiumArt(id) { return clips.has(id); }
export function usesPremiumArt(id) { return premiumCards.has(id); }

export function selectPremiumArt(id, enabled) {
  if (!hasPremiumArt(id)) return;
  if (enabled) premiumCards.add(id);
  else premiumCards.delete(id);
  try { globalThis.localStorage?.setItem(PREMIUM_ART_KEY, JSON.stringify([...premiumCards])); } catch {}
  refreshPremiumArt(document, id);
}

function playPremium(id) {
  return usesPremiumArt(id) && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function artwork(id, poster, className, size, doc, animated = playPremium(id)) {
  const node = doc.createElement(animated ? 'video' : 'img');
  node.className = className;
  node.width = 480;
  node.height = 720;
  node.draggable = false;
  if (hasPremiumArt(id)) {
    node.dataset.premiumCard = id;
    node.dataset.premiumPoster = poster;
    node.dataset.premiumSize = size;
  }
  if (!animated) {
    node.src = poster;
    node.alt = '';
    return node;
  }
  node.classList.add('card-art-video');
  node.poster = poster;
  node.muted = node.defaultMuted = node.loop = node.playsInline = node.autoplay = true;
  node.preload = 'none';
  node.setAttribute('aria-hidden', 'true');
  node.addEventListener('error', () => node.replaceWith(artwork(id, poster, className, size, doc, false)), { once: true });
  node.src = './art/' + clips.get(id)[size] + '?v=loop-1';
  return node;
}

export function cardArt(definition, className, { fullArt = false, doc = document } = {}) {
  const art = !fullArt && className === 'card-art-crop' ? definition.artCrop ?? definition.art : definition.art;
  return artwork(definition.id, './art/' + art, className, fullArt ? 'large' : 'small', doc);
}

export function addCardCrop(node, definition, { fullArt = false } = {}) {
  setCardRarity(node, definition.rarity ?? (definition.token ? 'bronze' : undefined));
  if (!definition.art) return;
  node.classList.add('has-art');
  node.prepend(cardArt(definition, 'card-art-crop', { fullArt }));
}

export function refreshPremiumArt(root, id) {
  for (const node of root.querySelectorAll('[data-premium-card]')) {
    const { premiumCard, premiumPoster, premiumSize } = node.dataset;
    if (id && id !== premiumCard) continue;
    const animated = playPremium(premiumCard);
    if (Boolean(node.poster) === animated) continue;
    const className = node.className.replace(/\s+card-art-video\b/, '');
    node.replaceWith(artwork(premiumCard, premiumPoster, className, premiumSize, node.ownerDocument ?? document, animated));
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
