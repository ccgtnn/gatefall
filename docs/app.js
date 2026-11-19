import { ROWS, ROW_LABELS } from './game/cards.js';
import { BOT_DELAY_MS, chooseBotAction, createBotView } from './game/bot.js';
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
const sideLabel = { human: 'Ты', bot: 'Бот' };

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
  }
}

function start() {
  clearTimeout(timer);
  selected = new Set();
  match = createMatch();
  render();
  screen.querySelector('h2').focus();
}

function startScreen() {
  phaseLabel.textContent = '';
  const panel = element('section', 'intro');
  panel.append(
    element('p', 'intro-copy', 'Карточная дуэль против бота. Разыгрывай карты на орбите и поверхности, выигрывай раунды и береги руку.'),
    button('Играть', start, 'button primary'),
  );
  return panel;
}

function cardButton(card, handler) {
  const { name, row } = card.definition;
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  node.setAttribute('aria-label', `${name} · сила ${card.power} · ${ROW_LABELS[row]}`);
  node.append(
    element('strong', 'card-power', card.power),
    element('span', 'card-name', name),
    element('span', 'card-row', ROW_LABELS[row]),
  );
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

function rowView(player, row) {
  const wrapper = element('div', 'board-row');
  const strength = rowScore(player, row);
  const label = element('div', 'row-label');
  label.append(element('span', null, ROW_LABELS[row]), element('strong', 'row-score', strength));
  const slots = element('div', 'slots');
  for (let index = 0; index < ROW_LIMIT; index += 1) {
    const card = player.board[row][index];
    const slot = element('div', 'slot');
    if (card) {
      const description = `${card.definition.name} · сила ${card.power}`;
      slot.classList.add('filled');
      slot.textContent = card.power;
      slot.title = description;
      slot.setAttribute('aria-label', description);
      slot.setAttribute('role', 'img');
    } else {
      slot.setAttribute('aria-hidden', 'true');
    }
    slots.append(slot);
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
    element('span', null, `Жизни ${player.lives}/2`),
    element('span', null, `Рука ${player.hand.length}`),
  );
  if (player.passed) status.append(element('span', 'passed', 'Пас'));

  const score = element('strong', 'total', totalScore(player));
  score.setAttribute('aria-label', `Общая сила ${totalScore(player)}`);
  summary.append(element('h2', null, sideLabel[side]), status, score);
  const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
  const lines = element('div', 'board-rows');
  lines.append(...rows.map((row) => rowView(player, row)));
  if (side === 'bot') section.append(summary, lines);
  else section.append(lines, summary);
  return section;
}

function playerHand() {
  const { human } = match.players;
  const active = match.turn === 'human';
  const panel = element('section', 'panel hand');
  const header = element('div', 'hand-header');
  const pass = button('Пас', () => playHuman({ type: 'pass' }));
  pass.id = 'pass-button';
  pass.disabled = !active;
  header.append(element('h2', null, `Твоя рука · ${human.hand.length}/${HAND_LIMIT}`), pass);
  panel.append(header);

  if (human.hand.length === 0) {
    panel.append(element('p', 'muted', 'В руке нет карт.'));
    return panel;
  }

  const cards = element('div', 'hand-grid');
  for (const card of human.hand) {
    const node = cardButton(card, () => playHuman({ type: 'play', cardId: card.id }));
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
  const turn = element('p', 'turn', match.turn === 'human' ? 'Твой ход' : 'Ход бота');
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
    button('Ещё раз', start, 'button primary'),
  );
  game.append(panel, logView());
  return game;
}

function render() {
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
  const events = next.log.slice(match.log.length);
  match = next;
  render();
  announcement.textContent = events.map(eventText).join(' ');
  if (match.phase === 'finished') screen.querySelector('h2').focus();
  else if (match.turn === 'bot') {
    timer = setTimeout(() => {
      const action = chooseBotAction(createBotView(match));
      updateMatch(applyAction(match, 'bot', action));
    }, BOT_DELAY_MS);
  }
}

function playHuman(action) {
  updateMatch(applyAction(match, 'human', action));
  if (match.turn === 'human') screen.querySelector('.hand-card:enabled, #pass-button:enabled').focus();
}

render();
