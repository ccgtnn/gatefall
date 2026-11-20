import { bindCardPlacement } from './card-placement.js?v=field-6';
import { animateCoin, animateLifeLoss, presentJournalEvent } from './card-motion.js?v=step-10-effects';
import { clearParticles } from './particles.js?v=step-10';
import { createSoundEffects, DEFAULT_VOLUME } from './sound.js?v=step-10-volume';
import { motionDuration, playJournal } from './turn-playback.js?v=step-10-impact';
import { CARD_TYPES, FACTIONS, KEYWORDS, RARITY_LABELS, ROWS, ROW_LABELS } from './game/cards.js?v=growth-art-3';
import { cardType, isUnit } from './game/board.js?v=step-10';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=step-10';
import { availableOrders, canUseLeader } from './game/effects.js?v=step-10';
import {
  HAND_LIMIT, ROW_LIMIT, applyAction, canEndTurn, canPass, canPlayCard,
  confirmMulligan, createMatch, mulliganRemaining, replaceMulliganCard, rowScore, totalScore,
} from './game/match.js?v=step-10';

const app = document.querySelector('#app');
const screen = document.querySelector('#screen');
const phaseLabel = document.querySelector('#phase');
const turnNotice = document.querySelector('#match-notice');
const coinNotice = document.querySelector('#coin-notice');
const roundNotice = document.querySelector('#round-notice');
const ROUND_RESULT_MS = 1500;
const noticeTimers = new Map();
const announcement = document.querySelector('#announcement');
const settings = document.querySelector('#settings');
const matchMenu = document.querySelector('#match-menu');
const leaveDialog = document.querySelector('#leave-match');
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
app.dataset.animationSpeed = speedSetting.value;
speedSetting.addEventListener('change', () => {
  app.dataset.animationSpeed = speedSetting.value;
  try { localStorage.setItem(speedKey, speedSetting.value); } catch {}
});

const soundSetting = document.querySelector('#sound-enabled');
const volumeSetting = document.querySelector('#sound-volume');
const volumeLabel = document.querySelector('#sound-level');
const soundTest = document.querySelector('#sound-test');
const soundKey = 'gatefall.sound-enabled';
const volumeKey = 'gatefall.sound-volume';
volumeSetting.value = DEFAULT_VOLUME * 100;
try {
  soundSetting.checked = localStorage.getItem(soundKey) !== 'off';
  const saved = localStorage.getItem(volumeKey);
  if (saved !== null && Number.isFinite(Number(saved))) volumeSetting.value = saved;
} catch {}

const sounds = createSoundEffects(soundSetting.checked, undefined, Number(volumeSetting.value) / 100);
function syncSoundControls() {
  volumeLabel.value = volumeSetting.value + '%';
  soundTest.disabled = !soundSetting.checked || Number(volumeSetting.value) === 0;
}
syncSoundControls();

soundSetting.addEventListener('change', () => {
  sounds.setEnabled(soundSetting.checked);
  if (soundSetting.checked) sounds.unlock();
  syncSoundControls();
  try { localStorage.setItem(soundKey, soundSetting.checked ? 'on' : 'off'); } catch {}
});
volumeSetting.addEventListener('input', () => {
  sounds.setVolume(Number(volumeSetting.value) / 100);
  syncSoundControls();
  try { localStorage.setItem(volumeKey, volumeSetting.value); } catch {}
});
soundTest.addEventListener('click', sounds.testSound);
for (const type of ['pointerdown', 'pointerup', 'keydown']) {
  document.addEventListener(type, sounds.unlock, { capture: true, passive: true });
}

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
  matchMenu.hidden = !app.classList.contains('in-match');
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

for (const [id, title, label] of [
  ['new-game', 'Начать новую партию?', 'Новая партия'],
  ['surrender', 'Сдаться?', 'Сдаться'],
]) {
  document.getElementById(id).addEventListener('click', () => {
    leaveDialog.querySelector('#leave-title').textContent = title;
    leaveDialog.querySelector('#leave-confirm').textContent = label;
    leaveDialog.returnValue = '';
    leaveDialog.showModal();
  });
}
leaveDialog.addEventListener('close', () => {
  if (leaveDialog.returnValue === 'leave') leaveMatch();
});

