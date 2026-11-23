import { DIAMOND, LEAGUES, LEAGUE_RULES, leagueOpponent, leagueStake, leagueTable, leagueTicket } from '../game/league.js?v=league-avatars-2';
import { leagueCharacter, LORE_FACTIONS } from './league-character.js?v=league-characters-1';
import { button, element, selectField } from './dom.js?v=opponent-reveal-1';
import { sectionBack } from './resources.js?v=interface-polish-1';

const difficulties = { easy: 'Лёгкий', normal: 'Обычный', hard: 'Сложный' };
const actionErrors = {
  stale: 'Лига обновилась. Проверь текущий тур.',
  unaffordable: 'Не хватает золота на ставку.',
  'invalid-deck': 'Эта колода больше недоступна.',
};

export function leagueScreen(phase, actions) {
  phase.textContent = '';
  const panel = element('section', 'panel league-panel');
  const content = element('div', 'league-content');
  const message = element('p', 'economy-status');
  message.setAttribute('role', 'status');
  const countdown = element('p', 'muted league-countdown');
  let selectedDeck;
  let league;
  let busy = false;
  let resetting = false;
  let retryAt = 0;
  const back = sectionBack(actions.back);
  panel.append(back, content, countdown, message);

  function updateClock() {
    if (!league) {
      if (!resetting && Date.now() >= retryAt) void sync();
      return;
    }
    const remaining = Math.max(0, Math.floor((league.resetAt - Date.now()) / 1000));
    const days = Math.floor(remaining / 86400);
    const time = [Math.floor(remaining / 3600) % 24, Math.floor(remaining / 60) % 60, remaining % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
    countdown.textContent = 'До сброса недели · ' + (days ? `${days} д · ` : '') + time;
    if (Date.now() >= Math.max(league.resetAt, retryAt) && !resetting && !busy) void sync();
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
    league = actions.read();
    if (!league) {
      const heading = element('h2', null, 'Лига');
      heading.tabIndex = -1;
      content.replaceChildren(heading, element('p', 'muted', 'Загрузка таблицы…'));
      return;
    }
    const { season, active, lastReward, lastSeason } = league;
    const { tier, round, number } = season;
    const { name, bots } = LEAGUES[tier];
    const bot = leagueOpponent(season);
    const heading = element('h2', null, `${name} лига`);
    heading.tabIndex = -1;
    const meta = element('p', 'muted', `Сезон ${number} · Тур ${round + 1} из ${LEAGUE_RULES.rounds}`);
    const table = standings(season, bots);
    const opponent = element('div', 'league-opponent');
    const label = active ? 'Незавершённый матч' : 'Следующий соперник';
    opponent.append(element('p', 'muted', label), leagueCharacter(bot, { line: bot.lines.start[0] }),
      element('p', null, `${bot.deck.name} · ${difficulties[bot.difficulty]}`));
    if (active) {
      opponent.append(element('p', 'muted', 'Незавершённый матч нужно закрыть, чтобы перейти к следующему туру.'));
      const concede = button('Засчитать поражение', () => submit(() => actions.concede(active.id)));
      concede.disabled = busy;
      opponent.append(concede);
    } else {
      const decks = actions.decks();
      const picker = selectField('Твоя колода', decks.length
        ? decks.map(({ id, name }) => [id, name]) : [['', 'Нет играбельных колод']]);
      if (decks.some(({ id }) => id === selectedDeck)) picker.input.value = selectedDeck;
      picker.input.addEventListener('change', () => { selectedDeck = picker.input.value; });
      const stake = leagueStake(league);
      const play = button(stake ? `Играть матч · ${stake} золота` : 'Играть матч', () =>
        submit(() => actions.play(leagueTicket(league), bot, decks.find(({ id }) => id === picker.input.value))), 'button primary');
      const short = actions.gold() < stake;
      play.disabled = busy || short || !decks.length;
      picker.input.disabled = busy || !decks.length;
      opponent.append(picker.field, play);
      if (short) opponent.append(element('p', 'muted', 'Не хватает золота на ставку.'));
    }
    const details = [
      lastSeason && element('p', 'muted', `Прошлый сезон · ${LEAGUES[lastSeason.tier].name} лига · место ${lastSeason.place}`),
      lastReward && element('p', 'muted', rewardText(lastReward)),
    ].filter(Boolean);
    content.replaceChildren(heading, meta, ...details, table, opponent);
  }

  panel.addEventListener('league-tick', updateClock);
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

function standings(season, bots) {
  const table = element('table', 'league-table');
  table.setAttribute('aria-label', 'Турнирная таблица');
  const head = table.createTHead().insertRow();
  for (const label of ['Место', 'Игрок', 'Очки', 'Победы', 'Ничьи', 'Пораж.', 'Δ раундов']) {
    const cell = element('th', null, label);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const [index, entry] of leagueTable(season).entries()) {
    const { id, points, wins, draws, losses, difference } = entry;
    const row = body.insertRow();
    const human = id === 'human';
    const bot = bots.find((candidate) => candidate.id === id);
    if (human) row.className = 'league-human';
    if (season.tier !== DIAMOND && index < LEAGUE_RULES.promotionPlaces) row.classList.add('league-promotion');
    const name = element('th', null, human ? 'Ты' : bot.name);
    name.scope = 'row';
    if (!human) name.title = LORE_FACTIONS[bot.loreFaction];
    row.insertCell().textContent = index + 1;
    row.append(name);
    for (const value of [points, wins, draws, losses, difference > 0 ? '+' + difference : difference]) {
      row.insertCell().textContent = value;
    }
  }
  const scroll = element('div', 'league-table-scroll');
  scroll.append(table);
  return scroll;
}

function rewardText(reward) {
  const place = reward.place === null ? '' : ` · место ${reward.place}`;
  const items = [`${reward.gold} золота`];
  if (reward.boosters) items.push(`нейтральные бустеры ×${reward.boosters}`);
  if (reward.gateShards) items.push(`Осколки врат ×${reward.gateShards}`);
  return `Награда недели · ${LEAGUES[reward.tier].name} лига${place} · ${items.join(' · ')}`;
}
