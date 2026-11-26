import { chooseBotTurn } from '../game/bot.js';

export function createBotSearch({
  createWorker = () => new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = 2400,
} = {}) {
  let worker;
  let pending;

  function finish(result, error) {
    if (!pending) return;
    const { resolve, reject, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(result);
  }

  function stopWorker() {
    const current = worker;
    worker = undefined;
    current?.terminate();
  }

  function cancel() {
    stopWorker();
    finish(null);
  }

  function fail(current, error) {
    if (worker !== current) return;
    stopWorker();
    finish(null, error);
  }

  function startWorker() {
    const current = createWorker();
    worker = current;
    current.addEventListener('message', ({ data }) => {
      if (worker !== current) return;
      if (data.error) fail(current, new Error(data.error));
      else finish(data);
    });
    current.addEventListener('error', (event) => fail(current, event.error ?? new Error(event.message)));
    current.addEventListener('messageerror', () => fail(current, new Error('Cannot read bot worker response')));
    return current;
  }

  function request(match, difficulty, withTrace) {
    if (pending) cancel();
    return new Promise((resolve, reject) => {
      try {
        const current = worker ?? startWorker();
        pending = { resolve, reject, timer: setTimeout(() => fail(current, new Error('Bot worker timed out')), timeoutMs) };
        current.postMessage({ match, difficulty, withTrace });
      } catch (error) {
        stopWorker();
        if (pending) finish(null, error);
        else reject(error);
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
