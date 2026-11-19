import { bindCardPlacement } from './card-placement.js';
import { FACTIONS, ROWS, ROW_LABELS } from './game/cards.js';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js';
import { availableOrders, canUseLeader } from './game/effects.js';
import {
  HAND_LIMIT, MULLIGAN_LIMIT, ROW_LIMIT, applyAction, canPlayCard,
  confirmMulligan, createMatch, rowScore, totalScore,
} from './game/match.js';

const screen = document.querySelector('#screen');
const phaseLabel = document.querySelector('#phase');
const announcement = document.querySelector('#announcement');

let match;
let selected = new Set();
let timer;
let previewTimer;
const preview = document.createElement('aside');
preview.className = 'card-preview panel';
preview.setAttribute('role', 'status');
preview.hidden = true;
document.body.append(preview);
const sideLabel = { human: 'Ты', bot: 'Бот' };

const cancelPlacement = bindCardPlacement(screen, (cardId, position) => {
  playHuman({ type: 'play', cardId, position });
}, (node) => {
  const card = match.players.human.hand.find(({ id }) => id === node.dataset.cardId);
  if (card) showCard(card, true);
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, handler, className = 'button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function humanCanAct() {
  return match.turn === 'human' && !match.pending;
}

function hideCard() {
  clearTimeout(previewTimer);
  preview.hidden = true;
}

function showCard(card, temporary = false) {
  clearTimeout(previewTimer);
  const { definition, power, armor } = card;
  preview.replaceChildren(
    element('strong', null, definition.name),
    element('p', 'muted', `Сила ${power} · броня ${armor ?? 0} · ${ROW_LABELS[definition.row]}`),
    element('p', null, definition.text ?? 'Без эффекта.'),
  );
  preview.hidden = false;
  if (temporary) previewTimer = setTimeout(hideCard, 4500);
}

function cardInspection(node, card, placement = false) {
  let timer;
  let held = false;
  let firstX, firstY;
  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' && !event.buttons) showCard(card);
  });
  node.addEventListener('pointerleave', (event) => {
    clearTimeout(timer);
    if (event.pointerType === 'mouse') hideCard();
  });
  node.addEventListener('focus', () => {
    if (node.matches(':focus-visible')) showCard(card);
  });
  node.addEventListener('blur', hideCard);
  node.addEventListener('contextmenu', (event) => event.preventDefault());
  if (!placement) {
    node.addEventListener('pointerdown', (event) => {
      held = false;
      if (event.pointerType !== 'touch') return;
      firstX = event.clientX;
      firstY = event.clientY;
      timer = setTimeout(() => {
        held = true;
        showCard(card, true);
      }, 450);
    });
    node.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - firstX, event.clientY - firstY) > 6) clearTimeout(timer);
    });
    for (const end of ['pointerup', 'pointercancel']) node.addEventListener(end, () => clearTimeout(timer));
    node.addEventListener('click', (event) => {
      if (!held) return;
      event.stopImmediatePropagation();
      held = false;
    }, { capture: true });
  }
}

function roundText(event) {
  const { scores, winner } = event;
  const outcome = winner === 'human' ? 'твоя победа' : winner === 'bot' ? 'победа бота' : 'ничья';
  return `Раунд ${event.round} · ${outcome} · ${scores.human} : ${scores.bot}`;
}

function eventText(event) {
  const side = sideLabel[event.side];
  switch (event.type) {
    case 'mulligan': return `Заменено карт: ${event.count}.`;
    case 'round-start': return `Раунд ${event.round}. Первый ход: ${side.toLowerCase()}.`;
    case 'play': return `${side}: «${event.name}» (${event.power}) → ${ROW_LABELS[event.row]}.`;
    case 'pass': {
      const reasons = {
        manual: 'пас',
        'empty-hand': 'автопас, рука пуста',
        'full-row': 'автопас, доступные ряды заполнены',
      };
      return `${side}: ${reasons[event.reason]}.`;
    }
    case 'draw': {
      const burned = event.burned ? `, сгорело ${event.burned}` : '';
      return `${side}: добор ${event.count}${burned}.`;
    }
    case 'round-end': return roundText(event);
    case 'armor': return `${side}, «${event.name}»: броня ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}.`;
    case 'boost': return `${side}, «${event.name}»: усиление +${event.amount}.`;
    case 'damage': return `${side}, «${event.name}»: урон ${event.amount}, броня поглотила ${event.absorbed}, потеря силы ${event.lost}.`;
    case 'death': return `«${event.name}» погибает и ${event.exile ? 'уходит из игры' : 'попадает в сброс'}.`;
    case 'destroy': return `Карта «${event.name}» уничтожена и уходит из игры.`;
    case 'consume': return `«${event.eater}» поглощает «${event.name}» (${event.amount} силы).`;
    case 'deathwish': return `Завещание: «${event.name}».`;
    case 'spawn': return `${side}: ${ROW_LABELS[event.row]}, порождено личинок: ${event.count}.`;
    case 'leader': return `${side}: способность лидера «${event.name}».`;
    case 'order': return `${side}: Приказ карты «${event.name}».`;
  }
}

