import { NEUTRAL } from './game/cards.js?v=neutral-art-complete';
import { burstParticles } from './particles.js?v=step-14';

const VISUAL_EVENTS = new Set([
  'play', 'damage', 'boost', 'armor', 'status', 'death', 'destroy', 'discard', 'spawn', 'deathwish', 'consume', 'consume-group', 'leader', 'order',
]);

function rects(screen) {
  return new Map(Array.from(screen.querySelectorAll('[data-board-card]'), (node) =>
    [node.dataset.boardCard, { node, rect: node.getBoundingClientRect() }]));
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function point(x, y) {
  return 'translate3d(' + x + 'px, ' + y + 'px, 0)';
}

function animate(node, keyframes, duration) {
  if (!node?.animate || !duration) return Promise.resolve();
  const motion = node.animate(keyframes, { duration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
  return motion.finished.catch(() => {}).finally(() => motion.cancel());
}

function floatNode(screen, className, text, { x, y }) {
  const doc = screen.ownerDocument;
  const node = doc.createElement('div');
  node.className = 'motion-overlay ' + className;
  node.textContent = text;
  node.setAttribute('aria-hidden', 'true');
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  doc.body.append(node);
  return node;
}

function moveNeighbors(previous, current, duration) {
  const movements = [];
  for (const [id, entry] of current) {
    const old = previous.get(id);
    if (!old) continue;
    const dx = old.rect.left - entry.rect.left;
    const dy = old.rect.top - entry.rect.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    movements.push(animate(entry.node, [{ transform: point(dx, dy) }, { transform: point(0, 0) }], duration));
  }
  return movements;
}

function oldHandPosition(screen, id) {
  const card = Array.from(screen.querySelectorAll('.hand [data-card-id]')).find(({ dataset }) => dataset.cardId === id);
  return card ? center(card.getBoundingClientRect()) : null;
}

function fly(screen, event, current, handOrigin, duration) {
  const target = current.get(event.cardId);
  const field = screen.querySelector('.field-center');
  if (!target && !field) return [];
  const destination = center(target?.rect ?? field.getBoundingClientRect());
  const view = screen.ownerDocument.defaultView;
  const from = handOrigin ?? { x: destination.x, y: -30 };
  const startY = Math.max(-40, Math.min(view.innerHeight + 40, from.y));
  const art = event.card?.definition.art;
  const card = floatNode(screen, 'motion-flight', art ? '' : event.name, destination);
  if (art) {
    const image = screen.ownerDocument.createElement('img');
    image.className = 'card-art-crop';
    image.src = './art/' + art;
    image.alt = '';
    card.classList.add('has-art');
    card.append(image);
  }
  card.dataset.faction = event.card?.definition.faction === NEUTRAL ? NEUTRAL
    : screen.querySelector('[data-side="' + event.side + '"]')?.dataset.faction ?? '';
  const slide = (factor) => point((from.x - destination.x) * factor, (startY - destination.y) * factor);
  const motion = animate(card, [
    { transform: 'translate(-50%, -50%) ' + slide(1) + ' scale(.92)', opacity: .3 },
    { transform: 'translate(-50%, -50%) ' + slide(.30) + ' scale(1)', opacity: 1, offset: .63 },
    { transform: 'translate(-50%, -50%) scale(' + (target ? '.36' : '.96') + ')', opacity: target ? .1 : 0 },
  ], duration).finally(() => card.remove());
  if (!target) return [motion];
  const { rect, node } = target;
  burstParticles(screen.ownerDocument, 'dust', destination.x, rect.bottom - 2, rect.width,
    duration * .5, duration * .53);
  return [motion, animate(node, [
    { opacity: 0, transform: 'scale(.88)' },
    { opacity: 0, transform: 'scale(.88)', offset: .55 },
    { opacity: 1, transform: 'translateY(3px) scale(1.08,.87)', offset: .66 },
    { opacity: 1, transform: 'translateY(-3px) scale(.98,1.07)', offset: .81 },
    { opacity: 1, transform: 'scale(1)' },
  ], duration)];
}

function ghostCard(screen, entry) {
  const clone = entry.node.cloneNode(true);
  clone.classList.add('motion-overlay', 'motion-departure');
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    left: entry.rect.left + 'px', top: entry.rect.top + 'px',
    width: entry.rect.width + 'px', height: entry.rect.height + 'px',
  });
  screen.ownerDocument.body.append(clone);
  return clone;
}

function leave(screen, entry, faction, duration) {
  if (!entry) return [];
  const clone = ghostCard(screen, entry);
  const growth = faction === 'growth';
  const at = center(entry.rect);
  burstParticles(screen.ownerDocument, growth ? 'slime' : 'sparks', at.x, at.y, entry.rect.width,
    duration * .78, duration * .18);
  return [animate(clone, growth ? [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: .7, transform: 'translateY(3px) scale(.94,.84)', offset: .4 },
    { opacity: 0, transform: 'translateY(22px) scale(.54,.14)' },
  ] : [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: .78, transform: 'scale(1.03)', offset: .2 },
    { opacity: 0, transform: 'translateY(5px) scale(.72)' },
  ], duration).finally(() => clone.remove()), animate(clone.querySelector('.unit-face'), [
    { opacity: 1 }, { opacity: growth ? .58 : .28, offset: .42 }, { opacity: 0 },
  ], duration)];
}

