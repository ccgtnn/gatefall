# Gatefall — Угасшие врата

Браузерная карточная игра на HTML, CSS и JS-модулях. Локальный сервер раздаёт `docs/`. GitHub Actions готовит копию для Pages из `main`. Зависимостей npm нет.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm start` | Локальная игра на порту 8000, нужен Python 3 |
| `npm run build:pages -- <новая-папка>` | Копия сайта с версиями JS-модулей для Pages |
| `npm test` | Полный набор тестов, нужен Node.js 22+ |
| `npm run test:battle` | Матч, раунды, эффекты и воспроизведение боя |
| `npm run test:economy` | Награды, ресурсы, база, таверна, Лига и ранги |
| `npm run test:bot` | Бот, его стратегия и сбор статистики для арены |

## Где искать

| Область | Файлы |
| --- | --- |
| Карты, колоды и лидеры | `docs/game/cards.js`, `docs/game/decks.js` |
| Нейтральные карты | `docs/game/neutral-cards.js`, `tests/neutral-cards.test.js` |
| Реестр и общие свойства карт | `docs/game/card-registry.js`, `card-metadata.js`, `tests/catalog.test.js` |
| Матч, поле и способности | `docs/game/match.js`, `board.js`, `effects.js`, `events.js` в той же папке |
| Бот и симуляции | `docs/game/bot.js`, `bot-strategy.js`, `bot-rollouts.js` |
| Оценка эффектов ботом | `docs/game/bot-effect-value.js`, `npm run test:bot` |
| Выбор целей и фильтры колоды | `docs/game/effect-queries.js`, `npm run test:battle` |
| Экономика и прогресс | `docs/game/rewards.js`, `base.js`, `tavern.js`, `ranks.js`, `league.js` |
| Коллекция, крафт и бустеры | `docs/game/collection-economy.js`, `tests/rewards.test.js` |
| Экран «Все карты» | `docs/ui/catalog-screen.js`, `tests/catalog.test.js` |
| Ход, бот, выбор целей и анимации матча | `docs/ui/match-turn.js`, `tests/match-turn.test.js` |
| Экраны и итоги | `docs/app.js`, `docs/ui/`, `docs/ui/match-result.js` |
| Размещение карт и анимации | `docs/card-placement.js`, `turn-playback.js`, `card-motion.js` |
| Разметка и стили | `docs/index.html`, `style.css`, `field.css` |
| Тесты, иллюстрации и правила | `tests/`, `docs/art/`, [ART_STYLE.md](ART_STYLE.md), [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |

Изменения геймдизайна согласуйте с владельцем. Перед коммитом запустите полный `npm test`. Версии JS-модулей добавляет сборка. Для CSS и медиафайлов обновите версии URL у потребителей. После публикации проверьте [игру](https://ccgtnn.github.io/gatefall/).