let match;
let matchSession = 0;
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
for (const surface of [screen, drawer, preview]) {
  surface.addEventListener('contextmenu', (event) => {
    if (surface !== screen || app.classList.contains('in-match')) event.preventDefault();
  });
}

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

function cardInspection(node, card, placement = false, show = () => showCard(card)) {
  let holdTimer;
  let activated;
  let pendingClick;
  let firstX, firstY;
  function inspect(event) {
    event.preventDefault();
    clearTimeout(holdTimer);
    clearTimeout(pendingClick);
    if (node.isConnected) show();
  }
  node.addEventListener('dblclick', inspect);
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (event.pointerType !== 'touch' && !event.sourceCapabilities?.firesTouchEvents) inspect(event);
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) inspect(event);
  });
  if (!placement) {
    node.addEventListener('pointerdown', (event) => {
      activated = false;
      if (!event.isPrimary || event.pointerType !== 'touch') return;
      firstX = event.clientX;
      firstY = event.clientY;
      holdTimer = setTimeout(() => {
        activated = true;
        if (node.isConnected) show();
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

function hideNotice(notice) {
  clearTimeout(noticeTimers.get(notice));
  noticeTimers.delete(notice);
  notice.hidden = true;
  notice.textContent = '';
}

function showNotice(notice, text, duration) {
  hideNotice(notice);
  notice.hidden = false;
  notice.textContent = text;
  noticeTimers.set(notice, setTimeout(() => hideNotice(notice), duration));
}

function start(faction) {
  mulliganFieldVisible = false;
  announcement.textContent = '';
  match = createMatch({ humanFaction: faction });
  render();
  const first = match.starter === 'human';
  const label = element('span', 'coin-result', 'Монетка: ты ходишь ' + (first ? 'первым' : 'вторым'));
  const coin = element('span', 'tossed-coin', first ? '✦' : '◈');
  coin.setAttribute('aria-hidden', 'true');
  showNotice(coinNotice, '', 1500);
  coinNotice.append(coin, label);
  animateCoin(coin, label, motionDuration(speedSetting.value, reducedMotion.matches) * 1.9);
  screen.querySelector('h2').focus({ preventScroll: true });
}

function leaveMatch() {
  matchSession += 1;
  clearParticles(document);
  for (const overlay of document.querySelectorAll('.motion-overlay')) overlay.remove();
  clearTimeout(timer);
  hideNotice(coinNotice);
  hideNotice(turnNotice);
  hideNotice(roundNotice);
  match = undefined;
  replaying = false;
  mulliganFieldVisible = false;
  announcement.textContent = '';
  for (const dialog of [settings, drawer, preview]) {
    if (dialog.open) dialog.close();
  }
  render();
  screen.querySelector('h2').focus({ preventScroll: true });
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
  function updateCounter() {
    const remaining = mulliganRemaining(match);
    counter.textContent = 'Осталось замен: ' + remaining;
    for (const choice of cards.children) choice.classList.toggle('is-unavailable', remaining === 0);
  }

  function choice(card, index) {
    return cardButton(card, (event) => {
      if (!mulliganRemaining(match)) return;
      const next = replaceMulliganCard(match, card.id);
      if (next === match) {
        counter.textContent = 'Нет подходящей карты для замены · осталось: ' + mulliganRemaining(match);
        return;
      }
      match = next;
      const previous = event.currentTarget;
      const focused = document.activeElement === previous;
      const replacement = choice(match.players.human.hand[index], index);
      previous.replaceWith(replacement);
      updateCounter();
      if (focused) replacement.focus({ preventScroll: true });
    });
  }

  const confirm = button('Готово', () => updateMatch(confirmMulligan(match)), 'button primary');
  const header = element('header', 'mulligan-header');
  header.append(heading, counter);
  const actions = element('div', 'mulligan-actions');
  actions.append(button('Посмотреть поле', () => setMulliganField(true)), confirm);
  cards.append(...match.players.human.hand.map(choice));
  panel.append(header, cards, actions, settingsButton());
  updateCounter();
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
  score.dataset.score = side + '-' + row;
  score.title = ROW_LABELS[row] + ' · ' + strength;
  score.setAttribute('aria-label', score.title);
  if (side === 'bot') label.title = score.title;
  const rowIcon = element('span', 'row-icon', row === 'orbit' ? '◎' : '▲');
  rowIcon.setAttribute('aria-hidden', 'true');
  label.append(rowIcon, score);
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

function readyOrderIds(side) {
  return new Set(availableOrders(match, side).map(({ card }) => card.id));
}

function sideView(side, readyOrders) {
  const player = match.players[side];
  const section = element('section', 'side');
  section.dataset.side = side;
  section.dataset.faction = player.factionId ?? '';
  section.setAttribute('aria-label', sideLabel[side]);
  const rows = side === 'bot' ? ROWS : [...ROWS].reverse();
  section.append(...rows.map((row) => rowView(side, player, row, readyOrders)));
  if (side === 'bot' && player.passed) section.append(element('p', 'opponent-passed', 'ПАС'));
  return section;
}

function playerHand() {
  const { human } = match.players;
  const active = humanCanAct() && !match.playedCard;
  const hand = element('section', 'hand battle-hand');
  hand.setAttribute('aria-label', 'Твоя рука · ' + human.hand.length);
  const cards = element('div', 'battle-hand-cards');
  for (const card of human.hand) {
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
    cards.append(node);
  }
  hand.append(cards);
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
  cardInspection(portrait, { definition: leader }, false, () => showCard({ definition: leader }, { leader: true }));
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

function pileView(side, pile) {
  const player = match.players[side];
  const count = player[pile].length;
  const name = pile === 'deck' ? 'Колода' : 'Сброс';
  const label = sideLabel[side] + ' · ' + name + ' · ' + count;
  const viewable = pile === 'discard' || side === 'human';
  const node = viewable ? button(undefined, () => showDrawer({ side, pile }), 'field-pile')
    : element('div', 'field-pile');
  node.dataset.faction = player.factionId ?? '';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(element('span', 'pile-icon', pile === 'deck' ? '▤' : '▱'), element('strong', null, count));
  return node;
}

function fillDrawer() {
  const journal = openPile === 'journal';
  const { side, pile } = openPile;
  const player = match.players[side];
  const title = element('h2', null, journal ? 'Журнал ходов'
    : pile === 'deck' ? 'Твоя колода' : 'Сброс · ' + player.faction);
  title.id = 'drawer-title';
  const header = element('header', 'drawer-header');
  header.append(title, button('Закрыть', () => drawer.close()));
  if (journal) {
    drawer.replaceChildren(header, logView().querySelector('ol'));
    return;
  }

  const cards = element('div', 'pile-grid');
  const ordered = player[pile].toSorted((left, right) =>
    (right.power ?? 0) - (left.power ?? 0) ||
    left.definition.name.localeCompare(right.definition.name, 'ru'));
  cards.append(...ordered.map((card) => cardButton(card, () => showCard(card), false, player)));
  if (!ordered.length) cards.append(element('p', 'muted', pile === 'deck' ? 'Колода пуста.' : 'Сброс пуст.'));
  drawer.replaceChildren(header, cards);
}

function showDrawer(pile) {
  if (pile.side === 'bot' && pile.pile === 'deck') return;
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
  field.classList.toggle('is-human-turn', phase === 'playing' && !replaying && match.turn === 'human');
  const center = element('div', 'field-center battlefield');
  const humanOrders = readyOrderIds('human');
  center.append(sideView('bot', readyOrderIds('bot')), sideView('human', humanOrders));
  if (!replaying && pending?.side === 'human') {
    center.append(element('p', 'field-message target-prompt', pending.prompt));
  }
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
  if (afterPlay && !action.disabled && humanOrders.size) {
    action.classList.add('has-ready-order');
    action.title = 'Есть готовый Приказ';
    action.setAttribute('aria-description', action.title);
  }
  if (humanCanAct() && !afterPlay && players.human.usedAbility) action.title = 'Сыграй карту после применения способности';
  const humanCount = element('span', 'field-hand-count', players.human.hand.length + '/' + HAND_LIMIT);
  humanCount.title = 'Карт в твоей руке';
  const humanCorner = element('div', 'field-corner');
  humanCorner.append(humanCount, pileView('human', 'deck'));
  right.append(pileView('bot', 'deck'), scoreView('bot'), action, scoreView('human'), humanCorner);
  field.append(left, center, playerHand(), right);
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
  const wins = rounds.filter(({ winner }) => winner === 'human').length;
  const losses = rounds.filter(({ winner }) => winner === 'bot').length;
  const ties = rounds.length - wins - losses;
  const score = element('p', 'match-result-score', `Раунды · Ты ${wins} : ${losses} Противник${ties ? ' · Ничьих: ' + ties : ''}`);
  const actions = element('div', 'finish-actions');
  const faction = match.players.human.factionId;
  actions.append(
    button('Ещё раз той же колодой', () => start(faction), 'button primary'),
    button('Выбор колоды', leaveMatch),
  );
  panel.append(
    heading, score,
    ...rounds.map((event) => element('p', 'round-result', roundText(event))),
    actions,
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

async function showRoundResult(event, state, duration) {
  const { scores, winner } = event;
  const result = winner === 'human' ? 'Раунд за тобой' : winner === 'bot' ? 'Раунд за противником' : 'Раунд: ничья';
  hideNotice(coinNotice);
  hideNotice(turnNotice);
  renderPlayback(state);
  animateLifeLoss(screen, winner, duration * 1.5);
  showNotice(roundNotice, `${result} · ${scores.human} : ${scores.bot}`, ROUND_RESULT_MS);
  await new Promise((resolve) => setTimeout(resolve, ROUND_RESULT_MS));
}

async function updateMatch(next) {
  if (replaying || next === match) return;
  const session = matchSession;
  clearTimeout(timer);
  const before = match;
  const events = next.log.slice(before.log.length);
  const duration = motionDuration(speedSetting.value, reducedMotion.matches);
  if ((before.phase === 'playing' && events.length && duration) || events.some(({ type }) => type === 'round-end')) {
    replaying = true;
    screen.classList.add('is-replaying');
    try {
      await playJournal(before, events, async (event, commit, state) => {
        if (session !== matchSession) return;
        sounds.play(event);
        if (event.type === 'round-end') {
          await showRoundResult(event, state, duration);
          if (session === matchSession) commit();
          return;
        }
        await presentJournalEvent(screen, event, commit, renderPlayback, duration);
      });
    } catch (error) {
      console.warn('Playback stopped early', error);
    } finally {
      if (session === matchSession) replaying = false;
    }
  } else {
    events.forEach(sounds.play);
  }

  if (session !== matchSession) return;
  match = next;
  if (match.phase === 'mulligan') {
    mulliganFieldVisible = false;
  }
  render();
  const changedTurn = match.phase === 'playing' && match.turn !== before.turn;
  if (changedTurn) showNotice(turnNotice, match.turn === 'human' ? 'Твой ход' : 'Ход противника', 1000);
  else if (match.phase !== 'playing') hideNotice(turnNotice);
  announcement.textContent = events.map(eventText).join(' ');
  if (match.phase === 'finished' || match.phase === 'mulligan') screen.querySelector('h2')?.focus({ preventScroll: true });
  else if (match.pending?.side === 'human') {
    const target = screen.querySelector('.effect-target');
    target?.focus({ preventScroll: true });
  } else if ((match.pending?.side ?? match.turn) === 'bot') {
    const delay = changedTurn ? Math.max(BOT_DELAY_MS, 1000) : BOT_DELAY_MS;
    timer = setTimeout(() => updateMatch(applyAction(match, 'bot', chooseBotTurn(match))), delay);
  } else if (before.phase === 'mulligan') {
    screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
  }
}

async function playHuman(action) {
  if (!match || replaying) return;
  const session = matchSession;
  await updateMatch(applyAction(match, 'human', action));
  if (session === matchSession && match && humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
}

render();
