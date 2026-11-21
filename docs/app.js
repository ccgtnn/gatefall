import { deckEditor, deckListScreen, factionPicker } from './ui/deck-builder.js?v=step-21';
import { createDeckStorage } from './ui/deck-storage.js?v=step-16';
import { bindCardPlacement } from './card-placement.js?v=field-6';
import { animateCoin, animateLifeLoss, presentJournalEvent } from './card-motion.js?v=step-21';
import { clearParticles } from './particles.js?v=step-14';
import { playJournal } from './turn-playback.js?v=step-21';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=step-21';
import { FACTIONS } from './game/cards.js?v=step-21';
import { applyAction, createDeckMatch } from './game/match.js?v=step-21';
import { element, iconButton } from './ui/dom.js?v=step-11';
import { preview, showCard } from './ui/cards.js?v=step-21';
import { createBattlefield } from './ui/field.js?v=step-21';
import { mulliganScreen, updatePlacementSelection } from './ui/hand.js?v=step-21';
import { createMatchMenu, describeBotAction, eventText } from './ui/menu.js?v=step-21';
import { catalogScreen, finishedScreen, leaderScreen } from './ui/screens.js?v=step-21';
import { createSettings } from './ui/settings.js?v=step-21';

import { createFactionStats } from './ui/stats.js?v=step-11';

const app = document.querySelector('#app');
const screen = document.querySelector('#screen');
const phaseLabel = document.querySelector('#phase');
const turnNotice = document.querySelector('#match-notice');
const coinNotice = document.querySelector('#coin-notice');
const roundNotice = document.querySelector('#round-notice');
const ROUND_RESULT_MS = 1500;
const noticeTimers = new Map();
const announcement = document.querySelector('#announcement');
let match;
let menuView = 'decks';
let selectedFaction;
let editedDeck;
let matchDeck;
let matchSession = 0;
let timer;
let selectedCardId;
let replaying = false;
let mulliganFieldVisible = false;
let storage;
try { storage = window.localStorage; } catch {}
const deckStore = createDeckStorage(storage);
const stats = createFactionStats(Object.keys(FACTIONS), storage);
const settings = createSettings(app, leaveMatch);
const menu = createMatchMenu(() => match, () => settings.showBotThoughts());
const { drawer } = menu;
const hand = {
  getMatch: () => match,
  setMatch: (next) => { match = next; },
  updateMatch, setMulliganField, settingsButton,
};
const battlefield = createBattlefield({
  getMatch: () => match,
  isReplaying: () => replaying,
  getSelectedCardId: () => selectedCardId,
  isMulliganFieldVisible: () => mulliganFieldVisible,
  setMulliganField, playHuman, humanCanAct, placeSelected, settingsButton,
  showDrawer: menu.showDrawer,
  selectCard: (id) => {
    selectedCardId = selectedCardId === id ? undefined : id;
    updatePlacementSelection(screen, match, selectedCardId);
  },
  mulliganScreen: () => mulliganScreen(hand),
});

for (const surface of [screen, drawer, preview]) {
  surface.addEventListener('contextmenu', (event) => {
    if (surface !== screen || app.classList.contains('in-match')) event.preventDefault();
  });
}

const cancelPlacement = bindCardPlacement(screen, (cardId, row, position) => {
  playHuman({ type: 'play', cardId, row, position });
}, (node) => {
  const card = match.players.human.hand.find(({ id }) => id === node.dataset.cardId);
  if (card && !replaying) showCard(card);
});

function settingsButton() {
  return iconButton('⚙', 'Настройки', settings.showSettings, 'field-settings');
}

