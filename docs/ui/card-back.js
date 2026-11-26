import { FACTIONS } from '../game/cards.js';
import { assetUrl } from './asset-url.js';
import { element } from './dom.js';

export function cardBack(faction, className, fallback = FACTIONS.protectorate.cardBack) {
  const art = FACTIONS[faction]?.cardBack ?? fallback;
  if (!art) return;
  const back = element('img', className);
  back.src = assetUrl('./art/' + art);
  back.alt = '';
  back.draggable = false;
  return back;
}
