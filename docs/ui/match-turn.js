import {
  animateHandTurn, animateLifeLoss, animateTurnSparks, dismissRoundTransition, presentJournalEvent,
  roundResultLabel, showRoundTransition,
} from './card-motion.js';
import { BOT_DELAY_MS } from '../game/bot/bot.js';
import { serializeBotPosition } from '../game/bot/bot-position.js';
import { createBotSearch } from './bot-search.js';
import { applyAction } from '../game/engine/match.js';
import { playJournal } from './turn-playback.js';
import { animateChoiceSelection, clearRememberedRects, rememberChoicePosition, takeRememberedRect } from './card-motion-core.js';
import { MOTION } from './motion-tokens.js';
import { describeBotAction, eventText } from './match-log.js';
import { aimAnchor, isChoicePending } from './targeting.js';

export function createMatchTurn({
  app, screen, settings, aim, notices, announcement, showNotice, hideNotice,
  render, recordJournal, onMatchChanged, onCancelTargeting, difficulty, battlefieldStyle,
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
    clearTimeout(timer);
    botSearch.cancel();
    match = next;
    replaying = false;
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
    showNotice(roundNotice, roundResultLabel(event), MOTION.ms.roundResult);
    await new Promise((resolve) => setTimeout(resolve, MOTION.ms.roundResult));
  }

  async function playBotTurn() {
    const before = match;
    const session = matchSession;
    const level = difficulty();
    showNotice(turnNotice, 'Противник думает…');
    const result = await botSearch.choose(before, level, settings.showBotThoughts());
    if (session !== matchSession || match !== before) return;
    hideNotice(turnNotice);
    if (result === null) return;
    const { action, trace } = result;
    const next = applyAction(before, 'bot', action);
    if (trace && next !== before) {
      next.log.push({
        type: 'bot-thought', side: 'bot',
        chosen: describeBotAction(match, action), reason: trace.reason,
        candidates: trace.candidates.map(({ action, score, samples, changes }) => ({
          label: describeBotAction(match, action), score, samples, changes,
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
    const speech = recordJournal(before, next, journal);
    const events = journal.filter(({ type }) => type !== 'bot-thought' && type !== 'league-speech');
    const duration = settings.motion();
    let roundTransition;
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
        if (session === matchSession && next.phase === 'mulligan' && next.round > before.round) {
          roundTransition = await showRoundTransition(app, next.round, duration);
        }
      } catch (error) {
        console.warn('Playback stopped early', error);
      } finally {
        if (session === matchSession) replaying = false;
      }
    } else {
      for (const event of events) {
        if (['play', 'hand-return', 'hand-bottom'].includes(event.type)) takeRememberedRect(event.cardId);
        settings.playSound(event);
      }
    }

    if (session !== matchSession) {
      roundTransition?.remove();
      return;
    }
    match = next;
    onMatchChanged(before, match, speech);
    render();
    if (roundTransition) void dismissRoundTransition(roundTransition, duration);
    const changedTurn = match.phase === 'playing' && match.turn !== before.turn;
    const turnStarted = match.phase === 'playing' && (before.phase !== 'playing' || changedTurn ||
      match.players[match.turn].turns !== before.players[match.turn].turns);
    const humanTurnStarted = humanCanAct() && !match.playedCard &&
      (changedTurn || match.players.human.turns !== before.players.human.turns);
    if (turnStarted && battlefieldStyle() === 'standard') animateTurnSparks(screen, match.turn, duration);
    if (humanTurnStarted) animateHandTurn(screen, duration);
    if (changedTurn || humanTurnStarted) showNotice(turnNotice, match.turn === 'human' ? 'Твой ход' : 'Ход противника', MOTION.ms.turnNotice);
    else if (match.phase !== 'playing') hideNotice(turnNotice);
    announcement.textContent = events.map(eventText).join(' ');
    if (match.phase === 'finished' || match.phase === 'mulligan') screen.querySelector('h2')?.focus({ preventScroll: true });
    else if (match.pending?.side === 'human') {
      const target = screen.querySelector('.effect-target');
      target?.focus({ preventScroll: true });
    } else if ((match.pending?.side ?? match.turn) === 'bot') {
      const delay = changedTurn ? Math.max(BOT_DELAY_MS, MOTION.ms.botNoticeDelay) : BOT_DELAY_MS;
      timer = setTimeout(playBotTurn, delay);
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
      const animation = animateChoiceSelection(choiceNode, settings.motion());
      if (animation) await animation;
      if (session !== matchSession) return;
      confirmingTarget = false;
      if (match !== before) return;
      rememberChoicePosition(before, next, action.cardId, choiceNode);
    } else if (before.pending && !isChoicePending(before.pending) && aim.showTap()) {
      confirmingTarget = true;
      await new Promise((resolve) => setTimeout(resolve, settings.motion() ? MOTION.ms.targetConfirm : MOTION.ms.targetConfirmReduced));
      if (session !== matchSession) return;
      confirmingTarget = false;
      if (match !== before) return;
    }
    if (next.pending?.side !== 'human') targetAction = undefined;
    await updateMatch(next);
    if (session === matchSession && match && humanCanAct()) screen.querySelector('#pass-button:enabled')?.focus({ preventScroll: true });
  }

  return {
    get match() { return match; },
    get replaying() { return replaying; },
    get targetAction() { return targetAction; },
    get confirmingTarget() { return confirmingTarget; },
    setMatch: (next) => { match = next; },
    reset, warmBot: botSearch.warm, humanCanAct, playHuman, updateMatch, canCancelTargeting, cancelTargeting,
  };
}
