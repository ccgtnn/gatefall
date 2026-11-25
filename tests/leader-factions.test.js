import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard, ROW_LIMIT } from '../docs/game/board.js';
import { AWAKENING, PSIONICS, TENTACLE } from '../docs/game/choir.js';
import { CAPTAIN_CARDS, HOUND } from '../docs/game/captains.js';
import { copyLimit, inspectDeck, PRESETS } from '../docs/game/decks.js';
import { canUseLeader } from '../docs/game/effects.js';
import { applyAction, createDeckMatch, createMatch } from '../docs/game/match.js';
import { createRewardProgress, drawBoosterCards } from '../docs/game/rewards.js';
import { applyJournalEvent, createPlaybackState } from '../docs/ui/turn-playback.js';

const random = () => 0;
const unit = (id, power) => createCard(id, { id, name: id, power });
const activate = (match) => act(match, { type: 'leader' });
const target = (match, cardId) => act(match, { type: 'target', cardId });
function act(match, action) {
  return applyAction(match, 'human', action, { random });
}

function playing(humanFaction) {
  const match = createMatch({ humanFaction, random });
  match.phase = 'playing';
  match.turn = 'human';
  return match;
}

test('both new presets have 25 owned cards and available leaders', () => {
  const economy = createRewardProgress();
  const { owned } = economy.inventory();
  for (const faction of ['captains', 'choir']) {
    const preset = PRESETS.find(({ factionId }) => factionId === faction);
    const result = inspectDeck(preset, owned);
    assert.ok(result.valid, JSON.stringify(result.issues));
    assert.equal(result.cards.length, 25);
    assert.equal(result.units, 16);
    assert.equal(result.budget, 165);
    assert.equal(createDeckMatch(preset, { random }).players.human.leader.id, preset.leaderId);
    const rival = createDeckMatch(preset, { random: () => .9 }).players.bot;
    assert.equal(rival.factionId, faction === 'captains' ? 'choir' : 'captains');
  }
  for (const card of CAPTAIN_CARDS) assert.equal(owned[card.id], copyLimit(card));
  assert.equal(owned[HOUND.id], undefined);
  const pack = drawBoosterCards(CAPTAIN_CARDS, random);
  assert.equal(pack.length, 5);
  assert.ok(pack.every(({ faction }) => faction === 'captains'));
  const choir = PRESETS.find(({ factionId }) => factionId === 'choir');
  assert.equal(inspectDeck({ ...choir, leaderId: 'choir-leader' }, owned).leader.id, 'high-priest');
});

test('leader charge overrides apply to both sides and leave other leaders on the match rule', () => {
  const standard = createMatch({ humanFaction: 'captains', botFaction: 'choir', random });
  assert.equal(standard.players.human.leader.charges, 1);
  assert.equal(standard.players.bot.leader.charges, 2);
  const custom = createMatch({ humanFaction: 'choir', botFaction: 'growth', random, rules: { leaderCharges: 3 } });
  assert.equal(custom.players.human.leader.charges, 2);
  assert.equal(custom.players.bot.leader.charges, 3);
});

test('Skara offers only rows with space, spawns two Hounds, and caps income at nine coins', () => {
  const match = playing('captains');
  const player = match.players.human;
  player.coins = 8;
  player.board.orbit = Array.from({ length: ROW_LIMIT }, (_, index) => unit('full-' + index, 1));
  let next = activate(match);
  assert.deepEqual(next.pending.options, ['surface']);
  assert.equal(next.players.human.leader.charges, 0);
  next = target(next, 'surface');
  assert.deepEqual(next.players.human.board.surface.map(({ definition }) => definition.id), [HOUND.id, HOUND.id]);
  assert.equal(next.players.human.coins, 9);
  assert.ok(next.log.findIndex(({ type }) => type === 'spawn') < next.log.findIndex(({ type }) => type === 'coins'));
  assert.equal(canUseLeader(next, 'human'), false);

  player.board.surface = player.board.orbit.map(({ id }) => unit('surface-' + id, 1));
  assert.equal(activate(match), match);
});

test('the High Priest has two order uses and places the Tentacle to the right of a survivor', () => {
  const match = playing('choir');
  match.playedCard = true;
  match.players.human.board.surface = [unit('offering', 3), unit('neighbor', 4)];

  let next = activate(match);
  assert.equal(next.pending.kind, 'leader-offering');
  const playback = createPlaybackState(match);
  applyJournalEvent(playback, next.log.at(-1));
  assert.equal(playback.players.human.leader.charges, 1);
  next = target(next, 'offering');
  assert.deepEqual(next.players.human.board.surface.map(({ definition, power }) => [definition.id, power]),
    [['offering', 1], [TENTACLE.id, 3], ['neighbor', 3]]);
  assert.equal(next.players.human.leader.lastUsedTurn, 0);
  assert.equal(activate(next), next);

  next.turn = 'human';
  next = target(activate(next), 'offering');
  assert.equal(next.players.human.leader.charges, 0);
  next.players.human.turns += 1;
  assert.equal(canUseLeader(next, 'human'), false);
});

test('a lethal offering summons at the fallen unit position and advances Awakening', () => {
  const match = playing('choir');
  match.players.human.board.surface = [unit('left', 4), unit('offering', 2), unit('right', 5)];
  match.players.human.board.orbit = [createCard('awaken', AWAKENING)];
  const next = target(activate(match), 'offering');
  assert.deepEqual(next.players.human.board.surface.map(({ definition }) => definition.id), ['left', TENTACLE.id, 'right']);
  assert.equal(next.log.find(({ type }) => type === 'spawn').position, 1);
  assert.equal(next.players.human.board.orbit[0].chapter, 1);
  assert.equal(next.log.filter(({ type }) => type === 'scenario-chapter').length, 1);
});

test('the Priest’s Tentacle respects the final Awakening chapter requirement', () => {
  for (const played of [6, 7]) {
    const match = playing('choir');
    match.players.human.board.surface = [unit('offering', 2)];
    const awakening = { ...createCard('awaken', AWAKENING), chapter: 2 };
    match.players.human.board.orbit = [awakening];
    match.players.human.effectCategoryPlays = { [PSIONICS]: played };
    const next = target(activate(match), 'offering');
    assert.equal(next.players.human.board.orbit[0].chapter, played === 7 ? 3 : 2);
  }
});
