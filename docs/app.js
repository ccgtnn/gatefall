import { bindCardPlacement } from './card-placement.js?v=field-6';
import { presentJournalEvent } from './card-motion.js?v=field-6';
import { motionDuration, playJournal } from './turn-playback.js?v=motion-settings';
import { CARD_TYPES, FACTIONS, KEYWORDS, RARITY_LABELS, ROWS, ROW_LABELS } from './game/cards.js?v=growth-art-3';
import { cardType, isUnit } from './game/board.js';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=growth-art-3';
import { availableOrders, canUseLeader } from './game/effects.js';
import {
  HAND_LIMIT, ROW_LIMIT, applyAction, canEndTurn, canPass, canPlayCard,
  confirmMulligan, createMatch, mulliganLimit, rowScore, totalScore,
} from './game/match.js?v=growth-art-3';

const app = document.querySelector('#app');
const screen = document.querySelector('#screen');
const phaseLabel = document.querySelector('#phase');
const announcement = document.querySelector('#announcement');
const settings = document.querySelector('#settings');
const fullscreenButton = document.querySelector('#fullscreen');
const fullscreenStatus = document.querySelector('#fullscreen-status');
const fullscreenMode = matchMedia('(display-mode: fullscreen)');
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

function syncFullscreen() {
  const installedFullscreen = fullscreenMode.matches && !document.fullscreenElement;
  fullscreenButton.hidden = installedFullscreen;
  fullscreenButton.disabled = !document.fullscreenEnabled;
  fullscreenButton.textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран';
}

function showSettings() {
  fullscreenStatus.textContent = document.fullscreenEnabled || fullscreenMode.matches
    ? '' : 'Браузер не поддерживает полноэкранный режим. Попробуй установить игру через меню браузера.';
  syncFullscreen();
  settings.showModal();
}

fullscreenButton.addEventListener('click', async () => {
  fullscreenStatus.textContent = '';
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      settings.close();
      await document.documentElement.requestFullscreen();
      if (matchMedia('(pointer: coarse)').matches) {
        await window.screen.orientation?.lock?.('landscape').catch(() => {});
      }
    }
  } catch (error) {
    console.warn('Fullscreen request failed', error);
    fullscreenStatus.textContent = 'Не удалось переключить полноэкранный режим.';
    if (!settings.open) settings.showModal();
  }
});
document.addEventListener('fullscreenchange', syncFullscreen);
fullscreenMode.addEventListener('change', syncFullscreen);
document.querySelector('#start-settings').addEventListener('click', showSettings);

let match;
let selected = new Set();
let timer;
let selectedCardId;
let replaying = false;
let mulliganFieldVisible = false;
let openPile;
const drawer = element('dialog', 'field-drawer');
drawer.setAttribute('aria-labelledby', 'drawer-title');
drawer.addEventListener('close', () => { if (!drawer.open) openPile = undefined; });
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) drawer.close();
});
document.body.append(drawer);
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

