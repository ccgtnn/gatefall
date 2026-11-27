import { emit } from './ui/app-events.js';
import { createAppHistory } from './ui/app-history.js';
import { createAppTimers } from './ui/app-timers.js';
import { keepCardVideos, resumeCardVideos } from './ui/card-art.js';
import { deckEditor, deckHomeScreen, deckListScreen, factionPicker } from './ui/deck-builder.js';
import { createDeckStorage, DECK_STORAGE_KEY, newDeckId, PRIMARY_DECK_KEY, RECENT_DECKS_KEY } from './ui/deck-storage.js';
import { QUICK_MATCH_KEY } from './ui/quick-match-panel.js';
import { bindCardPlacement } from './ui/card-placement.js';
import { placementSide } from './game/engine/board.js';
import { FACTIONS } from './game/cards/cards.js';
import { inspectDeck, PRESETS } from './game/cards/decks.js';
import { iconButton } from './ui/dom.js';
import { preview, showCard } from './ui/cards.js';
import { createBattlefield } from './ui/field.js';
import { mulliganScreen, updatePlacementSelection } from './ui/hand.js';
import { createMatchSession } from './ui/match-session.js';
import { createMatchTurn } from './ui/match-turn.js';
import { createMatchMenu } from './ui/menu.js';
import { finishedScreen, leaderScreen } from './ui/screens.js';
import { BOT_DIFFICULTY_KEY, createBotDifficulty } from './ui/bot-difficulty.js';
import { createSettings } from './ui/settings.js';
import { createAppCloud } from './ui/cloud/app-cloud.js';

import { createFactionStats, FACTION_STATS_KEY } from './ui/stats.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from './game/meta/rewards.js';
import { createBoosterOpening, createBoosterShop, economyDialog } from './ui/booster-screens.js';
import { createResourceBar, prepareLazySection, sectionDialog, showEssenceGain } from './ui/resources.js';
import { bindTargeting, updatePendingAim } from './ui/targeting.js';
import { BATTLEFIELD_STORAGE_KEY, createBattlefieldPreferences, createFramePreferences, decorationsScreen, FRAME_STORAGE_KEY } from './ui/decorations.js';
import { rankScreen } from './ui/rank-screen.js';
import { leagueScreen, LEAGUE_OVERVIEW_QUERY } from './ui/league-screen.js';
import { resetProgress } from './game/meta/reset-progress.js';
import { createRewardReveal, enqueueReward } from './ui/reward-reveal.js';

const app = document.querySelector('#app');
const screen = document.querySelector('#screen');
const leagueOverview = window.matchMedia(LEAGUE_OVERVIEW_QUERY);
leagueOverview.addEventListener('change', () => emit('league-layout-change'));
const phaseLabel = document.querySelector('#phase');
const turnNotice = document.querySelector('#match-notice');
const coinNotice = document.querySelector('#coin-notice');
const roundNotice = document.querySelector('#round-notice');
const noticeTimers = new Map();
const announcement = document.querySelector('#announcement');
let menuView = 'decks';
let selectedFaction;
let editedDeck;
const editNotices = new Map();
let screenEvents;
let selectedCardId;
let reloadOnMatchExit = false;
let turns;
const aim = bindTargeting(screen, () => turns?.cancelTargeting());
let localStorage;
try { localStorage = window.localStorage; } catch {}
const cloud = createAppCloud(localStorage, () => Boolean(turns?.match));
const { storage } = cloud;
const deckStore = createDeckStorage(storage);
const framePreferences = createFramePreferences(storage, document.documentElement);
const battlefieldPreferences = createBattlefieldPreferences(storage, document.documentElement);
const stats = createFactionStats(Object.keys(FACTIONS), storage);
const botDifficulty = createBotDifficulty(storage);
const settings = createSettings(app, (surrender) => session.leave(surrender), async () => {
  const overwrite = Boolean(cloud.auth.session()) &&
    window.confirm('Перезаписать облачную копию после сброса прогресса?');
  await cloud.sync.reset(() => resetProgress(localStorage, navigator.locks), overwrite);
  window.location.reload();
}, botDifficulty, cloud);
turns = createMatchTurn({
  app, screen, settings, aim, notices: { turnNotice, coinNotice, roundNotice }, announcement,
  showNotice, hideNotice, render,
  difficulty: () => session.difficulty(),
  battlefieldStyle: battlefieldPreferences.current,
  onCancelTargeting: () => session.cancelDialogue(),
  recordJournal: (...args) => session.recordJournal(...args),
  onMatchChanged: (...args) => session.onMatchChanged(...args),
});
const progress = createRewardProgress(storage, navigator.locks, { enqueueReward });
const menu = createMatchMenu(() => turns.match, () => settings.showBotThoughts());
const { drawer } = menu;
const session = createMatchSession({
  app, screen, turns, progress, stats, deckStore, settings, dialogs: [drawer, preview],
  waitForRewards: () => rewardReveal.whenIdle(),
  announcement, notices: { turnNotice, coinNotice, roundNotice }, showNotice, hideNotice, render,
  onStart() {
    selectedFaction = undefined;
    editedDeck = undefined;
    menuView = 'decks';
    navigation.navigate('match');
  },
  onLeave(view, historyEntry) {
    if (historyEntry) restoreMenuState(historyEntry);
    else {
      menuView = view;
      navigation.replace(view);
    }
    if (reloadOnMatchExit) window.location.reload();
    else void cloud.sync.run();
  },
});
const navigation = createAppHistory({
  window, document,
  inMatch: () => turns.match?.phase === 'playing' || turns.match?.phase === 'mulligan',
  confirmLeave: settings.confirmLeave,
  showMenu(entry) {
    if (entry.screen === 'match') return Boolean(turns.match);
    if (turns.match?.phase === 'finished') {
      const canLeave = session.canLeaveResult();
      void session.leave(false, entry);
      return canLeave;
    }
    restoreMenuState(entry);
    showMenuScreen(menuView);
  },
});
const rewardReveal = createRewardReveal({
  motion: settings.motion,
  canShow: session.canShowRewards,
  showEssence: showEssenceGain,
});
const base = sectionDialog('base-screen', 'База', 'base-screen');
const prepareBase = prepareLazySection(base.dialog, base.shell, async () => {
  const { mountBaseScreen } = await import('./ui/base-screen.js');
  return () => mountBaseScreen(progress, base);
});
function openBase() {
  if (base.dialog.open) return;
  base.dialog.showModal();
  prepareBase();
}

