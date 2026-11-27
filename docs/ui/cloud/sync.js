import {
  markProgressChange, progressChangedAt, readSnapshot, replaceSnapshot, validateSnapshot, withProgressLock,
} from './snapshot.js';

const SELECT = 'data,version,updated_at,device';
const META_PREFIX = 'gatefall-cloud.sync.';
const DEVICE_KEY = 'gatefall-cloud.device';
const DELAY_MS = 3000;
const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);

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
  const listeners = new Set();

  function meta(id) {
    try { return JSON.parse(storage?.getItem(META_PREFIX + id) ?? '{}') ?? {}; } catch { return {}; }
  }

  function saveMeta(id, value) {
    storage.setItem(META_PREFIX + id, JSON.stringify(value));
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
    if (!current || !active()) return null;
    try {
      return await request(path, { ...options, token: current.accessToken });
    } catch (error) {
      if (error?.status !== 401) throw error;
      const refreshed = await auth.access(current.accessToken);
      if (!refreshed || refreshed.user.id !== account || !active()) return null;
      return request(path, { ...options, token: refreshed.accessToken });
    }
  }

  async function reconcile({ manual, keepalive }) {
    const account = auth.session()?.user.id;
    if (!account || paused || reloading) return;
    const attempt = epoch;
    const { reset } = meta(account);
    const active = () => !paused && !reloading && attempt === epoch &&
      auth.session()?.user.id === account && meta(account).reset === reset;
    if (reset === 'keep-cloud' && !manual) {
      updateStatus('Облачная копия сохранена. Для выбора копии запусти синхронизацию вручную.');
      return;
    }
    const filter = '/rest/v1/progress?user_id=eq.' + encodeURIComponent(account);
    const read = async () => {
      const rows = await api(filter + '&select=' + SELECT, { keepalive }, account, active);
      return active() ? progressRow(rows) : null;
    };

    function remember(row, digest) {
      const previous = meta(account);
      if (previous.version > row.version) return;
      const lastSync = now();
      saveMeta(account, { version: row.version, fingerprint: digest, lastSync });
      dismissedVersion = undefined;
      showSynced(lastSync);
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
        remember(remote, digest);
        reloading = true;
        onReplaced();
      });
    }

    async function write(remote, data, digest) {
      const version = remote ? remote.version + 1 : 1;
      let device = storage.getItem(DEVICE_KEY);
      if (!device) {
        device = deviceName + ' · ' + crypto.randomUUID().slice(0, 8);
        storage.setItem(DEVICE_KEY, device);
      }
      const body = { data, version, device, updated_at: new Date(now()).toISOString() };
      let rows;
      try {
        rows = await api(remote ? filter + '&version=eq.' + remote.version : '/rest/v1/progress', {
          method: remote ? 'PATCH' : 'POST',
          body: remote ? body : { ...body, user_id: account },
          headers: { Prefer: 'return=representation' },
          keepalive: keepalive && new TextEncoder().encode(JSON.stringify(body)).length < 60_000,
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
    const baseline = meta(account);
    if (remote && baseline.version > remote.version) {
      schedule();
      return;
    }
    if (remote && matches(local, remote.data)) {
      remember(remote, digest);
      return;
    }
    if (remote && !reset && (baseline.fingerprint === digest || (!baseline.fingerprint && !Object.keys(local).length))) {
      await useCloud(remote, local);
      return;
    }
    if (!remote || reset === 'overwrite' || (!reset && remote.version === baseline.version)) {
      if (await write(remote, local, digest)) return;
      remote = await read();
      if (!active()) return;
      if (!remote) throw new Error('Версия облачного прогресса изменилась.');
    }

    if (inMatch()) {
      updateStatus('Разные версии прогресса. Выбор копии доступен после выхода из матча.');
      return;
    }
    local = readSnapshot(storage);
    updateStatus('Прогресс на этом устройстве и в облаке разный.');
    if (!manual && dismissedVersion === remote.version) return;
    const choice = await chooseConflict({ localAt: progressChangedAt(storage), remote });
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

  function run({ manual = false, keepalive = false } = {}) {
    clearTimeout(timer);
    if (job) {
      if (manual) return job.then(() => run({ manual, keepalive }));
      queued = true;
      return job;
    }
    if (!auth.session() || paused || reloading) return Promise.resolve();
    const attempt = epoch;
    updateStatus('Синхронизация…');
    job = reconcile({ manual, keepalive }).catch((error) => {
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
    updateStatus('');
  }

  return {
    run, schedule, reset, accountChanged,
    status: () => status,
    reloading: () => reloading,
    version: () => meta(auth.session()?.user.id).version ?? 0,
    subscribe(listener) { listeners.add(listener); },
  };
}
