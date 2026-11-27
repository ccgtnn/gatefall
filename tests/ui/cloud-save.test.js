import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudAuth, SESSION_KEY, SYNC_META_PREFIX } from '../../docs/ui/cloud/auth.js';
import { SUPABASE_KEY, SUPABASE_URL } from '../../docs/ui/cloud/config.js';
import { createCloudRequest } from '../../docs/ui/cloud/request.js';
import {
  exportSnapshot, parseSnapshot, progressChangedAt, readSnapshot, replaceSnapshot, trackProgressWrites,
} from '../../docs/ui/cloud/snapshot.js';
import { createFactionStats } from '../../docs/ui/stats.js';
import { createAppTimers } from '../../docs/ui/app-timers.js';
import { createConflictDialog } from '../../docs/ui/cloud/settings-panel.js';
import { TestNode } from '../helpers/test-node.js';
import { createCloudSync } from '../../docs/ui/cloud/sync.js';
import { resetProgress } from '../../docs/game/meta/reset-progress.js';

const DECKS = 'gatefall.decks';
const REWARDS = 'gatefall.reward-book';
const USER = { id: '21294696-4656-4380-ae47-3f77f8003c8d', email: 'player@example.com' };
const META = SYNC_META_PREFIX + USER.id;
const OWN_DECKS = JSON.stringify([{ id: 'own' }]);
const SESSION = { user: USER, accessToken: 'token', refreshToken: 'refresh', expiresAt: Infinity };
const NOW = Date.parse('2026-11-27T05:42:00Z');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