const rewardBook = sectionDialog('reward-book', 'Книга наград');
const prepareRewardBook = prepareLazySection(rewardBook.dialog, rewardBook.shell, async () => {
  const { mountRewardBook } = await import('./ui/reward-book.js');
  return () => mountRewardBook(progress, rewardBook);
});

const catalog = economyDialog('card-collection', 'Все карты');
catalog.dialog.addEventListener('toggle', () => {
  if (catalog.dialog.open) resumeCardVideos(catalog.body);
});
const prepareCatalog = prepareLazySection(catalog.dialog, catalog.body, async () => {
  const { catalogScreen } = await import('./ui/catalog-screen.js');
  return () => {
    const { panel, refresh } = catalogScreen(progress, () => catalog.dialog.open);
    catalog.body.append(panel);
    return refresh;
  };
});
const openResources = createResourceBar(app.querySelector('.masthead'), document.querySelector('#start-settings'), progress, {
  keys: { ...rewardBook, prepare: prepareRewardBook },
  gold: createBoosterShop(progress, () => openResources('packCount')),
  essence: { ...catalog, prepare: prepareCatalog },
  packCount: createBoosterOpening(progress, () => openResources('gold')),
});
progress.subscribe(() => emit('collection-change'));
const reloadKeys = new Set([REWARD_STORAGE_KEY, DECK_STORAGE_KEY, RECENT_DECKS_KEY, FACTION_STATS_KEY]);
window.addEventListener('storage', (event) => {
  if (event.storageArea !== localStorage) return;
  if (event.key === BOT_DIFFICULTY_KEY) botDifficulty.refresh();
  const decorationKeys = [FRAME_STORAGE_KEY, BATTLEFIELD_STORAGE_KEY];
  if (decorationKeys.includes(event.key) || event.key === null) {
    if (event.key !== BATTLEFIELD_STORAGE_KEY) framePreferences.refresh();
    if (event.key !== FRAME_STORAGE_KEY) battlefieldPreferences.refresh();
    emit('decorations-change');
  }
  if (decorationKeys.includes(event.key)) return;
  if (event.key === null || (reloadKeys.has(event.key) && event.newValue === null)) {
    if (turns.match) reloadOnMatchExit = true;
    else window.location.reload();
  } else if (event.key === REWARD_STORAGE_KEY) {
    progress.refresh();
  } else if (event.key === DECK_STORAGE_KEY) {
    deckStore.refresh();
    if (!turns.match && menuView === 'all-decks') render();
    else emit('collection-change');
  } else if (event.key === PRIMARY_DECK_KEY) {
    if (!turns.match && ['all-decks', 'league'].includes(menuView)) render();
    else emit('collection-change');
  }
});
const timers = createAppTimers(progress, () => emit('league-tick'));
window.addEventListener('pagehide', timers.stop);
window.addEventListener('pageshow', (event) => { if (event.persisted) timers.start(); });

