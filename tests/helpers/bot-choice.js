import { chooseBotTurn } from '../../docs/game/bot.js';

// Fixture tests compare the best policy, with intentional mistakes exercised separately.
export function chooseBestBotTurn(match, level = 2, options = {}) {
  return chooseBotTurn(match, level, { random: () => .99, ...options });
}
