import { on } from './app-events.js';
import { LEAGUES, LEAGUE_RULES, leagueDivision, leagueOpponent, leagueTicket } from '../game/meta/league.js';
import { nextOpponent } from './league-opponent.js';
import { leagueProfile } from './league-profile.js';
import { divisionColumn, leagueTabs, rewardText, roundText, standings } from './league-standings.js';
import { button, createBusyGuard, element } from './dom.js';
import { sectionBack } from './resources.js';

export const LEAGUE_OVERVIEW_QUERY = '(min-width: 72rem) and (pointer: fine)';

const actionErrors = {
  stale: 'Лига обновилась. Проверь текущий тур.',
  unaffordable: 'Не хватает золота на ставку.',
  'invalid-deck': 'Эта колода больше недоступна.',
};

export function leagueScreen(phase, actions, signal) {
  phase.textContent = '';
  const panel = element('section', 'league-panel');
  const content = element('div', 'league-content');
  const nav = element('div', 'league-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Лиги');
  nav.hidden = true;
  let viewedTier;
  const tabs = leagueTabs.map(([label, symbol], tier) => {
    const tab = button(undefined, () => selectTier(tier), 'button secondary league-tab');
    tab.id = `league-tab-${tier}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'league-tab-panel');
    const icon = element('span', 'league-tab-icon', symbol);
    icon.setAttribute('aria-hidden', 'true');
    const here = element('small', 'league-tab-here', 'Ты здесь');
    tab.append(icon, element('span', null, label), here);
    nav.append(tab);
    return { tab, here };
  });
  nav.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : step && (viewedTier + step + tabs.length) % tabs.length;
    if (target === undefined) return;
    event.preventDefault();
    selectTier(target);
  });

  function selectTier(tier) {
    viewedTier = tier;
    update();
    tabs[tier].tab.focus();
  }

  const message = element('p', 'economy-status');
  message.setAttribute('role', 'status');
  const heading = element('h2', null, 'Лига');
  heading.tabIndex = -1;
  const meta = element('p', 'muted');
  const header = element('header', 'league-header');
  const title = element('div');
  title.append(heading, meta);
  const countdown = element('div', 'league-countdown');
  countdown.hidden = true;
  const clockIcon = element('span', 'league-clock-icon', '⌛︎');
  clockIcon.setAttribute('aria-hidden', 'true');
  const clockLabel = element('strong');
  const clockProgress = element('progress');
  clockProgress.max = 1;
  clockProgress.setAttribute('aria-label', 'Прошедшая часть недели');
  countdown.append(clockIcon, clockLabel, clockProgress);
  let selectedDeck;
  let league;
  const busy = createBusyGuard();
  const resetting = createBusyGuard();
  let retryAt = 0;
  let currentPlay;
  const back = sectionBack(actions.back);
  header.append(back, title);
  panel.append(header, nav, content, countdown, message);

  function updateClock(checkpoint = true) {
    if (!league) {
      if (checkpoint && !resetting.active && panel.isConnected && Date.now() >= retryAt) void sync();
      return;
    }
    const now = Date.now();
    const remaining = Math.max(0, league.resetAt - now);
    const minutes = Math.ceil(remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const time = [Math.floor(minutes / 60) % 24, minutes % 60].map((part) => String(part).padStart(2, '0')).join(':');
    const start = new Date(league.resetAt);
    start.setDate(start.getDate() - 7);
    clockLabel.textContent = 'Новая неделя через ' + (days ? `${days} д ` : '') + time;
    clockProgress.value = Math.max(0, 1 - remaining / (league.resetAt - start.getTime()));
    countdown.classList.toggle('is-urgent', remaining < 86400000);
    countdown.hidden = false;
    if (checkpoint && now >= Math.max(league.resetAt, retryAt) && !resetting.active && !busy.active) void sync();
  }
  async function sync() {
    if (resetting.active) return;
    const outcome = await resetting.run(actions.checkpoint);
    if (outcome === 'unavailable') {
      retryAt = Date.now() + 15000;
      message.textContent = 'Не удалось обновить лигу.';
    } else if (retryAt) {
      retryAt = 0;
      message.textContent = '';
    }
    if (panel.isConnected) update(false);
  }

  async function submit(action) {
    if (busy.active) return;
    const result = await busy.run(() => {
      back.disabled = true;
      message.textContent = '';
      update();
      return action();
    });
    back.disabled = false;
    if (!panel.isConnected) return;
    if (result === 'stale') await sync();
    message.textContent = result === 'done' ? '' : actionErrors[result] ?? 'Не удалось сохранить изменение. Попробуй снова.';
    update();
  }

  function update(checkpoint = true) {
    const previousTier = league?.season.tier;
    league = actions.read();
    if (!league) {
      heading.textContent = 'Лига';
      meta.textContent = '';
      content.replaceChildren(element('p', 'muted', 'Загрузка участников…'));
      countdown.hidden = true;
      return;
    }
    const openDialog = panel.querySelector('.league-profile[open]');
    const ticket = leagueTicket(league);
    const { season, active, lastReward, lastSeason } = league;
    const { tier, round, number } = season;
    const overview = actions.overview();
    if (viewedTier === undefined || viewedTier === previousTier) viewedTier = tier;
    panel.toggleAttribute('data-overview', overview);
    if (overview) {
      content.removeAttribute('id');
      content.removeAttribute('role');
      content.removeAttribute('aria-labelledby');
    } else {
      content.id = 'league-tab-panel';
      content.setAttribute('role', 'tabpanel');
      content.setAttribute('aria-labelledby', tabs[viewedTier].tab.id);
    }
    nav.hidden = overview;
    for (const [index, { tab, here }] of tabs.entries()) {
      tab.setAttribute('aria-selected', String(index === viewedTier));
      tab.tabIndex = index === viewedTier ? 0 : -1;
      here.hidden = index !== tier;
    }
    const isHome = overview || viewedTier === tier;
    const { name } = LEAGUES[viewedTier];
    const bot = isHome ? leagueOpponent(season) : undefined;
    heading.textContent = overview ? 'Лига' : `${name} лига`;
    meta.textContent = overview ? `Сезон ${number}` : `Сезон ${number} · ${roundText(round)}`;
    const opponentView = bot && nextOpponent(bot, {
      active, season, league, ticket, actions, busy, submit, openProfile, selectedDeck,
      setSelectedDeck: (deck) => { selectedDeck = deck; },
    });
    const opponent = opponentView?.opponent;
    currentPlay = opponentView?.currentPlay;

    function openProfile(character, score) {
      const play = character.id === bot?.id && currentPlay && {
        ...currentPlay,
        start: () => {
          if (ticket === leagueTicket(league) && !currentPlay?.disabled) currentPlay?.start();
        },
      };
      const dialog = leagueProfile(character, score, league.encounters?.[character.id], play);
      dialog.dataset.ticket = ticket;
      panel.append(dialog);
      dialog.showModal();
    }
    const tables = element('div', 'league-divisions');
    if (overview) {
      tables.append(...LEAGUES.map((_, index) =>
        divisionColumn(leagueDivision(league, index), index === tier, openProfile)));
    } else {
      tables.append(standings(leagueDivision(league, viewedTier), openProfile));
    }
    const details = [
      element('p', 'muted league-scoring', season.roundScoring
        ? `За выигранный раунд +${LEAGUE_RULES.roundPoints}, за победу в матче ещё +${LEAGUE_RULES.winBonus}.`
        : 'В этом сезоне за победу в матче +3, за ничью +1. Очки за раунды начнут начисляться со следующего сезона.'),
      lastSeason && element('p', 'muted', `Прошлый сезон · ${LEAGUES[lastSeason.tier].name} лига · место ${lastSeason.place}`),
      lastReward && element('p', 'muted', rewardText(lastReward)),
    ].filter(Boolean);
    content.replaceChildren(...details, tables, ...(opponent ? [opponent] : []));
    if (openDialog && (openDialog.dataset.ticket !== ticket ||
        (openDialog.querySelector('.button.primary') && !currentPlay))) openDialog.close();
    updateClock(checkpoint);
  }

  on('league-tick', () => updateClock(), { signal });
  on('league-layout-change', () => update(), { signal });
  on('collection-change', () => { if (!busy.active) update(); }, { signal });
  update();
  if (league) {
    updateClock();
    if (league.resetAt > Date.now()) void sync();
  } else {
    queueMicrotask(sync);
  }
  return panel;
}
