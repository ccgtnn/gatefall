import { DIAMOND, LEAGUE_BOTS, LEAGUES, LEAGUE_RULES, leagueDivision, leagueOpponent, leagueStake, leagueTable, leagueTicket } from '../game/league.js';
import { leagueAvatar, LORE_FACTIONS, setLeagueSpeech } from './league-character.js';
import { leagueProfile, leagueRecord, leagueRoundRecord, LEAGUE_DIFFICULTY_LABELS } from './league-profile.js';
import { button, element, selectField } from './dom.js';
import { sectionBack } from './resources.js';

const leagueTabs = [
  ['Бронза', '🥉'], ['Серебро', '🥈'], ['Золото', '🥇'], ['Алмаз', '💎'],
];

export const LEAGUE_OVERVIEW_QUERY = '(min-width: 72rem) and (pointer: fine)';

const actionErrors = {
  stale: 'Лига обновилась. Проверь текущий тур.',
  unaffordable: 'Не хватает золота на ставку.',
  'invalid-deck': 'Эта колода больше недоступна.',
};

export function leagueScreen(phase, actions) {
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
  let busy = false;
  let resetting = false;
  let retryAt = 0;
  let currentPlay;
  const back = sectionBack(actions.back);
  header.append(back, title);
  panel.append(header, nav, content, countdown, message);

  function updateClock() {
    if (!league) {
      if (!resetting && panel.isConnected && Date.now() >= retryAt) void sync();
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
    if (now >= Math.max(league.resetAt, retryAt) && !resetting && !busy) void sync();
  }
  async function sync() {
    resetting = true;
    const outcome = await actions.checkpoint();
    if (outcome === 'unavailable') {
      retryAt = Date.now() + 15000;
      message.textContent = 'Не удалось обновить лигу.';
    } else if (retryAt) {
      retryAt = 0;
      message.textContent = '';
    }
    if (panel.isConnected) update();
    resetting = false;
  }

  async function submit(action) {
    if (busy) return;
    busy = true;
    back.disabled = true;
    message.textContent = '';
    update();
    const result = await action();
    busy = false;
    back.disabled = false;
    if (!panel.isConnected) return;
    if (result === 'stale') await sync();
    message.textContent = result === 'done' ? '' : actionErrors[result] ?? 'Не удалось сохранить изменение. Попробуй снова.';
    update();
  }

  function update() {
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
    currentPlay = undefined;
    const opponent = bot && nextOpponent(bot);
    function nextOpponent(bot) {
      const opponent = element('section', 'league-opponent');
      const label = active ? 'Незавершённый матч' : 'Следующий соперник';
      const challenger = button(undefined, () => openProfile(bot, season.scores[bot.id]), 'league-challenger');
      challenger.setAttribute('aria-haspopup', 'dialog');
      challenger.append(leagueAvatar(bot), leagueIdentity(bot));
      const greeting = element('blockquote', 'league-speech');
      setLeagueSpeech(greeting, { line: bot.lines.start[0], telepathic: bot.telepathic });
      const details = element('div', 'league-opponent-details');
      const identity = element('div', 'league-opponent-summary');
      identity.append(challenger,
        element('p', 'muted league-opponent-info', `${bot.deck.name} · ${LEAGUE_DIFFICULTY_LABELS[bot.difficulty]}`));
      details.append(identity, greeting);
      const controls = element('div', 'league-opponent-controls');
      opponent.append(element('h3', null, label), details, controls);
      if (active) {
        const concede = button('Засчитать поражение', () => submit(() => actions.concede(active.id)));
        concede.disabled = busy;
        controls.append(concede);
      } else {
        const decks = actions.decks();
        const picker = selectField('Твоя колода', decks.length
          ? decks.map(({ id, name }) => [id, name]) : [['', 'Нет играбельных колод']]);
        if (decks.some(({ id }) => id === selectedDeck)) picker.input.value = selectedDeck;
        picker.input.addEventListener('change', () => { selectedDeck = picker.input.value; });
        const stake = leagueStake(league);
        const short = actions.gold() < stake;
        currentPlay = {
          label: stake ? `Играть против него · ${stake} золота` : 'Играть против него',
          disabled: busy || short || !decks.length,
          start: () => submit(() => actions.play(ticket, bot, decks.find(({ id }) => id === picker.input.value))),
        };
        const start = button(stake ? `Играть матч · ${stake} золота` : 'Играть матч', currentPlay.start, 'button primary');
        start.disabled = currentPlay.disabled;
        picker.input.disabled = busy || !decks.length;
        controls.append(picker.field, start);
        if (short) controls.append(element('p', 'muted', 'Не хватает золота на ставку.'));
      }
      return opponent;
    }

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
    updateClock();
  }

  panel.addEventListener('league-tick', updateClock);
  panel.addEventListener('league-layout-change', update);
  panel.addEventListener('collection-change', () => { if (!busy) update(); });
  update();
  if (league) {
    updateClock();
    if (league.resetAt > Date.now()) void sync();
  } else {
    queueMicrotask(sync);
  }
  return panel;
}

function roundText(round) {
  return `Тур ${round + 1} из ${LEAGUE_RULES.rounds}`;
}

function divisionColumn(season, home, openProfile) {
  const [name, medal] = leagueTabs[season.tier];
  const column = element('section', 'league-division');
  column.toggleAttribute('data-home', home);
  const header = element('header', 'league-division-header');
  const icon = element('span', null, medal);
  icon.setAttribute('aria-hidden', 'true');
  const heading = element('h3', null);
  heading.id = `league-division-${season.tier}`;
  heading.append(icon, name);
  column.setAttribute('aria-labelledby', heading.id);
  const details = element('div', 'league-division-meta');
  details.append(element('span', null, roundText(season.round)));
  if (home) details.append(element('small', 'league-tab-here', 'Ты здесь'));
  header.append(heading, details);
  column.append(header, standings(season, openProfile));
  return column;
}

function leagueIdentity(bot) {
  const identity = element('span', 'league-identity');
  identity.append(element('strong', 'league-name', bot?.name ?? 'Ты'),
    element('small', 'muted league-faction', bot ? LORE_FACTIONS[bot.loreFaction] : 'Игрок'));
  return identity;
}

function standings(season, openProfile) {
  const table = leagueTable(season);
  const container = element('div', 'league-standings');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Участники лиги');
  const roundsHeading = element('div', 'league-rounds-heading muted');
  roundsHeading.setAttribute('aria-hidden', 'true');
  roundsHeading.append(element('span', null, 'Раунды'), element('span', null, 'Раунды'));
  const laterPlaces = Math.ceil(table.length / 2);
  const firstColumn = element('ol', 'league-standings-column');
  const secondColumn = element('ol', 'league-standings-column');
  secondColumn.start = laterPlaces + 1;
  container.append(roundsHeading, firstColumn, secondColumn);
  const firstRelegation = table.length + 1 - LEAGUE_RULES.relegationPlaces;
  for (const [index, score] of table.entries()) {
    const { id, points } = score;
    const bot = LEAGUE_BOTS.get(id);
    const item = element('li', 'league-entry');
    const place = index + 1;
    const promotion = season.tier !== DIAMOND && place <= LEAGUE_RULES.promotionPlaces;
    if (promotion) item.dataset.promotion = place;
    if (promotion && place === 1) item.append(element('span', 'league-promotion-label', 'Зона повышения ↑'));
    if (season.tier > 0 && place >= firstRelegation) {
      item.dataset.relegation = '';
      if (place === firstRelegation) item.append(element('span', 'league-relegation-label', 'Зона вылета ↓'));
    }
    const row = bot
      ? button(undefined, () => openProfile(bot, score), 'league-standing')
      : element('div', 'league-standing league-human');
    if (bot) row.setAttribute('aria-haspopup', 'dialog');
    else row.setAttribute('aria-current', 'true');
    const record = leagueRecord(score);
    const rounds = leagueRoundRecord(score);
    row.title = `${bot?.name ?? 'Ты'} · ${bot ? LORE_FACTIONS[bot.loreFaction] : 'Игрок'}\n${record}\nРаунды (выиграно–проиграно): ${rounds}`;
    const rank = element('span', 'league-place', place);
    const old = season.previousPlaces?.[id];
    if (old && old !== place) {
      const movement = old > place ? '▲' : '▼';
      const change = element('small', old > place ? 'league-up' : 'league-down', movement);
      change.setAttribute('aria-label', old > place ? 'Место повысилось' : 'Место понизилось');
      change.title = `Изменение места: ${old} → ${place}`;
      rank.append(change);
    }
    const avatar = bot ? leagueAvatar(bot) : element('span', 'league-avatar', '♟');
    if (!bot) avatar.setAttribute('aria-hidden', 'true');
    const numbers = element('span', 'league-numbers');
    numbers.append(element('strong', null, points), element('small', 'muted league-points-label', 'очк.'),
      element('small', 'league-record', record));
    const identity = leagueIdentity(bot);
    const arrival = season.arrivals?.[id];
    if (bot && arrival) {
      const label = arrival > 0 ? 'Повысился в прошлом сезоне' : 'Вылетел в прошлом сезоне';
      const marker = element('span', arrival > 0 ? 'league-arrival league-up' : 'league-arrival league-down', arrival > 0 ? '↑' : '↓');
      marker.title = label;
      marker.setAttribute('aria-label', label);
      identity.firstChild.append(' ', marker);
    }
    const roundScore = element('span', 'league-round-score', rounds);
    roundScore.setAttribute('aria-label', `Раунды (выиграно–проиграно): ${rounds}`);
    row.append(rank, avatar, identity, numbers, roundScore);
    item.append(row);
    (index < laterPlaces ? firstColumn : secondColumn).append(item);
  }
  return container;
}

function rewardText(reward) {
  const place = reward.place === null ? '' : ` · место ${reward.place}`;
  const items = [`${reward.gold} золота`];
  if (reward.boosters) items.push(`нейтральные бустеры ×${reward.boosters}`);
  if (reward.gateShards) items.push(`Осколки врат ×${reward.gateShards}`);
  return `Награда недели · ${LEAGUES[reward.tier].name} лига${place} · ${items.join(' · ')}`;
}
