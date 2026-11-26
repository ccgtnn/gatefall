import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { botSearchTimeoutMs, createBotSearch } from '../../docs/ui/bot-search.js';
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

test('level 6 search returns control while the worker calculates a legal action and sends its trace', async () => {
  const match = createMatch({ random: () => 0 });
  match.phase = 'playing';
  match.turn = 'bot';
  let response;
  const search = createBotSearch({ createWorker: () => nodeWorker((data) => { response = data; }) });
  try {
    let settled = false;
    const result = search.choose(match, 6, true).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    const { action, trace } = await result;
    assert.ok(['play', 'leader', 'pass', 'order', 'fee'].includes(action.type));
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
  const choice = search.choose(createMatch(), 6);
  search.cancel();
  assert.equal(await choice, null);
  assert.equal(stopped, true);
});

test('successive turns reuse one worker until the match is reset', async () => {
  let created = 0;
  let stopped = 0;
  const seen = [];
  const action = { type: 'pass' };
  const search = createBotSearch({ createWorker() {
    created += 1;
    let respond;
    return {
      terminate() { stopped += 1; },
      addEventListener(type, listener) {
        if (type !== 'message') return;
        respond = listener;
        queueMicrotask(() => listener({ data: { ready: true } }));
      },
      postMessage({ match }) { seen.push(match.players.human); respond({ data: { action } }); },
    };
  } });
  const match = createMatch();
  assert.deepEqual(await search.choose(match, 4), { action });
  assert.deepEqual(await search.choose(match, 6), { action });
  assert.deepEqual([created, stopped], [1, 0]);
  assert.equal(seen[0].knownDeck, undefined);
  assert.equal(seen[1].knownDeck.length, match.players.human.startingDeck.length);
  assert.deepEqual(seen[1].deck, []);
  assert.deepEqual(seen[1].hand.map(({ id }) => id), ['unknown-play']);
  search.cancel();
  assert.deepEqual(await search.choose(match, 6), { action });
  search.cancel();
  assert.deepEqual([created, stopped], [2, 2]);
});

test('a failed or timed-out worker is replaced on the next turn', async () => {
  for (const outcome of ['error', 'timeout']) {
    let created = 0;
    let stopped = 0;
    const action = { type: 'pass' };
    const search = createBotSearch({ timeoutMs: () => 10, createWorker() {
      const first = ++created === 1;
      const listeners = {};
      return {
        terminate() { stopped += 1; },
        addEventListener(type, listener) {
          listeners[type] = listener;
          if (type === 'message') queueMicrotask(() => listener({ data: { ready: true } }));
        },
        postMessage() {
          if (!first) listeners.message({ data: { action } });
          else if (outcome === 'error') listeners.error({ message: 'worker failed' });
        },
      };
    } });
    const match = createMatch({ random: () => 0 });
    match.phase = 'playing';
    match.turn = 'bot';
    assert.ok((await search.choose(match, 6)).action);
    assert.deepEqual([created, stopped], [1, 1]);
    assert.deepEqual(await search.choose(match, 6), { action });
    search.cancel();
    assert.deepEqual([created, stopped], [2, 2]);
  }
});

test('prewarm starts the worker early and the search clock waits for readiness', async () => {
  const action = { type: 'pass' };
  let respond;
  let created = 0;
  let requests = 0;
  const search = createBotSearch({ timeoutMs: () => 10, createWorker() {
    created += 1;
    return {
      terminate() {},
      addEventListener(type, listener) { if (type === 'message') respond = listener; },
      postMessage() {
        requests += 1;
        respond({ data: { action } });
      },
    };
  } });
  try {
    search.warm();
    assert.equal(created, 1);
    const result = search.choose(createMatch(), 4);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(requests, 0);
    respond({ data: { ready: true } });
    assert.deepEqual(await result, { action });
    assert.equal(requests, 1);
  } finally {
    search.cancel();
  }
});

test('every level uses the worker and its timeout allows the search budget plus slack', async () => {
  assert.equal(botSearchTimeoutMs(1), 3500);
  assert.equal(botSearchTimeoutMs(6), 6500);
  assert.equal(botSearchTimeoutMs(7), 9500);
  let respond;
  const requests = [];
  const search = createBotSearch({ createWorker: () => ({
    addEventListener(type, listener) { if (type === 'message') respond = listener; },
    terminate() {},
    postMessage(data) { requests.push(data.level); respond({ data: { action: { type: 'pass' } } }); },
  }) });
  search.warm();
  respond({ data: { ready: true } });
  try {
    for (let level = 1; level <= 7; level += 1) await search.choose(createMatch(), level);
    assert.deepEqual(requests, [1, 2, 3, 4, 5, 6, 7]);
  } finally {
    search.cancel();
  }
});
