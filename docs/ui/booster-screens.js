import { createCard } from '../game/board.js?v=reward-routes-1';
import { FACTIONS, NEUTRAL_CARDS } from '../game/cards.js?v=reward-routes-1';
import { BOOSTER_FACTIONS, BOOSTER_PRICE } from '../game/rewards.js?v=reward-routes-1';
import { cardButton, showCard } from './cards.js?v=reward-routes-1';
import { button, element } from './dom.js?v=opponent-reveal-1';
import { resourceIcon } from './resource-icon.js?v=1';

const definitions = new Map([...NEUTRAL_CARDS, ...Object.values(FACTIONS).flatMap(({ pool }) => pool)]
  .map((card) => [card.id, card]));

export function economyDialog(id, title) {
  const dialog = element('dialog', 'reward-book economy-page');
  dialog.id = id;
  dialog.setAttribute('aria-labelledby', id + '-title');
  const shell = element('div', 'reward-shell');
  const header = element('header', 'reward-header');
  const heading = element('h2', null, title);
  heading.id = id + '-title';
  heading.tabIndex = -1;
  heading.autofocus = true;
  header.append(button('Назад', () => dialog.close(), 'button reward-back'), heading);
  const body = element('div', 'economy-content');
  shell.append(header, body);
  dialog.append(shell);
  document.body.append(dialog);
  return { dialog, header, body };
}

function capsule(page) {
  const pack = element('span', 'booster-capsule');
  pack.dataset.faction = page.id;
  pack.setAttribute('aria-hidden', 'true');
  pack.append(resourceIcon(page.id, true), element('span', 'booster-capsule-rim'));
  return pack;
}

function packOptions(className) {
  return BOOSTER_FACTIONS.map((page) => {
    const item = element('article', 'booster-option ' + className);
    item.dataset.faction = page.id;
    item.style.setProperty('--booster-art', `url('./art/${page.image}')`);
    item.append(capsule(page), element('h3', null, page.name));
    return { page, item };
  });
}

function liveStatus() {
  const status = element('p', 'economy-status');
  status.setAttribute('role', 'status');
  return status;
}

export function createBoosterShop(progress, openPacks) {
  const view = economyDialog('booster-shop', 'Магазин бустеров');
  const description = element('p', 'economy-description', 'В каждом бустере пять карт выбранной фракции.');
  const options = element('div', 'booster-options');
  const status = liveStatus();
  let busy = false;
  const choices = packOptions('booster-shop-option').map(({ page, item }) => {
    const balance = element('p', 'booster-quantity');
    const buy = button(undefined, async () => {
      if (busy) return;
      busy = true;
      update();
      const outcome = await progress.buyPack(page.id);
      busy = false;
      update();
      status.textContent = outcome === 'done' ? `Куплен бустер «${page.name}».`
        : outcome === 'unaffordable' ? 'Нужно 100 золота.' : 'Не удалось сохранить покупку.';
      if (!buy.disabled && view.dialog.open) buy.focus({ preventScroll: true });
    }, 'button booster-price');
    buy.setAttribute('aria-label', `Купить бустер «${page.name}» за ${BOOSTER_PRICE} золота`);
    buy.append(resourceIcon('gold'), element('span', null, BOOSTER_PRICE));
    item.append(balance, buy);
    options.append(item);
    return { page, balance, buy };
  });
  const footer = element('footer', 'economy-footer');
  footer.append(status, button('К открытию бустеров', openPacks));
  view.body.append(description, options, footer);

  function update() {
    const { gold, boosters } = progress.inventory();
    for (const { page, balance, buy } of choices) {
      balance.textContent = `В наличии · ${boosters[page.id]}`;
      buy.disabled = busy || gold < BOOSTER_PRICE;
    }
  }

  progress.subscribe(update);
  return { ...view, prepare() {
    status.textContent = '';
    update();
  } };
}

