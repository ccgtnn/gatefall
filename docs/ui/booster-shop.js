import { BOOSTER_PRICE } from '../game/collection-economy.js';
import { economyDialog, liveStatus, packOptions } from './booster-shared.js';
import { button, createBusyGuard, element } from './dom.js';
import { resourceIcon } from './resource-icon.js';

export function createBoosterShop(progress, openPacks) {
  const view = economyDialog('booster-shop', 'Магазин бустеров');
  const description = element('p', 'economy-description', 'В каждом бустере пять карт выбранной фракции.');
  const options = element('div', 'booster-options');
  const status = liveStatus();
  const busy = createBusyGuard();
  const choices = packOptions('booster-shop-option').map(({ page, item }) => {
    const balance = element('p', 'booster-quantity');
    const buy = button(undefined, async () => {
      if (busy.active) return;
      const outcome = await busy.run(() => {
        update();
        return progress.buyPack(page.id);
      });
      update();
      status.textContent = outcome === 'done' ? `Куплен бустер «${page.name}».`
        : outcome === 'unaffordable' ? 'Нужно 100 золота.' : 'Не удалось сохранить покупку.';
      if (!buy.disabled && view.dialog.open) buy.focus({ preventScroll: true });
    }, 'button primary booster-price');
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
      buy.disabled = busy.active || gold < BOOSTER_PRICE;
    }
  }

  progress.subscribe(update);
  return { ...view, prepare() {
    status.textContent = '';
    update();
  } };
}
