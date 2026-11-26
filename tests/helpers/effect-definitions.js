import * as cards from '../../docs/game/cards.js';
import * as captains from '../../docs/game/captains.js';
import * as choir from '../../docs/game/choir.js';
import * as growth from '../../docs/game/growth.js';
import * as neutrals from '../../docs/game/neutral-cards.js';

export function visitDefinitions(visitor) {
  const visited = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    visitor(value);
    for (const entry of Object.values(value)) visit(entry);
  }
  for (const definitions of [cards, captains, choir, growth, neutrals]) visit(definitions);
}