function start(faction) {
  clearTimeout(timer);
  selected = new Set();
  match = createMatch({ humanFaction: faction });
  render();
  screen.querySelector('h2').focus();
}

function startScreen() {
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  const heading = element('h2', null, 'Выбери колоду');
  heading.tabIndex = -1;
  const choices = element('div', 'deck-choices');
  for (const [id, faction] of Object.entries(FACTIONS)) {
    const choice = button(undefined, () => start(id), 'button deck-choice');
    choice.append(
      element('strong', null, faction.name),
      element('span', 'muted', faction.strategy),
      element('span', null, faction.leader.name),
    );
    choices.append(choice);
  }
  panel.append(heading, choices, element('p', 'muted', 'Бот сыграет второй колодой.'));
  return panel;
}

function cardMarks(card) {
  const marks = element('span', 'card-marks');
  const { definition, armor } = card;
  if (armor) marks.append(element('span', 'armor-mark', `Б${armor}`));
  if (definition.doomed) marks.append(element('span', 'doomed-mark', 'О'));
  if (definition.deathwish) marks.append(element('span', 'wish-mark', 'З'));
  return marks;
}

function cardLabel(card) {
  const { definition, power, armor } = card;
  const details = [definition.name, `сила ${power}`, ROW_LABELS[definition.row]];
  if (armor) details.push(`броня ${armor}`);
  if (definition.doomed) details.push('Обречённая');
  if (definition.deathwish) details.push('Завещание');
  return details.join(' · ');
}

function cardButton(card, handler, placement = false) {
  const { name, row } = card.definition;
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  node.setAttribute('aria-label', cardLabel(card));
  node.append(
    element('strong', 'card-power', card.power),
    element('span', 'card-name', name),
    element('span', 'card-row', ROW_LABELS[row]),
    cardMarks(card),
  );
  cardInspection(node, card, placement);
  return node;
}

function mulliganScreen() {
  phaseLabel.textContent = 'Перед первым раундом';
  const panel = element('section', 'panel mulligan');
  const heading = element('h2', null, 'Муллиган');
  heading.tabIndex = -1;
  const counter = element('p', 'muted selection-count');
  const cards = element('div', 'hand-grid');
  const choices = match.players.human.hand.map((card) => cardButton(card, () => {
    if (selected.has(card.id)) selected.delete(card.id);
    else if (selected.size < MULLIGAN_LIMIT) selected.add(card.id);
    updateSelection();
  }));
  const confirm = button('Начать раунд', () => {
    updateMatch(confirmMulligan(match, [...selected]));
    document.querySelector('#turn-label').focus();
  }, 'button primary');

  function updateSelection() {
    counter.textContent = `Выбрано ${selected.size} из ${MULLIGAN_LIMIT}`;
    for (const choice of choices) {
      const pressed = selected.has(choice.dataset.cardId);
      choice.setAttribute('aria-pressed', String(pressed));
      choice.disabled = !pressed && selected.size === MULLIGAN_LIMIT;
    }
  }

  cards.append(...choices);
  panel.append(
    heading,
    element('p', 'muted', 'Выбери до трёх карт для замены или сразу начни раунд.'),
    counter,
    cards,
    confirm,
  );
  updateSelection();
  return panel;
}

