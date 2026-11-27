import { GAME_STORAGE_PREFIX, REWARD_STORAGE_KEY } from '../../game/shared/storage-keys.js';

const DEVICE_SETTINGS = new Set([
  'gatefall.animation-speed',
  'gatefall.sound-enabled',
  'gatefall.sound-volume',
  'gatefall.bot-thoughts',
  'gatefall.premium-card-art',
  'gatefall.card-frame',
  'gatefall.battlefield',
  'gatefall.bot-difficulty',
]);
const LAST_CHANGE_KEY = 'gatefall-cloud.changed-at';

export function isProgressKey(key) {
  return typeof key === 'string' && key.startsWith(GAME_STORAGE_PREFIX) && !DEVICE_SETTINGS.has(key);
}

export function readSnapshot(storage) {
  if (!storage) throw new Error('Локальное хранилище недоступно.');
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  return Object.fromEntries(keys.filter(isProgressKey).sort().flatMap((key) => {
    const value = storage.getItem(key);
    return value === null ? [] : [[key, value]];
  }));
}

export function validateSnapshot(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Object.entries(data).every(([key, value]) => isProgressKey(key) && typeof value === 'string')) {
    throw new Error('Файл или облачная копия содержит некорректный прогресс.');
  }
  return Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]]));
}

export function parseSnapshot(text) {
  let document;
  try { document = JSON.parse(text.replace(/^\uFEFF/, '')); } catch {}
  if (!Number.isSafeInteger(document?.version) || document.version < 0) {
    throw new Error('Выбери JSON-файл, созданный через экспорт прогресса.');
  }
  return validateSnapshot(document.data);
}

export function exportSnapshot(storage, version = 0) {
  return JSON.stringify({ version, data: readSnapshot(storage) }, null, 2) + '\n';
}

export function downloadSnapshot(json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gatefall-progress.json';
  try { link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function replaceSnapshot(storage, data) {
  const next = validateSnapshot(data);
  const previous = readSnapshot(storage);
  function replace(from, to) {
    for (const key of Object.keys(from)) {
      if (!Object.hasOwn(to, key)) storage.removeItem(key);
    }
    for (const [key, value] of Object.entries(to)) {
      if (storage.getItem(key) !== value) storage.setItem(key, value);
    }
  }
  try {
    replace(previous, next);
  } catch (error) {
    replace(readSnapshot(storage), previous);
    throw error;
  }
}

export function withProgressLock(locks, task) {
  return locks ? locks.request(REWARD_STORAGE_KEY, task) : task();
}

export function markProgressChange(storage, at = new Date().toISOString()) {
  try { storage?.setItem(LAST_CHANGE_KEY, at); } catch {}
}

export function progressChangedAt(storage) {
  return storage?.getItem(LAST_CHANGE_KEY);
}

export function trackProgressWrites(storage, onChanged, { background = false } = {}) {
  if (!storage) return undefined;
  return {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      const changed = isProgressKey(key) && storage.getItem(key) !== String(value);
      storage.setItem(key, value);
      if (changed) {
        if (!background) markProgressChange(storage);
        onChanged();
      }
    },
  };
}
