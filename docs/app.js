import { deckEditor, deckListScreen, factionPicker } from './ui/deck-builder.js?v=orbital-art-1';
import { createDeckStorage } from './ui/deck-storage.js?v=step-16';
import { bindCardPlacement } from './card-placement.js?v=opponent-reveal-1';
import { animateCoin, animateHandTurn, animateLifeLoss, presentJournalEvent } from './card-motion.js?v=orbital-art-1';
import { clearParticles } from './particles.js?v=step-14';
import { playJournal } from './turn-playback.js?v=orbital-art-1';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=orbital-art-1';
import { placementSide } from './game/board.js?v=orbital-art-1';
import { FACTIONS } from './game/cards.js?v=orbital-art-1';
import { inspectDeck } from './game/decks.js?v=orbital-art-1';
import { applyAction, createDeckMatch } from './game/match.js?v=orbital-art-1';
import { element, iconButton } from './ui/dom.js?v=opponent-reveal-1';
import { preview, showCard } from './ui/cards.js?v=orbital-art-1';
import { createBattlefield } from './ui/field.js?v=orbital-art-1';
import { mulliganScreen, updatePlacementSelection } from './ui/hand.js?v=orbital-art-1';
import { createMatchMenu, describeBotAction, eventText } from './ui/menu.js?v=orbital-art-1';
import { catalogScreen, finishedScreen, leaderScreen } from './ui/screens.js?v=orbital-art-1';
import { createSettings } from './ui/settings.js?v=orbital-art-1';

import { createFactionStats } from './ui/stats.js?v=step-11';
import { createRewardProgress, REWARD_STORAGE_KEY } from './game/rewards.js?v=orbital-art-1';
import { createRewardBook } from './ui/reward-book.js?v=orbital-art-1';
import { createBoosterOpening, createBoosterShop, economyDialog } from './ui/booster-screens.js?v=orbital-art-1';
import { createResourceBar } from './ui/resources.js?v=interface-polish-1';
import { resetProgress } from './game/reset-progress.js?v=orbital-art-1';

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
const settings = createSettings(app, leaveMatch, async () => {
  await resetProgress(storage, navigator.locks);
  window.location.reload();
});
const progress = createRewardProgress(storage, navigator.locks, { legacyDecks: deckStore.list() });
const catalog = economyDialog('card-collection', 'Все карты');
catalog.body.append(catalogScreen(progress));
const openResources = createResourceBar(app.querySelector('.masthead'), document.querySelector('#start-settings'), progress, {
  keys: createRewardBook(progress),
  gold: createBoosterShop(progress, () => openResources('packCount')),
  essence: catalog,
  packCount: createBoosterOpening(progress, () => openResources('gold')),
});
progress.subscribe(() => screen.querySelector('.deck-editor, .deck-home, .finish')?.dispatchEvent(new Event('collection-change')));
window.addEventListener('storage', (event) => {
  if (event.key?.startsWith('gatefall.') && event.newValue === null) window.location.reload();
  else if (event.key === REWARD_STORAGE_KEY || event.key === null) progress.refresh();
});
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
  screen.querySelector('.section-back, h2')?.focus({ preventScroll: true });
}

function editDeck(deck, notice = '') {
  editedDeck = structuredClone(deck);
  goTo('edit');
  if (notice) screen.querySelector('.deck-save-status').textContent = notice;
}

function makeDeck(factionId, leaderId, source) {
  const id = globalThis.crypto?.randomUUID?.() ?? 'deck-' + Date.now() + '-' + Math.random();
  const { owned } = progress.inventory();
  const cardIds = (source?.cardIds ?? []).filter((cardId) => {
    if (!owned[cardId]) return false;
    owned[cardId] -= 1;
    return true;
  });
  const skipped = source ? source.cardIds.length - cardIds.length : 0;
  editDeck({
    id, name: source ? source.name + ' (копия)' : FACTIONS[factionId].name,
    factionId, leaderId, cardIds,
  }, skipped ? `В копию вошли доступные карты. Пропущено копий · ${skipped}.` : '');
}

function canPlayDeck(deck) {
  return inspectDeck(deck, progress.inventory().owned).valid;
}

function start(deck) {
  if (!canPlayDeck(deck)) return;
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
  const coinDuration = settings.motion() * 2.85;
  showNotice(coinNotice, '', Math.max(1500, coinDuration + 900));
  coinNotice.append(coin, label);
  animateCoin(coin, label, coinDuration);
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

function placeSelected(row, side) {
  if (!selectedCardId || !humanCanAct()) return;
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  if (!card || placementSide('human', card) !== side) return;
  playHuman({ type: 'play', cardId: selectedCardId, row, position: match.players[side].board[row].length });
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
  else if (match?.phase === 'finished') {
    content = finishedScreen(match, phaseLabel, () => start(matchDeck), leaveMatch,
      settings.showBotThoughts(), () => canPlayDeck(matchDeck));
  } else {
    const back = () => goTo('decks');
    switch (menuView) {
      case 'faction': content = factionPicker(phaseLabel, (id) => {
        selectedFaction = id;
        goTo('leader');
      }, back); break;
      case 'leader': content = leaderScreen(phaseLabel, selectedFaction, makeDeck, () => goTo('faction')); break;
      case 'edit': content = deckEditor(phaseLabel, editedDeck, {
        back, inventory: progress.inventory, save: (deck) => deckStore.save(deck), play: (deck) => {
          deckStore.save(deck);
          start(deck);
        },
      }); break;
      default: content = deckListScreen(phaseLabel, deckStore.list(), stats, {
        create: () => goTo('faction'), catalog: () => openResources('essence'), play: start, edit: editDeck,
        copy: (deck) => makeDeck(deck.factionId, deck.leaderId, deck),
      }, progress.inventory);
    }
  }
  app.classList.toggle('is-deck-home', content.classList.contains('deck-home'));
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
        if (event.type === 'round-end') {
          settings.playSound(event);
          await showRoundResult(event, state, duration);
          if (session === matchSession) commit();
          return;
        }
        await presentJournalEvent(screen, event, () => {
          if (session === matchSession) settings.playSound(event);
          return commit();
        }, (state) => {
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
  const humanTurnStarted = humanCanAct() && !match.playedCard &&
    (changedTurn || match.players.human.turns !== before.players.human.turns);
  if (humanTurnStarted) animateHandTurn(screen, duration);
  if (changedTurn || humanTurnStarted) showNotice(turnNotice, match.turn === 'human' ? 'Твой ход' : 'Ход противника', 1000);
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