function fetchMock(respond) {
  const calls = [];
  const request = createCloudRequest(async (url, options) => {
    assert.ok(url.startsWith(SUPABASE_URL + '/'));
    const call = { url: new URL(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    return respond(call);
  });
  return { request, calls };
}

test('magic link request sends the email, redirect URL and public API key', async () => {
  const { request, calls } = fetchMock(() => Response.json({}));
  const location = new URL('https://ccgtnn.github.io/gatefall/?source=game#menu');
  const auth = createCloudAuth({ request, location });
  await auth.sendLink(USER.email);
  assert.equal(calls[0].url.pathname, '/auth/v1/otp');
  assert.equal(calls[0].url.searchParams.get('redirect_to'), location.origin + location.pathname);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.apikey, SUPABASE_KEY);
  assert.deepEqual(calls[0].body, { email: USER.email, create_user: true });
  assert.equal(auth.message(), 'Ссылка отправлена на ' + USER.email);
});

test('magic link strips credentials from the address and saves the verified session', async () => {
  const storage = memoryStorage();
  const { request, calls } = fetchMock((call) =>
    call.url.pathname === '/auth/v1/logout' ? new Response(null, { status: 204 }) : Response.json(USER));
  const location = {
    hash: '#access_token=access&refresh_token=refresh&expires_in=3600&type=magiclink',
    pathname: '/gatefall/', search: '?source=game',
  };
  const replacements = [];
  const history = { state: { screen: 'decks' }, replaceState: (...args) => replacements.push(args) };
  const auth = createCloudAuth({ storage, request, location, history, now: () => NOW });
  await auth.initialize();
  assert.deepEqual(replacements, [[history.state, '', '/gatefall/?source=game']]);
  assert.equal(calls[0].url.pathname, '/auth/v1/user');
  assert.equal(calls[0].headers.Authorization, 'Bearer access');
  assert.deepEqual(auth.session(), { user: USER, accessToken: 'access', refreshToken: 'refresh', expiresAt: NOW + 3_600_000 });
  assert.ok(storage.getItem(SESSION_KEY));
  await auth.signOut();
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(calls[1].url.searchParams.get('scope'), 'local');
});

test('expired links are removed from the address and reported in Russian', async () => {
  const { request, calls } = fetchMock(() => Response.json({}));
  const location = { hash: '#error_code=otp_expired', pathname: '/gatefall/', search: '' };
  let cleanUrl;
  const history = { replaceState(_state, _title, url) { cleanUrl = url; } };
  const auth = createCloudAuth({ request, location, history });
  await auth.initialize();
  assert.equal(cleanUrl, '/gatefall/');
  assert.match(auth.message(), /истекла/);
  assert.equal(calls.length, 0);
});

test('requests near expiry share a refresh and persist the rotated token', async () => {
  const storage = memoryStorage({
    [SESSION_KEY]: JSON.stringify({ user: USER, accessToken: 'old', refreshToken: 'old-refresh', expiresAt: NOW + 20_000 }),
  });
  const { request, calls } = fetchMock(() => Response.json({
    access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600, user: USER,
  }));
  const auth = createCloudAuth({ storage, request, now: () => NOW });
  const [left, right] = await Promise.all([auth.access(), auth.access()]);
  assert.equal(left.accessToken, right.accessToken);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/auth/v1/token');
  assert.equal(calls[0].url.searchParams.get('grant_type'), 'refresh_token');
  assert.deepEqual(calls[0].body, { refresh_token: 'old-refresh' });
  assert.equal(auth.session().refreshToken, 'new-refresh');
});

test('snapshot exports progress only and replaces old keys on import', () => {
  const local = {
    'gatefall.animation-speed': 'fast', 'gatefall.sound-enabled': 'off', 'gatefall.sound-volume': '30',
    'gatefall.bot-thoughts': 'on', 'gatefall.bot-difficulty': '7',
    'gatefall.card-frame': 'dark', 'gatefall.battlefield': 'gates', 'gatefall.premium-card-art': 'false',
    [SESSION_KEY]: 'private-session', 'another-game.save': 'keep',
  };
  const progress = {
    [DECKS]: '[]', [REWARDS]: '{"goldSpent":150}', 'gatefall.quick-match': '{"player":"main"}',
    'gatefall.recent-decks': '[]', 'gatefall.faction-stats': '{}', 'gatefall.future-progress': 'legacy value',
  };
  const source = memoryStorage({ ...local, ...progress });
  const target = memoryStorage({ ...local, 'gatefall.deleted': 'old' });
  const json = exportSnapshot(source, 3);
  assert.deepEqual(JSON.parse(json), { version: 3, data: progress });
  replaceSnapshot(target, parseSnapshot(json));
  assert.equal(exportSnapshot(target, 3), json);
  assert.equal(target.getItem('gatefall.deleted'), null);
  for (const [key, value] of Object.entries(local)) assert.equal(target.getItem(key), value);
  assert.throws(() => replaceSnapshot(target, { [SESSION_KEY]: 'injected' }), /некорректный/);
  assert.equal(exportSnapshot(target, 3), json);
});

test('real storage changes notify the debounce hook and record a local date', () => {
  const storage = memoryStorage();
  let changes = 0;
  const tracked = trackProgressWrites(storage, () => { changes += 1; });
  tracked.setItem('gatefall.sound-volume', 30);
  tracked.setItem(DECKS, '[]');
  tracked.setItem(DECKS, '[]');
  tracked.setItem(REWARDS, '{}');
  assert.equal(changes, 2);
  assert.deepEqual(readSnapshot(storage), { [DECKS]: '[]', [REWARDS]: '{}' });
});

function syncFixture(initial, { remote = null, choose = 'local', locks, realAuth = false } = {}) {
  const credentials = JSON.stringify({ ...SESSION, expiresAt: NOW + 3_600_000 });
  const storage = memoryStorage({ [SESSION_KEY]: realAuth ? credentials : 'keep', ...initial });
  let inMatch = false;
  let offline = false;
  let onPatch;
  let losePatchResponse = false;
  let replaced = 0;
  const conflicts = [];
  const { request, calls } = fetchMock(({ method, body, url, headers }) => {
    if (offline) throw new TypeError('Network error');
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    assert.equal(url.pathname, '/rest/v1/progress');
    assert.equal(headers.Authorization, 'Bearer token');
    if (method === 'GET') {
      assert.equal(url.searchParams.get('select'), 'data,version,updated_at,device');
      return Response.json(remote ? [remote] : []);
    }
    assert.equal(headers.Prefer, 'return=representation');
    if (method === 'PATCH') {
      assert.equal(url.searchParams.get('user_id'), 'eq.' + USER.id);
      onPatch?.();
      onPatch = undefined;
      if (url.searchParams.get('version') !== 'eq.' + remote.version) return Response.json([]);
    } else {
      assert.equal(method, 'POST');
      assert.equal(body.user_id, USER.id);
      if (remote) return Response.json({ code: '23505' }, { status: 409 });
    }
    remote = body;
    if (method === 'PATCH' && losePatchResponse) {
      losePatchResponse = false;
      throw new DOMException('Timeout', 'TimeoutError');
    }
    return Response.json([remote]);
  });
  const auth = realAuth ? createCloudAuth({ storage, request, now: () => NOW }) :
    { session: () => SESSION, access: async () => SESSION };
  const tab = () => createCloudSync({
    storage, request, auth, locks,
    inMatch: () => inMatch, now: () => NOW, onReplaced: () => { replaced += 1; },
    chooseConflict: async (details) => { conflicts.push(details); return choose; },
  });
  return {
    sync: tab(), tab, auth, storage, calls, conflicts, replaced: () => replaced, cloud: () => remote,
    signBackIn() { storage.setItem(SESSION_KEY, credentials); },
    dropPatchResponse() { losePatchResponse = true; },
    setRemote(row) { remote = row; },
    setInMatch(value) { inMatch = value; },
    setOffline(value) { offline = value; },
    racePatch(row) { onPatch = () => { remote = row; }; },
  };
}

function row(version, data) {
  return { version, data, device: 'Телефон', updated_at: new Date(NOW).toISOString() };
}

test('first sync inserts, later local saves patch exactly the known cloud version', async () => {
  const { sync, storage, calls, cloud } = syncFixture({ [DECKS]: '[]' });
  await sync.run();
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'POST']);
  assert.equal(cloud().version, 1);
  storage.setItem(REWARDS, '{}');
  await sync.run();
  assert.equal(calls[3].method, 'PATCH');
  assert.equal(calls[3].url.searchParams.get('version'), 'eq.1');
  assert.equal(cloud().version, 2);
  assert.deepEqual(cloud().data, { [DECKS]: '[]', [REWARDS]: '{}' });
  assert.match(sync.status(), /^Синхронизировано в /);
});

