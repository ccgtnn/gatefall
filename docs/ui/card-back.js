import { FACTIONS } from '../game/cards/cards.js';
import { assetUrl } from './asset-url.js';
import { element } from './dom.js';

/** @type {(faction: string) => string | undefined} */
let chosenBack = () => undefined;

/** Lets the card-back preference pick a faction's back (improved or neutral from the Reward Book). */
export function useCardBacks(resolver) {
  chosenBack = resolver;
}

export function cardBack(faction, className, fallback = FACTIONS.protectorate.cardBack) {
  const standard = FACTIONS[faction]?.cardBack ?? fallback;
  if (!standard) return;
  const art = (fallback !== null && chosenBack(faction)) || standard;
  const back = element('img', className);
  back.src = assetUrl('./art/' + art);
  // Book backs may still be waiting for their art: fall back to the faction's standard back.
  if (art !== standard) back.addEventListener?.('error', () => { back.src = assetUrl('./art/' + standard); }, { once: true });
  back.alt = '';
  back.draggable = false;
  return back;
}