function annihilate(screen, entry, duration) {
  if (!entry) return [];
  const { rect } = entry;
  const { x, y } = center(rect);
  const clone = ghostCard(screen, entry);
  burstParticles(screen.ownerDocument, 'starlight', x, y, rect.width, duration * .8, duration * .18);
  return [
    animate(clone, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: .9, transform: 'scale(1.06)', offset: .2 },
      { opacity: 0, transform: 'scale(.75)', offset: .65 },
      { opacity: 0, transform: 'scale(.75)' },
    ], duration).finally(() => clone.remove()),
    ...cardFlash(screen, entry, 'motion-annihilation', [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.35)' },
      { opacity: .94, transform: 'translate(-50%, -50%) scale(1.1)', offset: .24 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.45)' },
    ], duration),
  ];
}

function swallow(screen, victims, eater, duration) {
  if (!victims.length || !eater) return [];
  const to = center(eater.rect);
  const flights = victims.map((victim) => {
    const clone = ghostCard(screen, victim);
    victim.node.style.opacity = '0';
    const from = center(victim.rect);
    const slide = point(to.x - from.x, to.y - from.y);
    return animate(clone, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: .9, transform: slide + ' scale(.27)', offset: .68 },
      { opacity: 0, transform: slide + ' scale(.06)' },
    ], duration).finally(() => clone.remove());
  });
  return [...flights, animate(eater.node.querySelector('.unit-face'), [
    { transform: 'scale(1)' },
    { transform: 'scale(1)', offset: .5 },
    { transform: 'scale(1.17,1.13)', offset: .69 },
    { transform: 'scale(.96)', offset: .86 },
    { transform: 'scale(1)' },
  ], duration)];
}

function floatingNumber(screen, entry, value, kind, duration) {
  if (!entry) return [];
  const anchor = center(entry.rect);
  anchor.y -= entry.rect.height / 4;
  const number = floatNode(screen, 'motion-number motion-' + kind, value, anchor);
  return [animate(number, [
    { transform: 'translate(-50%, -45%) scale(.86)', opacity: .2 },
    { transform: 'translate(-50%, -92%) scale(1.08)', opacity: 1, offset: .34 },
    { transform: 'translate(-50%, -152%) scale(1)', opacity: 0 },
  ], duration).finally(() => number.remove())];
}

function cardFlash(screen, entry, kind, keyframes, duration) {
  if (!entry) return [];
  const flash = floatNode(screen, 'motion-card-flash ' + kind, '', center(entry.rect));
  flash.style.width = entry.rect.width + 'px';
  flash.style.height = entry.rect.height + 'px';
  return [animate(flash, keyframes, duration).finally(() => flash.remove())];
}

function shield(screen, entry, duration) {
  return cardFlash(screen, entry, 'motion-shield-outline', [
    { transform: 'translate(-50%, -50%) scale(.92)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.02)', opacity: .95, offset: .27 },
    { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 0 },
  ], duration);
}

function orbitalBeam(screen, rect, duration) {
  const { x, y } = center(rect);
  const beam = floatNode(screen, 'motion-orbital-beam', '', { x, y: 0 });
  beam.style.height = Math.max(1, y) + 'px';
  return animate(beam, [
    { transform: 'translateX(-50%) scale(.3,0)', opacity: 0 },
    { transform: 'translateX(-50%) scale(1,1)', opacity: 1, offset: .27 },
    { transform: 'translateX(-50%) scale(.2,1)', opacity: 0 },
  ], duration).finally(() => beam.remove());
}