test('a zero-row patch opens the conflict dialogue before writing against the new version', async () => {
  const game = syncFixture({ [DECKS]: '[]' });
  await game.sync.run();
  game.storage.setItem(REWARDS, '{"gold":42}');
  const changedRemotely = row(2, { [REWARDS]: '{"gold":70}' });
  game.racePatch(changedRemotely);
  await game.sync.run();
  assert.deepEqual(game.calls.map(({ method }) => method), ['GET', 'POST', 'GET', 'PATCH', 'GET', 'PATCH']);
  assert.deepEqual(game.conflicts[0].remote, changedRemotely);
  assert.equal(game.calls.at(-1).url.searchParams.get('version'), 'eq.2');
  assert.equal(game.cloud().version, 3);
  assert.equal(game.cloud().data[REWARDS], '{"gold":42}');
});

test('newer cloud progress applies without a prompt when local data is clean, after leaving the match', async () => {
  const game = syncFixture({ [DECKS]: '[]', 'gatefall.sound-enabled': 'off' });
  await game.sync.run();
  game.setRemote(row(2, { [REWARDS]: '{}' }));
  game.setInMatch(true);
  await game.sync.run();
  assert.equal(game.replaced(), 0);
  assert.equal(game.storage.getItem(DECKS), '[]');
  game.setInMatch(false);
  await game.sync.run();
  assert.equal(game.replaced(), 1);
  assert.equal(game.conflicts.length, 0);
  assert.equal(game.storage.getItem(DECKS), null);
  assert.equal(game.storage.getItem(REWARDS), '{}');
  assert.equal(game.storage.getItem('gatefall.sound-enabled'), 'off');
});

