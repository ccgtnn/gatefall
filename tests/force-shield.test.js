import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStatus, createCard, damage, findUnit, statusCount, tickInfection } from '../docs/game/board.js';
import { NEUTRAL_CARDS } from '../docs/game/cards.js';
import { applyAction, confirmMulligan, createMatch } from '../docs/game/match.js';
import { applyJournalEvent, createPlaybackState } from '../docs/turn-playback.js';

function deployedGolem() {
  const definition = NEUTRAL_CARDS.find(({ id }) => id === 'old-golem');
  const match = confirmMulligan(createMatch({ random: () => 0 }));
  match.players.human.hand = [createCard('golem', definition)];
  return applyAction(match, 'human', { type: 'play', cardId: 'golem', row: 'orbit', position: 0 });
}

test('the Old Golem blocks a complete hit before armor, then takes normal damage', () => {
  const match = deployedGolem();
  const golem = findUnit(match, 'golem');
  assert.equal(golem.card.power, 9);
  assert.equal(statusCount(golem.card, 'shield'), 1);
  applyStatus(match, golem, 'armor', 2);
  damage(match, golem, 0);
  assert.equal(statusCount(golem.card, 'shield'), 1);

  const playback = createPlaybackState(match);
  assert.equal(damage(match, golem, 99), 0);
  const event = match.log.at(-1);
  assert.equal(event.blockedDamage, 99);
  assert.equal(statusCount(golem.card, 'shield'), 0);
  assert.equal(golem.card.power, 9);
  assert.equal(golem.card.armor, 2);

  applyJournalEvent(playback, event);
  assert.equal(statusCount(findUnit(playback, 'golem').card, 'shield'), 0);
  assert.equal(damage(match, golem, 4), 0);
  assert.equal(golem.card.armor, 0);
  assert.equal(golem.card.power, 7);
});

test('infection bypasses the shield and leaves it for the next hit', () => {
  const match = deployedGolem();
  const golem = findUnit(match, 'golem');
  applyStatus(match, golem, 'infection', 1);
  tickInfection(match, golem);
  assert.equal(golem.card.power, 8);
  assert.equal(statusCount(golem.card, 'shield'), 1);
});
