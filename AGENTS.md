# Gatefall — Угасшие врата

Браузерная карточная игра на HTML, CSS и JS-модулях. GitHub Pages раздаёт `docs/` из `main`. Сборки и зависимостей npm нет.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm start` | Локальная игра на порту 8000, нужен Python 3 |
| `npm test` | Полный набор тестов, нужен Node.js 22+ |
| `npm run test:battle` | Матч, раунды, эффекты и воспроизведение боя |
| `npm run test:economy` | Награды, ресурсы, база, таверна, Лига и ранги |
| `npm run test:bot` | Бот, его стратегия и сбор статистики для арены |

## Где искать

| Область | Файлы |
| --- | --- |
| Карты, колоды и лидеры | `docs/game/cards.js`, `docs/game/decks.js` |
| Матч, поле и способности | `docs/game/match.js`, `board.js`, `effects.js`, `events.js` в той же папке |
| Бот и симуляции | `docs/game/bot.js`, `bot-strategy.js`, `bot-rollouts.js` |
| Экономика и прогресс | `docs/game/rewards.js`, `base.js`, `tavern.js`, `ranks.js`, `league.js` |
| Экраны и управление матчем | `docs/app.js`, `docs/ui/` |
| Размещение карт и анимации | `docs/card-placement.js`, `turn-playback.js`, `card-motion.js` |
| Разметка и стили | `docs/index.html`, `style.css`, `field.css` |
| Тесты, иллюстрации и правила | `tests/`, `docs/art/`, [ART_STYLE.md](ART_STYLE.md), [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |

Изменения геймдизайна согласуйте с владельцем. Перед коммитом запустите полный `npm test`. Для изменённых браузерных модулей и ресурсов обновите версии URL у потребителей по цепочке. После публикации проверьте [игру](https://ccgtnn.github.io/gatefall/).
