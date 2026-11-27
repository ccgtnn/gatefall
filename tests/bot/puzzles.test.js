import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chooseBotTurn } from '../../docs/game/bot/bot.js';
import { restoreBotPosition } from '../../docs/game/bot/bot-position.js';

const folder = new URL('./puzzles/', import.meta.url);
const files = readdirSync(folder).filter((file) => file.endsWith('.json')).sort();
assert.ok(files.length, 'No bot puzzles found');

for (const file of files) {
  const puzzle = JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
  const { name, description, expect, rolloutSamples } = puzzle;
  test(name + ' — ' + description, () => {
    const { level, state } = restoreBotPosition(puzzle);
    const action = chooseBotTurn(state, level, { random: () => .99, rolloutSamples });
    assert.ok(Object.keys(expect).length, 'The puzzle must specify an expectation');
    for (const [key, value] of Object.entries(expect)) {
      switch (key) {
        case 'target':
          assert.deepEqual(action, { type: 'target', cardId: value });
          break;
        case 'type':
        case 'cardId':
        case 'row':
          assert.equal(action[key], value);
          break;
        case 'notType':
          assert.notEqual(action.type, value);
          break;
        case 'notCardId':
          assert.notEqual(action.cardId, value);
          break;
        default:
          assert.fail('Unknown expectation: ' + key);
      }
    }
  });
}