function humanCanAct() {
  return !replaying && match.phase === 'playing' && match.turn === 'human' && !match.pending;
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

function goTo(view) {
  menuView = view;
  render();
  screen.querySelector('h2')?.focus({ preventScroll: true });
}

function editDeck(deck) {
  editedDeck = structuredClone(deck);
  goTo('edit');
}

function makeDeck(factionId, leaderId, source) {
  const id = globalThis.crypto?.randomUUID?.() ?? 'deck-' + Date.now() + '-' + Math.random();
  editDeck({
    id, name: source ? source.name + ' (копия)' : FACTIONS[factionId].name,
    factionId, leaderId, cardIds: source ? [...source.cardIds] : [],
  });
}

function start(deck) {
  const next = createDeckMatch(deck);
  if (!next) return;
  matchDeck = structuredClone(deck);
  match = next;
  selectedFaction = undefined;
  editedDeck = undefined;
  menuView = 'decks';
  mulliganFieldVisible = false;
  announcement.textContent = '';
  render();
  const first = match.starter === 'human';
  const label = element('span', 'coin-result', 'Монетка: ты ходишь ' + (first ? 'первым' : 'вторым'));
  const coin = element('span', 'tossed-coin', first ? '✦' : '◈');
  coin.setAttribute('aria-hidden', 'true');
  showNotice(coinNotice, '', 1500);
  coinNotice.append(coin, label);
  animateCoin(coin, label, settings.motion() * 1.9);
  screen.querySelector('h2').focus({ preventScroll: true });
}

function leaveMatch(surrender = false) {
  if (surrender === true && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
    stats.record(match.players.human.factionId, 'loss');
  }
  matchSession += 1;
  clearParticles(document);
  for (const overlay of document.querySelectorAll('.motion-overlay')) overlay.remove();
  clearTimeout(timer);
  hideNotice(coinNotice);
  hideNotice(turnNotice);
  hideNotice(roundNotice);
  match = undefined;
  matchDeck = undefined;
  menuView = 'decks';
  replaying = false;
  mulliganFieldVisible = false;
  announcement.textContent = '';
  settings.close();
  for (const dialog of [drawer, preview]) {
    if (dialog.open) dialog.close();
  }
  render();
  screen.querySelector('h2').focus({ preventScroll: true });
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

function render() {
  cancelPlacement();
  screen.classList.toggle('is-replaying', replaying);
  selectedCardId = undefined;
  app.classList.toggle('in-match', match?.phase === 'mulligan' || match?.phase === 'playing');
  let content;
  if (match?.phase === 'mulligan' || match?.phase === 'playing') content = battlefield();
  else if (match?.phase === 'finished') content = finishedScreen(match, phaseLabel, () => start(matchDeck), leaveMatch, settings.showBotThoughts());
  else {
    const back = () => goTo('decks');
    switch (menuView) {
      case 'catalog': content = catalogScreen(phaseLabel, back); break;
      case 'faction': content = factionPicker(phaseLabel, (id) => {
        selectedFaction = id;
        goTo('leader');
      }, back); break;
      case 'leader': content = leaderScreen(phaseLabel, selectedFaction, makeDeck, () => goTo('faction')); break;
      case 'edit': content = deckEditor(phaseLabel, editedDeck, {
        back, save: (deck) => deckStore.save(deck), play: (deck) => {
          deckStore.save(deck);
          start(deck);
        },
      }); break;
      default: content = deckListScreen(phaseLabel, deckStore.list(), stats, {
        create: () => goTo('faction'), catalog: () => goTo('catalog'), play: start, edit: editDeck,
        copy: (deck) => makeDeck(deck.factionId, deck.leaderId, deck),
      });
    }
  }
  screen.replaceChildren(content);
  menu.refresh(match, replaying);
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

function playBotTurn() {
  let trace;
  const options = settings.showBotThoughts() ? { onDecision: (decision) => { trace = decision; } } : {};
  const action = chooseBotTurn(match, settings.difficulty(), options);
  const next = applyAction(match, 'bot', action);
  if (trace && next !== match) {
    next.log.push({
      type: 'bot-thought', side: 'bot',
      chosen: describeBotAction(match, action), reason: trace.reason,
      candidates: trace.candidates.map(({ action, score, samples }) => ({
        label: describeBotAction(match, action), score, samples,
      })),
    });
  }
  return updateMatch(next);
}

async function updateMatch(next) {
  if (replaying || next === match) return;
  const session = matchSession;
  clearTimeout(timer);
  const before = match;
  const events = next.log.slice(before.log.length).filter(({ type }) => type !== 'bot-thought');
  const duration = settings.motion();
  if ((before.phase === 'playing' && events.length && duration) || events.some(({ type }) => type === 'round-end')) {
    replaying = true;
    screen.classList.add('is-replaying');
    try {
      await playJournal(before, events, async (event, commit, state) => {
        if (session !== matchSession) return;
        settings.playSound(event);
        if (event.type === 'round-end') {
          await showRoundResult(event, state, duration);
          if (session === matchSession) commit();
          return;
        }
        await presentJournalEvent(screen, event, commit, (state) => {
          if (session === matchSession) renderPlayback(state);
        }, duration);
      });
    } catch (error) {
      console.warn('Playback stopped early', error);
    } finally {
      if (session === matchSession) replaying = false;
    }
  } else {
    events.forEach(settings.playSound);
  }

  if (session !== matchSession) return;
  match = next;
  if (match.phase === 'finished' && before.phase !== 'finished') {
    stats.record(match.players.human.factionId, match.result);
  }
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
    timer = setTimeout(playBotTurn, delay);
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
