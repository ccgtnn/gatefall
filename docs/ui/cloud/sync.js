import { DECK_STORAGE_KEY } from '../deck-storage.js';
import { FACTION_STATS_KEY } from '../stats.js';
import { SYNC_META_PREFIX } from './auth.js';
import {
  markProgressChange, progressChangedAt, readSnapshot, replaceSnapshot, validateSnapshot, withProgressLock,
} from './snapshot.js';

const SELECT = 'data,version,updated_at,device';
const SYNC_LOCK = 'gatefall-cloud.sync';
const KEEPALIVE_LIMIT = 60_000;
const DEVICE_KEY = 'gatefall-cloud.device';
const DELAY_MS = 3000;
const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const snapshotFingerprint = (data) => 'snapshot:' + JSON.stringify(data);
const byteLength = (text) => new TextEncoder().encode(text).length;

async function fingerprint(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function progressRow(rows) {
  if (!Array.isArray(rows)) throw new Error('Некорректный ответ облака.');
  if (rows.length === 0) return null;
  const [row] = rows;
  if (!Number.isSafeInteger(row?.version) || row.version < 0) throw new Error('Некорректная версия прогресса.');
  return { ...row, data: validateSnapshot(row.data) };
}

function storedProgress(data, key) {
  try { return JSON.parse(data[key]); } catch { return undefined; }
}

export function progressActivity(data) {
  const decks = storedProgress(data, DECK_STORAGE_KEY);
  const stats = storedProgress(data, FACTION_STATS_KEY);
  return {
    decks: Array.isArray(decks) ? decks.filter((deck) =>
      typeof deck?.id === 'string' && !deck.id.startsWith('preset-')).length : undefined,
    matches: stats && typeof stats === 'object' ? Object.values(stats).reduce((total, tally) =>
      total + [tally?.win, tally?.loss].reduce((sum, count) =>
        sum + (Number.isSafeInteger(count) && count > 0 ? count : 0), 0), 0) : undefined,
  };
}

export function createCloudSync({
  storage, auth, request, locks, inMatch, chooseConflict, onReplaced, now = Date.now, deviceName = 'Браузер',
}) {
  let job;
  let timer;
  let queued = false;
  let paused = false;
  let reloading = false;
  let dismissedVersion;
  let epoch = 0;
  let status = '';
  let readyAccount;
  const listeners = new Set();

  function meta(id) {
    try { return JSON.parse(storage?.getItem(SYNC_META_PREFIX + id) ?? '{}') ?? {}; } catch { return {}; }
  }

  function saveMeta(id, value) {
    storage.setItem(SYNC_META_PREFIX + id, JSON.stringify(value));
  }

  function updateStatus(text) {
    status = text;
    for (const listener of listeners) listener();
  }

  function showSynced(at) {
    updateStatus('Синхронизировано в ' + new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  }

  function schedule() {
    clearTimeout(timer);
    const account = auth.session()?.user.id;
    if (paused || reloading || !account || meta(account).reset === 'keep-cloud') return;
    timer = setTimeout(() => {
      timer = undefined;
      if (job) queued = true;
      else void run();
    }, DELAY_MS);
  }

  async function api(path, options, account, active) {
    const current = await auth.access();
    if (current?.user.id !== account || !active()) return null;
    try {
      return await request(path, { ...options, token: current.accessToken });
    } catch (error) {
      if (error?.status !== 401) throw error;
      const refreshed = await auth.access(current.accessToken);
      if (!refreshed || refreshed.user.id !== account || !active()) return null;
      return request(path, { ...options, token: refreshed.accessToken });
    }
  }

  const filterFor = (account) => '/rest/v1/progress?user_id=eq.' + encodeURIComponent(account);

  function payload(data, version) {
    let device = storage.getItem(DEVICE_KEY);
    if (!device) {
      device = deviceName + ' · ' + crypto.randomUUID().slice(0, 8);
      storage.setItem(DEVICE_KEY, device);
    }
    return { data, version, device, updated_at: new Date(now()).toISOString() };
  }

  function recordPending(account, version, digest) {
    const baseline = meta(account);
    const previous = baseline.pending;
    if (previous?.version === version &&
        [previous.fingerprint, ...(previous.alternates ?? [])].includes(digest)) return;
    const pending = { version, fingerprint: digest };
    // A hidden tab can send a competing CAS while a foreground write is in flight.
    if (previous?.version === version) {
      pending.alternates = [previous.fingerprint, ...(previous.alternates ?? [])];
    }
    saveMeta(account, { ...baseline, pending });
  }

  function saveOnHide() {
    const current = auth.session();
    if (!current || paused || reloading) return;
    try {
      const account = current.user.id;
      const baseline = meta(account);
      if (!baseline.fingerprint || baseline.reset || !Number.isSafeInteger(baseline.version)) return;
      // Before a legacy baseline has been reconciled, only a newer player write can trigger keepalive.
      if (!baseline.hiddenFingerprint && !(Date.parse(progressChangedAt(storage)) >= baseline.lastSync)) return;
      const data = readSnapshot(storage);
      // Keepalive starts in this event handler. The canonical text avoids waiting for Web Crypto.
      const digest = snapshotFingerprint(data);
      if (baseline.hiddenFingerprint === digest || (baseline.pending?.version === baseline.version + 1 &&
          [baseline.pending.fingerprint, ...(baseline.pending.alternates ?? [])].includes(digest))) return;
      const body = payload(data, baseline.version + 1);
      if (byteLength(JSON.stringify(body)) >= KEEPALIVE_LIMIT) return;
      recordPending(account, body.version, digest);
      void request(filterFor(account) + '&version=eq.' + baseline.version, {
        method: 'PATCH', body, token: current.accessToken,
        headers: { Prefer: 'return=representation' }, keepalive: true,
      }).catch(() => {});
    } catch {
      // The foreground reconciliation can retry storage and network operations.
    }
  }

  async function reconcile({ manual, account, attempt }) {
    let { reset } = meta(account);
    const active = () => !paused && !reloading && attempt === epoch &&
      auth.session()?.user.id === account && meta(account).reset === reset;
    if (!active()) return;
    if (reset === 'keep-cloud' && !manual) {
      updateStatus('Облачная копия сохранена. Для выбора копии запусти синхронизацию вручную.');
      return;
    }
    const filter = filterFor(account);
    const read = async () => {
      const rows = await api(filter + '&select=' + SELECT, {}, account, active);
      return active() ? progressRow(rows) : null;
    };

    function remember(row, digest, settled = true) {
      const previous = meta(account);
      if (previous.version > row.version) return;
      const lastSync = now();
      const snapshot = snapshotFingerprint(row.data);
      const hiddenFingerprint = byteLength(snapshot) < KEEPALIVE_LIMIT ? snapshot : undefined;
      saveMeta(account, { version: row.version, fingerprint: digest, hiddenFingerprint, lastSync });
      dismissedVersion = undefined;
      if (settled) {
        readyAccount = account;
        showSynced(lastSync);
      }
    }

    async function useCloud(remote, local) {
      const digest = await fingerprint(remote.data);
      await withProgressLock(locks, () => {
        if (!active()) return;
        if (meta(account).version > remote.version) {
          schedule();
          return;
        }
        if (inMatch()) {
          updateStatus('Облачный прогресс будет проверен после выхода из матча.');
          return;
        }
        if (!matches(readSnapshot(storage), local)) {
          schedule();
          return;
        }
        replaceSnapshot(storage, remote.data);
        markProgressChange(storage, remote.updated_at);
        reloading = true;
        remember(remote, digest);
        onReplaced();
      });
    }

    async function write(remote, data, digest) {
      const body = payload(data, remote ? remote.version + 1 : 1);
      if (remote) recordPending(account, body.version, digest);
      let rows;
      try {
        rows = await api(remote ? filter + '&version=eq.' + remote.version : '/rest/v1/progress', {
          method: remote ? 'PATCH' : 'POST',
          body: remote ? body : { ...body, user_id: account },
          headers: { Prefer: 'return=representation' },
        }, account, active);
      } catch (error) {
        if (remote || error?.status !== 409) throw error;
        rows = [];
      }
      if (!active()) return true;
      const saved = progressRow(rows);
      if (!saved) return false;
      remember(saved, digest);
      return true;
    }

    let remote = await read();
    if (!active()) return;
    let local = readSnapshot(storage);
    let digest = await fingerprint(local);
    if (!active()) return;
    let baseline = meta(account);
    const pending = baseline.pending;
    if (remote && reset !== 'keep-cloud' && pending?.version === remote.version) {
      const cloudDigest = await fingerprint(remote.data);
      if (!active()) return;
      const candidates = [pending.fingerprint, ...(pending.alternates ?? [])];
      if (candidates.includes(cloudDigest) || candidates.includes(snapshotFingerprint(remote.data))) {
        remember(remote, cloudDigest, false);
        baseline = meta(account);
        reset = baseline.reset;
      }
    }
    if (remote && baseline.version > remote.version) {
      schedule();
      return;
    }
    if (remote && matches(local, remote.data)) {
      remember(remote, digest);
      return;
    }
    const { decks, matches: played } = progressActivity(local);
    if (remote && !reset && (baseline.fingerprint === digest || (!baseline.fingerprint && !decks && !played))) {
      await useCloud(remote, local);
      return;
    }
    if ((!remote && !baseline.version) || reset === 'overwrite' ||
        (remote && !reset && baseline.fingerprint && remote.version === baseline.version)) {
      if (await write(remote, local, digest)) return;
      remote = await read();
      if (!active()) return;
      if (remote && (matches(local, remote.data) || matches(readSnapshot(storage), remote.data))) {
        const remoteDigest = await fingerprint(remote.data);
        if (active()) {
          remember(remote, remoteDigest);
          if (!matches(readSnapshot(storage), remote.data)) schedule();
        }
        return;
      }
    }
    if (!remote) throw new Error('Облачная копия не найдена.');

    if (inMatch()) {
      updateStatus('Разные версии прогресса. Выбор копии доступен после выхода из матча.');
      return;
    }
    local = readSnapshot(storage);
    updateStatus('Прогресс на этом устройстве и в облаке разный.');
    if (!manual && dismissedVersion === remote.version) return;
    const choice = await chooseConflict({
      local, localAt: progressChangedAt(storage), remote, hasBaseline: Boolean(baseline.fingerprint),
    });
    if (!active()) return;
    if (!choice) {
      dismissedVersion = remote.version;
      return;
    }
    if (choice === 'cloud') {
      await useCloud(remote, local);
    } else if (choice === 'local') {
      local = readSnapshot(storage);
      digest = await fingerprint(local);
      if (active() && !(await write(remote, local, digest))) {
        updateStatus('Облачная копия снова изменилась. Проверь версии ещё раз.');
        schedule();
      }
    }
  }

  function run({ manual = false } = {}) {
    clearTimeout(timer);
    if (job) {
      if (manual) return job.then(() => run({ manual }));
      queued = true;
      return job;
    }
    const account = auth.session()?.user.id;
    if (!account || paused || reloading) return Promise.resolve();
    const attempt = epoch;
    updateStatus('Синхронизация…');
    const task = () => reconcile({ manual, account, attempt });
    job = Promise.resolve().then(() => locks ? locks.request(SYNC_LOCK, task) : task()).catch((error) => {
      if (attempt === epoch && auth.session()) {
        updateStatus(error?.status === 0 ? 'Нет сети' : 'Ошибка синхронизации. Попробуй снова.');
      }
    }).finally(() => {
      job = undefined;
      if (queued) {
        queued = false;
        schedule();
      }
    });
    return job;
  }

  async function reset(clear, overwrite) {
    const account = auth.session()?.user.id;
    paused = true;
    epoch += 1;
    try {
      if (account) saveMeta(account, { ...meta(account), reset: overwrite ? 'overwrite' : 'keep-cloud' });
      await clear();
      markProgressChange(storage);
    } finally {
      paused = false;
    }
    if (overwrite && auth.session()?.user.id === account) await run({ manual: true });
  }

  function accountChanged() {
    epoch += 1;
    clearTimeout(timer);
    dismissedVersion = undefined;
    readyAccount = undefined;
    updateStatus('');
  }

  return {
    run, schedule, reset, accountChanged, saveOnHide,
    ready: () => !reloading && (!auth.session() || readyAccount === auth.session().user.id),
    status: () => status,
    reloading: () => reloading,
    version: () => meta(auth.session()?.user.id).version ?? 0,
    subscribe(listener) { listeners.add(listener); },
  };
}
