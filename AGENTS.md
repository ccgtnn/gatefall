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
| `npm run --silent ctx -- --help` | Список пакетов контекста для передачи кода |

## Где искать

| Область | Файлы |
| --- | --- |
| Сборка фракций и стартовые колоды | `docs/game/cards.js`, `docs/game/decks.js` |
| Карты и лидеры фракций | `docs/game/protectorate.js`, `growth.js`, `captains.js`, `choir.js` |
| Словарь способностей | `docs/game/card-keywords.js` |
| Нейтральные карты | `docs/game/neutral-cards.js`, `tests/neutral-cards.test.js` |
| Реестр и общие свойства карт | `docs/game/card-registry.js`, `card-metadata.js`, `tests/catalog.test.js` |
| Матч, поле и способности | `docs/game/match.js`, `board.js`, `effects.js`, `events.js` в той же папке |
| Пассивные бонусы силы | `docs/game/board.js` и определения с `sidePower` или `rowPower`, `tests/captains.test.js` |
| Бот и симуляции | `docs/game/bot.js`, `bot-strategy.js`, `bot-rollouts.js` |
| Подсказки стратегии | `aiHints` в определениях карт, [CONTRACTS.md](CONTRACTS.md) |
| Оценка эффектов ботом | `stepValues` в `docs/game/bot-effect-value.js`, `npm run test:bot` |
| Действия с колодой, рукой, сбросом и Сотворение | `docs/game/effect-piles.js`, `tests/effects.test.js` |
| Выбор целей и фильтры колоды | `docs/game/effect-queries.js`, `npm run test:battle` |
| Экономика и прогресс | `docs/game/rewards.js`, `base.js`, `tavern.js`, `ranks.js`, `league.js` |
| Коллекция, крафт и бустеры | `docs/game/collection-economy.js`, `tests/rewards.test.js` |
| Главы и маршруты Книги наград | `docs/game/reward-book.js`, `tests/rewards.test.js` |
| Экран «Все карты» | `docs/ui/catalog-screen.js`, `tests/catalog.test.js` |
| Отложенная загрузка экранов | `docs/ui/resources.js`, `tests/lazy-sections.test.js` |
| Ход, бот, выбор целей и анимации матча | `docs/ui/match-turn.js`, `tests/match-turn.test.js` |
| Старт, выход и результаты матча | `docs/ui/match-session.js`, `docs/ui/match-result.js` |
| Фоновое обновление Таверны, рангов и Лиги | `docs/ui/app-timers.js`, `tests/app-timers.test.js` |
| Экраны и навигация | `docs/app.js`, `docs/ui/` |
| Размещение карт и анимации | `docs/card-placement.js`, `turn-playback.js`, `card-motion.js` |
| Разметка и порядок стилей | `docs/index.html`, общие правила в `docs/style.css` |
| Стили карт и колод | `docs/cards.css`, `card-frames.css`, `deck-screens.css`, `card-preview.css` |
| Стили матча | `docs/field.css`, `field-controls.css`, `match-dialogs.css`, `field-effects.css`, `card-motion.css` |
| Тесты, иллюстрации и правила | `tests/`, `docs/art/`, [ART_STYLE.md](ART_STYLE.md), [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |
| Контракты матча, эффектов и сохранений | [CONTRACTS.md](CONTRACTS.md) |

Пакет для движка сохраняется командой `npm run --silent ctx -- engine > gatefall-engine.md`. К пакету можно добавить нужные файлы, например `npm run --silent ctx -- ui:catalog docs/card-preview.css > gatefall-catalog.md`.

## Порядок работы

- Для мелких правок во время работы запускайте только тематические тесты. Перед каждым коммитом запускайте полный `npm test`.
- Браузер не открывать. Визуальные изменения пользователь проверяет сам после деплоя. Браузер — только если пользователь прямо попросил в задаче.
- Одна задача — одна ветка. Вливайте её в `main` в день работы.
- Изменения геймдизайна согласуйте с владельцем.
- Сборка GitHub Pages проставляет версии JS, CSS и медиа по хешу содержимого. Версии вручную не меняйте. Для динамических URL медиа используйте `assetUrl`.
- После публикации сверяйте сборку на [GitHub Pages](https://ccgtnn.github.io/gatefall/).