export function createBoosterOpening(progress, openShop) {
  const view = economyDialog('booster-opening', 'Открытие бустеров');
  const inventory = element('div', 'booster-options');
  const stage = element('section', 'booster-stage');
  const status = liveStatus();
  const empty = element('p', 'economy-description', 'Бустеры можно получить в Книге наград или купить за золото.');
  const footer = element('footer', 'economy-footer');
  footer.append(status, button('В магазин бустеров', openShop));
  view.body.append(inventory, empty, stage, footer);

  let busy = false;
  let shownPack;
  let animateNext = false;
  const choices = packOptions('booster-inventory-option').map(({ page, item }) => {
    const quantity = element('p', 'booster-quantity');
    const open = button('Открыть', async () => {
      if (busy) return;
      busy = true;
      animateNext = true;
      update();
      const outcome = await progress.openPack(page.id);
      busy = false;
      animateNext = false;
      if (outcome !== 'done') {
        status.textContent = outcome === 'empty' ? 'Этот бустер уже открыт.'
          : outcome === 'pending' ? 'Заверши открытие текущего бустера.' : 'Не удалось сохранить открытие.';
      }
      update();
      if (view.dialog.open) stage.querySelector('.booster-stage-title')?.focus();
    }, 'button booster-open-button');
    open.setAttribute('aria-label', 'Открыть бустер «' + page.name + '»');
    item.append(quantity, open);
    inventory.append(item);
    return { page, item, quantity, open };
  });

  function renderPack(pack) {
    stage.replaceChildren();
    shownPack = pack?.id;
    if (!pack) return;
    const page = BOOSTER_FACTIONS.find(({ id }) => id === pack.faction);
    stage.dataset.faction = pack.faction;
    stage.classList.toggle('is-opening', animateNext && view.dialog.open);
    const burst = element('div', 'booster-burst');
    burst.append(capsule(page));
    const heading = element('h3', 'booster-stage-title', 'Бустер · ' + page.name);
    heading.tabIndex = -1;
    const line = element('div', 'booster-card-line');
    line.setAttribute('aria-label', 'Карты из бустера');
    const actions = element('div', 'booster-reveal-actions');
    const revealed = new Set();
    const all = button('Перевернуть все', () => {
      cards.forEach(({ flip }) => flip(false));
      done.focus({ preventScroll: true });
    });
    const done = button('Готово', async () => {
      if (done.disabled) return;
      done.disabled = true;
      const outcome = await progress.finishPack(pack.id);
      if (outcome === 'done') {
        const next = choices.find(({ item }) => !item.hidden)?.open ?? footer.querySelector('button');
        next.focus({ preventScroll: true });
      } else {
        update();
        status.textContent = 'Не удалось завершить открытие.';
        done.disabled = false;
      }
    }, 'button primary');
    done.disabled = true;

    const cards = pack.cards.map((id, index) => {
      const def = definitions.get(id);
      const item = element('div', 'booster-card-slot');
      item.style.setProperty('--card-index', index);
      item.style.setProperty('--card-travel', (2 - index) * 110 + '%');
      item.style.setProperty('--card-angle', (2 - index) * 12 + 'deg');
      const cover = button(undefined, () => flip(true), 'booster-reveal-card');
      cover.setAttribute('aria-label', `Перевернуть карту ${index + 1} из ${pack.cards.length}`);
      cover.append(resourceIcon(pack.faction, true));
      const card = createCard(def.id, def);
      const face = cardButton(card, () => showCard(card), { factionId: def.faction }, false, { showProvision: true });
      face.tabIndex = -1;
      face.inert = true;
      face.setAttribute('aria-hidden', 'true');
      const name = element('p', 'booster-revealed-name', def.name);
      name.hidden = true;
      item.append(face, cover, name);

      function flip(focus) {
        if (revealed.has(index)) return;
        revealed.add(index);
        item.classList.add('is-revealed');
        cover.inert = true;
        cover.tabIndex = -1;
        face.inert = false;
        face.tabIndex = 0;
        face.removeAttribute('aria-hidden');
        name.hidden = false;
        if (focus) face.focus({ preventScroll: true });
        if (revealed.size === pack.cards.length) {
          all.disabled = true;
          done.disabled = false;
        }
      }
      line.append(item);
      return { flip };
    });

    actions.append(all, done);
    stage.append(heading, burst, line, actions);
  }

  function update() {
    const { boosters, packCount, pendingPack } = progress.inventory();
    inventory.hidden = Boolean(pendingPack) || !packCount;
    stage.hidden = !pendingPack;
    empty.hidden = Boolean(pendingPack) || Boolean(packCount);
    for (const { page, item, quantity, open } of choices) {
      item.hidden = !boosters[page.id];
      quantity.textContent = `В наличии · ${boosters[page.id]}`;
      open.disabled = busy;
    }
    if (shownPack !== pendingPack?.id) renderPack(pendingPack);
  }

  progress.subscribe(update);
  return { ...view, prepare() {
    status.textContent = '';
    update();
  } };
}