test('a fresh device downloads its first cloud save without inserting or prompting', async () => {
  const game = syncFixture({}, { remote: row(5, { [DECKS]: '[]' }) });
  await game.sync.run();
  assert.deepEqual(game.calls.map(({ method }) => method), ['GET']);
  assert.equal(game.replaced(), 1);
  assert.equal(game.sync.version(), 5);
});

test('choosing the cloud copy replaces changed local data only after the choice', async () => {
  const game = syncFixture({ [DECKS]: OWN_DECKS }, { remote: row(2, { [REWARDS]: '{}' }), choose: 'cloud' });
  await game.sync.run();
  assert.equal(game.conflicts.length, 1);
  assert.equal(game.conflicts[0].hasBaseline, false);
  assert.deepEqual(game.conflicts[0].local, { [DECKS]: OWN_DECKS });
  assert.equal(game.replaced(), 1);
  assert.deepEqual(readSnapshot(game.storage), { [REWARDS]: '{}' });
  assert.deepEqual(game.calls.map(({ method }) => method), ['GET']);
});

test('offline sync leaves local progress usable and retry uploads the same data', async () => {
  const game = syncFixture({ [DECKS]: '[]' });
  game.setOffline(true);
  await game.sync.run();
  assert.equal(game.sync.status(), 'Нет сети');
  game.storage.setItem(REWARDS, '{}');
  assert.equal(game.replaced(), 0);
  game.setOffline(false);
  await game.sync.run();
  assert.deepEqual(game.cloud().data, { [DECKS]: '[]', [REWARDS]: '{}' });
});

test('declining cloud overwrite during reset preserves the session and pauses automatic writes', async () => {
  const game = syncFixture({ [DECKS]: '[]' });
  await game.sync.run();
  await game.sync.reset(() => resetProgress(game.storage), false);
  assert.equal(game.storage.getItem(SESSION_KEY), 'keep');
  assert.deepEqual(readSnapshot(game.storage), {});
  await game.sync.run();
  assert.equal(game.cloud().version, 1);
  await game.sync.run({ manual: true });
  assert.equal(game.conflicts.length, 1);
  assert.deepEqual(game.cloud().data, {});
});

test('an approved cloud reset can finish after an offline attempt', async () => {
  const game = syncFixture({ [DECKS]: '[]' });
  await game.sync.run();
  game.setOffline(true);
  await game.sync.reset(() => resetProgress(game.storage), true);
  assert.equal(game.storage.getItem(SESSION_KEY), 'keep');
  assert.equal(game.cloud().version, 1);
  game.setOffline(false);
  await game.sync.run();
  assert.equal(game.cloud().version, 2);
  assert.deepEqual(game.cloud().data, {});
});

test('signing out before a local reset invalidates the old cloud baseline', async () => {
  const original = row(5, { [DECKS]: OWN_DECKS });
  const game = syncFixture(original.data, { remote: original, realAuth: true });
  await game.sync.run();
  assert.ok(JSON.parse(game.storage.getItem(META)).fingerprint);
  await game.auth.signOut();
  game.sync.accountChanged();
  assert.equal(JSON.parse(game.storage.getItem(META)).fingerprint, undefined);
  await game.sync.reset(() => resetProgress(game.storage), false);
  game.signBackIn();
  game.sync.accountChanged();
  await game.sync.run();
  assert.deepEqual(game.cloud(), original);
  assert.deepEqual(readSnapshot(game.storage), original.data);
  assert.equal(game.replaced(), 1);
});

