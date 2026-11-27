import { button, element } from '../dom.js';

function dateLabel(value) {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? 'дата неизвестна' : date.toLocaleString('ru-RU');
}

export function createConflictDialog() {
  const dialog = element('dialog', 'panel settings-dialog');
  const title = element('h2', null, 'Прогресс на этом устройстве и в облаке разный');
  title.id = 'cloud-conflict-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const local = element('p');
  const cloud = element('p');
  const actions = element('div', 'settings-actions');
  actions.append(
    button('Оставить облачный', () => dialog.close('cloud')),
    button('Оставить этот', () => dialog.close('local'), 'button primary'),
    button('Решить позже', () => dialog.close('')),
  );
  dialog.append(title, local, cloud, actions);
  document.body.append(dialog);
  return {
    close() { if (dialog.open) dialog.close(''); },
    choose({ localAt, remote }) {
      local.textContent = 'На этом устройстве · ' + dateLabel(localAt);
      cloud.textContent = 'В облаке · ' + dateLabel(remote.updated_at) + (remote.device ? ' · ' + remote.device : '');
      dialog.returnValue = '';
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
      });
    },
  };
}

export function mountCloudSettings(settings, appCloud) {
  const { auth, sync } = appCloud;
  const section = element('section', 'cloud-settings');
  const title = element('h3', null, 'Облачное сохранение');
  section.setAttribute('aria-label', title.textContent);
  const form = element('form', 'settings-actions');
  const label = element('label', 'cloud-email', 'E-mail');
  const email = element('input');
  email.type = 'email';
  email.autocomplete = 'email';
  email.required = true;
  label.append(email);
  const signIn = element('button', 'button primary', 'Войти');
  signIn.type = 'submit';
  form.append(label, signIn);

  const signedIn = element('div');
  const account = element('p', 'cloud-account');
  const actions = element('div', 'settings-actions');
  const syncNow = button('Синхронизировать сейчас', async () => {
    syncNow.disabled = true;
    try { await sync.run({ manual: true }); } finally { syncNow.disabled = false; }
  });
  const signOut = button('Выйти', async () => {
    try { await auth.signOut(); }
    catch { status.textContent = 'Не удалось выйти. Попробуй снова.'; }
  });
  actions.append(syncNow, signOut);
  signedIn.append(account, actions);
  const status = element('p', 'muted');
  status.setAttribute('role', 'status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    signIn.disabled = true;
    try { await auth.sendLink(email.value.trim()); } finally { signIn.disabled = false; }
  });

  const transfer = element('div', 'settings-actions');
  const file = element('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  const transferStatus = element('p', 'muted');
  transferStatus.setAttribute('role', 'status');
  const download = button('Экспорт прогресса', () => {
    try {
      const blob = new Blob([appCloud.exportProgress()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = element('a');
      link.href = url;
      link.download = 'gatefall-progress.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      transferStatus.textContent = '';
    } catch {
      transferStatus.textContent = 'Не удалось экспортировать прогресс.';
    }
  });
  const upload = button('Импорт прогресса', () => file.click());
  file.addEventListener('change', async () => {
    const [selected] = file.files;
    file.value = '';
    if (!selected) return;
    try {
      const data = await selected.text();
      if (!window.confirm('Заменить локальный прогресс содержимым файла?')) return;
      await appCloud.importProgress(data);
      transferStatus.textContent = '';
    } catch (error) {
      transferStatus.textContent = error.message || 'Не удалось импортировать прогресс.';
    }
  });
  transfer.append(download, upload, file);
  section.append(title, form, signedIn, status, transfer, transferStatus);
  settings.append(section);

  function refresh() {
    const session = auth.session();
    form.hidden = Boolean(session);
    signedIn.hidden = !session;
    account.textContent = session ? 'Вы вошли: ' + session.user.email : '';
    status.textContent = auth.message() || (session ? sync.status() : '');
    upload.disabled = appCloud.inMatch();
    if (upload.disabled) upload.title = 'Импорт доступен после выхода из матча.';
    else upload.removeAttribute('title');
  }
  sync.subscribe(refresh);
  auth.subscribe(refresh);
  refresh();
  return refresh;
}
