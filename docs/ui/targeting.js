const TARGET = '[data-aim-target]';
const COLORS = {
  damage: '#ff6649',
  boost: '#ffdc80',
  mark: '#ff9a43',
  infection: '#a7dc80',
  neutral: '#8edcff',
};

export function aimTone(kind, side) {
  if (['target-mark', 'mark-row'].includes(kind)) return 'mark';
  if (['infection', 'infection-target', 'row-effect'].includes(kind)) return 'infection';
  if (['boost', 'armor', 'marshal', 'ready-order'].includes(kind)) return 'boost';
  if (side === 'bot' || ['damage', 'friendly-damage', 'leader-offering', 'consume', 'emp', 'spend-armor'].includes(kind)) return 'damage';
  return 'neutral';
}

export function aimGeometry(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = Math.min(64, Math.hypot(dx, dy) * .22);
  return {
    curve: `M${start.x} ${start.y} Q${start.x + dx * .42 + bend} ${start.y + dy * .42 - bend} ${end.x} ${end.y}`,
    length: Math.hypot(dx, dy),
  };
}

function center(node) {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function bindTargeting(screen, cancel) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('aim-overlay');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><marker id="aim-tip" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L11 6 1 11 4 6Z" fill="var(--aim-color)"/></marker></defs><path class="aim-curve" fill="none" stroke-linecap="round" marker-end="url(#aim-tip)"/>';
  screen.after(svg);
  const curve = svg.querySelector('.aim-curve');
  let source;
  let pointer;
  let snapped;
  let tap;

  function clear() {
    snapped?.classList.remove('aim-snapped');
    snapped = undefined;
    svg.classList.remove('is-visible');
  }

  function draw(target, point) {
    clear();
    const origin = typeof source === 'function' ? source() : source;
    if (!origin || !point) return;
    const { curve: path, length } = aimGeometry(origin, point);
    if (length > 8) {
      curve.setAttribute('d', path);
      svg.classList.add('is-visible');
    }
    snapped = target;
    snapped?.classList.add('aim-snapped');
  }

  function nearest(event, node) {
    const direct = node?.closest?.(TARGET);
    if (direct) return direct;
    if (!screen.contains(node) || node.closest?.('button, [data-board-card]')) return;
    let distance = 17;
    let closest;
    for (const target of screen.querySelectorAll(TARGET)) {
      const { left, top, right, bottom, width, height } = target.getBoundingClientRect();
      if (!width || !height) continue;
      const edge = Math.hypot(Math.max(left - event.clientX, event.clientX - right, 0),
        Math.max(top - event.clientY, event.clientY - bottom, 0));
      if (edge < distance) {
        closest = target;
        distance = edge;
      }
    }
    return closest;
  }

  function follow(event) {
    if (!source || tap || event?.pointerType !== 'mouse') return;
    const target = nearest(event, document.elementFromPoint(event.clientX, event.clientY));
    draw(target, target ? center(target) : { x: event.clientX, y: event.clientY });
  }

  screen.addEventListener('pointermove', (event) => {
    pointer = event;
    if (!tap) clear();
    follow(event);
  });
  screen.addEventListener('pointerleave', () => {
    pointer = undefined;
    if (!tap) clear();
  });
  screen.addEventListener('pointerdown', (event) => { pointer = event; });
  screen.addEventListener('click', (event) => {
    if (!source || !event.detail) return;
    if (pointer?.pointerType !== 'mouse') {
      tap = event.target.closest(TARGET);
      return;
    }
    const target = nearest(event, event.target);
    if (!target || target.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.click();
  }, true);
  document.addEventListener('contextmenu', (event) => {
    if (!source || event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents ||
        document.querySelector('dialog[open]') || !cancel()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && cancel()) event.preventDefault();
  });
  window.addEventListener('resize', () => { if (!tap) clear(); });

  return {
    update(origin, tone) {
      source = origin;
      screen.classList.toggle('is-aiming', Boolean(source));
      tap = undefined;
      clear();
      if (source) {
        screen.style.setProperty('--aim-color', COLORS[tone]);
        svg.style.setProperty('--aim-color', COLORS[tone]);
        follow(pointer);
      }
    },
    showTap() {
      if (!source || !tap) return false;
      draw(tap, center(tap));
      return true;
    },
  };
}

export function aimAnchor(node) {
  return node && (() => center(node));
}
