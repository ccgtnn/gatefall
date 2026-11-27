export const sideLabel = { human: 'Ты', bot: 'Бот' };

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text, handler, className = 'button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

export function iconButton(icon, label, handler, className = '') {
  const node = button(icon, handler, ('icon-button ' + className).trim());
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

export function confirmDeckDeletion(title, onConfirm, host = document.body) {
  const dialog = element('dialog', 'deck-delete-dialog');
  dialog.setAttribute('aria-label', `Удалить колоду „${title}“?`);
  const actions = element('div', 'deck-toolbar deck-delete-actions');
  const cancel = button('Отмена', () => dialog.close('cancel'));
  const remove = button('Удалить', () => dialog.close('delete'), 'button deck-danger');
  actions.append(cancel, remove);
  dialog.append(element('h3', null, `Удалить колоду „${title}“?`),
    element('p', 'muted', 'Действие нельзя отменить.'), actions);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue === 'delete') onConfirm();
  }, { once: true });
  host.append(dialog);
  dialog.showModal();
  return dialog;
}

export function setCardRarity(node, rarity) {
  if (rarity) node.dataset.rarity = rarity;
  else delete node.dataset.rarity;
}

export function selectField(label, options, className = 'deck-field') {
  const field = element('label', className);
  const input = element('select');
  for (const [value, name] of options) {
    const option = element('option', null, name);
    option.value = value;
    input.append(option);
  }
  field.append(element('span', null, label), input);
  return { field, input };
}

export function createBusyGuard() {
  let active = false;
  return {
    get active() { return active; },
    async run(task) {
      if (active) return;
      active = true;
      try {
        return await task();
      } catch (error) {
        console.error('UI action failed', error);
        return 'unavailable';
      } finally {
        active = false;
      }
    },
  };
}
