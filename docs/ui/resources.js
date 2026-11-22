import { button, element, iconButton } from './dom.js?v=opponent-reveal-1';
import { resourceIcon } from './resource-icon.js?v=1';

const resources = [
  ['keys', 'key', 'Ключи', 'Книга наград'],
  ['gold', 'gold', 'Золото', 'Магазин бустеров'],
  ['essence', 'essence', 'Эссенция', 'Все карты'],
  ['packCount', 'booster', 'Бустеры', 'Открытие бустеров'],
];

export function sectionBack(onBack) {
  return iconButton('←', 'Назад', onBack, 'section-back');
}

export function sectionDialog(id, title, className = '') {
  const dialog = element('dialog', ('reward-book ' + className).trim());
  dialog.id = id;
  dialog.setAttribute('aria-label', title);
  const back = sectionBack(() => dialog.close());
  back.autofocus = true;
  const shell = element('div', 'reward-shell');
  dialog.append(back, shell);
  document.body.append(dialog);
  return { dialog, shell };
}

export function createResourceBar(home, settings, progress, routes) {
  const bar = element('nav', 'resource-bar');
  bar.setAttribute('aria-label', 'Ресурсы и настройки');
  let active;
  let opener;

  function show(key) {
    const next = routes[key];
    if (next === active) return;
    if (active) active.dialog.close();
    else opener = document.activeElement;
    active = next;
    next.prepare?.();
    next.dialog.querySelector('.section-back').after(bar);
    next.dialog.showModal();
    update();
  }

  for (const route of Object.values(routes)) {
    route.dialog.addEventListener('close', () => {
      if (active !== route || route.dialog.open) return;
      active = undefined;
      home.append(bar);
      opener?.focus({ preventScroll: true });
    });
  }

  const numbers = resources.map(([key, glyph, label, title]) => {
    const control = button(undefined, () => show(key), 'resource-button');
    control.dataset.resource = glyph;
    control.id = key === 'keys' ? 'rewards-entry' : glyph + '-entry';
    control.setAttribute('aria-haspopup', 'dialog');
    control.setAttribute('aria-controls', routes[key].dialog.id);
    const count = element('strong');
    control.append(resourceIcon(glyph), count);
    bar.append(control);
    return { key, label, title, control, count };
  });
  bar.append(settings);
  home.append(bar);

  function update() {
    const balances = progress.inventory();
    for (const { key, label, title, control, count } of numbers) {
      count.textContent = balances[key];
      control.title = `${label} · ${balances[key]} · ${title}`;
      control.setAttribute('aria-label', control.title);
      if (routes[key] === active) control.setAttribute('aria-current', 'page');
      else control.removeAttribute('aria-current');
    }
  }

  for (const { dialog } of Object.values(routes)) dialog.addEventListener('close', update);
  progress.subscribe(update);
  update();
  return show;
}
