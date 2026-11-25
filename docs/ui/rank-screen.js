import { MONTHLY_RANKS, rankStanding } from '../game/ranks.js';
import { element } from './dom.js';
import { sectionBack } from './resources.js';

const resetDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const rewards = [
  ['keys', 'Ключи'], ['steel', 'Сталь'], ['energyCells', 'Энергоячейки'], ['gateShards', 'Осколки врат'],
];

export function rankScreen(phase, progress, back) {
  phase.textContent = '';
  const panel = element('section', 'rank-panel');
  const header = element('header', 'rank-header');
  const heading = element('h2', null, 'Месячные ранги');
  heading.tabIndex = -1;
  header.append(sectionBack(back), heading);

  const hero = element('div', 'rank-hero');
  const standing = element('div', 'rank-standing');
  const currentRank = element('strong', 'rank-number');
  standing.append(currentRank, element('span', null, 'Ранг'));
  const progressInfo = element('div', 'rank-progress');
  const summary = element('p', 'rank-summary');
  const until = element('p', 'rank-reset');
  const bar = element('progress');
  bar.setAttribute('aria-label', 'Прогресс до следующего ранга');
  progressInfo.append(summary, bar, until);
  hero.append(standing, progressInfo);

  const list = element('ol', 'rank-milestones');
  list.setAttribute('aria-label', 'Пороги рангов и награды');
  const tiles = MONTHLY_RANKS.map((entry) => {
    const tile = element('li', 'rank-milestone');
    if (entry.rank > 0 && entry.rank % 5 === 0) tile.classList.add('rank-milestone-major');
    const title = element('h3', null, `Ранг ${entry.rank}`);
    tile.append(title, element('p', 'rank-rounds', `Победы в раундах · ${entry.rounds}`));
    const amounts = element('dl', 'rank-rewards');
    for (const [key, label] of rewards) {
      if (!entry[key]) continue;
      const reward = element('div', 'rank-reward');
      reward.append(element('dt', null, label), element('dd', null, entry[key]));
      amounts.append(reward);
    }
    if (amounts.children.length) tile.append(amounts);
    list.append(tile);
    return tile;
  });
  panel.append(header, hero,
    element('p', 'rank-note', 'Засчитываются выигранные раунды в доигранных матчах, включая Лигу. Награды начисляются сразу.'), list);

  function update() {
    const { rounds, resetAt } = progress.ranks();
    const current = rankStanding(rounds);
    const next = MONTHLY_RANKS[current.rank + 1];
    currentRank.textContent = current.rank;
    summary.textContent = next
      ? `До ранга ${next.rank} · ${rounds} из ${next.rounds} побед в раундах`
      : `Максимальный ранг · побед в раундах ${rounds}`;
    until.textContent = `Сброс ${resetDate.format(resetAt)} по местному времени`;
    bar.hidden = !next;
    if (next) {
      bar.max = next.rounds - current.rounds;
      bar.value = rounds - current.rounds;
    }
    for (const [index, tile] of tiles.entries()) {
      if (index === current.rank) tile.setAttribute('aria-current', 'step');
      else tile.removeAttribute('aria-current');
      tile.classList.toggle('rank-reached', index < current.rank);
    }
  }

  panel.addEventListener('collection-change', update);
  update();
  return panel;
}
