import { activeOrder, opponent, statusCount } from '../game/engine/board.js';
import { insertionPoint, placementEffectRows } from './card-placement.js';
import { button, element, sideLabel } from './dom.js';
import { ROWS, ROW_LABELS } from '../game/shared/card-metadata.js';
import { cardInspection, decorateCard, showCard } from './cards.js';
import { spawnRowLabel } from './field-labels.js';
import { availableFees, availableOrders, rowArmor, ROW_EFFECTS } from '../game/effects/effects.js';
import { ROW_LIMIT, rowScore } from '../game/engine/match.js';
import { orderBadge } from './stat-badges.js';

export function createFieldRows({ getSelectedCardId, humanCanAct, isReplaying, placeSelected, playHuman }) {
  function rowView(match, side, player, row, readyOrders, readyFees) {
    const wrapper = element('div', 'board-row');
    const pending = !isReplaying() && match.pending?.side === 'human' ? match.pending : null;
    const deckPlacement = pending?.kind === 'deck-placement' &&
      (pending.selectionSide ?? 'human') === side && pending.options.includes(row);
    const rowTarget = pending?.kind !== 'deck-placement' && pending?.selectionSide === side && pending.options.includes(row);
    const armorTarget = rowTarget && pending.kind === 'armor-row';
    const chooseRow = () => playHuman({ type: 'target', cardId: row });
    const place = (position) => playHuman({ type: 'place', row, position });
    const strength = rowScore(player, row);
    const label = button(undefined, rowTarget ? chooseRow : () => placeSelected(row, side), 'row-label');
    label.disabled = !rowTarget;
    label.setAttribute('aria-label', `Сыграть карту в ${side === 'bot' ? 'ряд противника' : 'ряд'} «${ROW_LABELS[row]}» · сила ${strength}`);
    const score = element('strong', 'row-score', strength);
    score.dataset.score = side + '-' + row;
    score.title = ROW_LABELS[row] + ' · ' + strength;
    score.setAttribute('aria-label', score.title);
    if (side === 'bot') label.title = score.title;
    const rowIcon = element('span', 'row-icon', row === 'orbit' ? '◎' : '▲');
    rowIcon.setAttribute('aria-hidden', 'true');
    label.append(rowIcon, score);
    const effect = player.rowEffects?.[row];
    if (effect) {
      wrapper.dataset.rowEffect = effect.type;
      const { icon, label: name } = ROW_EFFECTS[effect.type];
      const badge = element('span', 'row-effect-badge', icon + effect.remaining);
      badge.title = `${name} · осталось ходов: ${effect.remaining}`;
      label.setAttribute('aria-label', label.getAttribute('aria-label') + ' · ' + badge.title);
      label.append(badge);
    }
    if (rowTarget) {
      label.classList.add('effect-target');
      label.dataset.aimTarget = row;
      label.setAttribute('aria-label', armorTarget
        ? `Снять броню с ряда «${ROW_LABELS[row]}» · броня ${rowArmor(player, row)}`
        : pending.kind === 'mark-row' ? `Отметить отряды ряда «${ROW_LABELS[row]}»`
          : pending.kind === 'row-effect' ? `Наложить Гниение на ряд «${ROW_LABELS[row]}»`
          : side === 'bot' ? `Нанести урон во вражеском ряду «${ROW_LABELS[row]}»`
            : spawnRowLabel(pending, ROW_LABELS[row]));
    }
    const slots = element('div', 'row-line');
    slots.dataset.castZone = '';
    if (rowTarget) slots.dataset.aimTarget = row;
    slots.dataset.row = row;
    const cards = player.board[row];
    slots.classList.toggle('is-selectable', Boolean(rowTarget || deckPlacement));
    if (deckPlacement) {
      const card = (pending.cards ?? match.players.human[pending.pile ?? 'deck']).find(({ id }) => id === pending.cardId);
      if (card && placementEffectRows(card.definition).includes(row)) slots.classList.add('is-placement-effect-row');
    }
    slots.dataset.playRow = row;
    slots.dataset.side = side;
    slots.dataset.full = String(cards.length >= ROW_LIMIT);
    slots.addEventListener('click', (event) => {
      if (event.target.closest('.unit-order, .unit-fee, .placement-choice')) return;
      if (rowTarget) chooseRow();
      else if (deckPlacement) {
        const rects = Array.from(slots.querySelectorAll('.slot.filled'), (node) => node.getBoundingClientRect());
        place(insertionPoint(slots.getBoundingClientRect(), rects, event.clientX).position);
      } else if (slots.classList.contains('is-selectable')) placeSelected(row, side);
    });
    for (const card of cards) {
      const target = !isReplaying() && match.pending?.side === 'human' && match.pending.options.includes(card.id);
      const slot = element('div', 'slot filled');
      slot.dataset.boardCard = card.id;
      if (match.hiddenDuringPlayback?.has(card.id)) slot.style.opacity = '0';
      const cooldown = Math.max(0, card.readyAt - player.turns);
      const ready = readyOrders.has(card.id);
      const inspect = () => showCard(card, { orderReady: ready, orderCooldown: cooldown });
      const face = button(undefined, () => {
        if (target) playHuman({ type: 'target', cardId: card.id });
        else if (!pending && !isReplaying() && getSelectedCardId() === undefined) inspect();
      }, 'unit-face');
      decorateCard(face, card, player, { orderOnField: Boolean(card.definition.order) });
      if (statusCount(card, 'lock')) face.classList.add('is-locked');
      if (target) {
        face.classList.add('effect-target');
        face.dataset.aimTarget = card.id;
      }
      if (statusCount(card, 'doomed')) face.classList.add('is-doomed');
      cardInspection(face, card, false, inspect);
      slot.append(face);
      if (statusCount(card, 'shield')) {
        const halo = element('span', 'force-shield-aura');
        halo.setAttribute('aria-hidden', 'true');
        face.setAttribute('aria-label', face.getAttribute('aria-label') + ' · Силовой щит активен');
        slot.append(halo);
      }
      if (activeOrder({ card, row }) || card.orderCharges !== undefined) {
        const state = statusCount(card, 'lock') ? 'заблокирован' : ready ? 'готов'
          : card.orderCharges === 0 ? 'заряды исчерпаны' : cooldown ? 'осталось ходов: ' + cooldown : 'нет цели';
        const charges = card.orderCharges === undefined ? '' : ' · Осталось зарядов: ' + card.orderCharges;
        const label = 'Приказ · ' + state + charges;
        const order = side === 'human'
          ? button(undefined, () => playHuman({ type: 'order', cardId: card.id }), 'unit-order stat-order-control')
          : element('span', 'unit-order stat-order-control');
        order.append(orderBadge(ready, cooldown, label, card.orderCharges));
        if (side === 'human') order.disabled = !humanCanAct() || !ready;
        order.classList.toggle('order-ready', ready);
        order.classList.toggle('order-sleep', !ready);
        order.setAttribute('aria-label', label + ' · ' + card.definition.name);
        order.title = label;
        slot.append(order);
      }
      if (side === 'human' && card.definition.fee) {
        const cost = card.definition.fee.coins;
        const fee = button('◉ ' + cost, () => playHuman({ type: 'fee', cardId: card.id }), 'unit-fee');
        fee.disabled = !humanCanAct() || !readyFees.has(card.id);
        fee.title = 'Плата ' + cost + ' · ' + card.definition.name;
        fee.setAttribute('aria-label', fee.title);
        slot.append(fee);
      }
      slots.append(slot);
    }
    if (cards.length === 0) {
      const placeholder = element('div', 'slot');
      placeholder.setAttribute('aria-hidden', 'true');
      slots.append(placeholder);
    }
    if (deckPlacement) {
      const choices = element('div', 'placement-choices');
      for (let index = 0; index <= cards.length; index += 1) {
        const node = button(index + 1, () => place(index), 'placement-choice effect-target');
        node.dataset.aimTarget = row;
        node.setAttribute('aria-label', ROW_LABELS[row] + ' · позиция ' + (index + 1));
        choices.append(node);
      }
      slots.append(choices);
    }
    wrapper.append(label, slots);
    return wrapper;
  }

  function readyOrderIds(match, side) {
    return new Set(availableOrders(match, side).map(({ card }) => card.id));
  }

  function sideView(match, side, readyOrders) {
    const player = match.players[side];
    const section = element('section', 'side');
    section.dataset.side = side;
    section.dataset.faction = player.factionId ?? '';
    const underStorm = ROWS.some((row) => match.players[opponent(side)].board[row]
      .some(({ definition }) => definition.fieldAura === 'psionic-storm'));
    section.toggleAttribute('data-psionic-storm', underStorm);
    section.setAttribute('aria-label', sideLabel[side] + (underStorm ? ' · Псионная буря' : ''));
    const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
    const readyFees = new Set(availableFees(match, side).map(({ card }) => card.id));
    section.append(...rows.map((row) => rowView(match, side, player, row, readyOrders, readyFees)));
    if (side === 'bot' && player.passed) section.append(element('p', 'opponent-passed', 'ПАС'));
    return section;
  }

  return { readyOrderIds, sideView };
}
