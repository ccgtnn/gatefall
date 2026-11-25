import { keepCardVideos, resumeCardVideos } from './ui/card-art.js';
import { createLeagueDialogue, LEAGUE_DIALOGUE } from './game/league-dialogue.js';
import { setLeagueSpeech } from './ui/league-character.js';
import { deckEditor, deckHomeScreen, deckListScreen, factionPicker } from './ui/deck-builder.js';
import { createDeckStorage } from './ui/deck-storage.js';
import { bindCardPlacement } from './card-placement.js';
import { animateCoin } from './card-motion.js';
import { clearParticles } from './particles.js';
import { findInPiles, placementSide } from './game/board.js';
import { FACTIONS } from './game/cards.js';
import { inspectDeck, PRESETS } from './game/decks.js';
import { createDeckMatch } from './game/match.js';
import { element, iconButton } from './ui/dom.js';
import { cardArt, preview, showCard } from './ui/cards.js';
import { createBattlefield } from './ui/field.js';
import { mulliganScreen, updatePlacementSelection } from './ui/hand.js';
import { describeFinishedMatch, settleFinishedMatch } from './ui/match-result.js';
import { createMatchTurn } from './ui/match-turn.js';
import { createMatchMenu } from './ui/menu.js';
import { finishedScreen, leaderScreen } from './ui/screens.js';
import { createSettings } from './ui/settings.js';

import { createFactionStats } from './ui/stats.js';
import { createRewardProgress, REWARD_STORAGE_KEY } from './game/rewards.js';
import { createBoosterOpening, createBoosterShop, economyDialog } from './ui/booster-screens.js';
import { createResourceBar, prepareLazySection, sectionDialog, showEssenceGain } from './ui/resources.js';
import { aimAnchor, aimTone, bindTargeting } from './ui/targeting.js';
import { questComplete } from './game/tavern.js';
import { rankStanding } from './game/ranks.js';
import { BATTLEFIELD_STORAGE_KEY, createBattlefieldPreferences, createFramePreferences, decorationsScreen, FRAME_STORAGE_KEY } from './ui/decorations.js';
import { rankScreen } from './ui/rank-screen.js';
import { leagueScreen, LEAGUE_OVERVIEW_QUERY } from './ui/league-screen.js';
import { resetProgress } from './game/reset-progress.js';
import { createRewardReveal, enqueueReward } from './ui/reward-reveal.js';

