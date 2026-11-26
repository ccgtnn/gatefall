import { on } from './app-events.js';
import { LEAGUE_RULES, leagueOpponent, leagueTable } from '../game/league.js';
import { createLeagueDialogue } from '../game/league-dialogue.js';
import { MONTHLY_RANKS, rankStanding } from '../game/ranks.js';
import { tavernRewardCount } from '../game/tavern.js';
import { button, element } from './dom.js';
import { leagueAvatar } from './league-character.js';
import { resourceGlyph, resourceLabel } from './resources.js';

function amountsText(amounts) {
  return amounts.map(([key, count]) => `${resourceLabel(key)} ${count}`).join(', ');
}

function amountsLine(prefix, amounts) {
  const line = element('span', 'home-tile-detail');
  line.append(prefix);
  for (const [key, count] of amounts) {
    const amount = element('span', 'home-tile-amount', count);
    amount.title = resourceLabel(key);
    const icon = resourceGlyph(key);
    amount.append(icon ?? ` ${resourceLabel(key)}`);
    line.append(' ', amount);
  }
  return line;
}

function produced(stock) {
  const total = new Map();
  for (const building of Object.values(stock ?? {})) {
    for (const [key, { stored }] of Object.entries(building?.outputs ?? {})) {
      if (stored > 0) total.set(key, (total.get(key) ?? 0) + stored);
    }
  }
  return [...total];
}

function leagueDetails(league) {
  const season = league?.season;
  if (!season?.scores?.human || league.resetAt <= Date.now() || season.round >= LEAGUE_RULES.rounds) return;
  const rival = leagueOpponent(season);
  if (!rival) return;
  const table = leagueTable(season);
  const place = table.findIndex(({ id }) => id === 'human') + 1;
  const line = createLeagueDialogue(rival, () => 0).start(league)?.line;
  return { rival, place: `Ты ${place}-й из ${table.length}`, line };
}

export function homeTiles(progress, actions, signal) {
  const tiles = element('div', 'home-tiles home-tiles-sections');
  const base = button('', actions.base, 'button home-tile home-tile-base');
  const league = button('', actions.league, 'button home-tile home-tile-league');
  const ranks = button('', actions.ranks, 'button home-tile home-tile-ranks');
  const badge = element('span', 'tavern-badge');
  badge.setAttribute('aria-hidden', 'true');

  const copy = (title, ...details) => {
    const node = element('span', 'home-tile-copy');
    node.append(element('strong', 'home-tile-title', title), ...details);
    return node;
  };
  let baseSignature;
  function updateBase() {
    const amounts = produced(progress.production?.());
    const ready = tavernRewardCount(progress.tavern?.());
    const signature = JSON.stringify([amounts, ready]);
    if (signature === baseSignature) return;
    baseSignature = signature;
    const detail = amounts.length ? [amountsLine('К сбору', amounts)] : [];
    if (ready) {
      detail.push(element('span', 'home-tile-detail', `Награды Таверны · ${ready}`));
      badge.textContent = ready;
    }
    base.replaceChildren(copy('База', ...detail), ...(ready ? [badge] : []));
    base.setAttribute('aria-label', ['База', amounts.length && 'к сбору: ' + amountsText(amounts),
      ready && 'награды Таверны: ' + ready].filter(Boolean).join(' · '));
  }

  let leagueSignature;
  function updateLeague() {
    const details = leagueDetails(progress.league?.());
    const signature = details && JSON.stringify([details.rival.id, details.place, details.line]);
    if (signature === leagueSignature && league.children.length) return;
    leagueSignature = signature;
    if (!details) {
      league.title = '';
      league.replaceChildren(copy('Лига'));
      return;
    }
    const { rival, place, line } = details;
    const quote = line && `«${line.replace(/\s+/g, ' ')}»`;
    const speech = quote ? [element('span', 'home-tile-quote', quote)] : [];
    league.replaceChildren(leagueAvatar(rival),
      copy(`Лига · ${rival.name}`, element('span', 'home-tile-detail', place), ...speech));
    league.title = ['Лига', rival.name, place, quote].filter(Boolean).join(' · ');
  }

  function updateRanks() {
    const current = rankStanding(progress.ranks?.()?.rounds);
    const title = current ? `Ранги · ${current.rank}` : 'Ранги';
    const next = current && MONTHLY_RANKS[current.rank + 1];
    const amounts = Object.entries(next ?? {}).filter(([key, count]) =>
      key !== 'rank' && key !== 'rounds' && count > 0);
    ranks.replaceChildren(copy(title, ...(next ? [amountsLine(`→ Ранг ${next.rank}`, amounts)] : [])));
    ranks.setAttribute('aria-label', next ? `${title} · ранг ${next.rank}: ${amountsText(amounts)}` : title);
  }

  function update() {
    updateBase();
    updateLeague();
    updateRanks();
  }
  on('collection-change', update, { signal });
  on('league-tick', () => {
    updateBase();
    if (leagueSignature && progress.league?.()?.resetAt <= Date.now()) updateLeague();
  }, { signal });
  update();
  tiles.append(base, league, ranks);
  return tiles;
}
