import { cardBack } from './card-back.js';
import { createCard } from '../game/board.js';
import { findCardDefinition } from '../game/card-registry.js';
import { BOOSTER_FACTIONS } from '../game/collection-economy.js';
import { cardButton, showCard } from './cards.js';
import { capsule, economyDialog, liveStatus, packOptions } from './booster-shared.js';
import { button, createBusyGuard, element } from './dom.js';
import { resourceIcon } from './resource-icon.js';

export function createBoosterOpening(progress, openShop) {
  const view = economyDialog('booster-opening', 'Открытие бустеров');
  const inventory = element('div', 'booster-options');
  const stage = element('section', 'booster-stage');
  const status = liveStatus();
  const empty = element('p', 'economy-description', 'Бустеры можно получить в Книге наград или купить за золото.');
  const footer = element('footer', 'economy-footer');
  footer.append(status, button('В магазин бустеров', openShop));
  view.body.append(inventory, empty, stage, footer);

  const busy = createBusyGuard();
  let shownPack;
  let showRevealed;
  let animateNext = false;
  const choices = packOptions('booster-inventory-option').map(({ page, item }) => {
    const quantity = element('p', 'booster-quantity');
    const open = button('Открыть бустер', async () => {
      if (busy.active) return;
      const outcome = await busy.run(() => {
        animateNext = true;
        update();
        return progress.openPack(page.id);
      });
      animateNext = false;
      if (outcome === 'done' && !view.dialog.open) await finish(progress.inventory().pendingPack?.id);
      if (outcome !== 'done') {
        status.textContent = outcome === 'empty' ? 'Этот бустер уже открыт.'
          : outcome === 'pending' ? 'Заверши открытие текущего бустера.' : 'Не удалось сохранить открытие.';
      }
      update();
      if (view.dialog.open) stage.querySelector('.booster-stage-title')?.focus();
    }, 'button primary');
    open.setAttribute('aria-label', 'Открыть бустер «' + page.name + '»');
    item.append(quantity, open);
    inventory.append(item);
    return { page, item, quantity, open };
  });

  const finishing = createBusyGuard();
  async function finish(id) {
    if (id === undefined || finishing.active) return;
    const outcome = await finishing.run(() => progress.finishPack(id));
    if (outcome === 'unavailable') status.textContent = 'Не удалось завершить открытие.';
    return outcome;
  }

  view.dialog.addEventListener('close', () => {
    if (!view.dialog.open) void finish(shownPack);
  });

  function renderPack(pack) {
    stage.replaceChildren();
    shownPack = pack?.id;
    showRevealed = undefined;
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
    const flipping = createBusyGuard();
    async function reveal(id, focus) {
      if (flipping.active) return;
      const outcome = await flipping.run(() => progress.revealPack(pack.id, id));
      update();
      if (outcome === 'unavailable') status.textContent = 'Не удалось сохранить переворот карты.';
      if ((outcome === 'done' || outcome === 'revealed') && view.dialog.open) focus();
    }
    const all = button('Перевернуть все', () => reveal(undefined, () => done.focus({ preventScroll: true })));
    const done = button('Готово', async () => {
      if (done.disabled) return;
      done.disabled = true;
      const outcome = await finish(pack.id);
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
      const def = findCardDefinition(id);
      const item = element('div', 'booster-card-slot');
      item.style.setProperty('--card-index', index);
      item.style.setProperty('--card-travel', (2 - index) * 110 + '%');
      item.style.setProperty('--card-angle', (2 - index) * 12 + 'deg');
      const cover = button(undefined, () => reveal(id, () => face.focus({ preventScroll: true })), 'booster-reveal-card');
      cover.setAttribute('aria-label', `Перевернуть карту ${index + 1} из ${pack.cards.length}`);
      cover.append(cardBack(pack.faction, 'booster-card-back', null) ?? resourceIcon(pack.faction, true));
      const card = createCard(def.id, def);
      const face = cardButton(card, () => showCard(card), { factionId: def.faction }, false, { showProvision: true });
      face.tabIndex = -1;
      face.inert = true;
      face.setAttribute('aria-hidden', 'true');
      const name = element('p', 'booster-revealed-name', def.name);
      name.hidden = true;
      const essence = pack.essenceByCard[id];
      if (essence) {
        const note = element('span', 'booster-dismantled', `Лишняя копия → +${essence} эссенции`);
        note.id = `booster-dismantled-${index}`;
        face.setAttribute('aria-describedby', note.id);
        name.append(note);
      }
      item.append(face, cover, name);

      function flip() {
        if (revealed.has(index)) return;
        revealed.add(index);
        item.classList.add('is-revealed');
        cover.inert = true;
        cover.tabIndex = -1;
        face.inert = false;
        face.tabIndex = 0;
        face.removeAttribute('aria-hidden');
        name.hidden = false;
        if (revealed.size === pack.cards.length) {
          all.disabled = true;
          done.disabled = false;
        }
      }
      line.append(item);
      return { id, flip };
    });

    showRevealed = (ids) => {
      for (const { id, flip } of cards) if (ids.includes(id)) flip();
    };
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
      open.disabled = busy.active;
    }
    if (shownPack !== pendingPack?.id) renderPack(pendingPack);
    if (pendingPack) showRevealed?.(pendingPack.revealed);
  }

  progress.subscribe(update);
  return { ...view, prepare() {
    status.textContent = '';
    update();
  } };
}
