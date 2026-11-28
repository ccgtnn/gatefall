import {
  animateHandTurn, animateLifeLoss, animateMatchResult, animateRoundWinner, dismissRoundTransition, presentJournalEvent,
  roundResultLabel, showRoundTransition,
} from './card-motion.js';
import { BOT_DELAY_MS } from '../game/bot/bot.js';
import { serializeBotPosition } from '../game/bot/bot-position.js';
import { chooseFallbackTurn, createBotSearch } from './bot-search.js';
import { applyAction } from '../game/engine/match.js';
import { playJournal } from './turn-playback.js';
import { animateChoiceSelection, clearRememberedRects, rememberChoicePosition, takeRememberedRect } from './card-motion-core.js';
import { clearTurnBanner, pulseTurnAction } from './turn-banner.js';
import { MOTION, respectReducedMotion } from './motion-tokens.js';
import { describeMatchAction, eventText } from './match-log.js';
import { weatherApplied } from './card-motion-feedback.js';
import { aimAnchor, botAimTime, isChoicePending, showBotAim } from './targeting.js';

export function createMatchTurn({
  app, screen, settings, aim, notices, announcement, showNotice, hideNotice,
  render, recordJournal, onMatchChanged, onCancelTargeting, difficulty, testReport,
}) {
  const { turnNotice, coinNotice, roundNotice } = notices;
  const botSearch = createBotSearch();
  let match;
  let matchSession = 0;
  let timer;
  let replaying = false;
  let targetAction;
  let confirmingTarget = false;
  let retryRolls = [];

  settings.bindPositionCopy?.(() => match && !replaying && serializeBotPosition(match, difficulty()));

  function reset(next) {
    matchSession += 1;
    clearRememberedRects();
    clearTurnBanner(screen);
    clearTimeout(timer);
    botSearch.cancel();
    match = next;
    replaying = false;
    screen.classList.remove('is-replaying');
    targetAction = undefined;
    confirmingTarget = false;
    retryRolls = [];
  }

  function humanCanAct() {
    return !replaying && match?.phase === 'playing' && match.turn === 'human' && !match.pending;
  }

  function renderPlayback(state) {
    match = state;
    render();
  }

  async function showRoundResult(event, state, duration) {
    hideNotice(coinNotice);
    hideNotice(turnNotice);
    renderPlayback(state);
    animateLifeLoss(screen, event.winner, duration * MOTION.pace.lifeLoss);
    animateRoundWinner(screen, event.winner, duration);
    showNotice(roundNotice, roundResultLabel(event), MOTION.ms.roundResult);
    await new Promise((resolve) => setTimeout(resolve, MOTION.ms.roundResult));
  }

  async function playBotTurn(intentTime) {
    const before = match;
    const session = matchSession;
    const level = difficulty();
    if (testReport?.latestBot) {
      testReport.clearLatestBot();
      screen.querySelector('.field-test-feedback')?.remove();
    }
    const label = screen.querySelector('.field-turn-label[data-side="bot"]');
    label?.setAttribute('data-thinking', '');
    const result = await botSearch.choose(before, level, Boolean(testReport?.active) || settings.showBotThoughts()).finally(() => {
      label?.removeAttribute('data-thinking');
    });
    if (session !== matchSession || match !== before) return;
    if (result === null) return;
    let { action, trace } = result;
    let next = applyAction(before, 'bot', action);
    const rejected = next === before;
    if (rejected) {
      console.warn('Bot action rejected', action);
      const rejectedAction = action;
      for (action of [chooseFallbackTurn(before), { type: 'pass' }, { type: 'end-turn' }]) {
        next = applyAction(before, 'bot', action);
        if (next !== before) break;
      }
      if (next === before) return;
      if (testReport?.active) {
        trace = { action, rejectedAction, reason: 'Действие из поиска отклонено. Использую резервный ход.',
          candidates: trace?.candidates ?? [] };
      }
    }
    if (trace && (!rejected || testReport?.active)) {
      next.log.push({
        type: 'bot-thought', side: 'bot',
        chosen: describeMatchAction(before, action), reason: trace.reason,
        candidates: trace.candidates.map(({ action, score, samples, changes }) => ({
          label: describeMatchAction(before, action), score, samples, changes,
        })),
      });
    }
    if (intentTime && !rejected) {
      await showBotAim(screen, before, action, intentTime).catch(() => {});
      if (session !== matchSession || match !== before) return;
    }
    return updateMatch(next, { side: 'bot', action, level, trace });
  }

  async function updateMatch(next, reportAction) {
    if (replaying || next === match) return;
    aim.update();
    const session = matchSession;
    clearTimeout(timer);
    const before = match;
    const journal = next.log.slice(before.log.length);
    const speech = recordJournal(before, next, journal);
    if (next.pending?.side !== 'human') targetAction = undefined;
    const reportEntry = reportAction && testReport?.record(before, journal, reportAction, { deferBotFeedback: true });
    const events = journal.filter(({ type }) => type !== 'bot-thought' && type !== 'league-speech');
    const duration = respectReducedMotion(settings.motion());
    let roundTransition;
    let bannerSide;
    if ((before.phase === 'playing' && events.length && duration) || events.some(({ type }) => type === 'round-end')) {
      replaying = true;
      screen.classList.add('is-replaying');
      try {
        await playJournal(before, events, async (event, commit, state, nextEvent, previous) => {
          if (session !== matchSession) return;
          if (event.type === 'round-end') {
            settings.playSound(event);
            if (duration) await showRoundResult(event, state, duration);
            if (session === matchSession) commit();
            return;
          }
          if (event.type === 'turn-start') hideNotice(turnNotice);
          const shown = await presentJournalEvent(screen, event, () => {
            if (session === matchSession && (event.type !== 'row-effect' || weatherApplied(event, state))) {
              settings.playSound(event);
            }
            return commit();
          }, (state) => {
            if (session === matchSession) renderPlayback(state);
          }, duration, { next: nextEvent, previous, state });
          if (event.type === 'turn-start' && !event.empty) bannerSide = shown ? event.side : undefined;
        });
        if (session === matchSession && next.phase === 'mulligan' && next.round > before.round) {
          roundTransition = await showRoundTransition(app, next.round, duration);
        }
      } catch (error) {
        console.warn('Playback stopped early', error);
      } finally {
        if (session === matchSession) {
          replaying = false;
          screen.classList.remove('is-replaying');
        }
      }
    } else {
      for (const event of events) {
        if (['play', 'hand-return', 'hand-bottom'].includes(event.type)) takeRememberedRect(event.cardId);
        if (event.type !== 'row-effect' || weatherApplied(event, before)) settings.playSound(event);
      }
    }

    if (session !== matchSession) {
      roundTransition?.remove();
      return;
    }
    match = next;
    if (reportEntry?.botMove) testReport.showBotFeedback(reportEntry);
    if (match.phase === 'finished') testReport?.finish(match);
    onMatchChanged(before, match, speech);
    render();
    if (roundTransition) void dismissRoundTransition(roundTransition, duration);
    if (match.phase === 'finished' && before.phase !== 'finished') {
      settings.playSound({ type: 'match-end', result: match.result });
      animateMatchResult(screen, match.result, duration);
    }
    const changedTurn = match.phase === 'playing' && match.turn !== before.turn;
    const turnStarted = match.phase === 'playing' && (before.phase !== 'playing' || changedTurn ||
      match.players[match.turn].turns !== before.players[match.turn].turns);
    if (turnStarted && humanCanAct() && !match.playedCard && duration) {
      animateHandTurn(screen, duration);
      pulseTurnAction(screen, duration);
    }
    if (turnStarted && bannerSide !== match.turn) {
      showNotice(turnNotice, match.turn === 'human' ? 'Твой ход' : 'Ход противника', MOTION.ms.turnNotice);
    } else if (turnStarted || match.phase !== 'playing') hideNotice(turnNotice);
    announcement.textContent = events.map(eventText).join(' ');
    if (match.phase === 'finished' || match.phase === 'mulligan') screen.querySelector('h2')?.focus({ preventScroll: true });
    else if (match.pending?.side === 'human') {
      const target = screen.querySelector('.effect-target');
      target?.focus({ preventScroll: true });
    } else if ((match.pending?.side ?? match.turn) === 'bot') {
      const delay = changedTurn ? Math.max(BOT_DELAY_MS, MOTION.ms.botNoticeDelay) : BOT_DELAY_MS;
      // Reserve the aim cue inside the existing time allotted to the bot.
      const intentTime = botAimTime(match.pending, duration);
      timer = setTimeout(() => playBotTurn(intentTime), delay - intentTime);
    } else if (before.phase === 'mulligan') {
      screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
    }
  }

  function canCancelTargeting() {
    return Boolean(targetAction && match?.pending?.side === 'human' && !replaying && !confirmingTarget);
  }

  function cancelTargeting() {
    if (!canCancelTargeting()) return false;
    const { before, rolls, cardId, type } = targetAction;
    retryRolls = [...rolls, ...retryRolls];
    targetAction = undefined;
    clearRememberedRects();
    testReport?.record(match, [], {
      side: 'human', action: { type: 'cancel-target' }, description: 'Выбор цели отменён.',
    });
    match = before;
    onCancelTargeting();
    render();
    const source = cardId && CSS.escape(cardId);
    const selector = type === 'leader' ? '[data-aim-leader="human"] ~ .leader-power'
      : type === 'order' ? `[data-board-card="${source}"] .unit-order`
        : `.hand [data-card-id="${source}"]`;
    screen.querySelector(selector)?.focus({ preventScroll: true });
    announcement.textContent = 'Выбор цели отменён.';
    return true;
  }

  async function playHuman(action, choiceNode) {
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
    if (action.type === 'target' && choiceNode && isChoicePending(before.pending)) {
      confirmingTarget = true;
      try {
        const animation = animateChoiceSelection(choiceNode, settings.motion());
        if (animation) await animation;
        if (session === matchSession && match === before) rememberChoicePosition(before, next, action.cardId, choiceNode);
      } catch (error) {
        console.warn('Target confirmation animation interrupted', error);
      } finally {
        if (session === matchSession) confirmingTarget = false;
      }
      if (session !== matchSession || match !== before) return;
    } else if (before.pending && !isChoicePending(before.pending) && aim.showTap()) {
      confirmingTarget = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, settings.motion() ? MOTION.ms.targetConfirm : MOTION.ms.targetConfirmReduced));
      } finally {
        if (session === matchSession) confirmingTarget = false;
      }
      if (session !== matchSession || match !== before) return;
    }
    await updateMatch(next, { side: 'human', action });
    if (session === matchSession && match && humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
  }

  return {
    get match() { return match; },
    get replaying() { return replaying; },
    get targetAction() { return targetAction; },
    get confirmingTarget() { return confirmingTarget; },
    setMatch: (next, reportAction) => {
      if (reportAction && next !== match) testReport?.record(match, next.log.slice(match.log.length), reportAction);
      match = next;
    },
    reset, warmBot: botSearch.warm, humanCanAct, playHuman, updateMatch, canCancelTargeting, cancelTargeting,
  };
}
