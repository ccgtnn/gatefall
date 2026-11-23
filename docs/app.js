import { keepCardVideos } from './ui/card-art.js?v=premium-art-1';
import { createLeagueDialogue, LEAGUE_DIALOGUE } from './game/league-dialogue.js?v=hounds-1';
import { setLeagueSpeech } from './ui/league-character.js?v=league-characters-1';
import { createBaseScreen } from './ui/base-screen.js?v=hounds-1';
import { deckEditor, deckHomeScreen, deckListScreen, factionPicker } from './ui/deck-builder.js?v=premium-art-1';
import { createDeckStorage } from './ui/deck-storage.js?v=hounds-1';
import { bindCardPlacement } from './card-placement.js?v=hounds-1';
import { animateCoin, animateHandTurn, animateLifeLoss, animateTurnSparks, presentJournalEvent } from './card-motion.js?v=premium-art-1';
import { clearParticles } from './particles.js?v=step-14';
import { playJournal } from './turn-playback.js?v=hounds-1';
import { BOT_DELAY_MS, chooseBotTurn } from './game/bot.js?v=hounds-1';
import { findInPiles, placementSide } from './game/board.js?v=hounds-1';
import { FACTIONS } from './game/cards.js?v=hounds-1';
import { inspectDeck, PRESETS } from './game/decks.js?v=hounds-1';
import { applyAction, createDeckMatch } from './game/match.js?v=hounds-1';
import { element, iconButton } from './ui/dom.js?v=opponent-reveal-1';
import { cardArt, preview, showCard } from './ui/cards.js?v=premium-art-1';
import { createBattlefield } from './ui/field.js?v=premium-art-1';
import { mulliganScreen, updatePlacementSelection } from './ui/hand.js?v=premium-art-1';
import { createMatchMenu, describeBotAction, eventText } from './ui/menu.js?v=premium-art-1';
import { catalogScreen, finishedScreen, leaderScreen } from './ui/screens.js?v=premium-art-1';
import { createSettings } from './ui/settings.js?v=hounds-1';

