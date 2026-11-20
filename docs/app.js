import { bindCardPlacement } from './card-placement.js';
import { presentJournalEvent } from './card-motion.js';
import { motionDuration, playJournal } from './turn-playback.js?v=motion-settings';
import { CARD_TYPES, FACTIONS, KEYWORDS, RARITY_LABELS, ROWS, ROW_LABELS } from './game/cards.js?v=complete-art-3';
import { cardType, isUnit } from './game/board.js';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=round-rules';
import { availableOrders, canUseLeader } from './game/effects.js';
import {
  HAND_LIMIT, ROW_LIMIT, applyAction, canPass, canPlayCard,
  confirmMulligan, createMatch, mulliganLimit, rowScore, totalScore,
} from './game/match.js?v=complete-art-3';

const screen = document.querySelector('#screen');
const phaseLabel = document.querySelector('#phase');
const announcement = document.querySelector('#announcement');
const speedSetting = document.querySelector('#animation-speed');
const systemSpeed = speedSetting.querySelector('[value="system"]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const speedKey = 'gatefall.animation-speed';
try {
  const saved = localStorage.getItem(speedKey);
  if (saved === 'normal' || saved === 'fast') speedSetting.value = saved;
} catch {}
speedSetting.addEventListener('change', () => {
  try { localStorage.setItem(speedKey, speedSetting.value); } catch {}
});

function updateSystemSpeed() {
  systemSpeed.textContent = reducedMotion.matches ? 'По системе (выключены)' : 'По системе (обычная)';
}

reducedMotion.addEventListener('change', updateSystemSpeed);
updateSystemSpeed();

let match;
let selected = new Set();
let timer;
let selectedCardId;
let replaying = false;
const preview = document.createElement('dialog');
preview.className = 'card-preview panel';
preview.setAttribute('aria-labelledby', 'preview-title');
document.body.append(preview);
preview.addEventListener('click', (event) => {
  if (event.target === preview) preview.close();
});
const sideLabel = { human: 'Ты', bot: 'Бот' };

const cancelPlacement = bindCardPlacement(screen, (cardId, row, position) => {
  playHuman({ type: 'play', cardId, row, position });
}, (node) => {
  const card = match.players.human.hand.find(({ id }) => id === node.dataset.cardId);
  if (card && !replaying) showCard(card);
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
  return !replaying && match.phase === 'playing' && match.turn === 'human' && !match.pending;
}

function cardArt(definition, className) {
  const image = element('img', className);
  image.src = './art/' + definition.art;
  image.alt = '';
  image.width = 480;
  image.height = 720;
  image.draggable = false;
  return image;
}

function addCardCrop(node, definition) {
  if (!definition.art) return;
  node.classList.add('has-art');
  node.prepend(cardArt(definition, 'card-art-crop'));
}

function showCard(card) {
  const { definition, power, armor, timer } = card;
  const details = [CARD_TYPES[cardType(card)], RARITY_LABELS[definition.rarity],
    definition.stratagem ? 'Стратагема' : definition.provision !== undefined ? `Провизия ${definition.provision}` : 'Токен'].filter(Boolean);
  const stats = [];
  if (isUnit(card)) stats.push(`Сила ${power}`, `Броня ${armor ?? 0}`);
  if (timer !== undefined) stats.push(`Таймер ${timer}`);
  const title = element('h2', null, definition.name);
  title.id = 'preview-title';
  const close = button('Закрыть', () => preview.close());
  close.autofocus = true;
  const body = element('div', 'preview-body');
  body.append(title, element('p', 'muted', details.join(' · ')));
  if (stats.length) body.append(element('p', 'preview-stats', stats.join(' · ')));
  body.append(element('p', null, definition.text ?? 'Без эффекта.'));
  const glossaryWords = new Set(definition.keywords);
  if (definition.endTurn) glossaryWords.add('Конец хода');
  if (glossaryWords.size) {
    const glossary = element('dl', 'preview-keywords');
    for (const keyword of glossaryWords) {
      glossary.append(element('dt', null, keyword), element('dd', null, KEYWORDS[keyword]));
    }
    body.append(glossary);
  }
  body.append(close);
  if (definition.art) {
    const layout = element('div', 'preview-layout');
    layout.append(cardArt(definition, 'preview-art'), body);
    preview.replaceChildren(layout);
  } else {
    preview.replaceChildren(body);
  }
  if (!preview.open) preview.showModal();
}

function cardInspection(node, card, placement = false) {
  let holdTimer;
  let activated;
  let pendingClick;
  let firstX, firstY;
  function inspect(event) {
    event.preventDefault();
    clearTimeout(holdTimer);
    clearTimeout(pendingClick);
    showCard(card);
  }
  node.addEventListener('dblclick', inspect);
  node.addEventListener('contextmenu', inspect);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) inspect(event);
  });
  if (!placement) {
    node.addEventListener('pointerdown', (event) => {
      activated = false;
      if (event.pointerType !== 'touch') return;
      firstX = event.clientX;
      firstY = event.clientY;
      holdTimer = setTimeout(() => {
        activated = true;
        showCard(card);
      }, 450);
    });
    node.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - firstX, event.clientY - firstY) > 6) clearTimeout(holdTimer);
    });
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
      node.addEventListener(end, () => clearTimeout(holdTimer));
    }
  }
  node.addEventListener('click', (event) => {
    if (activated || node.dataset.suppressClick) {
      event.stopImmediatePropagation();
      activated = false;
      delete node.dataset.suppressClick;
      return;
    }
    if (event.detail > 1) {
      clearTimeout(pendingClick);
      event.stopImmediatePropagation();
    } else if (event.detail === 1 && node.classList.contains('effect-target') && event.pointerType !== 'touch') {
      event.stopImmediatePropagation();
      pendingClick = setTimeout(() => {
        if (node.isConnected) node.click();
      }, 520);
    }
  }, { capture: true });
}