function projectile(screen, event, entry, duration) {
  if (!entry) return Promise.resolve();
  const sourceLine = screen.querySelector('[data-side="' + event.attacker + '"] [data-row="' + event.sourceRow + '"]');
  const floor = screen.querySelector('.field-center');
  if (!floor) return Promise.resolve();
  const from = center((sourceLine ?? floor).getBoundingClientRect());
  const to = center(entry.rect);
  const shot = floatNode(screen, 'motion-projectile', '', from);
  return animate(shot, [
    { transform: point(0, 0) + ' scale(.65)', opacity: .8 },
    { transform: point(to.x - from.x, to.y - from.y) + ' scale(1.2)', opacity: 1 },
  ], duration).finally(() => shot.remove());
}

function hit(screen, entry, event, duration) {
  if (!entry) return [];
  const { node, rect } = entry;
  const motions = [animate(node.querySelector('.unit-face'), [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-4px) rotate(-2deg)', offset: .17 },
    { transform: 'translateX(4px) rotate(2deg)', offset: .34 },
    { transform: 'translateX(-2px)', offset: .56 },
    { transform: 'translateX(0)' },
  ], duration)];
  motions.push(...cardFlash(screen, entry, 'motion-scratches', [
    { transform: 'translate(-50%, -50%) scale(.95)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.03)', opacity: 1, offset: .23 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ], duration));
  if (event.absorbed && !node.querySelector('.armor-stat')) {
    const { x, y } = center(rect);
    burstParticles(screen.ownerDocument, 'shards', x, y, rect.width, duration);
  }
  if (event.sourceDefinitionId === 'orbital-salvo') motions.push(orbitalBeam(screen, rect, duration));
  motions.push(...floatingNumber(screen, entry, '−' + event.amount, 'damage', duration));
  return motions;
}

function hop(screen, entry, duration) {
  if (!entry) return [];
  const { rect, node } = entry;
  burstParticles(screen.ownerDocument, 'drops', center(rect).x, rect.bottom - 3, rect.width,
    duration * .82, duration * .13);
  return [animate(node, [
    { transform: 'translateY(12px) scale(.43,.28)', opacity: 0 },
    { transform: 'translateY(-9px) scale(.89,1.11)', opacity: 1, offset: .46 },
    { transform: 'translateY(3px) scale(1.13,.88)', opacity: 1, offset: .72 },
    { transform: 'translateY(0) scale(1)', opacity: 1 },
  ], duration)];
}

function showActivation(screen, event, duration) {
  const field = screen.querySelector('.field-center');
  if (!field) return [];
  const labels = { deathwish: 'Завещание', leader: 'Лидер', order: 'Приказ' };
  const name = event.eater ?? event.name;
  const banner = floatNode(screen, 'motion-activation', labels[event.type] + ' · ' + name,
    center(field.getBoundingClientRect()));
  return [animate(banner, [
    { opacity: 0, transform: 'translate(-50%, -40%)' },
    { opacity: 1, transform: 'translate(-50%, -50%)', offset: .36 },
    { opacity: .95, transform: 'translate(-50%, -64%)', offset: .77 },
    { opacity: 0, transform: 'translate(-50%, -72%)' },
  ], duration).finally(() => banner.remove())];
}

function updateScores(screen, previous, duration) {
  const changing = [];
  for (const node of screen.querySelectorAll('[data-score]')) {
    const from = previous.get(node.dataset.score);
    const to = Number(node.textContent);
    if (from === undefined || from === to) continue;
    node.textContent = from;
    changing.push({ node, from, to });
  }
  if (!changing.length) return Promise.resolve();

  const view = screen.ownerDocument.defaultView;
  const start = view.performance.now();
  return new Promise((resolve) => {
    let frame;
    const finish = () => {
      view.cancelAnimationFrame(frame);
      view.clearTimeout(timeout);
      for (const { node, to } of changing) node.textContent = to;
      resolve();
    };
    const update = (now) => {
      const fraction = Math.min(1, (now - start) / duration);
      if (fraction >= 1 || !changing.some(({ node }) => node.isConnected)) {
        finish();
        return;
      }
      const progress = 1 - (1 - fraction) ** 2;
      for (const { node, from, to } of changing) node.textContent = Math.round(from + (to - from) * progress);
      frame = view.requestAnimationFrame(update);
    };
    const timeout = view.setTimeout(finish, duration + 50);
    frame = view.requestAnimationFrame(update);
  });
}

