import { chooseBotTurn } from '../game/bot.js';

globalThis.addEventListener('message', ({ data: { match, level, withTrace } }) => {
  try {
    let trace;
    const options = withTrace ? { onDecision: (decision) => { trace = decision; } } : {};
    const action = chooseBotTurn(match, level, options);
    globalThis.postMessage({ action, trace });
  } catch (error) {
    globalThis.postMessage({ error: String(error.message ?? error) });
  }
});

globalThis.postMessage({ ready: true });
