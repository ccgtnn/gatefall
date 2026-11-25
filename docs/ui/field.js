import { assetUrl } from '../asset-url.js';
import { leagueCharacter } from './league-character.js';
import { activeOrder, opponent, restoreCard, statusCount } from '../game/board.js';
import { insertionPoint, placementEffectRows } from '../card-placement.js';
import { button, element, iconButton, sideLabel } from './dom.js';
import { ROWS, ROW_LABELS } from '../game/card-metadata.js';
import { cardArt, cardButton, cardInspection, decorateCard, showCard } from './cards.js';
import { playerHand } from './hand.js';
import { availableFees, availableOrders, canUseLeader, leaderCooldown, rowArmor, ROW_EFFECTS } from '../game/effects.js';
import { HAND_LIMIT, ROW_LIMIT, canEndTurn, canPass, rowScore, totalScore } from '../game/match.js';

import { orderBadge } from './stat-badges.js';

export function createBattlefield({ getMatch, isReplaying, getSelectedCardId, isMulliganFieldVisible, setMulliganField,
  playHuman, humanCanAct, placeSelected, settingsButton, showDrawer, selectCard, mulliganScreen, getLeagueOpponent, getLeagueSpeech }) {
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
            : `Породить личинки в ряду «${ROW_LABELS[row]}»`);
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
      if (activeOrder({ card, row })) {
        const label = 'Приказ · ' + (ready ? 'готов' : cooldown ? 'осталось ходов: ' + cooldown : 'нет цели');
        const order = side === 'human'
          ? button(undefined, () => playHuman({ type: 'order', cardId: card.id }), 'unit-order stat-order-control')
          : element('span', 'unit-order stat-order-control');
        order.append(orderBadge(ready, cooldown, label));
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

  function leaderView(match, side) {
    const player = match.players[side];
    const { leader } = player;
    const panel = element('div', 'field-leader');
    panel.dataset.faction = player.factionId ?? '';
    if (!leader) return panel;
    const portrait = button(undefined, () => showCard({ definition: leader }, { leader: true }), 'leader-portrait');
    portrait.dataset.aimLeader = side;
    portrait.setAttribute('aria-label', 'Лидер · ' + leader.name);
    portrait.title = leader.name;
    if (leader.art) portrait.append(cardArt(leader, 'leader-image'));
    else portrait.append(element('span', 'leader-placeholder', '♜'));
    cardInspection(portrait, { definition: leader }, false, () => showCard({ definition: leader }, { leader: true }));
    panel.append(portrait);
    if (!leader.ability) return panel;
    const cooldown = leaderCooldown(player);
    const power = button(leader.order ? (cooldown ? '◷ ' + cooldown : '⚑') : 'ϟ ' + leader.charges,
      () => playHuman({ type: 'leader' }), 'leader-power');
    power.title = leader.text;
    power.setAttribute('aria-label', leader.name + ' · ' + (leader.order
      ? cooldown ? 'Перезарядка приказа: ' + cooldown : 'Приказ лидера'
      : 'зарядов ' + leader.charges));
    power.disabled = side !== 'human' || !humanCanAct() || !canUseLeader(match, side);
    panel.append(power);
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
    panel.append(element('span', 'field-score-side', sideLabel[side]), total, lives);
    const coins = element('span', 'field-coins');
    coins.dataset.coinsSide = side;
    coins.setAttribute('aria-label', 'Боевые монеты: ' + (player.coins ?? 0));
    const coinIcon = element('span', null, '◉');
    coinIcon.setAttribute('aria-hidden', 'true');
    coins.append(coinIcon, element('strong', null, player.coins ?? 0));
    panel.append(coins);
    if (side === 'bot') {
      const count = element('span', 'field-hand-count bot-hand-count');
      count.classList.toggle('is-passed', player.passed);
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

  function handSummary(player, side) {
    const human = side === 'human';
    const stack = human
      ? button(undefined, () => showDrawer({ side, pile: 'deck' }), 'field-hand-stack')
      : element('div', 'field-hand-stack');
    const counts = `В руке: ${player.hand.length} · В колоде: ${player.deck.length}`;
    if (human) {
      stack.setAttribute('aria-label', 'Открыть свою колоду. ' + counts);
      stack.title = 'Открыть свою колоду';
    }
    const backs = element('span', 'field-hand-backs');
    backs.setAttribute('aria-hidden', 'true');
    const art = player.factionId === 'growth' ? 'back-growth.webp' : 'back-protectorate.webp';
    for (let index = 0; index < player.hand.length; index += 1) {
      const back = element('img');
      back.src = assetUrl('./art/' + art);
      back.alt = '';
      backs.append(back);
    }
    stack.classList.toggle('is-passed', player.passed);
    const numbers = element('span', 'field-hand-numbers');
    numbers.append(element('span', null, 'В руке: ' + player.hand.length),
      element('span', null, 'В колоде: ' + player.deck.length));
    if (human) stack.append(backs, numbers);
    else stack.append(numbers, backs);
    return stack;
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
    const selectable = (pending.cards ?? human[pile]).filter(({ id }) => pending.fullDeck || options.has(id));
    const scrollable = pending.fullDeck || pending.kind === 'deck-top' || pile === 'discard' || pile === 'hand';
    if (scrollable) {
      panel.classList.add('pile-offer');
      if (pile !== 'hand') selectable.sort((a, b) => a.definition.name.localeCompare(b.definition.name, 'ru'));
    }
    for (const item of selectable) {
      const card = pile === 'discard' ? restoreCard(item) : item;
      const node = cardButton(card, () => playHuman({ type: 'target', cardId: card.id }), human);
      node.disabled = !options.has(card.id);
      node.classList.toggle('effect-target', !node.disabled);
      if (!node.disabled) node.dataset.aimTarget = card.id;
      node.append(element('span', 'deck-choice-name', card.definition.name));
      choices.append(node);
    }
    panel.append(title, choices);
    return panel;
  }

  function tributeChoice(pending) {
    const offer = element('section', 'deck-offer panel');
    const heading = element('h2', null, pending.prompt);
    heading.id = 'deck-choice-title';
    offer.setAttribute('aria-labelledby', heading.id);
    const options = element('div', 'tribute-choices');
    for (const cost of pending.options) {
      const label = cost === '0' ? 'Без взноса' : `◉ ${cost} · Гончие ×${pending.tiers[cost]}`;
      options.append(button(label, () => playHuman({ type: 'target', cardId: cost }), 'button effect-target'));
    }
    offer.append(heading, options);
    return offer;
  }

  function battlefield() {
    const match = getMatch();
    const game = element('div', 'match-screen');
    const field = element('div', 'match-board');
    const { pending, players, phase } = match;
    const replaying = isReplaying();
    const humanTurn = phase === 'playing' && !replaying && match.turn === 'human';
    field.classList.toggle('is-human-turn', humanTurn);
    const center = element('div', 'field-center battlefield');
    const humanOrders = readyOrderIds(match, 'human');
    center.append(sideView(match, 'bot', readyOrderIds(match, 'bot')), sideView(match, 'human', humanOrders));
    if (!isReplaying() && pending?.side === 'human') {
      if (['deck-card', 'deck-top', 'hand-bottom', 'hand-return'].includes(pending.kind)) center.append(deckChoice(match));
      else if (pending.kind === 'tribute') center.append(tributeChoice(pending));
      else {
        const picked = pending.kind === 'deck-placement' && (pending.cards ?? players.human[pending.pile ?? 'deck']).find(({ id }) => id === pending.cardId);
        const prompt = picked ? picked.definition.name + ' · ' + pending.prompt : pending.prompt;
        center.append(element('p', 'field-message target-prompt', prompt));
      }
    }
    const left = element('div', 'field-rail field-left');
    left.append(settingsButton(), pileView(match, 'bot', 'discard'), leaderView(match, 'bot'),
      iconButton('▤', 'Журнал ходов', () => showDrawer('journal'), 'field-log'),
      leaderView(match, 'human'), pileView(match, 'human', 'discard'));
    const right = element('div', 'field-rail field-right');
    const afterPlay = match.turn === 'human' && (match.playedCard || canEndTurn(match, 'human'));
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
    const turnControls = element('div', 'field-turn-controls');
    if (phase === 'playing') {
      const turn = replaying ? 'Розыгрыш' : humanTurn ? 'Твой ход' : 'Ход бота';
      turnControls.append(element('p', 'field-turn-label', turn));
    }
    turnControls.append(action);
    const botCorner = pileView(match, 'bot', 'deck');
    botCorner.classList.add('field-compact-count');
    humanCorner.classList.add('field-compact-count');
    const botHand = handSummary(players.bot, 'bot');
    right.append(botCorner, botHand, scoreView(match, 'bot'), turnControls, scoreView(match, 'human'),
      handSummary(players.human, 'human'), humanCorner);
    field.append(left, center, playerHand(match, humanCanAct() && !match.playedCard, selectCard, isReplaying), right);
    const opponent = getLeagueOpponent();
    const stage = opponent ? element('div', 'league-battle-stage') : game;
    if (opponent) {
      game.classList.add('league-battle');
      const speech = getLeagueSpeech();
      const character = leagueCharacter(opponent, { compact: true, line: speech?.line });
      if (speech) {
        // Keep the entrance animation in sync when playback rebuilds the field.
        character.querySelector('.league-speech').style.animationDelay = `${Math.min(0, speech.shownAt - Date.now())}ms`;
      }
      game.append(character, stage);
    }
    stage.append(field);
    if (phase === 'mulligan') {
      field.inert = !isMulliganFieldVisible();
      stage.append(isMulliganFieldVisible()
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
