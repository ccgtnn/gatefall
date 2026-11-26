export const BOT_LEVELS = Object.freeze({
  1: Object.freeze({ errorRate: .40, errorPool: 5, passMistakeRate: .20, horizon: 'turn', candidates: 12, samples: 0, memory: false, budgetMs: 200 }),
  2: Object.freeze({ errorRate: .30, errorPool: 5, passMistakeRate: .12, horizon: 'turn', candidates: 18, samples: 0, memory: false, budgetMs: 350 }),
  3: Object.freeze({ errorRate: .20, errorPool: 3, passMistakeRate: 0, horizon: 'reply', candidates: 24, samples: 3, memory: false, budgetMs: 750 }),
  4: Object.freeze({ errorRate: .10, errorPool: 3, passMistakeRate: 0, horizon: 'round', candidates: 32, samples: 6, memory: false, budgetMs: 1400 }),
  5: Object.freeze({ errorRate: .05, errorPool: 2, passMistakeRate: 0, horizon: 'round', candidates: 44, samples: 12, memory: true, budgetMs: 2600 }),
  6: Object.freeze({ errorRate: .02, errorPool: 2, passMistakeRate: 0, horizon: 'match', candidates: 90, samples: 40, memory: true, knowsDeckList: true, budgetMs: 5000 }),
  7: Object.freeze({ errorRate: 0, errorPool: 1, passMistakeRate: 0, horizon: 'match', candidates: 120, samples: 72, memory: true, knowsDeckList: true, budgetMs: 8000 }),
});

export const DEFAULT_BOT_LEVEL = 4;
export const BOT_LEVEL_LABELS = Object.freeze([
  '', 'Новичок', 'Ученик', 'Тактик', 'Опытный', 'Эксперт', 'Мастер', 'Гроссмейстер',
]);

export function readBotLevel(value) {
  const legacy = { easy: 2, normal: 4, hard: 6 };
  if (Object.hasOwn(legacy, value)) return legacy[value];
  const level = Number(value);
  return Number.isInteger(level) && Object.hasOwn(BOT_LEVELS, level) ? level : DEFAULT_BOT_LEVEL;
}

export function botLevelLabel(level) {
  return `${level} — ${BOT_LEVEL_LABELS[level]}`;
}
