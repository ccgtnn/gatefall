import { button, element, iconButton } from './dom.js';
import { resourceIcon } from './resource-icon.js';
import { MATERIALS } from '../game/base.js';

const resources = [
  ['keys', 'key', 'Ключи', 'Книга наград'],
  ['gold', 'gold', 'Золото', 'Магазин бустеров'],
  ['essence', 'essence', 'Эссенция', 'Все карты'],
  ['packCount', 'booster', 'Бустеры', 'Открытие бустеров'],
];

const walletResources = Object.fromEntries(resources.map(([key, glyph, label]) => [key, { glyph, label }]));
const materialPaths = {
  steel: 'm4 11 12-6 12 6-12 6Zm0 5 12 6 12-6M4 21l12 6 12-6',
  energyCells: 'M10 6h12v23H10zM13 3h6v3m-1 4-4 8h4l-3 6',
  gateShards: 'm16 3 9 10-9 16-9-16zm0 0v26M7 13h18M4 7v4m-2-2h4m21 13v4m-2-2h4',
};

export function resourceLabel(key) {
  const walletKey = key === 'boosters' ? 'packCount' : key;
  return (Object.hasOwn(walletResources, walletKey) && walletResources[walletKey].label) ||
    (Object.hasOwn(MATERIALS, key) && MATERIALS[key]) || key;
}

export function resourceGlyph(key) {
  const walletKey = key === 'boosters' ? 'packCount' : key;
  if (Object.hasOwn(walletResources, walletKey)) return resourceIcon(walletResources[walletKey].glyph);
  if (!Object.hasOwn(materialPaths, key)) return null;
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 32 32');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', materialPaths[key]);
  icon.append(path);
  return icon;
}

function chromeButton(label, outline, handler, className) {
  const control = iconButton(undefined, label, handler, 'chrome-button ' + className);
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', outline);
  icon.append(path);
  control.append(icon);
  return control;
}

export function sectionBack(onBack) {
  return chromeButton('Назад', 'M19 12H5m6-6-6 6 6 6', onBack, 'section-back');
}

export function dialogClose(dialog, className = '') {
  return chromeButton('Закрыть', 'm6 6 12 12M18 6 6 18', () => dialog.close('cancel'), className);
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

export function prepareLazySection(dialog, content, load) {
  let loading;
  let mount;
  let refresh;
  let status;

  function fail(error) {
    console.warn('Section could not be loaded', error);
    mount = undefined;
    status.textContent = 'Не удалось загрузить раздел. Перезагрузи игру и попробуй снова.';
  }

  function prepare() {
    if (refresh) return refresh();
    if (mount) {
      try {
        const update = mount();
        update();
        status.remove();
        refresh = update;
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (loading) return loading;
    status = element('p', 'economy-status', 'Загружаем…');
    status.setAttribute('role', 'status');
    content.append(status);
    loading = load().then((ready) => {
      mount = ready;
      if (dialog.open) prepare();
    }, fail);
    return loading;
  }

  return prepare;
}

const essenceNotices = new WeakMap();

export function showEssenceGain(amount) {
  const balance = document.querySelector('.card-preview[open] [data-essence-balance]') ??
    document.querySelector('.resource-bar [data-essence-balance]');
  if (!balance) return;
  const previous = essenceNotices.get(balance);
  clearTimeout(previous?.timer);
  const total = (previous?.total ?? 0) + amount;
  const notice = previous?.notice ?? element('span', 'essence-gain');
  if (!previous) {
    notice.setAttribute('role', 'status');
    balance.append(notice);
  }
  const count = '+' + total.toLocaleString('ru');
  notice.textContent = count;
  notice.setAttribute('aria-label', count + ' эссенции');
  const timer = setTimeout(() => {
    notice.remove();
    essenceNotices.delete(balance);
  }, 2800);
  essenceNotices.set(balance, { notice, total, timer });
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
    control.append(resourceGlyph(key), count);
    if (key === 'essence') {
      const balance = element('span', 'resource-balance');
      balance.dataset.essenceBalance = '';
      balance.append(control);
      bar.append(balance);
    } else bar.append(control);
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
