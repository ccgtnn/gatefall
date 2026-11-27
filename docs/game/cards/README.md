# Cards

Данные карт, фракций, колод и каталожные запросы.
- `cards.js` — `FACTIONS`, `FIRST_SIGNAL` и общие реэкспорты карт.
- `card-registry.js` — `CARD_DEFINITIONS`, `CATALOG_CARDS`, поиск определений.
- `decks.js` — пресеты, проверка колод и ограничения копий.
- `related-cards.js` — `relatedEffectCards` для связанных карт эффекта.
- `factions/` — определения карт и лидеров фракций.
Разрешены зависимости только от `shared/` и внутри `cards/`.
Здесь нет состояния боя и выполнения эффектов.