const { humanCanAct, playHuman, updateMatch } = turns;
const hand = {
  getMatch: () => turns.match,
  setMatch: turns.setMatch,
  updateMatch, setMulliganField: session.setMulliganField, settingsButton, motion: () => settings.motion(),
};
const battlefield = createBattlefield({
  getMatch: () => turns.match,
  getLeagueOpponent: () => session.leagueOpponent,
  getLeagueSpeech: () => session.leagueSpeech,
  isReplaying: () => turns.replaying,
  getSelectedCardId: () => selectedCardId,
  isMulliganFieldVisible: () => session.mulliganFieldVisible,
  setMulliganField: session.setMulliganField, playHuman, humanCanAct, placeSelected, settingsButton,
  showDrawer: menu.showDrawer,
  selectCard: (id) => {
    selectedCardId = selectedCardId === id ? undefined : id;
    updatePlacementSelection(screen, turns.match, selectedCardId);
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
  const card = turns.match?.players.human.hand.find(({ id }) => id === node.dataset.cardId);
  if (card && !turns.replaying) showCard(card);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !selectedCardId || !humanCanAct() || document.querySelector('dialog[open]')) return;
  selectedCardId = undefined;
  updatePlacementSelection(screen, turns.match);
});

function settingsButton() {
  return iconButton('⚙', 'Настройки', settings.showSettings, 'field-settings');
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
  if (duration !== undefined) noticeTimers.set(notice, setTimeout(() => hideNotice(notice), duration));
}

function goTo(view) {
  const data = view === 'leader' ? { faction: selectedFaction }
    : view === 'edit' ? { deckId: editedDeck.id } : undefined;
  navigation.navigate(view, data);
  showMenuScreen(view);
}

function showMenuScreen(view) {
  menuView = view;
  render();
  window.scrollTo(0, 0);
  screen.querySelector('.section-back, h2')?.focus({ preventScroll: true });
}

function restoreMenuState({ screen: view, data }) {
  screenEvents?.abort();
  selectedFaction = data?.faction;
  editedDeck = view === 'edit' ? deckStore.get(data?.deckId) : undefined;
  menuView = view === 'edit' && !editedDeck ? 'all-decks' : view;
  if (menuView !== view) navigation.replace(menuView);
}

function editDeck(deck, notice = '') {
  deckStore.stageDraft(deck);
  editedDeck = deckStore.get(deck.id);
  editNotices.set(deck.id, notice);
  goTo('edit');
}

function makeDeck(factionId, leaderId, source) {
  const id = newDeckId();
  const { owned } = progress.inventory();
  const cardIds = [];
  for (const cardId of source?.cardIds ?? []) {
    if (!owned[cardId]) continue;
    owned[cardId] -= 1;
    cardIds.push(cardId);
  }
  const skipped = source ? source.cardIds.length - cardIds.length : 0;
  editDeck({
    id, name: source ? source.name + ' (копия)' : FACTIONS[factionId].name,
    factionId, leaderId, cardIds,
  }, skipped ? `В копию вошли доступные карты. Пропущено копий · ${skipped}.` : '');
}

function openDeckEditor(deck) {
  if (deck.id.startsWith('preset-')) makeDeck(deck.factionId, deck.leaderId, deck);
  else editDeck(deck);
}

function setPrimaryDeck(deck) {
  if (!deckStore.setPrimary(deck.id, progress.inventory().owned)) return;
  try {
    const selected = JSON.parse(storage?.getItem(QUICK_MATCH_KEY)) ?? {};
    storage?.setItem(QUICK_MATCH_KEY, JSON.stringify({ ...selected, player: deck.id }));
  } catch {
    try { storage?.setItem(QUICK_MATCH_KEY, JSON.stringify({ player: deck.id })); } catch {}
  }
  render({ deckListNotice: `Основная колода: ${deck.name}.` });
}

function deleteDeck(deck) {
  return deckStore.remove(deck.id);
}

function placeSelected(row, side) {
  if (!selectedCardId || !humanCanAct()) return;
  const { match } = turns;
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  if (!card || placementSide('human', card) !== side) return;
  playHuman({ type: 'play', cardId: selectedCardId, row, position: match.players[side].board[row].length });
}

