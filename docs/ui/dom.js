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