function roundText(event) {
  const { scores, winner } = event;
  const outcome = winner === 'human' ? 'твоя победа' : winner === 'bot' ? 'победа бота' : 'ничья';
  return `Раунд ${event.round} · ${outcome} · ${scores.human} : ${scores.bot}`;
}

function eventText(event) {
  const side = sideLabel[event.side];
  switch (event.type) {
    case 'mulligan': return `${side}: заменено карт ${event.count}.`;
    case 'round-start': return `Раунд ${event.round}. Первый ход: ${side.toLowerCase()}.`;
    case 'stratagem': return `${side}: на Поверхности появляется стратагема «${event.name}».`;
    case 'play': {
      if (!event.row) return `${side}: «${event.name}» · Эффект.`;
      return `${side}: «${event.name}» (${event.power ?? 'артефакт'}) → ${ROW_LABELS[event.row]}.`;
    }
    case 'pass': {
      const reasons = {
        manual: 'пас',
        'empty-hand': 'автопас, рука пуста',
        'full-row': 'автопас, ряды заполнены',
        'no-target': 'автопас, нет допустимых целей',
      };
      return `${side}: ${reasons[event.reason]}.`;
    }
    case 'turn-skip': return `${side}: ход завершён без паса. Нет карты для розыгрыша.`;
    case 'draw': return `${side}: добор ${event.count}${event.extraSwaps ? ` · дополнительных замен +${event.extraSwaps}` : ''}.`;
    case 'round-end': return roundText(event);
    case 'armor': return `${side}, «${event.name}»: броня ${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)}.`;
    case 'boost': return `${side}, «${event.name}»: усиление +${event.amount}.`;
    case 'damage': return `${side}, «${event.name}»: урон ${event.amount}, броня поглотила ${event.absorbed}, потеря силы ${event.lost}.`;
    case 'death': return `«${event.name}» погибает и ${event.exile ? 'уходит из игры' : 'попадает в сброс'}.`;
    case 'destroy': return `Карта «${event.name}» уничтожена и уходит из игры.`;
    case 'consume': return `«${event.eater}» поглощает «${event.name}» (${event.amount} силы).`;
    case 'deathwish': return `Завещание: «${event.name}».`;
    case 'spawn': return `${side}: ${ROW_LABELS[event.row]}, порождение «${event.name}» ×${event.count}.`;
    case 'leader': return `${side}: способность лидера «${event.name}».`;
    case 'tick': return 'Таймер «' + event.name + '»: ' + event.remaining + '.';
    case 'order': return `${side}: Приказ карты «${event.name}».`;
  }
}

