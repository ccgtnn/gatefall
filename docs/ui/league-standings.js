import { DIAMOND, LEAGUE_BOTS, LEAGUES, LEAGUE_RULES, leagueTable } from '../game/meta/league.js';
import { leagueAvatar, LORE_FACTIONS } from './league-character.js';
import { leagueRecord, leagueRoundRecord } from './league-profile.js';
import { button, element } from './dom.js';

export const leagueTabs = [
  ['Бронза', '🥉'], ['Серебро', '🥈'], ['Золото', '🥇'], ['Алмаз', '💎'],
];

export function roundText(round) {
  return `Тур ${round + 1} из ${LEAGUE_RULES.rounds}`;
}

export function divisionColumn(season, home, openProfile) {
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

export function leagueIdentity(bot) {
  const identity = element('span', 'league-identity');
  identity.append(element('strong', 'league-name', bot?.name ?? 'Ты'),
    element('small', 'muted league-faction', bot ? LORE_FACTIONS[bot.loreFaction] : 'Игрок'));
  return identity;
}

export function standings(season, openProfile) {
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

export function rewardText(reward) {
  const place = reward.place === null ? '' : ` · место ${reward.place}`;
  const items = [`${reward.gold} золота`];
  if (reward.boosters) items.push(`нейтральные бустеры ×${reward.boosters}`);
  if (reward.gateShards) items.push(`Осколки врат ×${reward.gateShards}`);
  return `Награда недели · ${LEAGUES[reward.tier].name} лига${place} · ${items.join(' · ')}`;
}
