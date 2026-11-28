import { readFileSync } from 'node:fs';

function run([filename, number, ...extra]) {
  if (!filename || extra.length || (number !== undefined && !/^[1-9]\d*$/.test(number))) {
    throw new Error('Использование: node tools/report-to-puzzle.mjs <report.json> [номер хода бота]');
  }

  const report = JSON.parse(readFileSync(filename, 'utf8'));
  if (report.version !== 1 || !Array.isArray(report.timeline)) throw new Error('Неизвестный формат отчёта.');
  const rated = report.timeline.filter(({ botMove, rating }) => botMove && rating);
  if (number === undefined) {
    rated.sort((a, b) => a.rating.stars - b.rating.stars || a.botMove - b.botMove);
    if (!rated.length) console.log('В отчёте нет оценённых ходов.');
    for (const { botMove, rating, description } of rated) {
      console.log(`№${botMove} · ${rating.stars}★ · ${rating.comment.replace(/\s+/g, ' ') || '—'} · ${description}`);
    }
    return;
  }

  const entry = rated.find(({ botMove }) => botMove === Number(number));
  if (!entry) throw new Error(`Оценённый ход №${number} не найден.`);
  if (!entry.position?.state) throw new Error(`Для хода №${number} в отчёте нет снимка позиции.`);
  const { level, state } = entry.position;
  console.log(JSON.stringify({
    name: `${entry.description} · ${entry.rating.stars}/10`,
    description: entry.rating.comment,
    level,
    state,
    expect: {},
  }, null, 2));
}

try {
  run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
