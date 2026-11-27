import assert from 'node:assert/strict';
import test from 'node:test';
import { createCard } from '../../docs/game/engine/board.js';
import { confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { chooseBotTurn } from '../../docs/game/bot/bot.js';
import { evaluateBreakdown, evaluatePosition } from '../../docs/game/bot/bot-evaluation.js';
import { restoreBotPosition, serializeBotPosition } from '../../docs/game/bot/bot-position.js';
import { botSearchState } from '../../docs/game/bot/bot-strategy.js';
import { plain, position } from '../helpers/bot-strategy.js';

test('the evaluation breakdown preserves the score across factions, projections and outcomes', () => {
  for (const faction of Object.keys(FACTIONS)) {
    const created = createMatch({ botFaction: faction, random: () => .99 });
    const match = botSearchState(confirmMulligan(created, [], { random: () => .99 }), true);
    const { bot } = match.players;
    const protectedCard = plain('protected', 4);
    protectedCard.armor = 3;
    protectedCard.statuses = { shield: 1 };
    bot.board.surface.push(protectedCard);
    bot.coins = 4;
    for (const [state, projection] of [
      [match, undefined],
      [match, { type: 'play', cardId: bot.hand[0].id, gain: 6 }],
      [match, { type: 'pass' }],
      [{ ...match, phase: 'finished', result: 'loss' }, undefined],
    ]) {
      for (const side of ['human', 'bot']) {
        const { total, parts } = evaluateBreakdown(state, side, projection);
        assert.equal(total, evaluatePosition(state, side, projection), faction);
        assert.ok(Math.abs(total - Object.values(parts).reduce((sum, value) => sum + value, 0)) < 1e-10);
      }
    }
    const { parts } = evaluateBreakdown(match, 'bot');
    assert.ok(parts.field > 0 && parts.armor > 0 && parts.shields > 0, faction);
  }
});

test('a compact snapshot preserves the bot action and trace through a JSON round trip', () => {
  const match = confirmMulligan(createMatch({ random: () => .99 }), [], { random: () => .99 });
  const hidden = plain('private-original-hand', 99);
  match.players.human.hand[0] = hidden;
  match.players.human.deck[0] = plain('private-original-deck', 91);
  match.mulligan.excluded = [hidden.definition.id];
  const level = 7;
  const json = serializeBotPosition(match, level);
  assert.ok(!json.includes('private-original'));
  assert.match(json, /"definition":\{"\$card":"[^"]+"\}/);
  const restored = restoreBotPosition(json);
  assert.equal(restored.level, level);
  assert.equal(restored.state.players.human.deck.length, 0);
  assert.ok(restored.state.players.human.knownDeck.length);
  const decide = (state, onDecision) => chooseBotTurn(state, level, {
    random: () => .99, rolloutSamples: 0, onDecision,
  });
  let originalTrace;
  let restoredTrace;
  const action = decide(match, (trace) => { originalTrace = trace; });
  assert.deepEqual(decide(restored.state, (trace) => { restoredTrace = trace; }), action);
  assert.deepEqual(decide(match), action);
  assert.deepEqual(restoredTrace, originalTrace);
  assert.ok(originalTrace.candidates.length && originalTrace.candidates.length <= 3);
  assert.ok(originalTrace.candidates.every(({ changes }) => Object.values(changes).every(Number.isFinite)));
  assert.ok(originalTrace.candidates.some(({ changes }) => Object.values(changes).some((value) => Math.abs(value) > .05)));
});

test('a snapshot omits cards and references from a private player choice', () => {
  const match = position();
  const privateCard = plain('private-offer', 100);
  match.pending = { side: 'human', options: [privateCard.id], cards: [privateCard], job: { created: [privateCard] } };
  match.effects = [{ side: 'human', pileChoices: { deck: [privateCard] } }];
  const json = serializeBotPosition(match, 4);
  assert.ok(!json.includes(privateCard.id));
  assert.equal(restoreBotPosition(json).state.pending, null);
});

test('a snapshot keeps runtime card definitions with the same printed id distinct', () => {
  const match = position();
  const printed = FACTIONS.growth.pool.find(({ id }) => id === 'broodlord');
  const variant = { ...printed, counter: { amount: 2, effect: printed.deploy } };
  match.players.bot.hand = [createCard('printed', printed), createCard('variant', variant)];
  const { state } = restoreBotPosition(serializeBotPosition(match, 4));
  assert.deepEqual(state.players.bot.hand.map(({ definition }) => definition), [printed, variant]);
});
