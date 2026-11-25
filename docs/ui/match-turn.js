import { animateHandTurn, animateLifeLoss, animateTurnSparks, presentJournalEvent } from './card-motion.js';
import { BOT_DELAY_MS, chooseBotTurn } from '../game/bot.js';
import { applyAction } from '../game/match.js';
import { playJournal } from './turn-playback.js';
import { element } from './dom.js';
import { describeBotAction, eventText } from './match-log.js';
import { aimAnchor } from './targeting.js';

const ROUND_RESULT_MS = 1500;

export function createMatchTurn({
  app, screen, settings, aim, notices, announcement, showNotice, hideNotice,
  render, recordJournal, onMatchChanged, onCancelTargeting, difficulty, battlefieldStyle,
}) {
  const { turnNotice, coinNotice, roundNotice } = notices;
  let match;
  let matchSession = 0;
  let timer;
  let replaying = false;
  let targetAction;
  let confirmingTarget = false;
  let retryRolls = [];

  function reset(next) {
    matchSession += 1;
    clearTimeout(timer);
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
    const { scores, winner } = event;
    const result = winner === 'human' ? 'Раунд за тобой' : winner === 'bot' ? 'Раунд за противником' : 'Раунд: ничья';
    hideNotice(coinNotice);
    hideNotice(turnNotice);
    renderPlayback(state);
    animateLifeLoss(screen, winner, duration * 1.5);
    showNotice(roundNotice, `${result} · ${scores.human} : ${scores.bot}`, ROUND_RESULT_MS);
    await new Promise((resolve) => setTimeout(resolve, ROUND_RESULT_MS));
  }

  async function showRoundTransition(round, duration) {
    const overlay = element('div', 'motion-overlay round-transition');
    overlay.setAttribute('role', 'status');
    overlay.append(element('span', 'round-transition-title', `Раунд ${round}`));
    app.append(overlay);
    if (duration) {
      await overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' }).finished;
    }
    await new Promise((resolve) => setTimeout(resolve, duration ? 360 : 600));
    return overlay;
  }

  function playBotTurn() {
    let trace;
    const options = settings.showBotThoughts() ? { onDecision: (decision) => { trace = decision; } } : {};
    const action = chooseBotTurn(match, difficulty(), options);
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
          roundTransition = await showRoundTransition(next.round, duration);
        }
      } catch (error) {
        console.warn('Playback stopped early', error);
      } finally {
        if (session === matchSession) replaying = false;
      }
    } else {
      events.forEach(settings.playSound);
    }

    if (session !== matchSession) {
      roundTransition?.remove();
      return;
    }
    match = next;
    onMatchChanged(before, match, speech);
    render();
    if (roundTransition) {
      if (duration) {
        const fade = roundTransition.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration, easing: 'ease-in', fill: 'forwards',
        });
        void fade.finished.then(() => roundTransition.remove(), () => roundTransition.remove());
      } else {
        roundTransition.remove();
      }
    }
    const changedTurn = match.phase === 'playing' && match.turn !== before.turn;
    const turnStarted = match.phase === 'playing' && (before.phase !== 'playing' || changedTurn ||
      match.players[match.turn].turns !== before.players[match.turn].turns);
    const humanTurnStarted = humanCanAct() && !match.playedCard &&
      (changedTurn || match.players.human.turns !== before.players.human.turns);
    if (turnStarted && battlefieldStyle() === 'standard') animateTurnSparks(screen, match.turn, duration);
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

  function cancelTargeting() {
    if (!targetAction || !match?.pending || replaying) return false;
    const { before, rolls, cardId, type } = targetAction;
    retryRolls = [...rolls, ...retryRolls];
    targetAction = undefined;
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
    setMatch: (next) => { match = next; },
    reset, humanCanAct, playHuman, updateMatch, cancelTargeting,
  };
}
