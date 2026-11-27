import { createCloudAuth, SESSION_KEY } from './auth.js';
import { createCloudRequest } from './request.js';
import {
  exportSnapshot, isProgressKey, markProgressChange, parseSnapshot, replaceSnapshot, trackProgressWrites, withProgressLock,
} from './snapshot.js';
import { createCloudSync } from './sync.js';
import { createConflictDialog } from './settings-panel.js';

export function createAppCloud(storage, inMatch) {
  const { location, history } = window;
  const { locks } = navigator;
  const request = createCloudRequest();
  const auth = createCloudAuth({ storage, request, location, history, locks });
  const conflict = createConflictDialog();
  const reload = () => location.reload();
  const sync = createCloudSync({
    storage, request, auth, locks, inMatch, chooseConflict: conflict.choose, onReplaced: reload,
    deviceName: matchMedia('(pointer: coarse)').matches ? 'Сенсорное устройство' : 'Компьютер',
  });
  const trackedStorage = trackProgressWrites(storage, sync.schedule);

  async function start() {
    await auth.initialize();
    let account = auth.session()?.user.id;
    auth.subscribe(() => {
      const id = auth.session()?.user.id;
      if (id === account) return;
      account = id;
      conflict.close();
      sync.accountChanged();
      if (id) void sync.run();
    });
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== storage) return;
      if (event.key === SESSION_KEY || event.key === null) auth.storageChanged();
      if (isProgressKey(event.key)) sync.schedule();
    });
    document.addEventListener('visibilitychange', () => {
      void sync.run({ keepalive: document.hidden });
    });
    window.addEventListener('online', () => { void sync.run(); });
    window.addEventListener('pageshow', (event) => { if (event.persisted) void sync.run(); });
    await sync.run();
  }

  return {
    auth, sync, start, storage: trackedStorage, inMatch,
    exportProgress: () => exportSnapshot(storage, sync.version()),
    async importProgress(data) {
      if (inMatch()) throw new Error('Импорт доступен после выхода из матча.');
      await withProgressLock(locks, () => {
        if (inMatch()) throw new Error('Импорт доступен после выхода из матча.');
        replaceSnapshot(storage, parseSnapshot(data));
        markProgressChange(storage);
        reload();
      });
    },
  };
}
