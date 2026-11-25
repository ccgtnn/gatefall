import { button, element } from './dom.js';

export function campaignShelf(campaigns) {
  const section = element('section', 'campaigns');
  const title = element('h2', null, 'Кампании');
  title.id = 'campaigns-title';
  title.tabIndex = -1;
  section.setAttribute('aria-labelledby', title.id);
  const rail = element('div', 'campaign-slots');
  rail.tabIndex = 0;
  rail.setAttribute('aria-label', 'Лента кампаний');
  const entries = campaigns.length ? campaigns : Array.from({ length: 3 }, () => ({ title: 'Скоро' }));
  const cards = entries.map(({ title, completed, open }) => {
    const card = open ? button(undefined, open, 'campaign-slot') : element('div', 'campaign-slot');
    card.append(element('strong', null, title));
    if (completed) {
      card.dataset.completed = '';
      card.append(element('span', 'campaign-complete', '✓ Пройдена'));
    }
    return card;
  });
  rail.append(...cards);
  section.append(title, rail);

  rail.addEventListener('wheel', (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
    const previous = rail.scrollLeft;
    rail.scrollLeft += event.deltaY * unit;
    if (rail.scrollLeft !== previous) event.preventDefault();
  }, { passive: false });
  let drag;
  let dragged = false;
  rail.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragged = false;
    drag = { id: event.pointerId, start: event.clientX, scroll: rail.scrollLeft };
  });
  rail.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId || !event.buttons) return;
    const distance = event.clientX - drag.start;
    if (!dragged && Math.abs(distance) < 5) return;
    if (!dragged) rail.setPointerCapture(event.pointerId);
    dragged = true;
    rail.scrollLeft = drag.scroll - distance;
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    rail.addEventListener(event, () => { drag = undefined; });
  }
  rail.addEventListener('dragstart', (event) => event.preventDefault());
  rail.addEventListener('click', (event) => {
    if (dragged && event.detail) {
      event.stopPropagation();
      event.preventDefault();
      dragged = false;
    }
  }, { capture: true });

  const firstUnfinished = entries.findIndex(({ completed }) => !completed);
  if (firstUnfinished > 0) requestAnimationFrame(() => {
    if (rail.isConnected) rail.scrollLeft = cards[firstUnfinished].offsetLeft;
  });
  return section;
}