const app = document.querySelector('#app');
const screen = document.querySelector('#screen');
const leagueOverview = window.matchMedia(LEAGUE_OVERVIEW_QUERY);
leagueOverview.addEventListener('change', () => {
  screen.querySelector('.league-panel')?.dispatchEvent(new Event('league-layout-change'));
});
const phaseLabel = document.querySelector('#phase');
const turnNotice = document.querySelector('#match-notice');
const coinNotice = document.querySelector('#coin-notice');
const roundNotice = document.querySelector('#round-notice');
const noticeTimers = new Map();
const announcement = document.querySelector('#announcement');
let menuView = 'decks';
let selectedFaction;
let editedDeck;
let matchDeck;
let matchRewardId;
let leagueMatch;
let leagueDialogue;
let leagueSpeech;
let speechTimer;
let matchSettlement;
let selectedCardId;
const aim = bindTargeting(screen, () => turns.cancelTargeting());
let mulliganFieldVisible = false;
let storage;
try { storage = window.localStorage; } catch {}
const deckStore = createDeckStorage(storage);
const framePreferences = createFramePreferences(storage, document.documentElement);
const battlefieldPreferences = createBattlefieldPreferences(storage, document.documentElement);
const stats = createFactionStats(Object.keys(FACTIONS), storage);
const settings = createSettings(app, leaveMatch, async () => {
  await resetProgress(storage, navigator.locks);
  window.location.reload();
});
const turns = createMatchTurn({
  app, screen, settings, aim, notices: { turnNotice, coinNotice, roundNotice }, announcement,
  showNotice, hideNotice, render,
  difficulty: () => leagueMatch?.difficulty ?? settings.difficulty(),
  battlefieldStyle: battlefieldPreferences.current,
  onCancelTargeting: () => leagueDialogue?.cancelPlay(),
  recordJournal(before, next, journal) {
    const speech = leagueDialogue?.transition(before, next, journal);
    if (speech) {
      next.log.push(speech);
      journal.push(speech);
    }
    void progress.recordTavernEvents(matchRewardId, before.log.length, journal);
    return speech;
  },
  onMatchChanged(before, next, speech) {
    if (speech && next.phase !== 'finished') showLeagueSpeech(speech);
    if (next.phase === 'finished' && before.phase !== 'finished') void saveMatchResult();
    if (next.phase === 'mulligan') mulliganFieldVisible = false;
  },
});
const rewardReveal = createRewardReveal({
  motion: settings.motion,
  canShow: () => !turns.match || (turns.match.phase === 'finished' && matchSettlement === 'done'),
  showEssence: showEssenceGain,
});
const progress = createRewardProgress(storage, navigator.locks, { enqueueReward });
void progress.checkpointProduction();
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
progress.subscribe(() => screen.querySelector('.deck-editor, .deck-home, .all-decks, .finish, .league-panel, .rank-panel')?.dispatchEvent(new Event('collection-change')));
window.addEventListener('storage', (event) => {
  const decorationKeys = [FRAME_STORAGE_KEY, BATTLEFIELD_STORAGE_KEY];
  if (decorationKeys.includes(event.key) || event.key === null) {
    if (event.key !== BATTLEFIELD_STORAGE_KEY) framePreferences.refresh();
    if (event.key !== FRAME_STORAGE_KEY) battlefieldPreferences.refresh();
    screen.querySelector('.decorations-panel')?.dispatchEvent(new Event('decorations-change'));
  }
  if (decorationKeys.includes(event.key)) return;
  if (event.key?.startsWith('gatefall.') && event.newValue === null) window.location.reload();
  else if (event.key === REWARD_STORAGE_KEY || event.key === null) progress.refresh();
});
if (progress.league()) void progress.checkpointLeague();
let tavernResetAt;
let checkingTavern = false;
let retryTavernAt = 0;
function rememberTavernReset() {
  tavernResetAt = progress.tavern()?.resetAt;
}
async function checkpointTavern() {
  if (checkingTavern) return;
  checkingTavern = true;
  const outcome = await progress.checkpointTavern();
  checkingTavern = false;
  retryTavernAt = outcome === 'unavailable' ? Date.now() + 15000 : 0;
}
progress.subscribe(rememberTavernReset);
rememberTavernReset();
void checkpointTavern();
let rankResetAt = progress.rankResetAt();
let retryRanksAt = 0;
let checkingRanks = false;
progress.subscribe(() => { rankResetAt = progress.rankResetAt(); });
async function checkpointRanks() {
  if (checkingRanks) return;
  checkingRanks = true;
  const outcome = await progress.checkpointRanks();
  checkingRanks = false;
  retryRanksAt = outcome === 'done' ? 0 : Date.now() + 15000;
}
void checkpointRanks();
setInterval(() => {
  screen.querySelector('.league-panel')?.dispatchEvent(new Event('league-tick'));
  if (tavernResetAt && Date.now() >= Math.max(tavernResetAt, retryTavernAt)) void checkpointTavern();
  if (Date.now() >= Math.max(rankResetAt, retryRanksAt)) void checkpointRanks();
}, 1000);
const { humanCanAct, playHuman, updateMatch } = turns;
const menu = createMatchMenu(() => turns.match, () => settings.showBotThoughts());
const { drawer } = menu;
const hand = {
  getMatch: () => turns.match,
  setMatch: turns.setMatch,
  updateMatch, setMulliganField, settingsButton, motion: () => settings.motion(),
};
const battlefield = createBattlefield({
  getMatch: () => turns.match,
  getLeagueOpponent: () => leagueMatch,
  getLeagueSpeech: () => leagueSpeech,
  isReplaying: () => turns.replaying,
  getSelectedCardId: () => selectedCardId,
  isMulliganFieldVisible: () => mulliganFieldVisible,
  setMulliganField, playHuman, humanCanAct, placeSelected, settingsButton,
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

screen.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !selectedCardId || !humanCanAct()) return;
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
  noticeTimers.set(notice, setTimeout(() => hideNotice(notice), duration));
}

function showLeagueSpeech(speech) {
  clearTimeout(speechTimer);
  leagueSpeech = speech ? { ...speech, shownAt: Date.now() } : undefined;
  if (!speech) return;
  speechTimer = setTimeout(() => {
    leagueSpeech = undefined;
    const bubble = screen.querySelector('.league-battle > .league-character .league-speech');
    if (bubble) setLeagueSpeech(bubble);
  }, LEAGUE_DIALOGUE.duration);
}