import { createFactionStats } from './ui/stats.js?v=step-11';
import { createRewardProgress, REWARD_STORAGE_KEY } from './game/rewards.js?v=hounds-1';
import { createRewardBook } from './ui/reward-book.js?v=hounds-1';
import { createBoosterOpening, createBoosterShop, economyDialog } from './ui/booster-screens.js?v=premium-art-1';
import { createResourceBar } from './ui/resources.js?v=reward-reveal-1';
import { aimAnchor, aimTone, bindTargeting } from './ui/targeting.js?v=targeting-1';
import { questComplete } from './game/tavern.js?v=hounds-1';
import { rankStanding, wonRounds } from './game/ranks.js?v=monthly-ranks-1';
import { BATTLEFIELD_STORAGE_KEY, createBattlefieldPreferences, createFramePreferences, decorationsScreen, FRAME_STORAGE_KEY } from './ui/decorations.js?v=premium-art-1';
import { rankScreen } from './ui/rank-screen.js?v=monthly-ranks-1';
import { leagueScreen, LEAGUE_OVERVIEW_QUERY } from './ui/league-screen.js?v=hounds-1';
import { resetProgress } from './game/reset-progress.js?v=hounds-1';
import { createRewardReveal, enqueueReward } from './ui/reward-reveal.js?v=reward-reveal-2';

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
const ROUND_RESULT_MS = 1500;
const noticeTimers = new Map();
const announcement = document.querySelector('#announcement');
let match;
let menuView = 'decks';
let selectedFaction;
let editedDeck;
let matchDeck;
let matchSession = 0;
let matchRewardId;
let leagueMatch;
let leagueDialogue;
let leagueSpeech;
let speechTimer;
let matchSettlement;
let timer;
let selectedCardId;
let replaying = false;
let targetAction;
let confirmingTarget = false;
let retryRolls = [];
const aim = bindTargeting(screen, cancelTargeting);
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
const rewardReveal = createRewardReveal({ motion: settings.motion, canShow: () => !match });
const progress = createRewardProgress(storage, navigator.locks, { enqueueReward });
const openBase = createBaseScreen(progress);
void progress.checkpointProduction();
const catalog = economyDialog('card-collection', 'Все карты');
catalog.body.append(catalogScreen(progress));
const openResources = createResourceBar(app.querySelector('.masthead'), document.querySelector('#start-settings'), progress, {
  keys: createRewardBook(progress),
  gold: createBoosterShop(progress, () => openResources('packCount')),
  essence: catalog,
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
const menu = createMatchMenu(() => match, () => settings.showBotThoughts());
const { drawer } = menu;
const hand = {
  getMatch: () => match,
  setMatch: (next) => { match = next; },
  updateMatch, setMulliganField, settingsButton, motion: () => settings.motion(),
};
const battlefield = createBattlefield({
  getMatch: () => match,
  getLeagueOpponent: () => leagueMatch,
  getLeagueSpeech: () => leagueSpeech,
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

screen.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !selectedCardId || !humanCanAct()) return;
  selectedCardId = undefined;
  updatePlacementSelection(screen, match);
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
  match = next;
  targetAction = undefined;
  retryRolls = [];
  matchRewardId = league?.id ?? matchId();
  leagueMatch = league?.bot;
  leagueDialogue = leagueMatch && createLeagueDialogue(leagueMatch);
  const greeting = leagueDialogue?.start();
  if (greeting) match.log.push(greeting);
  showLeagueSpeech(greeting);
  matchSettlement = undefined;
  selectedFaction = undefined;
  editedDeck = undefined;
  menuView = 'decks';
  mulliganFieldVisible = false;
  announcement.textContent = '';
  render();
  const first = match.starter === 'human';
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
  if (leagueMatch && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
    const id = matchRewardId;
    const outcome = await progress.settleLeagueMatch(id, 'loss', -2);
    if (id !== matchRewardId) return;
    if (outcome !== 'done' && outcome !== 'stale') {
      showNotice(turnNotice, 'Не удалось сохранить результат. Попробуй выйти снова.', 3000);
      return;
    }
    if (outcome === 'done') stats.record(match.players.human.factionId, 'loss');
    if (surrender) {
      matchSession += 1;
      clearTimeout(timer);
      hideNotice(coinNotice);
      hideNotice(turnNotice);
      hideNotice(roundNotice);
      showLeagueSpeech();
      replaying = false;
      const speech = leagueDialogue?.concede();
      match = { ...match, phase: 'finished', result: 'loss', surrendered: true,
        log: speech ? [...match.log, speech] : match.log };
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
  matchSession += 1;
  clearParticles(document);
  for (const overlay of document.querySelectorAll('.motion-overlay')) overlay.remove();
  clearTimeout(timer);
  hideNotice(coinNotice);
  hideNotice(turnNotice);
  hideNotice(roundNotice);
  match = undefined;
  targetAction = undefined;
  retryRolls = [];
  matchDeck = undefined;
  matchRewardId = undefined;
  leagueMatch = undefined;
  leagueDialogue = undefined;
  showLeagueSpeech();
  matchSettlement = undefined;
  menuView = returnTo;
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

async function replayMatch() {
  const deck = matchDeck;
  if (rewardReveal.hasPending()) {
    await leaveMatch();
    await rewardReveal.whenIdle();
  }
  if (!match || match.phase === 'finished') start(deck);
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
  app.classList.toggle('in-league-match', Boolean(leagueMatch));
  document.querySelector('#bot-difficulty').disabled = Boolean(leagueMatch);
  document.querySelector('#leave-description').textContent = leagueMatch
    ? 'Матч закончится поражением. Ты вернёшься к таблице лиги.'
    : 'Текущий матч закончится. Ты вернёшься к выбору колоды.';
  let content;
  if (match?.phase === 'mulligan' || match?.phase === 'playing') content = battlefield();
  else if (match?.phase === 'finished') {
    const saving = !matchSettlement || matchSettlement === 'saving';
    const failed = matchSettlement === 'unavailable';
    const scored = wonRounds(match.log);
    const settlement = {
      saving, failed,
      opponent: leagueMatch,
      reply: match.log.findLast(({ type, reason }) => type === 'league-speech' && (reason === 'win' || reason === 'loss')),
      notice: saving ? 'Сохраняем результат…' : failed ? 'Не удалось сохранить результат.'
        : matchSettlement === 'stale' ? 'Этот тур уже закрыт.'
          : scored && !match.surrendered ? `В месячный ранг зачтено: ${scored} · текущий ранг ${rankStanding(progress.ranks().rounds).rank}` : '',
    };
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
  const action = chooseBotTurn(match, leagueMatch?.difficulty ?? settings.difficulty(), options);
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
  aim.update();
  const session = matchSession;
  clearTimeout(timer);
  const before = match;
  const journal = next.log.slice(before.log.length);
  const speech = leagueDialogue?.transition(before, next, journal);
  if (speech) {
    next.log.push(speech);
    journal.push(speech);
  }
  void progress.recordTavernEvents(matchRewardId, before.log.length, journal);
  const events = journal.filter(({ type }) => type !== 'bot-thought' && type !== 'league-speech');
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
  if (speech && match.phase !== 'finished') showLeagueSpeech(speech);
  if (match.phase === 'finished' && before.phase !== 'finished') void saveMatchResult();
  if (match.phase === 'mulligan') {
    mulliganFieldVisible = false;
  }
  render();
  const changedTurn = match.phase === 'playing' && match.turn !== before.turn;
  const turnStarted = match.phase === 'playing' && (before.phase !== 'playing' || changedTurn ||
    match.players[match.turn].turns !== before.players[match.turn].turns);
  const humanTurnStarted = humanCanAct() && !match.playedCard &&
    (changedTurn || match.players.human.turns !== before.players.human.turns);
  if (turnStarted && battlefieldPreferences.current() === 'standard') animateTurnSparks(screen, match.turn, duration);
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

async function saveMatchResult() {
  const id = matchRewardId;
  const { result, log } = match;
  const { factionId } = match.players.human;
  const rounds = wonRounds(log);
  matchSettlement = 'saving';
  render();
  const outcome = leagueMatch
    ? await progress.settleLeagueMatch(id, result,
      rounds - log.filter(({ type, winner }) => type === 'round-end' && winner === 'bot').length, factionId, rounds)
    : await progress.rewardMatch(id, result, factionId, rounds);
  if (id !== matchRewardId) return;
  if (outcome === 'done' || outcome === 'empty') stats.record(factionId, result);
  matchSettlement = outcome === 'stale' ? 'stale'
    : ['done', 'empty', 'claimed'].includes(outcome) ? 'done' : 'unavailable';
  render();
  screen.querySelector('h2')?.focus({ preventScroll: true });
}

function cancelTargeting() {
  if (!targetAction || !match?.pending || replaying) return false;
  const { before, rolls, cardId, type } = targetAction;
  retryRolls = [...rolls, ...retryRolls];
  targetAction = undefined;
  match = before;
  leagueDialogue?.cancelPlay();
  render();
  const source = cardId && CSS.escape(cardId);
  const selector = type === 'leader' ? '[data-aim-leader="human"] ~ .leader-power'
    : type === 'order' ? `[data-board-card="${source}"] .unit-order`
      : `.hand [data-card-id="${source}"]`;
  screen.querySelector(selector)?.focus({ preventScroll: true });
  announcement.textContent = 'Выбор цели отменён.';
  return true;
}

async function playHuman(action) {
  if (!match || replaying || confirmingTarget) return;
  const before = match;
  const session = matchSession;
  const rolls = targetAction?.rolls ?? [];
  const next = applyAction(before, 'human', action, { random: () => {
    const roll = retryRolls.shift() ?? Math.random();
    rolls.push(roll);
    return roll;
  } });
  if (next === before) return;
  if (!targetAction && next.pending?.side === 'human') {
    const { cardId, type } = action;
    const node = type === 'leader' ? screen.querySelector('[data-aim-leader="human"]')
      : screen.querySelector(`[data-card-id="${CSS.escape(cardId ?? '')}"], [data-board-card="${CSS.escape(cardId ?? '')}"]`);
    const point = aimAnchor(node)?.();
    targetAction = { before, rolls, cardId, type, origin: () => point };
  }
  if (before.pending && aim.showTap()) {
    confirmingTarget = true;
    await new Promise((resolve) => setTimeout(resolve, settings.motion() ? 180 : 90));
    confirmingTarget = false;
    if (match !== before || session !== matchSession) return;
  }
  if (next.pending?.side !== 'human') targetAction = undefined;
  await updateMatch(next);
  if (session === matchSession && match && humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
}

render();