test('reset without a session drops all cached baselines and preserves the cloud on sign-in', async () => {
  const original = row(5, { [DECKS]: OWN_DECKS });
  const game = syncFixture(original.data, { remote: original, realAuth: true });
  await game.sync.run();
  assert.ok(JSON.parse(game.storage.getItem(META)).fingerprint);
  const otherMeta = SYNC_META_PREFIX + 'another-account';
  game.storage.setItem(otherMeta, JSON.stringify({
    version: 9, fingerprint: 'old', hiddenFingerprint: 'snapshot:{}', lastSync: NOW,
    pending: { version: 10, fingerprint: 'pending' }, reset: 'overwrite',
  }));
  game.storage.setItem(SYNC_META_PREFIX + 'malformed', '{');
  game.storage.removeItem(SESSION_KEY);
  assert.equal(game.auth.session(), null);

  await game.sync.reset(() => resetProgress(game.storage), false);
  assert.deepEqual(JSON.parse(game.storage.getItem(META)), { version: 5, lastSync: NOW });
  assert.deepEqual(JSON.parse(game.storage.getItem(otherMeta)), { version: 9, lastSync: NOW });
  assert.equal(game.storage.getItem(SYNC_META_PREFIX + 'malformed'), null);
  assert.deepEqual(readSnapshot(game.storage), {});

  game.signBackIn();
  await game.tab().run();
  assert.deepEqual(game.calls.map(({ method }) => method), ['GET', 'GET']);
  assert.deepEqual(game.cloud(), original);
  assert.deepEqual(readSnapshot(game.storage), original.data);
});

test('first sign-in ignores local progress created only by a background checkpoint', async () => {
  const original = row(5, { [DECKS]: OWN_DECKS, [REWARDS]: '{"startingGold":1000}' });
  const game = syncFixture({ [REWARDS]: '{"ranks":{"resetAt":123}}' }, { remote: original });
  await game.sync.run();
  assert.deepEqual(game.calls.map(({ method }) => method), ['GET']);
  assert.deepEqual(game.cloud(), original);
  assert.deepEqual(readSnapshot(game.storage), original.data);
  assert.equal(game.conflicts.length, 0);
});

test('an offline start gates timers and a checkpoint cannot change the local date', async () => {
  const original = row(5, { [DECKS]: OWN_DECKS });
  const game = syncFixture({}, { remote: original });
  const background = trackProgressWrites(game.storage, () => {}, { background: true });
  let checkpoints = 0;
  const progress = {
    tavern: () => undefined, rankResetAt: () => Infinity, league: () => null, subscribe: () => () => {},
    checkpointTavern: async () => 'current',
    checkpointRanks: async () => {
      checkpoints += 1;
      background.setItem(REWARDS, '{}');
      return 'done';
    },
  };
  const timers = createAppTimers(progress, () => {});
  game.sync.subscribe(() => { if (game.sync.ready()) timers.start(); });
  try {
    game.setOffline(true);
    await game.sync.run();
    assert.equal(game.sync.ready(), false);
    assert.equal(checkpoints, 0);
    // Even a checkpoint from another tab cannot mark this device newer.
    background.setItem(REWARDS, '{}');
    assert.equal(progressChangedAt(game.storage), null);
    game.setOffline(false);
    await game.sync.run();
    assert.equal(checkpoints, 0);
    assert.deepEqual(game.cloud(), original);
    assert.deepEqual(readSnapshot(game.storage), original.data);
    assert.equal(game.conflicts.length, 0);
  } finally {
    timers.stop();
  }
});

test('two tabs reconcile the same change under a shared lock', async () => {
  const queues = new Map();
  const lockNames = [];
  const locks = { request(name, task) {
    lockNames.push(name);
    const next = (queues.get(name) ?? Promise.resolve()).then(task);
    queues.set(name, next);
    return next;
  } };
  const game = syncFixture({ [DECKS]: OWN_DECKS }, { locks });
  await game.sync.run();
  const tab = game.tab();
  game.storage.setItem(REWARDS, '{"startingGold":100}');
  await Promise.all([game.sync.run(), tab.run()]);
  assert.deepEqual(lockNames, Array(3).fill('gatefall-cloud.sync'));
  assert.equal(game.calls.filter(({ method }) => method === 'PATCH').length, 1);
  assert.equal(game.cloud().version, 2);
  assert.equal(game.conflicts.length, 0);
});

test('without a shared lock a losing CAS accepts the identical winning snapshot', async () => {
  const game = syncFixture({ [DECKS]: OWN_DECKS });
  await game.sync.run();
  game.storage.setItem(REWARDS, '{"startingGold":100}');
  game.racePatch(row(2, readSnapshot(game.storage)));
  await game.sync.run();
  assert.deepEqual(game.calls.slice(-3).map(({ method }) => method), ['GET', 'PATCH', 'GET']);
  assert.equal(game.cloud().version, 2);
  assert.equal(game.sync.version(), 2);
  assert.equal(game.conflicts.length, 0);
});