function iconButton(icon, label, handler, className = '') {
  const node = button(icon, handler, ('icon-button ' + className).trim());
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

function settingsButton() {
  return iconButton('⚙', 'Настройки', showSettings, 'field-settings');
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

function showCard(card, { leader = false } = {}) {
  const { definition, power, armor, timer } = card;
  const details = leader ? ['Лидер'] : [CARD_TYPES[cardType(card)], RARITY_LABELS[definition.rarity],
    definition.stratagem ? 'Стратагема' : definition.provision !== undefined ? `Провизия ${definition.provision}` : 'Токен'].filter(Boolean);
  const stats = [];
  if (!leader && isUnit(card)) stats.push(`Сила ${power}`, `Броня ${armor ?? 0}`);
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
  mulliganFieldVisible = false;
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
    addCardCrop(choice, faction.leader);
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
  return stats;
}

function decorateCard(node, card, player, { orderOnField = false } = {}) {
  const { definition, timer } = card;
  const type = cardType(card);
  node.dataset.type = type;
  node.dataset.faction = player.factionId ?? '';
  node.dataset.rarity = definition.rarity ?? '';
  node.setAttribute('aria-label', cardLabel(card));
  node.append(cardStats(card));
  if (type !== 'unit') {
    const mark = element('span', 'card-kind', type === 'artifact' ? '◇' : '✦');
    mark.title = CARD_TYPES[type];
    node.append(mark);
  }
  const word = definition.order ? 'Приказ' : definition.deathwish ? 'Завещание'
    : definition.doomed ? 'Обречённая' : keywordsFor(card).find((keyword) => keyword !== 'Броня');
  if (!orderOnField && (timer !== undefined || word)) {
    const mark = element('span', 'card-state', timer !== undefined ? timer : keywordIcons[word] ?? '○');
    mark.title = timer !== undefined ? 'Таймер ' + timer : word;
    if (word === 'Приказ' && timer === undefined) mark.classList.add('order-sleep');
    node.append(mark);
  }
  addCardCrop(node, definition);
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

function cardButton(card, handler, placement = false, player = match.players.human) {
  const node = button(undefined, handler, 'hand-card');
  node.dataset.cardId = card.id;
  decorateCard(node, card, player);
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
    row.parentElement.querySelector('button.row-label').disabled = !available;
  }
}

function placeSelected(row) {
  if (!selectedCardId || !humanCanAct()) return;
  playHuman({ type: 'play', cardId: selectedCardId, row, position: match.players.human.board[row].length });
}

function setMulliganField(visible) {
  mulliganFieldVisible = visible;
  render();
  screen.querySelector(visible ? '.mulligan-return' : '#mulligan-title')?.focus({ preventScroll: true });
}

function mulliganScreen() {
  const limit = mulliganLimit(match, 'human');
  const panel = element('section', 'mulligan mulligan-overlay');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'mulligan-title');
  const heading = element('h2', null, 'Раунд ' + match.round);
  heading.id = 'mulligan-title';
  heading.tabIndex = -1;
  const counter = element('p', 'selection-count');
  counter.setAttribute('aria-live', 'polite');
  const cards = element('div', 'hand-grid');
  const choices = match.players.human.hand.map((card) => cardButton(card, () => {
    if (selected.has(card.id)) selected.delete(card.id);
    else if (selected.size < limit) selected.add(card.id);
    updateSelection();
  }));
  const confirm = button('Подтвердить', async () => {
    await updateMatch(confirmMulligan(match, [...selected]));
    document.querySelector('#turn-label')?.focus({ preventScroll: true });
  }, 'button primary');

  function updateSelection() {
    counter.textContent = 'Осталось замен: ' + (limit - selected.size);
    for (const choice of choices) {
      const pressed = selected.has(choice.dataset.cardId);
      choice.setAttribute('aria-pressed', String(pressed));
      choice.classList.toggle('is-unavailable', !pressed && selected.size === limit);
    }
  }

  const header = element('header', 'mulligan-header');
  header.append(heading, counter);
  const actions = element('div', 'mulligan-actions');
  actions.append(button('Посмотреть поле', () => setMulliganField(true)), confirm);
  cards.append(...choices);
  panel.append(header, cards, actions, settingsButton());
  updateSelection();
  return panel;
}

function rowView(side, player, row, readyOrders) {
  const wrapper = element('div', 'board-row');
  const strength = rowScore(player, row);
  const label = side === 'human'
    ? button(undefined, () => placeSelected(row), 'row-label')
    : element('div', 'row-label');
  if (side === 'human') {
    label.disabled = true;
    label.setAttribute('aria-label', `Сыграть карту в ряд «${ROW_LABELS[row]}» · сила ${strength}`);
  }
  const score = element('strong', 'row-score', strength);
  score.title = ROW_LABELS[row] + ' · ' + strength;
  score.setAttribute('aria-label', score.title);
  label.append(element('span', 'row-name', ROW_LABELS[row]), score);
  const slots = element('div', 'row-line');
  slots.dataset.castZone = '';
  const cards = player.board[row];
  if (side === 'human') {
    slots.dataset.playRow = row;
    slots.dataset.full = String(cards.length >= ROW_LIMIT);
    slots.addEventListener('click', (event) => {
      if (slots.classList.contains('is-selectable') && !event.target.closest('.unit-order')) {
        placeSelected(row);
      }
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
    decorateCard(face, card, player, { orderOnField: Boolean(card.definition.order) });
    if (target) face.classList.add('effect-target');
    if (card.definition.doomed) face.classList.add('is-doomed');
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
  wrapper.append(label, slots);
  return wrapper;
}

function sideView(side) {
  const player = match.players[side];
  const section = element('section', 'side');
  section.dataset.side = side;
  section.dataset.faction = player.factionId ?? '';
  section.setAttribute('aria-label', sideLabel[side]);
  const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
  const readyOrders = new Set(availableOrders(match, side).map(({ card }) => card.id));
  section.append(...rows.map((row) => rowView(side, player, row, readyOrders)));
  return section;
}

function playerHand() {
  const { human } = match.players;
  const active = humanCanAct() && !match.playedCard;
  const cards = element('section', 'hand hand-fan');
  cards.setAttribute('aria-label', 'Твоя рука · ' + human.hand.length);
  cards.style.setProperty('--hand-count', Math.max(1, human.hand.length));
  for (const [index, card] of human.hand.entries()) {
    const available = active && canPlayCard(match, 'human', card);
    const node = cardButton(card, () => {
      if (!available) {
        if (!replaying) showCard(card);
        return;
      }
      selectedCardId = selectedCardId === card.id ? undefined : card.id;
      updatePlacementSelection();
    }, available);
    if (available) node.dataset.playCard = '';
    if (active && !available) node.classList.add('is-unavailable');
    fanCard(node, index, human.hand.length, 1);
    cards.append(node);
  }
  return cards;
}

function fanCard(node, index, count, angle = 2) {
  const distance = index - (count - 1) / 2;
  node.style.setProperty('--fan-angle', (distance * angle) + 'deg');
  node.style.setProperty('--fan-drop', (distance ** 2 / 3) + 'px');
}

function botHand() {
  const { bot } = match.players;
  const hand = element('section', 'bot-hand');
  hand.setAttribute('aria-label', 'Рука бота · ' + bot.hand.length);
  for (let index = 0; index < bot.hand.length; index += 1) {
    const back = element('span', 'card-back');
    back.dataset.faction = bot.factionId;
    back.setAttribute('aria-hidden', 'true');
    fanCard(back, index, bot.hand.length);
    hand.append(back);
  }
  return hand;
}

function leaderView(side) {
  const player = match.players[side];
  const { leader } = player;
  const panel = element('div', 'field-leader');
  panel.dataset.faction = player.factionId ?? '';
  if (!leader) return panel;
  const portrait = button(undefined, () => showCard({ definition: leader }, { leader: true }), 'leader-portrait');
  portrait.setAttribute('aria-label', 'Лидер · ' + leader.name);
  portrait.title = leader.name;
  if (leader.art) portrait.append(cardArt(leader, 'leader-image'));
  const power = button('ϟ ' + leader.charges, () => playHuman({ type: 'leader' }), 'leader-power');
  power.title = leader.text;
  power.setAttribute('aria-label', leader.name + ' · зарядов ' + leader.charges);
  power.disabled = side !== 'human' || !humanCanAct() || match.playedCard || !canUseLeader(match, side);
  panel.append(portrait, power);
  return panel;
}

function scoreView(side) {
  const player = match.players[side];
  const panel = element('div', 'field-score');
  panel.dataset.faction = player.factionId ?? '';
  const points = totalScore(player);
  const total = element('strong', 'field-total', points);
  total.setAttribute('aria-label', sideLabel[side] + ' · сила ' + points);
  const lives = element('span', 'field-lives', '◆'.repeat(player.lives) + '◇'.repeat(2 - player.lives));
  lives.setAttribute('aria-label', 'Жизни ' + player.lives + '/2');
  panel.append(total, lives);
  if (side === 'bot') panel.append(element('span', 'field-round', 'Раунд ' + match.round));
  if (player.passed) panel.append(element('span', 'field-passed', 'Пас'));
  return panel;
}

function pileView(side, pile) {
  const player = match.players[side];
  const count = player[pile].length;
  const name = pile === 'deck' ? 'Колода' : 'Сброс';
  const label = sideLabel[side] + ' · ' + name + ' · ' + count;
  const node = pile === 'discard' ? button(undefined, () => showDrawer(side), 'field-pile')
    : element('div', 'field-pile');
  node.dataset.faction = player.factionId ?? '';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(element('span', 'pile-icon', pile === 'deck' ? '▤' : '▱'), element('strong', null, count));
  return node;
}

function fillDrawer() {
  const journal = openPile === 'journal';
  const player = match.players[openPile];
  const title = element('h2', null, journal ? 'Журнал ходов' : 'Сброс · ' + player.faction);
  title.id = 'drawer-title';
  const header = element('header', 'drawer-header');
  header.append(title, button('Закрыть', () => drawer.close()));
  if (!journal) {
    const cards = element('div', 'discard-grid');
    cards.append(...player.discard.map((card) => cardButton(card, () => showCard(card), false, player)));
    if (!player.discard.length) cards.append(element('p', 'muted', 'Сброс пуст.'));
    drawer.replaceChildren(header, cards);
    return;
  }
  const list = logView().querySelector('ol');
  drawer.replaceChildren(header, list);
}

function showDrawer(pile) {
  openPile = pile;
  fillDrawer();
  drawer.showModal();
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
  const game = element('div', 'match-screen');
  const field = element('div', 'match-board');
  const { pending, players, phase } = match;
  const turn = element('p', 'turn', replaying ? 'Розыгрыш…' : pending
    ? pending.side === 'human' ? pending.prompt : 'Бот выбирает цель…'
    : phase === 'mulligan' ? 'Перед раундом'
    : match.turn === 'human' ? 'Твой ход' : 'Ход бота');
  if (pending?.side === 'human') turn.classList.add('target-prompt');
  turn.id = 'turn-label';
  turn.tabIndex = -1;
  const center = element('div', 'field-center battlefield');
  center.append(sideView('bot'), turn, sideView('human'));
  const left = element('div', 'field-rail field-left');
  left.append(settingsButton(), pileView('bot', 'discard'), leaderView('bot'),
    iconButton('▤', 'Журнал ходов', () => showDrawer('journal'), 'field-log'),
    leaderView('human'), pileView('human', 'discard'));
  const right = element('div', 'field-rail field-right');
  const afterPlay = match.turn === 'human' && match.playedCard;
  const action = button(afterPlay ? 'Конец хода' : 'Пас', () =>
    playHuman({ type: afterPlay ? 'end-turn' : 'pass' }), 'button field-action');
  action.id = 'pass-button';
  action.disabled = !humanCanAct() || !(afterPlay ? canEndTurn(match, 'human') : canPass(match, 'human'));
  if (humanCanAct() && !afterPlay && players.human.usedAbility) action.title = 'Сыграй карту после применения способности';
  const botCount = element('span', 'field-hand-count', players.bot.hand.length + '/' + HAND_LIMIT);
  botCount.title = 'Карт в руке у бота';
  const humanCount = element('span', 'field-hand-count', players.human.hand.length + '/' + HAND_LIMIT);
  humanCount.title = 'Карт в твоей руке';
  const botCorner = element('div', 'field-corner');
  botCorner.append(botCount, pileView('bot', 'deck'));
  const humanCorner = element('div', 'field-corner');
  humanCorner.append(humanCount, pileView('human', 'deck'));
  right.append(botCorner, scoreView('bot'), action, scoreView('human'), humanCorner);
  field.append(left, botHand(), center, playerHand(), right);
  game.append(field);
  if (phase === 'mulligan') {
    field.inert = !mulliganFieldVisible;
    game.append(mulliganFieldVisible
      ? button('К муллигану', () => setMulliganField(false), 'button mulligan-return')
      : mulliganScreen());
  }
  const rotate = element('div', 'rotate-notice');
  rotate.append(element('p', null, 'Поверни телефон'), settingsButton());
  game.append(rotate);
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
  app.classList.toggle('in-match', match?.phase === 'mulligan' || match?.phase === 'playing');
  let content;
  switch (match?.phase) {
    case 'mulligan':
    case 'playing': content = battlefield(); break;
    case 'finished': content = finishedScreen(); break;
    default: content = startScreen();
  }
  screen.replaceChildren(content);
  if (drawer.open && match) {
    if (openPile === 'journal') {
      const list = drawer.querySelector('ol');
      list.replaceChildren(...logView().querySelector('ol').children);
    }
    if (openPile !== 'journal' && !replaying) fillDrawer();
  }
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
  if (match.phase === 'mulligan') {
    selected.clear();
    mulliganFieldVisible = false;
  }
  render();
  announcement.textContent = events.map(eventText).join(' ');
  if (match.phase === 'finished' || match.phase === 'mulligan') screen.querySelector('h2')?.focus({ preventScroll: true });
  else if (match.pending?.side === 'human') {
    const target = screen.querySelector('.effect-target');
    target?.focus({ preventScroll: true });
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
