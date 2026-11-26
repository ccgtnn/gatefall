# Gatefall — Угасшие врата

Браузерная карточная игра на HTML, CSS и JS-модулях. Локальный сервер раздаёт `docs/`. GitHub Actions готовит копию для Pages из `main`. Зависимостей npm нет.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm start` | Локальная игра на порту 8000, нужен Python 3 |
| `npm run build:pages -- <новая-папка>` | Копия сайта с версиями JS, CSS и медиа для Pages |
| `npm test` | Полный набор тестов, нужен Node.js 22+ |
| `npm run test:battle` | Матч, карты, фракции, лидеры, статусы, эффекты и воспроизведение боя |
| `npm run test:economy` | Награды, ресурсы, база, таверна, Лига и ранги |
| `npm run test:bot` | Бот, его стратегия и сбор статистики для арены |
| `npm run test:ui` | Интерфейс, каталог, колоды, звук, сборка Pages |
| `npm run --silent ctx -- --help` | Список пакетов контекста для передачи кода |

## Где искать

| Область | Файлы |
| --- | --- |
| Сборка фракций и стартовые колоды | `docs/game/cards.js`, `docs/game/decks.js` |
| Карты и лидеры фракций | `docs/game/protectorate.js`, `growth.js`, `captains.js`, `choir.js` |
| Словарь способностей | `docs/game/card-keywords.js` |
| Нейтральные карты | `docs/game/neutral-cards.js`, `tests/battle/neutral-cards.test.js` |
| Реестр и общие свойства карт | `docs/game/card-registry.js`, `card-metadata.js`, `tests/ui/catalog.test.js` |
| Создание матча, раунды, пас и действия | `docs/game/match-setup.js`, `match-rounds.js`, `match-actions.js`. Публичные импорты через `match.js` |
| Ряды, размещение и перемещение карт | `docs/game/board-placement.js`. Публичные импорты поля через `board.js` |
| Сила, урон, гибель и ауры | `docs/game/board-power.js`, определения с `sidePower` или `rowPower`, `tests/battle/captains.test.js` |
| Статусы, броня и эффекты рядов | `docs/game/board-status.js` |
| Очередь способностей и реакции на события | `docs/game/effects.js`, `events.js` |
| Бот и симуляции | `docs/game/bot.js`, `bot-levels.js`, `bot-strategy.js`, `bot-evaluation.js`, `bot-rollouts.js` |
| Подсказки стратегии | `aiHints` в определениях карт, [CONTRACTS.md](CONTRACTS.md) |
| Оценка эффектов ботом | `stepValues` в `docs/game/bot-effect-value.js`, учёт будущих ходов в `docs/game/bot-future-value.js`, `npm run test:bot` |
| Реестр эффектов | `docs/game/effect-operations.js`, действия с колодой и рукой в `effect-piles.js`, проверка в `tests/battle/effect-registry.test.js` |
| Схема DSL эффектов | `docs/game/effect-schema.js`, проверка в `tests/battle/effect-schema.test.js` |
| Выбор целей и фильтры колоды | `docs/game/effect-queries.js`, `npm run test:battle` |
| Экономика и прогресс | `docs/game/rewards.js`, `base.js`, `tavern.js`, `ranks.js`, `league.js` |
| Персонажи и реплики Лиги | `docs/game/data/league-characters.js`, `docs/game/data/league-context-lines.js` |
| Коллекция, крафт и бустеры | `docs/game/collection-economy.js`, `tests/economy/rewards.test.js` |
| Главы и маршруты Книги наград | `docs/game/reward-book.js`, `tests/economy/rewards.test.js` |
| Экран Лиги | `docs/ui/league-screen.js`; соперник в `league-opponent.js`, таблицы и награды в `league-standings.js` |
| Интерфейс Книги наград | `docs/ui/reward-book.js`; карта маршрута и узлы в `reward-book-map.js` |
| Магазин и открытие бустеров | Фасад `docs/ui/booster-screens.js`; магазин в `booster-shop.js`, открытие в `booster-opening.js`, общие элементы в `booster-shared.js` |
| Экран «Все карты» | `docs/ui/catalog-screen.js`, `tests/ui/catalog.test.js` |
| Отложенная загрузка экранов | `docs/ui/resources.js`, `tests/ui/lazy-sections.test.js` |
| Ход, бот, выбор целей и анимации матча | `docs/ui/match-turn.js`, `tests/ui/match-turn.test.js` |
| Поиск хода в воркере | `docs/ui/bot-search.js`, `docs/ui/bot-worker.js`, `tests/ui/bot-search.test.js` |
| Старт, выход и результаты матча | `docs/ui/match-session.js`, `docs/ui/match-result.js` |
| Фоновое обновление Таверны, рангов и Лиги | `docs/ui/app-timers.js`, `tests/economy/app-timers.test.js` |
| Навигация и события экранов | `docs/app.js`, `docs/ui/app-history.js`, `docs/ui/app-events.js` |
| Размещение карт и анимации | `docs/ui/card-placement.js`, `turn-playback.js`, `card-motion.js`; примитивы в `card-motion-core.js`, полёты и исчезновение в `card-motion-card-effects.js`, попадания в `card-motion-hit-effects.js` |
| Отрисовка поля боя | Фасад `docs/ui/field.js`; ряды в `field-rows.js`, панели в `field-panels.js`, выбор карт и платы в `field-choices.js` |
| Просмотр и оформление карт | Фасад `docs/ui/cards.js`; предпросмотр в `card-preview.js`, бейджи в `card-badges.js`, инспекция в `card-inspection.js`, кнопка в `card-button.js` |
| Экраны и редактор колод | Фасад `docs/ui/deck-builder.js`; списки в `deck-list.js`, редактор в `deck-editor.js`, выбор фракции в `deck-faction-picker.js`, общие расчёты в `deck-shared.js` |
| Разметка и порядок стилей | `docs/index.html`, общие правила в `docs/style.css` |
| Стили карт и колод | `docs/cards.css`, `card-frames.css`, `deck-screens.css`, `card-preview.css` |
| Стили матча | `docs/field.css`, `field-controls.css`, `match-dialogs.css`, `field-effects.css`, `card-motion.css` |
| Тесты, иллюстрации и правила | `tests/`, `docs/art/`, [ART_STYLE.md](ART_STYLE.md), [PROJECT_GUIDE.md](PROJECT_GUIDE.md) |
| Контракты матча, эффектов и сохранений | [CONTRACTS.md](CONTRACTS.md), `types/contracts.d.ts` |

Пакет для движка сохраняется командой `npm run --silent ctx -- engine > gatefall-engine.md`. К пакету можно добавить нужные файлы, например `npm run --silent ctx -- ui:catalog docs/card-preview.css > gatefall-catalog.md`.

## Порядок работы

- Для мелких правок во время работы запускайте только тематические тесты. Перед каждым коммитом запускайте полный `npm test`. Новые тесты размещайте в `tests/battle/`, `tests/bot/`, `tests/economy/` или `tests/ui/`. Общие хелперы и тестовые данные храните в `tests/helpers/`. `npm test` обнаруживает тесты автоматически.
- Браузер не открывать. Визуальные изменения пользователь проверяет сам после деплоя. Браузер — только если пользователь прямо попросил в задаче.
- Одна задача — одна ветка. Вливайте её в `main` в день работы.
- Изменения геймдизайна согласуйте с владельцем.
- Сборка GitHub Pages проставляет версии JS, CSS и медиа по хешу содержимого. Версии вручную не меняйте. Для динамических URL медиа используйте `assetUrl`.
- После публикации сверяйте сборку на [GitHub Pages](https://ccgtnn.github.io/gatefall/).
