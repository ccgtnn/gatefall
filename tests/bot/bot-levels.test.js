import assert from 'node:assert/strict';
import test from 'node:test';
import { COIN_LIMIT, ROW_LIMIT, createCard } from '../../docs/game/engine/board.js';
import { CAPTAIN_CARDS, HOUND } from '../../docs/game/cards/factions/captains.js';
import { createBotView, pickBotTarget } from '../../docs/game/bot/bot.js';
import { chooseBestBotTurn as chooseBotTurn } from '../helpers/bot-choice.js';
import { BOT_LEVELS, chooseBotTurn as decideAtLevel } from '../../docs/game/bot/bot.js';
import { evaluatePosition } from '../../docs/game/bot/bot-evaluation.js';
import { visibleSupply } from '../../docs/game/bot/bot-rollouts.js';
import { readBotLevel } from '../../docs/game/bot/bot-levels.js';
import { delayedCardValue, futureContext, remainingTurns } from '../../docs/game/bot/bot-future-value.js';
import { publicMatch } from '../../docs/game/bot/bot-strategy.js';
import { deckCardValue, effectSwing } from '../../docs/game/bot/bot-effect-value.js';
import { AWAKENING, CHOIR_CARDS, TENTACLE } from '../../docs/game/cards/factions/choir.js';
import { FACTIONS, LARVA } from '../../docs/game/cards/cards.js';
import { applyAction, canEndTurn, canPass, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';

import { member, pass, plain, position, standard } from '../helpers/bot-strategy.js';

test('level 6 reports ranked public decisions and scores from completed rollouts without mutating the match', () => {
  const match = position(3);
  const before = structuredClone(match);
  let trace;
  const action = chooseBotTurn(match, 6, {
    rolloutSamples: 2, onDecision: (report) => { trace = report; },
  });
  assert.deepEqual(match, before);
  assert.deepEqual(trace.action, action);
  assert.equal(trace.candidates.length, 3);
  assert.deepEqual(trace.candidates[0].action, action);
  assert.ok(trace.candidates.every(({ score, samples }) => Number.isFinite(score) && samples === 2));
  assert.ok(trace.candidates[0].score >= trace.candidates[1].score);
});


test('level 6 bot decisions including rollout scores repeat with the same seed', () => {
  const match = position(3);
  function decide() {
    let seed = 4831;
    let trace;
    const action = chooseBotTurn(structuredClone(match), 6, {
      random: () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
      rolloutSamples: 2,
      onDecision: (decision) => { trace = decision; },
    });
    return { action, trace };
  }
  const first = decide();
  assert.ok(first.trace.candidates.some(({ samples }) => samples > 0));
  assert.deepEqual(decide(), first);
});

test('the seven levels increase in depth, candidates, samples, memory and budget', () => {
  assert.deepEqual(Object.keys(BOT_LEVELS).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  const horizons = ['turn', 'reply', 'round', 'match'];
  for (let number = 2; number <= 7; number += 1) {
    const previous = BOT_LEVELS[number - 1];
    const level = BOT_LEVELS[number];
    assert.ok(level.errorRate < previous.errorRate);
    assert.ok(horizons.indexOf(level.horizon) >= horizons.indexOf(previous.horizon));
    assert.ok(level.candidates > previous.candidates && level.samples >= previous.samples);
    assert.ok(Number(level.memory) >= Number(previous.memory));
    assert.ok(level.budgetMs > previous.budgetMs);
  }
  assert.equal(BOT_LEVELS[7].errorRate, 0);
});

test('saved legacy bot settings migrate to levels 2, 4 and 6', () => {
  for (const [saved, level] of [['easy', 2], ['normal', 4], ['hard', 6], ['1', 1], ['7', 7], [6, 6]]) {
    assert.equal(readBotLevel(saved), level);
  }
  for (const invalid of [null, 'unknown', 8, 0, '3.5']) assert.equal(readBotLevel(invalid), 4);
});

test('a seed reproduces the decision and trace at levels 1, 4 and 7', () => {
  const match = position(3);
  match.players.bot.hand = [plain('strong', 9), plain('mid', 6), plain('weak', 3)];
  function decide(level) {
    let seed = 2468;
    let trace;
    const action = decideAtLevel(match, level, {
      random: () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
      onDecision: (value) => { trace = value; },
    });
    return { action, trace };
  }
  for (const level of [1, 4, 7]) {
    const result = decide(level);
    assert.deepEqual(decide(level), result);
    assert.equal(result.action.type, 'play');
    if (level > 1) assert.ok(result.trace.candidates[0].samples > 0);
  }
});

test('level 1 can select a weaker move or target and level 7 always uses the best rating', () => {
  const match = position(3);
  match.players.bot.hand = [plain('strong', 10), plain('mid', 7), plain('weak', 3)];
  match.players.human.deck = [];
  match.players.human.hand = [];
  match.players.human.board.orbit = [plain('enemy', 8)];
  match.players.human.passed = true;
  for (const level of [1, 7]) {
    assert.equal(decideAtLevel(match, level, { random: () => .99 }).cardId, 'strong');
    const alternative = decideAtLevel(match, level, { random: () => 0 }).cardId;
    if (level === 7) assert.equal(alternative, 'strong');
    else assert.notEqual(alternative, 'strong');
  }

  const { bot, human } = match.players;
  bot.hand = [standard('shot', { id: 'shot', name: 'Shot', type: 'effect', deploy: {
    select: [{ ref: 'victim', kind: 'damage', amount: 6, targets: { scope: 'enemy', type: 'unit' } }],
    steps: [{ action: 'damage', target: { scope: 'ref', ref: 'victim' }, amount: 6 }],
  } }), plain('spare', 1)];
  human.board.orbit = [plain('strong', 8), plain('mid', 5), plain('weak', 2)];
  human.passed = false;
  const pending = applyAction(match, 'bot', { type: 'play', cardId: 'shot' });
  assert.equal(decideAtLevel(pending, 1, { random: () => .99 }).cardId, 'strong');
  assert.equal(decideAtLevel(pending, 1, { random: () => 0 }).cardId, 'mid');
  assert.equal(decideAtLevel(pending, 7, { random: () => 0 }).cardId, 'strong');
});

