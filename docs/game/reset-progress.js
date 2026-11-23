import { REWARD_STORAGE_KEY } from './rewards.js?v=hounds-1';

export async function resetProgress(storage, locks) {
  function clearGameData() {
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith('gatefall.')) storage.removeItem(key);
    }
  }
  if (locks) await locks.request(REWARD_STORAGE_KEY, clearGameData);
  else clearGameData();
}