function goTo(view) {
  menuView = view;
  render();
  window.scrollTo(0, 0);
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

function matchId() {
  return globalThis.crypto?.randomUUID?.() ?? `match-${Date.now()}-${Math.random()}`;
}

async function startLeague(ticket, bot, deck) {
  if (!canPlayDeck(deck)) return 'invalid-deck';
  const next = createDeckMatch(deck, { botDeck: bot.deck });
  if (!next) return 'invalid-deck';
  const id = matchId();
  const outcome = await progress.beginLeagueMatch(ticket, id, deck);
  if (outcome === 'done') start(deck, { next, bot, id });
  return outcome;
}

function start(deck, league) {
  if (!league && !canPlayDeck(deck)) return;
  const next = league?.next ?? createDeckMatch(deck);
  if (!next) return;
  deckStore.recordPlay(deck.id);
  matchDeck = structuredClone(deck);
  turns.reset(next);
  matchRewardId = league?.id ?? matchId();
  leagueMatch = league?.bot;
  leagueDialogue = leagueMatch && createLeagueDialogue(leagueMatch);
  const greeting = leagueDialogue?.start(progress.league());
  if (greeting) next.log.push(greeting);
  showLeagueSpeech(greeting);
  matchSettlement = undefined;
  selectedFaction = undefined;
  editedDeck = undefined;
  menuView = 'decks';
  mulliganFieldVisible = false;
  announcement.textContent = '';
  render();
  const first = next.starter === 'human';
  const label = element('span', 'coin-result', 'Монетка: ты ходишь ' + (first ? 'первым' : 'вторым'));
  const coin = element('span', 'tossed-coin ' + (first ? 'coin-first' : 'coin-second'), first ? '✦' : '◈');
  coin.setAttribute('aria-hidden', 'true');
  const coinDuration = settings.motion() * 3.6;
  const noticeDuration = Math.max(1500, coinDuration + 1000);
  showNotice(coinNotice, '', noticeDuration);
  coinNotice.append(coin, label);
  if (coinDuration) {
    void animateCoin(coinNotice, coin, label, coinDuration, noticeDuration).then(() => {
      if (coin.parentElement === coinNotice) hideNotice(coinNotice);
    });
  }
  screen.querySelector('h2').focus({ preventScroll: true });
}

async function leaveMatch(surrender = false) {
  const returnTo = leagueMatch ? 'league' : 'decks';
  const { match } = turns;
  if (leagueMatch && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
    const id = matchRewardId;
    const outcome = await progress.settleLeagueMatch(id, 'loss', -2);
    if (id !== matchRewardId) return;
    if (outcome !== 'done' && outcome !== 'stale') {
      showNotice(turnNotice, 'Не удалось сохранить результат. Попробуй выйти снова.', 3000);
      return;
    }
    if (outcome === 'done') stats.record(turns.match.players.human.factionId, 'loss');
    if (surrender) {
      hideNotice(coinNotice);
      hideNotice(turnNotice);
      hideNotice(roundNotice);
      app.querySelector('.round-transition')?.remove();
      showLeagueSpeech();
      const current = turns.match;
      const speech = leagueDialogue?.concede();
      turns.reset({ ...current, phase: 'finished', result: 'loss', surrendered: true,
        log: speech ? [...current.log, speech] : current.log });
      matchSettlement = outcome;
      render();
      screen.querySelector('h2')?.focus({ preventScroll: true });
      return;
    }
  } else if (match?.phase === 'finished' && matchSettlement !== 'done' && matchSettlement !== 'stale') {
    if (matchSettlement === 'unavailable') void saveMatchResult();
    return;
  } else if (surrender === true && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
    stats.record(match.players.human.factionId, 'loss');
  }
  turns.reset();
  clearParticles(document);
  for (const overlay of document.querySelectorAll('.motion-overlay')) overlay.remove();
  hideNotice(coinNotice);
  hideNotice(turnNotice);
  hideNotice(roundNotice);
  matchDeck = undefined;
  matchRewardId = undefined;
  leagueMatch = undefined;
  leagueDialogue = undefined;
  showLeagueSpeech();
  matchSettlement = undefined;
  menuView = returnTo;
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
  const { match } = turns;
  const card = match.players.human.hand.find(({ id }) => id === selectedCardId);
  if (!card || placementSide('human', card) !== side) return;
  playHuman({ type: 'play', cardId: selectedCardId, row, position: match.players[side].board[row].length });
}

async function replayMatch() {
  const finished = turns.match;
  await rewardReveal.whenIdle();
  if (turns.match === finished && finished?.phase === 'finished') start(matchDeck);
}

function setMulliganField(visible) {
  mulliganFieldVisible = visible;
  render();
  screen.querySelector(visible ? '.mulligan-return' : '#mulligan-title')?.focus({ preventScroll: true });
}

function render() {
  const { match, replaying, targetAction } = turns;
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
    const settlement = describeFinishedMatch(match, matchSettlement, leagueMatch, progress.ranks);
    content = finishedScreen(match, phaseLabel, replayMatch, leaveMatch,
      settings.showBotThoughts(), () => canPlayDeck(matchDeck), Boolean(leagueMatch), settlement);
  } else {
    const back = () => goTo('all-decks');
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
      case 'all-decks': content = deckListScreen(phaseLabel, deckStore.list(), stats, {
        back: () => goTo('decks'), create: () => goTo('faction'), play: start, edit: editDeck,
        copy: (deck) => makeDeck(deck.factionId, deck.leaderId, deck),
      }, progress.inventory); break;
      case 'decorations': content = decorationsScreen(phaseLabel, framePreferences, battlefieldPreferences, () => goTo('decks')); break;
      case 'ranks': content = rankScreen(phaseLabel, progress, () => goTo('decks')); break;
      case 'league': content = leagueScreen(phaseLabel, {
        back: () => goTo('decks'),
        overview: () => leagueOverview.matches,
        read: progress.league,
        checkpoint: progress.checkpointLeague,
        decks: () => {
          const { owned } = progress.inventory();
          return [...PRESETS, ...deckStore.list()].filter((deck) => inspectDeck(deck, owned).valid);
        },
        gold: () => progress.inventory().gold,
        play: startLeague,
        concede: (id) => progress.settleLeagueMatch(id, 'loss', -2),
      }); break;
      default: content = deckHomeScreen(phaseLabel, stats, {
        base: openBase,
        tavernRewards: () => {
          const tavern = progress.tavern();
          return tavern ? tavern.pending.length + tavern.slots.filter((quest) => !quest.claimed && questComplete(quest)).length : 0;
        },
        league: () => goTo('league'), ranks: () => goTo('ranks'),
        currentRank: () => rankStanding(progress.ranks().rounds).rank,
        catalog: () => openResources('essence'), decorations: () => goTo('decorations'), all: back, play: start,
      }, () => deckStore.recent(progress.inventory().owned));
    }
  }
  app.classList.toggle('is-deck-home', content.classList.contains('deck-home'));
  if (app.classList.contains('in-match')) keepCardVideos(screen, content);
  screen.replaceChildren(content);
  if (app.classList.contains('in-match')) resumeCardVideos(content);
  rewardReveal.refresh();
  menu.refresh(match, replaying);
  const pending = !replaying && match?.pending?.side === 'human' ? match.pending : null;
  const sourceId = pending?.job?.sourceId ?? targetAction?.cardId;
  let source;
  if (pending) {
    source = sourceId
      ? screen.querySelector(`[data-board-card="${CSS.escape(sourceId)}"] .unit-face`)
      : screen.querySelector('[data-aim-leader="human"]');
    if (!source) {
      const card = match.effects.find(({ discard }) => discard?.id === sourceId)?.discard ??
        findInPiles(targetAction?.before ?? match, pending.side, sourceId, ['hand', 'discard', 'deck'])?.card;
      const prompt = screen.querySelector('.target-prompt, #deck-choice-title');
      if (card?.definition.art && prompt) {
        source = cardArt(card.definition, 'aim-source-art');
        prompt.prepend(source);
      }
    }
  }
  aim.update(pending ? aimAnchor(source) ?? targetAction?.origin : undefined, aimTone(pending?.kind, pending?.selectionSide));
}

async function saveMatchResult() {
  const id = matchRewardId;
  const finished = turns.match;
  matchSettlement = 'saving';
  render();
  const { status, recordStats } = await settleFinishedMatch(finished, progress, { id, league: Boolean(leagueMatch) });
  if (id !== matchRewardId) return;
  if (recordStats) stats.record(finished.players.human.factionId, finished.result);
  matchSettlement = status;
  render();
  screen.querySelector('h2')?.focus({ preventScroll: true });
}

render();