function render({ deckListNotice } = {}) {
  screenEvents?.abort();
  screenEvents = new AbortController();
  const { signal } = screenEvents;
  const { match, replaying, targetAction } = turns;
  const leagueMatch = session.leagueOpponent;
  cancelPlacement();
  screen.classList.toggle('is-replaying', replaying);
  selectedCardId = undefined;
  app.classList.toggle('in-match', match?.phase === 'mulligan' || match?.phase === 'playing');
  app.classList.toggle('in-league-match', Boolean(leagueMatch));
  document.querySelector('#bot-difficulty').disabled = Boolean(leagueMatch);
  document.querySelector('#leave-description').textContent = leagueMatch
    ? 'Матч закончится поражением. Ты вернёшься к таблице лиги.'
    : 'Текущий матч закончится. Ты вернёшься к выбору колоды.';
  let content;
  if (match?.phase === 'mulligan' || match?.phase === 'playing') content = battlefield();
  else if (match?.phase === 'finished') {
    const settlement = session.describeResult(match);
    content = finishedScreen(match, phaseLabel, session.replay, session.leave,
      settings.showBotThoughts(), session.canReplay, Boolean(leagueMatch), settlement, signal);
  } else {
    const back = () => navigation.backTo('all-decks');
    switch (menuView) {
      case 'faction': content = factionPicker(phaseLabel, (id) => {
        selectedFaction = id;
        goTo('leader');
      }, back); break;
      case 'leader': content = leaderScreen(phaseLabel, selectedFaction, makeDeck, () => navigation.backTo('faction')); break;
      case 'edit': {
        const notice = editNotices.get(editedDeck.id);
        editNotices.delete(editedDeck.id);
        content = deckEditor(phaseLabel, editedDeck, {
          back, notice, signal, inventory: progress.inventory, save: deckStore.save, play: session.start,
          remove: deleteDeck,
        });
        break;
      }
      case 'all-decks': content = deckListScreen(phaseLabel, deckStore.list(), stats, {
        back: () => navigation.backTo('decks'), create: () => goTo('faction'), edit: openDeckEditor,
        copy: (deck) => makeDeck(deck.factionId, deck.leaderId, deck),
        primary: deckStore.primary,
        setPrimary: setPrimaryDeck,
        refresh: render,
        remove: (deck) => {
          if (deleteDeck(deck)) render({ deckListNotice: `Колода «${deck.name}» удалена.` });
        },
        importJson: deckStore.importJson,
        notice: deckListNotice,
        onImported({ deck, decks, missing, saved }) {
          if (decks) {
            const incomplete = decks.filter((entry) => entry.missing.length > 0).length;
            const notice = `Импортировано колод: ${decks.length}.` +
              (incomplete ? ` Не хватает карт в колодах: ${incomplete}.` : '') +
              (saved ? '' : ' Браузер не сохранил данные после закрытия страницы.');
            render({ deckListNotice: notice });
            return;
          }
          const status = saved ? 'Колода импортирована.' : 'Колода импортирована до закрытия страницы. Браузер не сохранил данные.';
          const details = missing.map(({ name, count }) => name + ' ×' + count);
          editDeck(deck, details.length ? status + ' Не хватает карт: ' + details.join(', ') + '.' : status);
        },
      }, progress.inventory, signal); break;
      case 'decorations': content = decorationsScreen(phaseLabel, framePreferences, battlefieldPreferences, () => navigation.backTo('decks'), signal); break;
      case 'ranks': content = rankScreen(phaseLabel, progress, () => navigation.backTo('decks'), signal); break;
      case 'league': content = leagueScreen(phaseLabel, {
        back: () => navigation.backTo('decks'),
        overview: () => leagueOverview.matches,
        read: progress.league,
        checkpoint: progress.checkpointLeague,
        decks: () => {
          const { owned } = progress.inventory();
          const decks = [...PRESETS, ...deckStore.list()].filter((deck) => inspectDeck(deck, owned).valid);
          const primary = deckStore.primary(owned);
          return primary
            ? [primary, ...decks.filter(({ id }) => id !== primary.id)]
            : decks;
        },
        gold: () => progress.inventory().gold,
        play: session.startLeague,
        concede: (id) => progress.settleLeagueMatch(id, 'loss', -2),
      }, signal); break;
      default: content = deckHomeScreen(phaseLabel, {
        base: openBase, league: () => goTo('league'), ranks: () => goTo('ranks'),
        catalog: () => openResources('essence'), decorations: () => goTo('decorations'), all: () => goTo('all-decks'),
      }, progress, { deckStore, inventory: progress.inventory, storage, difficulty: botDifficulty, play: session.start }, signal);
    }
  }
  app.classList.toggle('is-deck-home', content.classList.contains('deck-home'));
  if (app.classList.contains('in-match')) keepCardVideos(screen, content);
  screen.replaceChildren(content);
  if (app.classList.contains('in-match')) resumeCardVideos(content);
  rewardReveal.refresh();
  menu.refresh(match, replaying);
  updatePendingAim(screen, aim, replaying ? null : match, targetAction);
}

render();
window.gatefallBootReady?.();

// Reconcile an existing cloud copy before background checkpoints create local progress.
void cloud.start().finally(() => {
  if (cloud.sync.reloading()) return;
  void progress.checkpointProduction();
  timers.start();
});
