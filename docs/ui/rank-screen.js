import { MONTHLY_RANKS, rankStanding } from '../game/ranks.js?v=monthly-ranks-1';
import { element } from './dom.js?v=opponent-reveal-1';
import { sectionBack } from './resources.js?v=interface-polish-1';

const resetDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const columns = [
  ['rank', 'Ранг'], ['rounds', 'Победы в раундах'], ['keys', 'Ключи'],
  ['steel', 'Сталь'], ['energyCells', 'Энергоячейки'], ['gateShards', 'Осколки врат'],
];

export function rankScreen(phase, progress, back) {
  phase.textContent = '';
  const panel = element('section', 'panel rank-panel');
  const heading = element('h2', null, 'Месячные ранги');
  heading.tabIndex = -1;
  const summary = element('p', 'rank-summary');
  const until = element('p', 'muted');
  const bar = element('progress');
  bar.setAttribute('aria-label', 'Прогресс до следующего ранга');
  const table = element('table', 'rank-table');
  table.setAttribute('aria-label', 'Пороги рангов и награды');
  const header = table.createTHead().insertRow();
  for (const [, title] of columns) {
    const cell = element('th', null, title);
    cell.scope = 'col';
    header.append(cell);
  }
  const body = table.createTBody();
  const rows = MONTHLY_RANKS.map((entry) => {
    const row = body.insertRow();
    const label = element('th', null, entry.rank);
    label.scope = 'row';
    row.append(label);
    for (const [key] of columns.slice(1)) row.insertCell().textContent = key === 'rounds' ? entry[key] : entry[key] || '—';
    return row;
  });
  const scroll = element('div', 'rank-table-scroll');
  scroll.tabIndex = 0;
  scroll.append(table);
  panel.append(sectionBack(back), heading, summary, bar, until,
    element('p', 'muted', 'Засчитываются выигранные раунды в доигранных матчах, включая Лигу. Награды начисляются сразу.'), scroll);

  function update() {
    const { rounds, resetAt } = progress.ranks();
    const current = rankStanding(rounds);
    const next = MONTHLY_RANKS[current.rank + 1];
    summary.textContent = next
      ? `Ранг ${current.rank} · выиграно раундов ${rounds} из ${next.rounds}`
      : `Ранг ${current.rank} · максимум · выиграно раундов ${rounds}`;
    until.textContent = `Сброс ${resetDate.format(resetAt)} по местному времени`;
    bar.hidden = !next;
    if (next) {
      bar.max = next.rounds - current.rounds;
      bar.value = rounds - current.rounds;
    }
    for (const [index, row] of rows.entries()) {
      if (index === current.rank) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
      row.classList.toggle('rank-reached', index < current.rank);
    }
  }

  panel.addEventListener('collection-change', update);
  update();
  return panel;
}
