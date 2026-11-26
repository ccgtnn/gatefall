import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_LEVELS, pickBotTarget } from '../../docs/game/bot.js';
import { chooseStrategicTarget, chooseStrategicTurn } from '../../docs/game/bot-strategy.js';
import { PRESETS } from '../../docs/game/decks.js';
import { applyAction, confirmMulligan, createDeckMatch } from '../../docs/game/match.js';
import { mirrorMatch } from '../../tools/arena-position.mjs';

function seeded(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32);
}

for (const [index, preset] of PRESETS.entries()) {
  test(`bots finish a seeded match with ${preset.id} at levels 1 and 4`, () => {
    const random = seeded(17020 + index);
    const options = { random, pickTarget: pickBotTarget, rolloutSamples: 1 };
    const levels = {
      human: { ...BOT_LEVELS[1], budgetMs: 40 },
      bot: { ...BOT_LEVELS[4], budgetMs: 80 },
    };
    let state = createDeckMatch(preset, { botDeck: preset, random });
    assert.ok(state);
    for (let step = 0; state.phase !== 'finished' && step < 300; step += 1) {
      if (state.phase === 'mulligan') {
        state = confirmMulligan(state, [], options);
        continue;
      }
      const side = state.pending?.side ?? state.turn;
      const view = side === 'bot' ? state : mirrorMatch(state);
      const choose = state.pending ? chooseStrategicTarget : chooseStrategicTurn;
      const action = choose(view, levels[side], options);
      const next = applyAction(state, side, action, options);
      assert.notStrictEqual(next, state, `step ${step}, ${side}, ${JSON.stringify(action)}`);
      state = next;
    }
    assert.equal(state.phase, 'finished');
  });
}
