import { CloudError } from './request.js';

// Outside gatefall.* so resetting game data preserves the session.
export const SESSION_KEY = 'gatefall-cloud.session';
const REFRESH_EARLY_MS = 60_000;

export function readAuthLink(location, history) {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!['access_token', 'refresh_token', 'error', 'error_code'].some((key) => hash.has(key))) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const expiresIn = Number(hash.get('expires_in'));
  if (hash.has('error') || hash.has('error_code') || !accessToken || !refreshToken || !(expiresIn > 0)) {
    throw new Error('Ссылка для входа недействительна или истекла. Запроси новую ссылку.');
  }
  return { accessToken, refreshToken, expiresIn };
}

export function createCloudAuth({ storage, request, location, history, locks, now = Date.now }) {
  let timer;
  let refreshJob;
  let generation = 0;
  let message = '';
  const listeners = new Set();

  function session() {
    try {
      const saved = JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null');
      if (saved?.user?.id && saved.accessToken && saved.refreshToken && Number.isFinite(saved.expiresAt)) return saved;
    } catch {}
    return null;
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    const saved = session();
    if (saved) {
      timer = setTimeout(() => {
        void access(undefined, false).catch(() => {
          clearTimeout(timer);
          if (session()) {
            timer = setTimeout(scheduleRefresh, 30_000);
            timer?.unref?.();
          }
        });
      }, Math.min(2 ** 31 - 1, Math.max(1000, saved.expiresAt - now() - REFRESH_EARLY_MS)));
      timer?.unref?.();
    }
  }

  function save(tokens, user) {
    const { accessToken, refreshToken, expiresIn } = tokens;
    if (!accessToken || !refreshToken || !(expiresIn > 0) || !user?.id) {
      throw new Error('Не удалось получить сессию. Запроси новую ссылку.');
    }
    if (!storage) throw new Error('Браузер запретил локальное хранилище. Вход недоступен.');
    const next = { accessToken, refreshToken, expiresAt: now() + expiresIn * 1000,
      user: { id: user.id, email: user.email } };
    storage.setItem(SESSION_KEY, JSON.stringify(next));
    message = '';
    scheduleRefresh();
    notify();
    return next;
  }

  function exclusive(task) {
    return locks ? locks.request(SESSION_KEY, task) : task();
  }

  async function access(rejectedToken, allowCurrent = true) {
    const attempt = generation;
    refreshJob ??= Promise.resolve().then(() => exclusive(async () => {
      const current = session();
      if (!current || attempt !== generation) return null;
      if (current.accessToken !== rejectedToken && current.expiresAt - now() > REFRESH_EARLY_MS) {
        scheduleRefresh();
        return current;
      }
      try {
        const response = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: current.refreshToken },
        });
        if (attempt !== generation || session()?.refreshToken !== current.refreshToken) return session();
        return save({
          accessToken: response?.access_token, refreshToken: response?.refresh_token, expiresIn: response?.expires_in,
        }, response?.user ?? current.user);
      } catch (error) {
        if ([400, 401, 403].includes(error?.status) && attempt === generation &&
            session()?.refreshToken === current.refreshToken) {
          storage.removeItem(SESSION_KEY);
          message = 'Сессия истекла. Войди снова по ссылке из письма.';
          scheduleRefresh();
          notify();
          return null;
        }
        throw error;
      }
    })).finally(() => { refreshJob = undefined; });
    try {
      return await refreshJob;
    } catch (error) {
      const current = session();
      if (allowCurrent && !rejectedToken && current?.expiresAt > now() &&
          (error?.status === 0 || error?.status >= 500)) return current;
      throw error;
    }
  }

  async function initialize() {
    try {
      const tokens = readAuthLink(location, history);
      if (tokens) {
        await exclusive(async () => {
          const user = await request('/auth/v1/user', { token: tokens.accessToken });
          save(tokens, user);
        });
      }
    } catch (error) {
      if (error?.status === 0) message = 'Нет сети. Подключись к интернету и снова открой ссылку из письма.';
      else if ([401, 403].includes(error?.status)) message = 'Ссылка для входа истекла. Запроси новую ссылку.';
      else message = error instanceof CloudError ? 'Не удалось войти. Попробуй снова.' : error.message;
    }
    scheduleRefresh();
    notify();
  }

  async function sendLink(email) {
    try {
      await request('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
      message = 'Ссылка отправлена на ' + email;
    } catch (error) {
      message = error?.status === 0 ? 'Нет сети. Подключись к интернету и попробуй снова.'
        : error?.status === 429 ? 'Ссылка уже запрошена. Подожди немного и попробуй снова.'
          : 'Не удалось отправить ссылку. Проверь адрес почты и попробуй снова.';
    }
    notify();
  }

  async function signOut() {
    const current = session();
    generation += 1;
    storage?.removeItem(SESSION_KEY);
    message = '';
    scheduleRefresh();
    notify();
    if (!current) return;
    try { await request('/auth/v1/logout?scope=local', { method: 'POST', token: current.accessToken }); } catch {}
  }

  return {
    session, access, initialize, sendLink, signOut,
    message: () => message,
    subscribe(listener) { listeners.add(listener); },
    storageChanged() { scheduleRefresh(); notify(); },
  };
}
