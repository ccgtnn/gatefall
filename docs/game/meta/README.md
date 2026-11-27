# Meta

Сохранения, экономика, база, награды, таверна, ранги и Лига.
- `rewards.js` — `createRewardProgress` и операции прогресса.
- `collection-economy.js`, `reward-book.js` — коллекция, бустеры и Книга наград.
- `base.js`, `base-production.js`, `outpost.js` — база и снабжение.
- `league.js`, `league-decks.js`, `league-dialogue.js` — правила и тексты Лиги.
- `reset-progress.js` — очистка сохранений через ключи из `shared/`.
Разрешены зависимости только от `shared/`, `cards/` и внутри `meta/`.
Запрещено импортировать `engine/`, `effects/` и `bot/`.