function start(faction) {
  clearTimeout(timer);
  selected = new Set();
  selectedCardId = undefined;
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
    choice.dataset.faction = id;
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

const keywordIcons = {
  'Броня': '⬟',
  'Урон': '✷',
  'Порождение': '✦',
  'Поглощение': '◉',
  'Завещание': '†',
  'Приказ': '⚑',
  'Рвение': 'ϟ',
  'Конец хода': '◷',
};

function keywordsFor(card) {
  const { definition } = card;
  const words = new Set(definition.keywords);
  if (definition.endTurn) words.add('Конец хода');
  return [...words].filter((word) => keywordIcons[word]);
}

function cardStats(card) {
  const stats = element('span', 'card-stats');
  if (isUnit(card)) {
    const power = element('strong', 'unit-power', card.power);
    power.title = 'Сила ' + card.power;
    stats.append(power);
  }
  if (card.armor) {
    const armor = element('strong', 'armor-stat', card.armor);
    armor.title = 'Броня ' + card.armor;
    stats.append(armor);
  }
  if (!isUnit(card)) {
    const icon = element('span', 'type-shape', cardType(card) === 'artifact' ? '◆' : '✧');
    icon.title = CARD_TYPES[cardType(card)];
    stats.append(icon);
  }
  return stats;
}

function cardMarks(card) {
  const decorations = document.createDocumentFragment();
  const marks = element('span', 'card-marks');
  const { definition, timer } = card;
  if (definition.provision !== undefined) {
    const provision = element('strong', 'provision-mark ' + definition.rarity, definition.provision);
    provision.title = RARITY_LABELS[definition.rarity] + ' · Провизия ' + definition.provision;
    decorations.append(provision);
  }
  for (const word of keywordsFor(card)) {
    if (word === 'Броня' && card.armor) continue;
    const icon = element('span', 'keyword-mark', keywordIcons[word]);
    icon.title = word;
    marks.append(icon);
  }
  if (definition.doomed) {
    const doomed = element('span', 'doomed-mark', 'О');
    doomed.title = 'Обречённая';
    marks.append(doomed);
  }
  if (timer !== undefined) marks.append(element('span', 'timer-mark', '⌛' + timer));
  marks.setAttribute('aria-hidden', 'true');
  decorations.append(marks);
  return decorations;
}

function cardLabel(card) {
  const { definition, power, armor, timer } = card;
  const details = [definition.name, CARD_TYPES[cardType(card)]];
  if (isUnit(card)) details.push(`сила ${power}`);
  if (armor) details.push(`броня ${armor}`);
  if (definition.rarity) details.push(RARITY_LABELS[definition.rarity], `провизия ${definition.provision}`);
  if (definition.doomed) details.push('Обречённая');
  if (definition.deathwish) details.push('Завещание');
  if (timer !== undefined) details.push(`таймер ${timer}`);
  details.push(...keywordsFor(card).filter((word) => word !== 'Завещание' && (word !== 'Броня' || !armor)));
  return details.join(' · ');
}

function cardName(name) {
  const label = element('span', 'card-name');
  for (const word of name.split(' ')) {
    if (label.firstChild) label.append(' ');
    label.append(element('span', 'card-name-word', word));
  }
  return label;
}

function cardButton(card, handler, placement = false) {
  const { name } = card.definition;
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  node.dataset.type = cardType(card);
  node.dataset.faction = match.players.human.factionId ?? '';
  node.setAttribute('aria-label', cardLabel(card));
  node.append(
    cardStats(card),
    element('span', 'card-type-label', CARD_TYPES[cardType(card)]),
    cardName(name),
    cardMarks(card),
  );
  addCardCrop(node, card.definition);
  cardInspection(node, card, placement);
  return node;
}

function updatePlacementSelection() {
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  for (const node of screen.querySelectorAll('.hand [data-card-id]')) {
    node.setAttribute('aria-pressed', String(node.dataset.cardId === selectedCardId));
  }
  for (const row of screen.querySelectorAll('[data-play-row]')) {
    const available = Boolean(card && (cardType(card) === 'effect' || row.dataset.full !== 'true'));
    row.classList.toggle('is-selectable', available);
    row.parentElement.querySelector('.row-place').hidden = !available;
  }
}

function placeSelected(row) {
  if (!selectedCardId || !humanCanAct()) return;
  playHuman({ type: 'play', cardId: selectedCardId, row, position: match.players.human.board[row].length });
}

function mulliganScreen() {
  const limit = mulliganLimit(match, 'human');
  const { extraSwaps } = match.players.human;
  phaseLabel.textContent = `Перед раундом ${match.round}`;
  const panel = element('section', 'panel mulligan');
  const heading = element('h2', null, 'Муллиган');
  heading.tabIndex = -1;
  const counter = element('p', 'muted selection-count');
  const cards = element('div', 'hand-grid');
  const choices = match.players.human.hand.map((card) => cardButton(card, () => {
    if (selected.has(card.id)) selected.delete(card.id);
    else if (selected.size < limit) selected.add(card.id);
    updateSelection();
  }));
  const confirm = button('Начать раунд', async () => {
    await updateMatch(confirmMulligan(match, [...selected]));
    document.querySelector('#turn-label')?.focus();
  }, 'button primary');

  function updateSelection() {
    counter.textContent = `Выбрано ${selected.size} из ${limit}${extraSwaps ? ` · от лишнего добора +${extraSwaps}` : ''}`;
    for (const choice of choices) {
      const pressed = selected.has(choice.dataset.cardId);
      choice.setAttribute('aria-pressed', String(pressed));
      choice.classList.toggle('is-unavailable', !pressed && selected.size === limit);
    }
  }

  cards.append(...choices);
  panel.append(
    heading,
    element('p', 'muted', 'Выбери карты для замены или сразу начни раунд.'),
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
  slots.dataset.castZone = '';
  const cards = player.board[row];
  if (side === 'human') {
    slots.dataset.playRow = row;
    slots.dataset.full = String(cards.length >= ROW_LIMIT);
    const place = button('Сюда', () => placeSelected(row), 'row-place');
    place.setAttribute('aria-label', `Сыграть карту в ряд «${ROW_LABELS[row]}»`);
    place.hidden = true;
    label.append(place);
    slots.addEventListener('click', (event) => {
      if (!event.target.closest('button')) placeSelected(row);
    });
  }
  for (const card of cards) {
    const target = !replaying && match.pending?.side === 'human' && match.pending.options.includes(card.id);
    const slot = element('div', 'slot filled');
    slot.dataset.boardCard = card.id;
    const face = button(undefined, () => {
      if (target) playHuman({ type: 'target', cardId: card.id });
      else if (!replaying && selectedCardId === undefined) showCard(card);
    }, 'unit-face');
    face.setAttribute('aria-label', cardLabel(card));
    face.dataset.faction = player.factionId ?? '';
    face.dataset.type = cardType(card);
    face.append(cardStats(card), cardMarks(card));
    addCardCrop(face, card.definition);
    if (cardType(card) === 'artifact') face.classList.add('is-artifact');
    if (target) face.classList.add('effect-target');
    if (card.definition.doomed) face.classList.add('is-doomed');
    cardInspection(face, card);
    slot.append(face);
    if (card.definition.order) {
      const cooldown = Math.min(Math.max(1, card.definition.order.cooldown ?? 0), Math.max(0, card.readyAt - player.turns));
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
  section.dataset.side = side;
  section.dataset.faction = player.factionId ?? '';
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
  pass.disabled = !active || !canPass(match, 'human');
  const controls = element('div', 'hand-controls');
  const leader = button(`${human.leader.name} · ${human.leader.charges}`, () => playHuman({ type: 'leader' }));
  leader.title = human.leader.text;
  leader.disabled = !active || !canUseLeader(match, 'human');
  controls.append(leader, pass);
  header.append(element('h2', null, `Твоя рука · ${human.hand.length}/${HAND_LIMIT}`), controls);
  panel.append(header);
  if (active && human.usedAbility) panel.append(element('p', 'muted', 'Способность применена. Сыграй карту, чтобы завершить ход.'));

  if (human.hand.length === 0) {
    panel.append(element('p', 'muted', 'В руке нет карт.'));
    return panel;
  }

  const cards = element('div', 'hand-grid');
  panel.append(element('p', 'muted placement-hint',
    'Перетащи карту или выбери её и нажми на ряд. Двойной клик, правый клик или удержание открывают описание.'));
  for (const card of human.hand) {
    const available = active && canPlayCard(match, 'human', card);
    const node = cardButton(card, () => {
      if (!available) return;
      selectedCardId = card.id;
      updatePlacementSelection();
    }, available);
    if (available) node.dataset.playCard = '';
    else node.classList.add('is-unavailable');
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
  const turn = element('p', 'turn', replaying ? 'Розыгрыш…' : pending
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
  screen.classList.toggle('is-replaying', replaying);
  selectedCardId = undefined;
  let content;
  switch (match?.phase) {
    case 'mulligan': content = mulliganScreen(); break;
    case 'playing': content = battlefield(); break;
    case 'finished': content = finishedScreen(); break;
    default: content = startScreen();
  }
  screen.replaceChildren(content);
}

function renderPlayback(state) {
  match = state;
  render();
}

async function updateMatch(next) {
  if (replaying || next === match) return;
  clearTimeout(timer);
  const before = match;
  const events = next.log.slice(before.log.length);
  if (before.phase === 'playing' && events.length && motionDuration(speedSetting.value, reducedMotion.matches)) {
    replaying = true;
    screen.classList.add('is-replaying');
    try {
      await playJournal(before, events, (event, commit) => presentJournalEvent(
        screen, event, commit, renderPlayback, motionDuration(speedSetting.value, reducedMotion.matches),
      ));
    } catch (error) {
      console.warn('Playback stopped early', error);
    } finally {
      replaying = false;
    }
  }

  match = next;
  if (match.phase === 'mulligan') selected.clear();
  render();
  announcement.textContent = events.map(eventText).join(' ');
  if (match.phase === 'finished' || match.phase === 'mulligan') screen.querySelector('h2').focus();
  else if (match.pending?.side === 'human') {
    const target = screen.querySelector('.effect-target');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  } else if ((match.pending?.side ?? match.turn) === 'bot') {
    timer = setTimeout(() => updateMatch(applyAction(match, 'bot', chooseBotTurn(match))), BOT_DELAY_MS);
  }
}

async function playHuman(action) {
  if (replaying) return;
  await updateMatch(applyAction(match, 'human', action));
  if (humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
}

render();