test('a lost PATCH response recovers its pending baseline and uploads later local changes', async () => {
  const game = syncFixture({ [DECKS]: OWN_DECKS });
  await game.sync.run();
  game.storage.setItem(REWARDS, '{"startingGold":100}');
  game.dropPatchResponse();
  await game.sync.run();
  assert.equal(game.cloud().version, 2);
  assert.equal(JSON.parse(game.storage.getItem(META)).pending.version, 2);
  game.storage.setItem(REWARDS, '{"startingGold":200}');
  await game.tab().run();
  assert.equal(game.cloud().version, 3);
  assert.deepEqual(game.cloud().data, readSnapshot(game.storage));
  assert.equal(JSON.parse(game.storage.getItem(META)).pending, undefined);
  assert.equal(game.conflicts.length, 0);
});

test('hiding with a changed snapshot sends one immediate conditional PATCH without a GET', async () => {
  const game = syncFixture({ [DECKS]: OWN_DECKS });
  await game.sync.run();
  const beforeHide = game.calls.length;
  game.tab().saveOnHide();
  assert.equal(game.calls.length, beforeHide);
  game.storage.setItem(REWARDS, '{"startingGold":100}');
  const backgroundJob = game.sync.run();
  game.sync.saveOnHide();
  const [hidden] = game.calls.slice(beforeHide);
  assert.equal(game.calls.length, beforeHide + 1);
  assert.equal(hidden.method, 'PATCH');
  assert.equal(hidden.keepalive, true);
  assert.equal(hidden.url.searchParams.get('version'), 'eq.1');
  assert.equal(JSON.parse(game.storage.getItem(META)).pending.version, 2);
  await backgroundJob;
  assert.equal(game.cloud().version, 2);
  assert.equal(game.conflicts.length, 0);
});

test('faction results written from different tabs preserve the accumulated wins', () => {
  const storage = memoryStorage();
  const first = createFactionStats(['choir'], storage);
  const second = createFactionStats(['choir'], storage);
  first.record('choir', 'win');
  first.record('choir', 'win');
  second.record('choir', 'loss');
  assert.deepEqual(second.get('choir'), { win: 2, loss: 1 });
  assert.deepEqual(createFactionStats(['choir'], storage).get('choir'), { win: 2, loss: 1 });
});

test('the conflict dialog shows both copies and favors the cloud before a baseline exists', async (t) => {
  const body = new TestNode('body');
  globalThis.document = { body, createElement: (tag) => new TestNode(tag) };
  t.after(() => { delete globalThis.document; });
  const conflict = createConflictDialog();
  const [dialog] = body.children;
  const [, local, cloud, actions] = dialog.children;
  const [keepCloud, keepLocal] = actions.children;
  const details = {
    local: { [DECKS]: OWN_DECKS, 'gatefall.faction-stats': '{"choir":{"win":2,"loss":1}}' },
    localAt: new Date(NOW).toISOString(),
    remote: row(5, { [REWARDS]: '{"startingGold":125}' }),
  };
  for (const hasBaseline of [false, true]) {
    const answer = conflict.choose({ ...details, hasBaseline });
    assert.match(local.textContent, /Свои колоды: 1 · Матчи: 3/);
    assert.doesNotMatch(local.textContent, /Золото:/);
    assert.match(cloud.textContent, /Телефон · Золото: 125 · Карт: \d+/);
    assert.equal(keepCloud.classList.contains('primary'), !hasBaseline);
    assert.equal(keepLocal.classList.contains('primary'), hasBaseline);
    const action = hasBaseline ? keepLocal : keepCloud;
    assert.equal(action.getAttribute('autofocus'), '');
    dialog.returnValue = hasBaseline ? 'local' : 'cloud';
    dialog.dispatchEvent(new Event('close'));
    assert.equal(await answer, dialog.returnValue);
  }
});
