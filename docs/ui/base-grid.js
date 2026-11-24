import { createTavernScreen } from './tavern-screen.js?v=ulmarin-1';
import { weeklyBundle } from '../game/outpost.js?v=base-outpost-1';
import { BUILDINGS, MAX_BUILDING_LEVEL, buildingEffect, buildingPrice, buildingSlot, constructionShortages } from '../game/base.js?v=tavern-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { dialogClose } from './resources.js?v=essence-gain-1';

export function createBaseGrid(shell, progress, labels, materialIcon) {
  const openTavern = createTavernScreen(progress);
  const toolbar = element('div', 'base-production-toolbar');
  const collectAll = button('Собрать всё', () => collect());
  toolbar.append(collectAll);
  const grid = element('section', 'base-grid');
  grid.setAttribute('aria-label', 'Здания');
  const status = element('p', 'visually-hidden');
  status.setAttribute('role', 'status');
  shell.append(toolbar, grid, status);

  const details = element('dialog', 'panel base-details');
  details.setAttribute('aria-labelledby', 'base-building-title');
  const heading = element('h3');
  heading.id = 'base-building-title';
  const header = element('header', 'drawer-header');
  header.append(heading, dialogClose(details));
  const body = element('div', 'base-details-content');
  details.append(header, body);
  document.body.append(details);

  let busy = false;
  const producers = [];
  let renderWeekly;
  const number = new Intl.NumberFormat('ru');
  const canCollect = (stock) => Object.values(stock?.outputs ?? {}).some(({ stored }) => stored > 0);

  function bundleText(bundle) {
    return Object.entries(bundle).map(([key, value]) => `${labels[key]} ${number.format(value)}`).join(' · ');
  }

  function collect(kind) {
    return claim(() => progress.collect(kind), 'Ресурсы собраны.', 'Пока нечего собирать.');
  }

  async function claim(action, success, empty) {
    if (busy) return;
    busy = true;
    updateProduction();
    const result = await action();
    busy = false;
    updateProduction();
    status.textContent = result === 'done' ? success
      : result === 'unavailable' ? 'Не удалось сохранить сбор.' : empty;
  }

  function updateProduction() {
    const production = progress.production();
    collectAll.disabled = busy || !Object.values(production).some(canCollect);
    for (const [kind, show] of producers) show(production[kind]);
    renderWeekly?.(progress.weeklyOutpost());
  }

  const cards = Object.entries(BUILDINGS).map(([kind, definition]) => {
    const card = element('article', 'base-card');
    card.dataset.building = kind;
    card.setAttribute('aria-labelledby', 'base-card-' + kind);
    const picture = element('div', 'base-card-picture');
    if (definition.art) {
      const art = element('img');
      art.alt = '';
      art.width = art.height = 640;
      art.src = './art/base-card-' + definition.art + '.webp';
      art.addEventListener('error', () => art.remove(), { once: true });
      picture.append(art);
    }
    const info = element('div', 'base-card-info');
    const title = element('h2', null, definition.name);
    title.id = 'base-card-' + kind;
    const effect = element('p', 'base-card-effect');
    const stars = element('span', 'base-card-stars');
    const marks = Array.from({ length: MAX_BUILDING_LEVEL }, () => {
      const mark = element('span');
      mark.setAttribute('aria-hidden', 'true');
      stars.append(mark);
      return mark;
    });
    const actions = element('div', 'base-card-actions');
    const priceLabel = element('p', 'base-card-price-label');
    const price = element('ul', 'base-card-price');
    const shortage = element('p', 'base-shortage');
    let level = 0;
    const open = button('Открыть', () => {
      if (kind === 'tavern') return void openTavern();
      heading.textContent = definition.name;
      body.replaceChildren(element('strong', null, 'Уровень ' + level),
        element('p', null, buildingEffect(kind, level)));
      if (kind === 'outpost') body.append(element('p', null, 'Еженедельно · ' + bundleText(weeklyBundle(level))));
      if (level < MAX_BUILDING_LEVEL) {
        body.append(element('strong', null, 'Следующий уровень · ' + (level + 1)),
          element('p', null, buildingEffect(kind, level + 1)));
        if (kind === 'outpost') body.append(element('p', null, 'Еженедельно · ' + bundleText(weeklyBundle(level + 1))));
      }
      if (definition.details) body.append(element('p', null, definition.details));
      details.showModal();
    }, 'button');
    open.setAttribute('aria-label', 'Открыть: ' + definition.name);
    open.setAttribute('aria-haspopup', 'dialog');
    const purchase = button('', async () => {
      if (busy) return;
      const levelBefore = level;
      busy = true;
      update();
      const result = levelBefore ? await progress.upgrade(kind, levelBefore)
        : await progress.build(buildingSlot(kind), kind);
      busy = false;
      update();
      status.textContent = result === 'done'
        ? `${definition.name} · уровень ${level}`
        : result === 'unavailable' ? 'Не удалось сохранить изменения.' : 'Условия строительства изменились.';
      if (document.activeElement === document.body && shell.closest('dialog')?.open) {
        const focus = !purchase.hidden && !purchase.disabled ? purchase : open;
        focus.focus({ preventScroll: true });
      }
    }, 'button primary');
    actions.append(open, purchase);
    info.append(title, stars, effect);
    if (definition.production) {
      const storage = element('div', 'base-production');
      const quantity = element('p', 'base-production-output');
      const bar = element('progress');
      bar.max = 1;
      bar.setAttribute('aria-label', 'Заполнение · ' + definition.name);
      const full = element('strong', 'base-production-full', 'Полно');
      const collectButton = button('Собрать', () => collect(kind), 'button');
      collectButton.setAttribute('aria-label', 'Собрать: ' + definition.name);
      storage.append(quantity, bar, full, collectButton);
      info.append(storage);
      producers.push([kind, (stock) => {
        storage.hidden = !stock;
        if (!stock) return;
        quantity.textContent = Object.entries(stock.outputs).map(([key, { stored, capacity }]) =>
          `${key === 'keys' ? 'Ключи' : labels[key]} ${number.format(stored)}/${number.format(Math.floor(capacity))}`).join(' · ');
        bar.value = stock.fill;
        full.hidden = !stock.full;
        card.classList.toggle('is-full', stock.full);
        collectButton.disabled = busy || !canCollect(stock);
      }]);
    }
    if (kind === 'outpost') {
      const panel = element('div', 'base-production');
      const title = element('strong', null, 'Еженедельный бонус');
      const bundle = element('p', 'base-production-output');
      const cooldown = element('p', 'base-production-output');
      const claimButton = button('Получить', () => claim(() => progress.claimOutpost(),
        'Еженедельный бонус получен.', 'Еженедельный бонус пока недоступен.'), 'button primary');
      const hour = 3_600_000;
      panel.append(title, bundle, cooldown, claimButton);
      info.append(panel);
      renderWeekly = (weekly) => {
        panel.hidden = !weekly;
        if (!weekly) return;
        bundle.textContent = bundleText(weekly.bundle);
        claimButton.disabled = busy || weekly.remaining > 0;
        const hours = Math.ceil(weekly.remaining / hour);
        cooldown.hidden = !hours;
        cooldown.textContent = `Следующий сбор через ${hours >= 24 ? Math.floor(hours / 24) + ' д ' : ''}${hours % 24} ч`;
      };
    }
    info.append(priceLabel, price, shortage, actions);
    card.append(picture, info);
    grid.append(card);

    return (scene, gold) => {
      level = scene.buildings[buildingSlot(kind)]?.level ?? 0;
      const nextLevel = level + 1;
      const cost = buildingPrice(kind, nextLevel);
      const missing = cost ? constructionShortages(cost, gold, scene.materials) : [];
      card.classList.toggle('is-built', level > 0);
      for (const [index, mark] of marks.entries()) {
        mark.textContent = index < level ? '★' : '☆';
      }
      stars.setAttribute('role', 'img');
      stars.setAttribute('aria-label', level ? `Уровень ${level} из ${MAX_BUILDING_LEVEL}` : 'Не построено');
      effect.textContent = buildingEffect(kind, level || 1);
      open.hidden = !level;
      purchase.hidden = !cost;
      purchase.textContent = level ? 'Улучшить' : 'Построить';
      purchase.setAttribute('aria-label', purchase.textContent + ': ' + definition.name);
      purchase.disabled = busy || missing.length > 0;
      priceLabel.hidden = !level || !cost;
      priceLabel.textContent = `Цена уровня ${nextLevel}`;
      price.hidden = !cost;
      price.setAttribute('aria-label', level ? `Цена уровня ${nextLevel}` : 'Цена постройки');
      price.replaceChildren(...Object.entries(cost ?? {}).map(([key, value]) => {
        const token = element('li');
        token.title = `${labels[key]} · ${value}`;
        token.append(materialIcon(key), element('span', 'visually-hidden', labels[key] + ' '), document.createTextNode(value));
        return token;
      }));
      shortage.hidden = !missing.length;
      shortage.textContent = 'Не хватает · ' + missing.map(([key, value]) => `${labels[key]} ${value}`).join(', ');
    };
  });

  function update(scene = progress.base(), gold = progress.inventory().gold) {
    for (const render of cards) render(scene, gold);
    updateProduction();
  }

  return { update, updateProduction };
}
