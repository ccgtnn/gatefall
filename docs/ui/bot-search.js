import { chooseEasyTurn } from '../game/bot/bot.js';
import { BOT_LEVELS, readBotLevel } from '../game/bot/bot-levels.js';
import { botSearchState } from '../game/bot/bot-strategy.js';

export function botSearchTimeoutMs(level) {
  const { budgetMs } = BOT_LEVELS[readBotLevel(level)];
  return Math.max(5_000, budgetMs * 1.5 + 3_000);
}

export function chooseFallbackTurn(match) {
  return chooseEasyTurn(botSearchState(match));
}

export function createBotSearch({
  createWorker = () => new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = botSearchTimeoutMs,
  startupTimeoutMs = 15_000,
} = {}) {
  let worker;
  let pending;
  let ready = false;
  let startupTimer;

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
    ready = false;
    clearTimeout(startupTimer);
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

  function sendRequest() {
    if (!ready || !pending) return;
    const current = worker;
    const duration = timeoutMs(pending.payload.level);
    pending.timer = setTimeout(() => fail(current, new Error('Bot worker timed out')), duration);
    try {
      current.postMessage(pending.payload);
    } catch (error) {
      fail(current, error);
    }
  }

  function startWorker() {
    const current = createWorker();
    worker = current;
    current.addEventListener('message', ({ data }) => {
      if (worker !== current) return;
      if (data.ready) {
        if (ready) return;
        ready = true;
        clearTimeout(startupTimer);
        sendRequest();
      } else if (data.error) fail(current, new Error(data.error));
      else if (ready) finish(data);
    });
    current.addEventListener('error', (event) => fail(current, event.error ?? new Error(event.message)));
    current.addEventListener('messageerror', () => fail(current, new Error('Cannot read bot worker response')));
    startupTimer = setTimeout(() => fail(current, new Error('Bot worker did not start')), startupTimeoutMs);
  }

  function warm() {
    if (worker) return;
    try {
      startWorker();
    } catch {
      stopWorker();
    }
  }

  function request(match, level, withTrace) {
    if (pending) cancel();
    return new Promise((resolve, reject) => {
      try {
        if (!worker) startWorker();
        pending = { resolve, reject, payload: { match, level, withTrace } };
        sendRequest();
      } catch (error) {
        stopWorker();
        if (pending) finish(null, error);
        else reject(error);
      }
    });
  }

  async function choose(match, level, withTrace = false) {
    try {
      const mastery = readBotLevel(level);
      const state = botSearchState(match, BOT_LEVELS[mastery].knowsDeckList);
      return await request(state, mastery, withTrace);
    } catch {
      const action = chooseFallbackTurn(match);
      const trace = withTrace ? { action, reason: 'Стратегический поиск недоступен. Использую резервный ход.', candidates: [] } : undefined;
      return { action, trace };
    }
  }

  return { choose, cancel, warm };
}
