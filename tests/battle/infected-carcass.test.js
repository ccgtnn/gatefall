import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { consume, createCard, damage, findUnit, statusCount } from '../../docs/game/engine/board.js';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { PRESETS } from '../../docs/game/cards/decks.js';
import { drain, emptyPlayingMatch, unit } from '../helpers/battle-helpers.js';

const definition = findCardDefinition('infected-carcass');
const random = () => .5;

test('Infected Carcass is a collectible Growth bronze outside the presets and has both artworks', async () => {
  assert.deepEqual([definition.faction, definition.type, definition.rarity, definition.provision, definition.power],
    ['growth', 'unit', 'bronze', 5, 5]);
  assert.ok(PRESETS.every(({ cardIds }) => !cardIds.includes(definition.id)));
  for (const file of [definition.art, definition.artCrop]) await access(new URL('../../docs/art/' + file, import.meta.url));
});

for (const cause of ['damage', 'consume']) {
  for (const count of [3, 1]) {
    test(`Infected Carcass targets distinct enemies after ${cause} with ${count} on the board`, () => {
      const match = emptyPlayingMatch({ random });
      const carcass = createCard(definition.id, definition);
      const eater = unit('eater', 3);
      match.players.human.board.orbit = [carcass, eater];
      const enemies = Array.from({ length: count }, (_, index) => unit('enemy-' + index, 5));
      match.players.bot.board.orbit = enemies.slice(0, 1);
      match.players.bot.board.surface = enemies.slice(1);
      const victim = findUnit(match, carcass.id);
      if (cause === 'damage') damage(match, victim, 5);
      else consume(match, victim, findUnit(match, eater.id));
      drain(match, random);
      const infected = enemies.map((card) => statusCount(card, 'infection'));
      assert.deepEqual(infected, count === 3 ? [0, 2, 2] : [2]);
      assert.equal(statusCount(eater, 'infection'), 0);
      assert.equal(findUnit(match, carcass.id), undefined);
    });
  }
}
