import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudAuth, SESSION_KEY } from '../../docs/ui/cloud/auth.js';
import { SUPABASE_KEY, SUPABASE_URL } from '../../docs/ui/cloud/config.js';
import { createCloudRequest } from '../../docs/ui/cloud/request.js';
import {
  exportSnapshot, parseSnapshot, readSnapshot, replaceSnapshot, trackProgressWrites,
} from '../../docs/ui/cloud/snapshot.js';
import { createCloudSync } from '../../docs/ui/cloud/sync.js';
import { resetProgress } from '../../docs/game/meta/reset-progress.js';

const DECKS = 'gatefall.decks';
const REWARDS = 'gatefall.reward-book';
const USER = { id: '21294696-4656-4380-ae47-3f77f8003c8d', email: 'player@example.com' };
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
    'gatefall.reduced-motion': 'on', 'gatefall.bot-thoughts': 'on', 'gatefall.bot-difficulty': '7',
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

function syncFixture(initial, { remote = null, choose = 'local' } = {}) {
  const storage = memoryStorage({ [SESSION_KEY]: 'keep', ...initial });
  let inMatch = false;
  let offline = false;
  let onPatch;
  let replaced = 0;
  const conflicts = [];
  const { request, calls } = fetchMock(({ method, body, url, headers }) => {
    if (offline) throw new TypeError('Network error');
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
    return Response.json([remote]);
  });
  const session = { user: USER, accessToken: 'token' };
  const sync = createCloudSync({
    storage, request, auth: { session: () => session, access: async () => session },
    inMatch: () => inMatch, now: () => NOW, onReplaced: () => { replaced += 1; },
    chooseConflict: async (details) => { conflicts.push(details); return choose; },
  });
  return {
    sync, storage, calls, conflicts, replaced: () => replaced, cloud: () => remote,
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
  const game = syncFixture({ [DECKS]: '[]' }, { remote: row(2, { [REWARDS]: '{}' }), choose: 'cloud' });
  await game.sync.run();
  assert.equal(game.conflicts.length, 1);
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