function rowView(side, player, row, readyOrders) {
  const wrapper = element('div', 'board-row');
  const strength = rowScore(player, row);
  const label = element('div', 'row-label');
  label.append(element('span', null, ROW_LABELS[row]), element('strong', 'row-score', strength));
  const slots = element('div', 'row-line');
  const cards = player.board[row];
  if (side === 'human' && cards.length < ROW_LIMIT) slots.dataset.playRow = row;
  for (const card of cards) {
    const target = match.pending?.side === 'human' && match.pending.options.includes(card.id);
    const slot = element('div', 'slot filled');
    const face = button(undefined, () => {
      if (target) playHuman({ type: 'target', cardId: card.id });
      else showCard(card, true);
    }, 'unit-face');
    face.setAttribute('aria-label', cardLabel(card));
    face.append(element('strong', 'unit-power', card.power), cardMarks(card));
    if (target) face.classList.add('effect-target');
    if (card.definition.doomed) face.classList.add('is-doomed');
    cardInspection(face, card);
    slot.append(face);
    if (card.definition.order) {
      const cooldown = Math.min(card.definition.order.cooldown, Math.max(0, card.readyAt - player.turns));
      const order = button(cooldown ? `↻${cooldown}` : '⚑', () =>
        playHuman({ type: 'order', cardId: card.id }), 'unit-order');
      order.disabled = side !== 'human' || !humanCanAct() || !readyOrders.has(card.id);
      const label = `Приказ: ${card.definition.name}${cooldown ? ` · осталось ходов: ${cooldown}` : ''}`;
      order.setAttribute('aria-label', label);
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
  wrapper.append(label, slots);
  return wrapper;
}

function sideView(side) {
  const player = match.players[side];
  const section = element('section', 'side');
  const summary = element('div', 'side-summary');
  const status = element('div', 'side-status');
  status.append(
    element('span', 'faction-label', player.faction),
    element('span', null, `Жизни ${player.lives}/2`),
    element('span', null, `Рука ${player.hand.length}`),
  );
  if (player.passed) status.append(element('span', 'passed', 'Пас'));

  const score = element('strong', 'total', totalScore(player));
  score.setAttribute('aria-label', `Общая сила ${totalScore(player)}`);
  summary.append(element('h2', null, sideLabel[side]), status, score);
  const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
  const lines = element('div', 'board-rows');
  const readyOrders = new Set(availableOrders(match, side).map(({ card }) => card.id));
  lines.append(...rows.map((row) => rowView(side, player, row, readyOrders)));
  if (side === 'bot') section.append(summary, lines);
  else section.append(lines, summary);
  return section;
}

function playerHand() {
  const { human } = match.players;
  const active = humanCanAct();
  const panel = element('section', 'panel hand');
  const header = element('div', 'hand-header');
  const pass = button('Пас', () => playHuman({ type: 'pass' }));
  pass.id = 'pass-button';
  pass.disabled = !active;
  const controls = element('div', 'hand-controls');
  const leader = button(`${human.leader.name} · ${human.leader.charges}`, () => playHuman({ type: 'leader' }));
  leader.title = human.leader.text;
  leader.disabled = !active || !canUseLeader(match, 'human');
  controls.append(leader, pass);
  header.append(element('h2', null, `Твоя рука · ${human.hand.length}/${HAND_LIMIT}`), controls);
  panel.append(header);

  if (human.hand.length === 0) {
    panel.append(element('p', 'muted', 'В руке нет карт.'));
    return panel;
  }

  const cards = element('div', 'hand-grid');
  panel.append(element('p', 'muted placement-hint', 'Перетащи карту в её ряд. Нажатие ставит карту справа.'));
  for (const card of human.hand) {
    const { row } = card.definition;
    const node = cardButton(card, (event) => {
      if (event.detail !== 0) return;
      playHuman({ type: 'play', cardId: card.id, position: human.board[row].length });
    }, active && canPlayCard(human, card));
    node.dataset.cardRow = row;
    const hasSpace = canPlayCard(human, card);
    node.disabled = !active || !hasSpace;
    if (!hasSpace) {
      node.title = 'Ряд заполнен';
      node.querySelector('.card-row').textContent = `${ROW_LABELS[card.definition.row]} · заполнен`;
    }
    cards.append(node);
  }
  panel.append(cards);
  return panel;
}

function logView() {
  const log = element('section', 'panel journal');
  const list = element('ol', 'log-list');
  for (const event of [...match.log].reverse()) {
    list.append(element('li', null, eventText(event)));
  }
  log.append(element('h2', null, 'Журнал ходов'), list);
  return log;
}

function battlefield() {
  phaseLabel.textContent = `Раунд ${match.round}`;
  const game = element('div', 'game');
  const field = element('div', 'panel battlefield');
  const { pending } = match;
  const turn = element('p', 'turn', pending
    ? pending.side === 'human' ? pending.prompt : 'Бот выбирает цель…'
    : match.turn === 'human' ? 'Твой ход' : 'Ход бота');
  if (pending?.side === 'human') turn.classList.add('target-prompt');
  turn.id = 'turn-label';
  turn.tabIndex = -1;
  field.append(sideView('bot'), turn, sideView('human'));
  game.append(field, playerHand());
  const lastRound = match.log.findLast((event) => event.type === 'round-end');
  if (lastRound) game.append(element('p', 'round-result', roundText(lastRound)));
  game.append(logView());
  return game;
}

function finishedScreen() {
  phaseLabel.textContent = `Матч завершён · раундов ${match.round}`;
  const game = element('div', 'game');
  const panel = element('section', 'panel finish');
  const outcomes = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
  const heading = element('h2', null, outcomes[match.result]);
  heading.tabIndex = -1;
  const rounds = match.log.filter((event) => event.type === 'round-end');
  panel.append(
    heading,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    button('Ещё раз', () => {
      match = undefined;
      render();
      screen.querySelector('h2').focus();
    }, 'button primary'),
  );
  game.append(panel, logView());
  return game;
}

function render() {
  cancelPlacement();
  hideCard();
  let content;
  switch (match?.phase) {
    case 'mulligan': content = mulliganScreen(); break;
    case 'playing': content = battlefield(); break;
    case 'finished': content = finishedScreen(); break;
    default: content = startScreen();
  }
  screen.replaceChildren(content);
}

function updateMatch(next) {
  if (next === match) return;
  clearTimeout(timer);
  const events = next.log.slice(match.log.length);
  match = next;
  render();
  announcement.textContent = events.map(eventText).join(' ');
  if (match.phase === 'finished') screen.querySelector('h2').focus();
  else if (match.pending?.side === 'human') {
    const target = screen.querySelector('.effect-target');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  } else if ((match.pending?.side ?? match.turn) === 'bot') {
    timer = setTimeout(() => updateMatch(applyAction(match, 'bot', chooseBotTurn(match))), BOT_DELAY_MS);
  }
}

function playHuman(action) {
  updateMatch(applyAction(match, 'human', action));
  if (humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
}

render();