export function animateLifeLoss(screen, winner, duration) {
  for (const lives of screen.querySelectorAll('[data-life-side]')) {
    if (lives.dataset.lifeSide === winner) continue;
    const live = lives.querySelectorAll('.is-live');
    const stone = live[live.length - 1];
    if (!stone) continue;
    lives.setAttribute('aria-label', 'Жизни ' + (live.length - 1) + '/2');
    if (!duration) {
      stone.textContent = '◇';
      continue;
    }
    stone.classList.add('life-lost');
    const crack = stone.ownerDocument.createElement('span');
    crack.className = 'life-crack';
    stone.append(crack);
    animate(stone, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.18) rotate(-7deg)', opacity: 1, offset: .35 },
      { transform: 'scale(.87) rotate(6deg)', opacity: .44, offset: .66 },
      { transform: 'scale(1)', opacity: .38 },
    ], duration);
    animate(crack, [
      { transform: 'scale(.35)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: .36 },
      { transform: 'scale(1)', opacity: .85 },
    ], duration);
  }
}

export function animateCoin(coin, label, duration) {
  animate(coin, [
    { transform: 'translateY(9px) rotateY(0deg) scale(.45)', opacity: 0 },
    { transform: 'translateY(-24px) rotateY(435deg) scale(1.12)', opacity: 1, offset: .42 },
    { transform: 'translateY(2px) rotateY(720deg) scale(1.02,.92)', opacity: 1, offset: .81 },
    { transform: 'translateY(0) rotateY(720deg) scale(1)', opacity: 1 },
  ], duration);
  animate(label, [
    { opacity: 0, transform: 'translateY(4px)' },
    { opacity: 0, transform: 'translateY(4px)', offset: .58 },
    { opacity: 1, transform: 'translateY(0)' },
  ], duration);
}

export async function presentJournalEvent(screen, event, commit, render, duration) {
  if (duration === 0 || !VISUAL_EVENTS.has(event.type)) {
    commit();
    return;
  }

  if (event.type === 'armor' && event.scattered) {
    commit();
    return;
  }
  if (event.scattered) {
    await projectile(screen, event, rects(screen).get(event.cardId), duration * .43);
    duration *= .52;
  }
  if (event.type === 'consume' && event.grouped) {
    commit();
    return;
  }

  const previous = rects(screen);
  const previousScores = new Map(Array.from(screen.querySelectorAll('[data-score]'),
    (node) => [node.dataset.score, Number(node.textContent)]));
  const pile = event.from ? screen.querySelector('[data-pile-side="' + event.side + '"][data-pile="' + event.from + '"]') : null;
  const origin = pile ? center(pile.getBoundingClientRect())
    : event.type === 'play' && event.side === 'human' ? oldHandPosition(screen, event.cardId) : null;
  render(commit());
  const current = rects(screen);
  const entry = current.get(event.cardId);
  const motions = moveNeighbors(previous, current, duration);
  motions.push(updateScores(screen, previousScores, duration * .88));

  switch (event.type) {
    case 'play':
      motions.push(...fly(screen, event, current, origin, duration));
      break;
    case 'spawn':
      for (const { id } of event.cards) motions.push(...hop(screen, current.get(id), duration));
      break;
    case 'armor':
      motions.push(...shield(screen, entry, duration));
      break;
    case 'status':
      if (event.status === 'infection') {
        motions.push(...cardFlash(screen, entry, 'motion-infection', [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' },
          { opacity: .9, transform: 'translate(-50%, -50%) scale(1)', offset: .4 },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(1.12)' },
        ], duration));
        if (event.tick) motions.push(...floatingNumber(screen, entry, '−1', 'poison', duration));
      }
      break;
    case 'damage':
      motions.push(...hit(screen, entry, event, duration));
      break;
    case 'consume':
      motions.push(...swallow(screen, entry ? [entry] : [], current.get(event.eaterId), duration));
      break;
    case 'consume-group':
      motions.push(...swallow(screen, event.cardIds.map((id) => previous.get(id)).filter(Boolean),
        current.get(event.eaterId), duration));
      break;
    case 'boost':
      motions.push(...floatingNumber(screen, entry, '+' + event.amount, 'boost', duration));
      break;
    case 'discard':
    case 'death':
    case 'destroy':
      if (event.visual === 'annihilation') {
        motions.push(...annihilate(screen, previous.get(event.cardId), duration));
      } else if (event.reason !== 'consume') {
        const faction = screen.querySelector('[data-side="' + event.side + '"]')?.dataset.faction;
        motions.push(...leave(screen, previous.get(event.cardId), faction, duration));
      }
      break;
    default:
      motions.push(...showActivation(screen, event, duration));
  }
  await Promise.all(motions);
}
