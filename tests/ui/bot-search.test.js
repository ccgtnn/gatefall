import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createBotSearch } from '../../docs/ui/bot-search.js';
import { createMatch } from '../../docs/game/match.js';

const workerEntry = new URL('../../docs/ui/bot-worker.js', import.meta.url).href;

function nodeWorker(onResponse) {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.addEventListener = (type, callback) => parentPort.on(type, (data) => callback({ data }));
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    import(${JSON.stringify(workerEntry)});
  `, { eval: true });
  return {
    terminate: () => worker.terminate(),
    postMessage: (data) => worker.postMessage(data),
    addEventListener(type, listener) {
      worker.on(type, (data) => {
        if (type === 'message') onResponse(data);
        listener(type === 'message' ? { data } : { error: data });
      });
    },
  };
}

test('hard search returns control while the worker calculates a legal action and sends its trace', async () => {
  const match = createMatch({ random: () => 0 });
  match.phase = 'playing';
  match.turn = 'bot';
  let response;
  const search = createBotSearch({ createWorker: () => nodeWorker((data) => { response = data; }) });
  try {
    let settled = false;
    const result = search.choose(match, 'hard', true).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    const { action, trace } = await result;
    assert.ok(['play', 'leader', 'pass', 'order'].includes(action.type));
    assert.deepEqual(trace.action, action);
    assert.deepEqual(response, { action, trace });
  } finally {
    search.cancel();
  }
});

test('reset can terminate a pending worker without applying its response', async () => {
  let stopped = false;
  const search = createBotSearch({ createWorker: () => ({
    terminate: () => { stopped = true; }, postMessage() {}, addEventListener() {},
  }) });
  const choice = search.choose({}, 'hard');
  search.cancel();
  assert.equal(await choice, undefined);
  assert.equal(stopped, true);
});
