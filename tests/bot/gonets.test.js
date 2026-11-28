import assert from 'node:assert/strict';
import test from 'node:test';
import { pickBotTarget } from '../../docs/game/bot/bot.js';
import { FACTIONS } from '../../docs/game/cards/cards.js';
import { applyAction } from '../../docs/game/engine/match.js';
import { chooseBestBotTurn } from '../helpers/bot-choice.js';
import { plain, position, standard } from '../helpers/bot-strategy.js';

const transport = FACTIONS.protectorate.pool.find(({ id }) => id === 'gonets');
const order = { type: 'order', cardId: 'gonets' };
const bronze = (id, power) => standard(id, { id, name: id, type: 'unit', power, rarity: 'bronze' });

test('the bot uses Gonets for an extra strong play and chooses the strongest bronze', () => {
  const match = position(3);
  const { bot, human } = match.players;
  bot.board.orbit = [standard('gonets', transport)];
  human.board.surface = [plain('opponent', 5)];
  human.passed = true;
  bot.hand = [bronze('weak', 1), bronze('strong', 7), plain('ordinary', 4)];
  bot.deck = [plain('drawn', 6)];
  match.playedCard = true;

  assert.deepEqual(chooseBestBotTurn(match), order);
  const choosing = applyAction(match, 'bot', order);
  const target = { type: 'target', cardId: 'strong' };
  assert.deepEqual(pickBotTarget(choosing), target);
  assert.deepEqual(chooseBestBotTurn(choosing), target);

  bot.hand = [plain('ordinary', 4)];
  assert.deepEqual(chooseBestBotTurn(match), { type: 'end-turn' });
});
