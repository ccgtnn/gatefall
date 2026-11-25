import { chooseBotTurn } from '../game/bot.js';

export function createBotSearch({
  createWorker = () => new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = 2400,
} = {}) {
  let worker;
  let pending;

  function finish(result) {
    if (!pending) return;
    const { resolve, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    resolve(result);
  }

  function cancel() {
    worker?.terminate();
    worker = undefined;
    finish();
  }

  function request(match, difficulty, withTrace) {
    cancel();
    return new Promise((resolve, reject) => {
      try {
        worker = createWorker();
        pending = { resolve, timer: setTimeout(() => fail(new Error('Bot worker timed out')), timeoutMs) };
        const current = worker;
        function fail(error) {
          if (worker !== current) return;
          reject(error);
          cancel();
        }
        worker.addEventListener('message', ({ data }) => {
          if (worker !== current) return;
          if (data.error) return fail(new Error(data.error));
          finish(data);
          worker.terminate();
          worker = undefined;
        });
        worker.addEventListener('error', (event) => fail(event.error ?? new Error(event.message)));
        worker.addEventListener('messageerror', () => fail(new Error('Cannot read bot worker response')));
        worker.postMessage({ match, difficulty, withTrace });
      } catch (error) {
        reject(error);
        cancel();
      }
    });
  }

  async function choose(match, difficulty, withTrace = false) {
    if (difficulty === 'hard' || difficulty === 'normal') {
      try {
        return await request(match, difficulty, withTrace);
      } catch {
        // Keep the match playable without ever running the long search on the main thread.
        difficulty = 'easy';
      }
    }
    let trace;
    const options = withTrace ? { onDecision: (decision) => { trace = decision; } } : {};
    const action = chooseBotTurn(match, difficulty, options);
    return { action, trace };
  }

  return { choose, cancel };
}
