import { createCard, statusCount } from '../game/board.js?v=catalog-rarity-1';
import { insertionPoint } from '../card-placement.js?v=catalog-rarity-1';
import { button, element, iconButton, sideLabel } from './dom.js?v=catalog-rarity-1';
import { ROWS, ROW_LABELS } from '../game/cards.js?v=catalog-rarity-1';
import { cardArt, cardButton, cardInspection, decorateCard, showCard } from './cards.js?v=catalog-rarity-1';
import { playerHand } from './hand.js?v=catalog-rarity-1';
import { availableOrders, canUseLeader, leaderCooldown, rowArmor, ROW_EFFECTS } from '../game/effects.js?v=catalog-rarity-1';
import { HAND_LIMIT, ROW_LIMIT, canEndTurn, canPass, rowScore, totalScore } from '../game/match.js?v=catalog-rarity-1';

export function createBattlefield({ getMatch, isReplaying, getSelectedCardId, isMulliganFieldVisible, setMulliganField,
  playHuman, humanCanAct, placeSelected, settingsButton, showDrawer, selectCard, mulliganScreen }) {
  function rowView(match, side, player, row, readyOrders) {
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
      const { icon, label: name } = ROW_EFFECTS[effect.type];
      const badge = element('span', 'row-effect-badge', icon + effect.remaining);
      badge.title = `${name} · осталось ходов: ${effect.remaining}`;
      label.setAttribute('aria-label', label.getAttribute('aria-label') + ' · ' + badge.title);
      label.append(badge);
    }
    if (rowTarget) {
      label.classList.add('effect-target');
      label.setAttribute('aria-label', armorTarget
        ? `Снять броню с ряда «${ROW_LABELS[row]}» · броня ${rowArmor(player, row)}`
        : pending.kind === 'row-effect' ? `Наложить Гниение на ряд «${ROW_LABELS[row]}»`
        : side === 'bot' ? `Нанести урон во вражеском ряду «${ROW_LABELS[row]}»`
          : `Породить личинки в ряду «${ROW_LABELS[row]}»`);
    }
    const slots = element('div', 'row-line');
    slots.dataset.castZone = '';
    slots.dataset.row = row;
    const cards = player.board[row];
    slots.classList.toggle('is-selectable', Boolean(rowTarget || deckPlacement));
    slots.dataset.playRow = row;
    slots.dataset.side = side;
    slots.dataset.full = String(cards.length >= ROW_LIMIT);
    slots.addEventListener('click', (event) => {
      if (event.target.closest('.unit-order, .placement-choice')) return;
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
      const face = button(undefined, () => {
        if (target) playHuman({ type: 'target', cardId: card.id });
        else if (!rowTarget && !deckPlacement && !isReplaying() && getSelectedCardId() === undefined) showCard(card);
      }, 'unit-face');
      decorateCard(face, card, player, { orderOnField: Boolean(card.definition.order) });
      if (target) face.classList.add('effect-target');
      if (statusCount(card, 'doomed')) face.classList.add('is-doomed');
      cardInspection(face, card);
      slot.append(face);
      if (card.definition.order) {
        const cooldown = Math.max(0, card.readyAt - player.turns);
        const ready = readyOrders.has(card.id);
        const label = 'Приказ · ' + (ready ? 'готов' : cooldown ? 'осталось ходов: ' + cooldown : 'нет цели');
        const mark = ready ? '⚑' : cooldown > 0 ? cooldown : '◷';
        const order = side === 'human'
          ? button(mark, () => playHuman({ type: 'order', cardId: card.id }), 'card-state unit-order')
          : element('span', 'card-state unit-order', mark);
        if (side === 'human') order.disabled = !humanCanAct() || !ready;
        order.classList.toggle('order-ready', ready);
        order.classList.toggle('order-sleep', !ready);
        order.setAttribute('aria-label', label + ' · ' + card.definition.name);
        order.title = label;
        slot.append(order);
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
    section.setAttribute('aria-label', sideLabel[side]);
    const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
    section.append(...rows.map((row) => rowView(match, side, player, row, readyOrders)));
    if (side === 'bot' && player.passed) section.append(element('p', 'opponent-passed', 'ПАС'));
    return section;
  }

  function leaderView(match, side) {
    const player = match.players[side];
    const { leader } = player;
    const panel = element('div', 'field-leader');
    panel.dataset.faction = player.factionId ?? '';
    if (!leader) return panel;
    const portrait = button(undefined, () => showCard({ definition: leader }, { leader: true }), 'leader-portrait');
    portrait.setAttribute('aria-label', 'Лидер · ' + leader.name);
    portrait.title = leader.name;
    if (leader.art) portrait.append(cardArt(leader, 'leader-image'));
    else portrait.append(element('span', 'leader-placeholder', '♜'));
    cardInspection(portrait, { definition: leader }, false, () => showCard({ definition: leader }, { leader: true }));
    const cooldown = leaderCooldown(player);
    const power = button(leader.order ? (cooldown ? '◷ ' + cooldown : '⚑') : 'ϟ ' + leader.charges,
      () => playHuman({ type: 'leader' }), 'leader-power');
    power.title = leader.text;
    power.setAttribute('aria-label', leader.name + ' · ' + (leader.order
      ? cooldown ? 'Перезарядка приказа: ' + cooldown : 'Приказ лидера'
      : 'зарядов ' + leader.charges));
    power.disabled = side !== 'human' || !humanCanAct() || !canUseLeader(match, side);
    panel.append(portrait, power);
    return panel;
  }

  function scoreView(match, side) {
    const player = match.players[side];
    const panel = element('div', 'field-score');
    panel.dataset.faction = player.factionId ?? '';
    const points = totalScore(player);
    const total = element('strong', 'field-total', points);
    total.dataset.score = side;
    total.setAttribute('aria-label', sideLabel[side] + ' · сила ' + points);
    const lives = element('span', 'field-lives');
    lives.dataset.lifeSide = side;
    lives.setAttribute('role', 'img');
    lives.setAttribute('aria-label', 'Жизни ' + player.lives + '/2');
    for (let index = 0; index < 2; index += 1) {
      const live = index < player.lives;
      lives.append(element('span', live ? 'life-stone is-live' : 'life-stone', live ? '◆' : '◇'));
    }
    panel.append(total, lives);
    if (side === 'bot') {
      const count = element('span', 'field-hand-count bot-hand-count');
      count.title = 'Карт в руке у бота';
      count.setAttribute('role', 'img');
      count.setAttribute('aria-label', 'Карт в руке у бота: ' + player.hand.length);
      count.append(element('span', null, '▯'), element('strong', null, player.hand.length));
      panel.append(count, element('span', 'field-round', 'Раунд ' + match.round));
    }
    if (side === 'human' && player.passed) panel.append(element('span', 'field-passed', 'Пас'));
    return panel;
  }

  function pileView(match, side, pile) {
    const player = match.players[side];
    const count = player[pile].length;
    const name = pile === 'deck' ? 'Колода' : 'Сброс';
    const label = sideLabel[side] + ' · ' + name + ' · ' + count;
    const viewable = pile === 'discard' || side === 'human';
    const node = viewable ? button(undefined, () => showDrawer({ side, pile }), 'field-pile')
      : element('div', 'field-pile');
    node.dataset.faction = player.factionId ?? '';
    node.dataset.pileSide = side;
    node.dataset.pile = pile;
    node.title = label;
    node.setAttribute('aria-label', label);
    node.append(element('span', 'pile-icon', pile === 'deck' ? '▤' : '▱'), element('strong', null, count));
    return node;
  }

  function deckChoice(match) {
    const { pending, players: { human } } = match;
    const panel = element('section', 'deck-offer panel');
    const title = element('h2', null, pending.prompt);
    title.id = 'deck-choice-title';
    panel.setAttribute('aria-labelledby', title.id);
    const choices = element('div', 'deck-choice-cards');
    const pile = pending.pile ?? 'deck';
    const options = new Set(pending.options);
    const selectable = human[pile].filter(({ id }) => pending.fullDeck || options.has(id));
    const scrollable = pending.fullDeck || pending.kind === 'deck-top' || pile === 'discard';
    if (scrollable) {
      panel.classList.add('pile-offer');
      selectable.sort((a, b) => a.definition.name.localeCompare(b.definition.name, 'ru'));
    }
    for (const item of selectable) {
      const card = pile === 'discard' ? createCard(item.id, item.definition) : item;
      const node = cardButton(card, () => playHuman({ type: 'target', cardId: card.id }), human);
      node.disabled = !options.has(card.id);
      node.classList.toggle('effect-target', !node.disabled);
      node.append(element('span', 'deck-choice-name', card.definition.name));
      choices.append(node);
    }
    panel.append(title, choices);
    return panel;
  }

  function battlefield() {
    const match = getMatch();
    const game = element('div', 'match-screen');
    const field = element('div', 'match-board');
    const { pending, players, phase } = match;
    field.classList.toggle('is-human-turn', phase === 'playing' && !isReplaying() && match.turn === 'human');
    const center = element('div', 'field-center battlefield');
    const humanOrders = readyOrderIds(match, 'human');
    center.append(sideView(match, 'bot', readyOrderIds(match, 'bot')), sideView(match, 'human', humanOrders));
    if (!isReplaying() && pending?.side === 'human') {
      if (pending.kind === 'deck-card' || pending.kind === 'deck-top') center.append(deckChoice(match));
      else {
        const picked = pending.kind === 'deck-placement' && players.human[pending.pile ?? 'deck'].find(({ id }) => id === pending.cardId);
        const prompt = picked ? picked.definition.name + ' · ' + pending.prompt : pending.prompt;
        center.append(element('p', 'field-message target-prompt', prompt));
      }
    }
    const left = element('div', 'field-rail field-left');
    left.append(settingsButton(), pileView(match, 'bot', 'discard'), leaderView(match, 'bot'),
      iconButton('▤', 'Журнал ходов', () => showDrawer('journal'), 'field-log'),
      leaderView(match, 'human'), pileView(match, 'human', 'discard'));
    const right = element('div', 'field-rail field-right');
    const afterPlay = match.turn === 'human' && match.playedCard;
    const action = button(afterPlay ? 'Конец хода' : 'Пас', () =>
      playHuman({ type: afterPlay ? 'end-turn' : 'pass' }), 'button field-action');
    action.id = 'pass-button';
    action.disabled = !humanCanAct() || !(afterPlay ? canEndTurn(match, 'human') : canPass(match, 'human'));
    if (afterPlay && !action.disabled && humanOrders.size) {
      action.classList.add('has-ready-order');
      action.title = 'Есть готовый Приказ';
      action.setAttribute('aria-description', action.title);
    }
    if (humanCanAct() && !afterPlay && players.human.usedAbility) action.title = 'Сыграй карту после применения способности';
    const humanCount = element('span', 'field-hand-count', players.human.hand.length + '/' + HAND_LIMIT);
    humanCount.title = 'Карт в твоей руке';
    const humanCorner = element('div', 'field-corner');
    humanCorner.append(humanCount, pileView(match, 'human', 'deck'));
    right.append(pileView(match, 'bot', 'deck'), scoreView(match, 'bot'), action, scoreView(match, 'human'), humanCorner);
    field.append(left, center, playerHand(match, humanCanAct() && !match.playedCard, selectCard, isReplaying), right);
    game.append(field);
    if (phase === 'mulligan') {
      field.inert = !isMulliganFieldVisible();
      game.append(isMulliganFieldVisible()
        ? button('К муллигану', () => setMulliganField(false), 'button mulligan-return')
        : mulliganScreen());
    }
    const rotate = element('div', 'rotate-notice');
    rotate.append(element('p', null, 'Поверни телефон'), settingsButton());
    game.append(rotate);
    return game;
  }

  return battlefield;
}
