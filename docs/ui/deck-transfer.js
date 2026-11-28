import { serializeDeckJson } from './deck-storage.js';
import { button, element } from './dom.js';
import { dialogClose } from './resources.js';

import { downloadJson } from './download-json.js';

export async function exportDeckJson(deck, status) {
  const text = serializeDeckJson(deck);
  const name = deck.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  let copy;
  try { copy = navigator.clipboard?.writeText(text); } catch {}
  downloadJson(text, (name || 'Колода') + '.json');
  try {
    if (!copy) {
      status.textContent = 'Файл скачан. Буфер обмена недоступен.';
      return;
    }
    await copy;
    status.textContent = 'Скопировано';
  } catch {
    status.textContent = 'Файл скачан. Не удалось скопировать JSON в буфер обмена.';
  }
}

export function exportOwnDecks(decks) {
  downloadJson(serializeDeckJson(decks), 'gatefall-decks.json');
}

export function deckImportDialog(importJson, onImported) {
  const dialog = element('dialog', 'panel settings-dialog deck-import-dialog');
  dialog.setAttribute('aria-label', 'Импорт JSON');
  const header = element('header', 'drawer-header');
  header.append(element('h2', null, 'Импорт JSON'), dialogClose(dialog));
  const form = element('form');
  const textLabel = element('label', 'deck-field');
  const text = element('textarea');
  text.rows = 8;
  text.autofocus = true;
  textLabel.append(element('span', null, 'Вставь JSON с колодами'), text);
  const fileLabel = element('label', 'deck-field');
  const file = element('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  fileLabel.append(element('span', null, 'Или выбери файл JSON'), file);
  const errors = element('ul', 'deck-invalid');
  errors.setAttribute('role', 'alert');
  const submit = button('Импортировать', undefined, 'button primary');
  submit.type = 'submit';
  form.append(textLabel, fileLabel, errors, submit);
  dialog.append(header, form);

  const showErrors = (messages) => errors.replaceChildren(...messages.map((message) => element('li', null, message)));
  let read = 0;
  file.addEventListener('change', async () => {
    const current = ++read;
    const [selected] = file.files;
    submit.disabled = Boolean(selected);
    if (!selected) return;
    showErrors([]);
    try {
      const json = await selected.text();
      if (current === read) text.value = json;
    } catch {
      if (current === read) showErrors(['Не удалось прочитать файл.']);
    } finally {
      if (current === read) {
        file.value = '';
        submit.disabled = false;
      }
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const result = importJson(text.value);
    if (result.errors) {
      showErrors(result.errors);
      return;
    }
    dialog.close();
    onImported(result);
  });
  dialog.addEventListener('close', () => {
    read += 1;
    submit.disabled = false;
    form.reset();
    showErrors([]);
  });
  return dialog;
}
