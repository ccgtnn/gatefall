# Bot

Выбор хода и целей, стратегическая оценка и симуляции бота.
- `bot.js` — `chooseBotTurn`, `chooseEasyTurn`, `pickBotTarget`.
- `bot-levels.js` — уровни сложности 1–7 и их параметры.
- `bot-evaluation.js` — оценка позиции и потенциала карт.
- `bot-weights.js` — общие `EVAL_WEIGHTS` без обратной зависимости.
- `bot-rollouts.js`, `bot-strategy.js` — выбор стратегии и симуляции.
Разрешены зависимости от `shared/`, `cards/`, `engine/`, `effects/`.
Поведение уровней и веса меняются только вместе с тестами стратегии.
