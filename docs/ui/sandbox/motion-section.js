import {
  animateCoin, animateLifeLoss, dismissRoundTransition, presentJournalEvent, roundResultLabel, showRoundTransition,
} from '../card-motion.js';
import { clearRememberedRects } from '../card-motion-core.js';
import { button, element, selectField } from '../dom.js';
import { createBattlefield } from '../field.js';
import { mulliganScreen } from '../hand.js';
import { coinTimings, MOTION, motionDuration, scaleMotion } from '../motion-tokens.js';
import { playJournal } from '../turn-playback.js';
import { motionFixture } from './fixtures.js';
import { applyMotionAction, motionGroups, prepareMotionScenario } from './motion-scenarios.js';

const cases = motionGroups.flatMap(([, items]) => items);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMotionSection() {
  const section = element('section', 'sandbox-section sandbox-motion');
  section.dataset.section = 'motion';
  const app = element('div', 'sandbox-motion-stage');
  app.id = 'app';
  const screen = element('main');
  screen.id = 'screen';
  const coinNotice = element('p', 'field-message');
  coinNotice.id = 'coin-notice';
  const roundNotice = element('p', 'field-message');
  roundNotice.id = 'round-notice';
  const status = element('p', 'muted');
  status.setAttribute('role', 'status');
  app.append(coinNotice, roundNotice, screen);

  let factionId;
  let match;
  let lastScenario;
  let busy = false;
  let generation = 0;
  let mulliganPreview = false;
  let mulliganDeal;
  const speed = selectField('Скорость', [['normal', 'Обычная'], ['fast', 'Быстрая'], ['off', 'Выкл']], 'deck-field');
  speed.input.value = 'normal';
  const slow = element('input');
  slow.type = 'checkbox';
  const slowField = element('label', 'sandbox-slow');
  slowField.append(slow, element('span', null, 'Замедлить ×4'));
  const handle = (task) => { void task.catch(() => {}); };
  const start = (run) => {
    app.scrollIntoView?.({ block: 'nearest' });
    handle(run());
  };
  const replay = button('Повторить', () => start(() => run(lastScenario)));
  const reset = button('Сбросить', () => resetScene());
  const all = button('Прогнать всё', () => start(runAll));
  const controls = element('div', 'sandbox-controls sandbox-motion-controls');
  controls.append(speed.field, slowField, replay, reset, all);
  const scenarios = element('div', 'sandbox-motion-scenarios');
  const buttons = [];
  for (const [group, items] of motionGroups) {
    const block = element('section');
    const choices = element('div', 'sandbox-motion-choices');
    for (const scenario of items) {
      const choice = button(scenario.label, () => start(() => run(scenario)));
      choice.dataset.scenario = scenario.id;
      choices.append(choice);
      buttons.push(choice);
    }
    block.append(element('h3', null, group), choices);
    scenarios.append(block);
  }
  coinNotice.setAttribute('role', 'status');
  roundNotice.setAttribute('role', 'status');
  section.append(element('h2', null, 'Анимации'), element('p', 'muted',
    'Телефонная раскладка зависит от реального окна — полностью видна только на телефоне.'),
  controls, scenarios, status, app);

  const battlefield = createBattlefield({
    getMatch: () => match,
    isReplaying: () => busy,
    getSelectedCardId: () => undefined,
    isMulliganFieldVisible: () => !mulliganPreview,
    setMulliganField,
    playHuman: choose,
    humanCanAct: () => false,
    placeSelected: (row, side) => {
      if (match.pending?.kind === 'deck-placement') {
        choose({ type: 'place', row, position: match.players[side].board[row].length });
      }
    },
    settingsButton: () => element('span'),
    showDrawer: () => {},
    selectCard: () => {},
    mulliganScreen: () => mulliganScreen({
      getMatch: () => match,
      setMatch: (state) => { match = state; },
      updateMatch: render,
      setMulliganField,
      settingsButton: () => element('span'),
      motion: syncSpeed,
      mulliganDeal: () => mulliganDeal,
    }),
    getLeagueOpponent: () => null,
    getLeagueSpeech: () => null,
  });

  const scale = () => slow.checked ? 4 : 1;
  function syncSpeed() {
    const duration = motionDuration(speed.input.value, false, scale());
    app.dataset.animationSpeed = speed.input.value;
    app.dataset.reducedMotion = String(duration === 0);
    app.style.setProperty('--motion-base', duration + 'ms');
    return duration;
  }
  speed.input.addEventListener('change', syncSpeed);
  slow.addEventListener('change', syncSpeed);

  function render(state = match) {
    match = state;
    screen.replaceChildren(battlefield());
  }

  function setMulliganField(visible) {
    mulliganPreview = !visible;
    render();
  }

  function resetScene() {
    mulliganPreview = false;
    generation += 1;
    clearRememberedRects();
    coinNotice.hidden = roundNotice.hidden = true;
    status.textContent = '';
    render(motionFixture(factionId));
  }

  function setBusy(value) {
    busy = value;
    replay.disabled = busy || !lastScenario;
    all.disabled = speed.input.disabled = slow.disabled = busy;
    buttons.forEach((choice) => { choice.disabled = busy; });
  }

  async function present(before, next, presentation, wait, token) {
    const duration = syncSpeed();
    const multiplier = scale();
    const active = () => generation === token;
    await playJournal(before, next.log.slice(before.log.length), async (event, commit, state) => {
      if (!active()) return;
      if (event.type === 'round-end') {
        if (presentation === 'round-result') {
          render(state);
          animateLifeLoss(screen, event.winner, duration * MOTION.pace.lifeLoss);
          roundNotice.textContent = roundResultLabel(event);
          roundNotice.hidden = false;
          await wait(scaleMotion(MOTION.ms.roundResult, multiplier));
        }
        if (active()) commit();
        return;
      }
      await presentJournalEvent(screen, event, commit, (state) => { if (active()) render(state); }, duration);
    });
    if (!active()) return;
    if (presentation === 'round-title') {
      const overlay = await showRoundTransition(app, next.round, duration, multiplier, wait);
      if (active()) render(next);
      await dismissRoundTransition(overlay, active() ? duration : 0);
    } else if (presentation === 'coin') {
      const first = next.starter === 'human';
      const coin = element('span', 'tossed-coin ' + (first ? 'coin-first' : 'coin-second'), first ? '✦' : '◈');
      coin.setAttribute('aria-hidden', 'true');
      const label = element('span', 'coin-result', 'Монетка: ты ходишь ' + (first ? 'первым' : 'вторым'));
      coinNotice.replaceChildren(coin, label);
      coinNotice.hidden = false;
      const timings = coinTimings(duration, multiplier);
      if (duration) await animateCoin(coinNotice, coin, label, timings.toss, timings.notice, multiplier);
      else await wait(timings.notice);
      if (active()) coinNotice.hidden = true;
    }
    if (active()) {
      roundNotice.hidden = true;
      render(next);
    }
  }

  async function playScenario(scenario, wait, token) {
    if (generation !== token) return;
    lastScenario = scenario;
    coinNotice.hidden = roundNotice.hidden = true;
    status.textContent = scenario.label;
    const { before, next } = prepareMotionScenario(factionId, scenario);
    const swap = scenario.presentation === 'mulligan-swap';
    mulliganPreview = swap || scenario.presentation === 'mulligan-deal';
    mulliganDeal = { round: swap ? before.round : 0 };
    if (swap) {
      render(before);
      screen.querySelector('.hand-grid')?.querySelector('.hand-card')?.dispatchEvent(new Event('click'));
    } else {
      render(before);
      const presentation = scenario.id === 'deal-round-one' && syncSpeed() ? 'coin' : scenario.presentation;
      await present(before, next, presentation, wait, token);
    }
    if (mulliganPreview && generation === token) {
      await Promise.resolve();
      const motions = screen.querySelector('.mulligan')?.getAnimations?.({ subtree: true }) ?? [];
      await Promise.all(motions.map((motion) => motion.finished.catch(() => {})));
    }
  }

  async function perform(task) {
    if (busy) return;
    setBusy(true);
    try {
      return await task(++generation);
    } catch (error) {
      status.textContent = 'Ошибка сценария: ' + error.message;
      throw error;
    } finally {
      setBusy(false);
      if (!mulliganPreview) render();
    }
  }

  function run(scenario, wait = pause) {
    return perform((token) => playScenario(scenario, wait, token));
  }

  function runAll(wait = pause) {
    return perform(async (token) => {
      for (const scenario of cases) {
        if (generation !== token) break;
        await playScenario(scenario, wait, token);
        if (generation === token) await wait(scaleMotion(500, scale()));
      }
    });
  }

  function choose(action) {
    if (busy || !match.pending) return;
    const next = applyMotionAction(match, action);
    if (next === match) return;
    handle(perform((token) => present(match, next, undefined, pause, token)));
  }

  function update(id) {
    factionId = id;
    lastScenario = undefined;
    resetScene();
    setBusy(busy);
  }

  syncSpeed();
  return { section, update, run, runAll, speed: speed.input, state: () => match };
}
