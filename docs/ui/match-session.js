import { animateCoin } from './card-motion.js';
import { clearParticles } from './particles.js';
import { inspectDeck } from '../game/decks.js';
import { createDeckMatch } from '../game/match.js';
import { createLeagueDialogue, LEAGUE_DIALOGUE } from '../game/league-dialogue.js';
import { element } from './dom.js';
import { setLeagueSpeech } from './league-character.js';
import { describeFinishedMatch, settleFinishedMatch } from './match-result.js';

function matchId() {
  return globalThis.crypto?.randomUUID?.() ?? `match-${Date.now()}-${Math.random()}`;
}

export function createMatchSession({
  app, screen, turns, progress, stats, deckStore, settings, dialogs, waitForRewards,
  announcement, notices, showNotice, hideNotice, onStart, onLeave, render,
}) {
  const { turnNotice, coinNotice, roundNotice } = notices;
  let matchDeck;
  let matchBotDeck;
  let matchRewardId;
  let leagueOpponent;
  let leagueDialogue;
  let leagueSpeech;
  let speechTimer;
  let matchSettlement;
  let mulliganFieldVisible = false;

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

  function canPlayDeck(deck) {
    return inspectDeck(deck, progress.inventory().owned).valid;
  }

  async function startLeague(ticket, bot, deck) {
    if (!canPlayDeck(deck)) return 'invalid-deck';
    const next = createDeckMatch(deck, { botDeck: bot.deck });
    if (!next) return 'invalid-deck';
    const id = matchId();
    const outcome = await progress.beginLeagueMatch(ticket, id, deck);
    if (outcome === 'done') begin(deck, next, { bot, id });
    return outcome;
  }

  function start(deck, { botDeck } = {}) {
    if (!canPlayDeck(deck)) return;
    const next = createDeckMatch(deck, { botDeck });
    if (next) begin(deck, next, { botDeck });
  }

  function begin(deck, next, { bot, botDeck, id }) {
    deckStore.recordPlay(deck.id);
    matchDeck = structuredClone(deck);
    matchBotDeck = botDeck && structuredClone(botDeck);
    turns.reset(next);
    matchRewardId = id ?? matchId();
    leagueOpponent = bot;
    turns.warmBot();
    leagueDialogue = leagueOpponent && createLeagueDialogue(leagueOpponent);
    const greeting = leagueDialogue?.start(progress.league());
    if (greeting) next.log.push(greeting);
    showLeagueSpeech(greeting);
    matchSettlement = undefined;
    onStart();
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

  const canLeaveResult = () => matchSettlement === 'done' || matchSettlement === 'stale';

  async function leave(surrender = false, historyEntry) {
    const returnTo = leagueOpponent ? 'league' : 'decks';
    const { match } = turns;
    if (leagueOpponent && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
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
        settings.close();
        render();
        screen.querySelector('h2')?.focus({ preventScroll: true });
        return;
      }
    } else if (match?.phase === 'finished' && !canLeaveResult()) {
      if (matchSettlement === 'unavailable') void saveMatchResult();
      return;
    } else if (surrender === true && (match?.phase === 'playing' || match?.phase === 'mulligan')) {
      stats.record(match.players.human.factionId, 'loss');
    }
    turns.reset();
    clearParticles(app.ownerDocument);
    for (const overlay of app.ownerDocument.querySelectorAll('.motion-overlay')) overlay.remove();
    hideNotice(coinNotice);
    hideNotice(turnNotice);
    hideNotice(roundNotice);
    matchDeck = undefined;
    matchBotDeck = undefined;
    matchRewardId = undefined;
    leagueOpponent = undefined;
    leagueDialogue = undefined;
    showLeagueSpeech();
    matchSettlement = undefined;
    onLeave(returnTo, historyEntry);
    mulliganFieldVisible = false;
    announcement.textContent = '';
    settings.close();
    for (const dialog of dialogs) {
      if (dialog.open) dialog.close();
    }
    render();
    screen.querySelector('h2').focus({ preventScroll: true });
  }

  async function replay() {
    const finished = turns.match;
    await waitForRewards();
    if (turns.match === finished && finished?.phase === 'finished') start(matchDeck, { botDeck: matchBotDeck });
  }

  function setMulliganField(visible) {
    mulliganFieldVisible = visible;
    render();
    screen.querySelector(visible ? '.mulligan-return' : '#mulligan-title')?.focus({ preventScroll: true });
  }

  function recordJournal(before, next, journal) {
    const speech = leagueDialogue?.transition(before, next, journal);
    if (speech) {
      next.log.push(speech);
      journal.push(speech);
    }
    void progress.recordTavernEvents(matchRewardId, before.log.length, journal);
    return speech;
  }

  function onMatchChanged(before, next, speech) {
    if (speech && next.phase !== 'finished') showLeagueSpeech(speech);
    if (next.phase === 'finished' && before.phase !== 'finished') void saveMatchResult();
    if (next.phase === 'mulligan') mulliganFieldVisible = false;
  }

  async function saveMatchResult() {
    const id = matchRewardId;
    const finished = turns.match;
    matchSettlement = 'saving';
    render();
    const { status, recordStats } = await settleFinishedMatch(finished, progress, { id, league: Boolean(leagueOpponent) });
    if (id !== matchRewardId) return;
    if (recordStats) stats.record(finished.players.human.factionId, finished.result);
    matchSettlement = status;
    render();
    screen.querySelector('h2')?.focus({ preventScroll: true });
  }

  return {
    start, startLeague, leave, replay, setMulliganField, recordJournal, onMatchChanged,
    get leagueOpponent() { return leagueOpponent; },
    get leagueSpeech() { return leagueSpeech; },
    get mulliganFieldVisible() { return mulliganFieldVisible; },
    difficulty: () => leagueOpponent?.level ?? settings.difficulty(),
    cancelDialogue: () => leagueDialogue?.cancelPlay(),
    canLeaveResult,
    canReplay: () => canPlayDeck(matchDeck),
    canShowRewards: () => !turns.match || (turns.match.phase === 'finished' && matchSettlement === 'done'),
    describeResult: (match) => describeFinishedMatch(match, matchSettlement, leagueOpponent, progress.ranks),
  };
}
