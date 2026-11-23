import { button, element } from './dom.js?v=opponent-reveal-1';
import { resourceGlyph, resourceLabel } from './resources.js?v=reward-reveal-1';

const MERGE_MS = 1500;

export function createRewardQueue(now = Date.now) {
  const pending = [];
  let completed = 0;
  let lastCollected;

  function enqueueReward({ title, source, reward }, showing = false) {
    const amounts = Object.entries(reward).filter(([, value]) => Number.isSafeInteger(value) && value > 0);
    if (!amounts.length) return false;
    const time = now();
    const last = pending.at(-1) ?? lastCollected;
    const lastIsVisible = showing && pending.length === 1;
    const merge = last?.source === source && (lastIsVisible || time - last.time <= MERGE_MS);
    const totals = new Map(merge ? Object.entries(last.reward) : []);
    for (const [key, value] of amounts) totals.set(key, (totals.get(key) ?? 0) + value);

    const entry = {
      title: merge && last.title !== title ? source : title,
      source,
      reward: Object.fromEntries(totals),
      time,
    };
    if (merge && pending.length) pending[pending.length - 1] = entry;
    else pending.push(entry);
    lastCollected = undefined;
    return true;
  }

  return {
    enqueueReward,
    current: () => pending[0],
    remaining: () => pending.length,
    position: () => completed + 1,
    total: () => completed + pending.length,
    collect() {
      const collected = pending.shift();
      if (!collected) return;
      if (pending.length) completed += 1;
      else {
        completed = 0;
        lastCollected = collected;
      }
    },
    collectAll() {
      pending.length = 0;
      completed = 0;
      lastCollected = undefined;
    },
  };
}

const queue = createRewardQueue();
let reveal;

export function enqueueReward(entry) {
  if (queue.enqueueReward(entry, reveal?.isOpen())) reveal?.refresh();
}

export function createRewardReveal({ motion, canShow }) {
  const dialog = element('dialog', 'reward-reveal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'reward-reveal-title');
  const header = element('header', 'reward-reveal-header');
  const source = element('p', 'reward-reveal-source');
  const title = element('h2', null);
  title.id = 'reward-reveal-title';
  const counter = element('p', 'reward-reveal-count');
  header.append(source, title, counter);
  const items = element('ul', 'reward-reveal-items');
  items.setAttribute('aria-live', 'polite');
  const actions = element('footer', 'reward-reveal-actions');
  const collect = button('Получить', () => advance(false), 'button primary');
  collect.autofocus = true;
  const all = button('Забрать всё', () => advance(true));
  actions.append(collect, all);
  dialog.append(header, items, actions);
  document.body.append(dialog);

  let scheduled = false;
  let rendered;
  let renderedPosition;
  const idle = new Set();
  function show() {
    scheduled = false;
    if (!canShow() || !queue.current()) return;
    const entry = queue.current();
    const position = queue.position();
    const entering = !dialog.open;
    const newPage = entering || renderedPosition !== position;
    if (rendered !== entry) {
      rendered = entry;
      renderedPosition = position;
      title.textContent = entry.title;
      source.textContent = entry.source;
      source.hidden = entry.source === entry.title;
      items.replaceChildren(...Object.entries(entry.reward).map(([key, amount]) => {
        const item = element('li', 'reward-reveal-item');
        item.dataset.resource = key;
        const icon = resourceGlyph(key);
        if (icon) item.append(icon);
        item.append(element('strong', null, '+' + amount.toLocaleString('ru')),
          element('span', null, resourceLabel(key)));
        return item;
      }));
    }
    counter.hidden = queue.total() <= 1;
    counter.textContent = `${position} из ${queue.total()}`;
    all.hidden = queue.remaining() <= 2;
    if (entering) dialog.showModal();
    if (newPage) {
      collect.focus({ preventScroll: true });
      const duration = motion();
      if (!duration) return;
      if (entering) {
        dialog.style.setProperty('--reward-enter', duration + 'ms');
        dialog.classList.add('is-entering');
      }
      [...items.children].forEach((item, index) => item.animate?.([
        { opacity: 0, transform: 'translateY(.65rem) scale(.72)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration, delay: index * Math.round(duration / 5), easing: 'ease-out', fill: 'backwards' }));
    }
  }

  function refresh() {
    if (!canShow() || !queue.current()) return;
    if (dialog.open) {
      show();
      return;
    }
    if (scheduled) return;
    scheduled = true;
    // Let the source screen finish updating or close its own modal first.
    setTimeout(show, 0);
  }

  function advance(allAtOnce) {
    if (!dialog.open) return;
    if (allAtOnce) queue.collectAll();
    else queue.collect();
    if (queue.current()) show();
    else {
      rendered = undefined;
      dialog.classList.remove('is-entering');
      dialog.close();
      for (const resolve of idle) resolve();
      idle.clear();
    }
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    advance(false);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    if (event.repeat) event.preventDefault();
    else if (event.key === 'Enter' && event.target !== all) {
      event.preventDefault();
      advance(false);
    }
  });

  reveal = { refresh, isOpen: () => dialog.open };
  refresh();
  return {
    refresh,
    whenIdle: () => queue.current() ? new Promise((resolve) => idle.add(resolve)) : Promise.resolve(),
    hasPending: () => Boolean(queue.current()),
  };
}
