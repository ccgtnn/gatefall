import { BOOSTER_FACTIONS } from './collection-economy.js';

// Preserve reward IDs, prices, and the original prerequisites for saved purchases.
const stops = [
  ['signal', null, 1],
  ['supply', 'signal', 2],
  ['junction', 'supply', 2],
  ['upper-cache', 'junction', 2],
  ['upper-relay', 'upper-cache', 3],
  ['upper-vault', 'upper-relay', 4],
  ['upper-finish', 'upper-vault', 6],
  ['lower-cache', 'junction', 2],
  ['lower-relay', 'lower-cache', 3],
  ['lower-vault', 'lower-relay', 4],
  ['lower-finish', 'lower-vault', 6],
  ['upper-conduit', 'upper-relay', 1],
  ['upper-watch', 'upper-conduit', 2],
  ['upper-depot', 'upper-watch', 2],
  ['upper-beacon', 'upper-depot', 3],
  ['upper-horizon', 'upper-beacon', 5],
  ['lower-conduit', 'lower-relay', 1],
  ['lower-watch', 'lower-conduit', 2],
  ['lower-depot', 'lower-watch', 2],
  ['lower-beacon', 'lower-depot', 3],
  ['lower-horizon', 'lower-beacon', 5],
];

// Columns run from entry to finale. A null leaves a gap between lanes.
const layouts = {
  protectorate: {
    columns: [[0], [1], [2], [3, 7], [4, 8], [5, 11, 16, 9], [6, 12, 17, 10],
      [null, 13, 18, null], [null, 14, 19, null], [15, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 15], [4, 11, 12, 13, 14, 15],
      [2, 7, 8, 9, 10, 20], [8, 16, 17, 18, 19, 20]],
  },
  growth: {
    columns: [[0], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11, 16], [6, 12, 17],
      [null, 13, 18], [null, 14, 19], [15, 20, null]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 15], [3, 11, 12, 13, 14, 20],
      [0, 7, 8, 9, 10, 16, 17, 18, 19, 20]],
  },
  neutral: {
    columns: [[0], [1], [2, 3, 7], [11, 4, 8], [12, 5, 9], [13, 6, 10],
      [14, 16, 17], [null, 18, 19], [15, null, 20]],
    paths: [[0, 1, 2, 11, 12, 13, 14, 15], [1, 3, 4, 5, 6, 16, 18, 15],
      [1, 7, 8, 9, 10, 17, 19, 20], [7, 8, 16, 18, 20]],
  },
  'debris-belt': {
    columns: [[0], [1], [2], [3, 7], [4, 8], [5, 9], [6, 16, 11, 10],
      [12, 13, 17, 18], [14, 15, 19, null], [null, null, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 12, 14, 20], [4, 11, 13, 15, 20],
      [2, 7, 8, 9, 10, 17, 19, 20], [8, 16, 18, 20]],
  },
  'border-station': {
    columns: [[0], [1, 7], [2, 8], [3, 9], [4, 10, 16], [5, 11, 17],
      [6, 12, 18], [13, 14, 19], [15, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 13, 15], [3, 11, 12, 14, 15],
      [0, 7, 8, 9, 10, 11], [9, 16, 17, 18, 19, 20], [12, 20]],
  },
};

const mirrored = (layout) => ({ ...layout, columns: layout.columns.map((column) => [...column].reverse()) });
Object.assign(layouts, {
  choir: mirrored(layouts.protectorate),
  captains: mirrored(layouts.neutral),
  'dead-colony': layouts['debris-belt'],
  'black-market': layouts['debris-belt'],
  'pirate-cove': { columns: [...layouts.growth.columns.slice(0, -1), [null, 15, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 15, 20], ...layouts.growth.paths.slice(1)] },
  'smuggler-nebula': mirrored(layouts['debris-belt']),
});

// The longer chapters award some keys along the way to fund later stops.
const frontier = {
  'debris-belt': {
    columns: [[0], [null, 21], [1], [22, null], [2], [3, null, null, 7],
      [null, 23, null, 25], [4, null, 8, null], [null, 24, null, 9],
      [5, null, 26, null], [6, null, null, 10], [27], [null, 11, null, 16],
      [12, null, 17, null], [13, null, null, 18], [null, 14, 19, null],
      [15, null, null, 28], [20]],
    paths: [[0, 21, 1, 22, 2, 3, 23, 4, 24, 5, 6, 27, 11, 12, 13, 14, 15, 20],
      [2, 7, 25, 8, 9, 26, 10, 27, 16, 17, 18, 19, 28, 20], [4, 9], [12, 18]],
    rewards: [
      ['drift-cache', 1, 'Тайник в обшивке', 'gold', 45, 8],
      ['scrap-bin', 1, 'Кладовая сборщиков', 'essence', 35],
      ['rescue-locker', 2, 'Шкаф спасателей', 'booster', 1, 6],
      ['lost-manifest', 3, 'Утерянная ведомость', 'gold-stack', 150],
      ['smuggler-cache', 2, 'Тайник контрабандистов', 'essence', 50, 6],
      ['silent-beacon', 3, 'Безмолвный маяк', 'booster', 1],
      ['salvage-hub', 5, 'Биржа обломков', 'gold-stack', 240, 18],
      ['drift-banner', 5, 'Склад пустотников', 'steel', 70],
    ],
  },
  'border-station': {
    columns: [[0], [21, null], [null, 1], [2], [null, 22], [3, null, 7],
      [null, 4, null, 8], [23, null, 9, null], [5, null, null, 24],
      [null, 6, 10, null], [null, 11], [25], [12, null], [13, null, null, 16],
      [null, 26, 17, null], [null, 14, null, 18], [27, null, 19], [15, null, 20]],
    paths: [[0, 21, 1, 2, 22, 3, 4, 23, 5, 6, 11, 25, 12, 13, 26, 14, 27, 15],
      [22, 7, 8, 9, 24, 10, 11], [12, 16, 17, 18, 19, 20], [4, 9], [26, 18]],
    rewards: [
      ['recon-cache', 1, 'Запас разведчиков', 'gold', 50, 8],
      ['escort-dock', 2, 'Шлюз эскорта', 'booster', 1, 5],
      ['encrypted-log', 2, 'Шифрованный журнал', 'essence', 50],
      ['reserve-warehouse', 3, 'Резервный склад', 'gold-stack', 150],
      ['dispatch-center', 4, 'Диспетчерский узел', 'booster', 2, 19],
      ['customs-lockbox', 4, 'Сейф таможни', 'essence', 75],
      ['bastion-deck', 5, 'Палуба бастиона', 'energyCells', 35],
    ],
  },
};
frontier['dead-colony'] = {
  ...mirrored(frontier['debris-belt']),
  rewards: [
    ['colony-cache', 1, 'Аварийный тайник', 'gold', 45, 8],
    ['colony-lab', 1, 'Брошенная лаборатория', 'essence', 35],
    ['colony-shelter', 2, 'Убежище колонистов', 'booster', 1, 6],
    ['colony-ledger', 3, 'Книга учёта колонии', 'gold-stack', 160],
    ['colony-reactor', 2, 'Остывший реактор', 'energyCells', 30, 6],
    ['colony-signal', 3, 'Последний сигнал колонии', 'booster', 1],
    ['colony-mint', 5, 'Монетный двор колонии', 'gold-stack', 250, 18],
    ['colony-forge', 5, 'Кузня колонии', 'steel', 75],
  ],
};

function chapter(id, title, faction, rewards, image = faction.image) {
  const extension = frontier[id];
  const { columns, paths } = extension ?? layouts[id];
  const fullId = (stop) => id + ':' + stop;
  const nodes = stops.map(([stop, legacyParent, cost], index) => {
    const [label, kind, value] = rewards[index];
    return { id: fullId(stop), legacyParents: legacyParent ? [fullId(legacyParent)] : [],
      parents: [], finale: true, cost, label, kind, value };
  });
  if (extension) {
    for (const path of layouts[id].paths) {
      for (let i = 1; i < path.length; i++) nodes[path[i]].legacyParents.push(nodes[path[i - 1]].id);
    }
    for (const [stop, cost, label, kind, value, keyReward = 0] of extension.rewards) {
      nodes.push({ id: fullId(stop), legacyParents: [], parents: [], finale: true, cost, label, kind, value, keyReward });
    }
  }
  columns.forEach((column, x) => column.forEach((index, y) => {
    if (index === null) return;
    nodes[index].x = 6 + 88 * x / (columns.length - 1);
    nodes[index].y = 12 + 76 * (y + .5) / column.length;
  }));
  for (const path of paths) {
    for (let index = 1; index < path.length; index++) {
      const parent = nodes[path[index - 1]];
      const child = nodes[path[index]];
      if (!child.parents.includes(parent.id)) child.parents.push(parent.id);
      parent.finale = false;
    }
  }
  return { id, title, faction: faction.id, image, nodes, tall: Boolean(extension) };
}

const { protectorate, growth, choir, captains, neutral } = Object.fromEntries(BOOSTER_FACTIONS.map((faction) => [faction.id, faction]));

export const REWARD_SECTIONS = [
  {
    id: 'gate-signals', title: 'Сигналы Врат',
    chapters: [
      chapter('protectorate', 'Орбитальный рубеж', protectorate, [
        ['Первый сигнал', 'gold', 40],
        ['Склад гарнизона', 'booster', 1],
        ['Ретранслятор', 'essence', 30],
        ['Патрульный пост', 'gold', 75],
        ['Арсенал', 'booster', 1],
        ['Казна сектора', 'gold-stack', 250],
        ['Сталелитейный цех', 'steel', 60],
        ['Плавильня', 'essence', 55],
        ['Штаб флота', 'booster', 1],
        ['Хранилище флота', 'gold-stack', 300],
        ['Энергоузел флота', 'energyCells', 25],
        ['Зонд наблюдения', 'essence', 25],
        ['Склад дозора', 'gold', 65],
        ['Резерв эскадры', 'booster', 1],
        ['Архив шифров', 'essence', 90],
        ['Стальной герб', 'card-back', 'Улучшенная рубашка Протектората'],
        ['Тыловой пост', 'gold', 45],
        ['Патрульный ангар', 'booster', 1],
        ['Верфь', 'essence', 60],
        ['Контракт флота', 'gold-stack', 180],
        ['Ночная верфь', 'battlefield', 'Поле Протектората'],
      ]),
      chapter('growth', 'Сады под куполом', growth, [
        ['Живая искра', 'essence', 25],
        ['Кладка', 'booster', 1],
        ['Корневой узел', 'gold', 60],
        ['Светящиеся споры', 'essence', 45],
        ['Камера роста', 'booster', 1],
        ['Кристаллическая жила', 'gold-stack', 240],
        ['Хитиновая броня', 'steel', 55],
        ['Затерянный тайник', 'gold', 85],
        ['Подземное гнездо', 'essence', 70],
        ['Семенной резерв', 'booster', 2],
        ['Биобатарея', 'energyCells', 25],
        ['Ядро споры', 'essence', 30],
        ['Банк пыльцы', 'gold', 45],
        ['Теплица', 'booster', 1],
        ['Зелёный янтарь', 'essence', 95],
        ['Цветущий рой', 'card-back', 'Улучшенная рубашка Поросли'],
        ['Хранилище семян', 'gold', 65],
        ['Споровая колыбель', 'booster', 1],
        ['Глубокие корни', 'essence', 50],
        ['Клад под куполом', 'gold-stack', 170],
        ['Мицелиевая долина', 'battlefield', 'Поле Поросли'],
      ]),
      chapter('choir', 'Шёпот глубин', choir, [
        ['Первый шёпот', 'gold', 45],
        ['Подношение', 'booster', 1],
        ['Свиток видений', 'essence', 35],
        ['Пожертвования', 'gold', 70],
        ['Тайник культа', 'booster', 1],
        ['Казна храма', 'gold-stack', 240],
        ['Цепи алтаря', 'steel', 60],
        ['Чернила глубин', 'essence', 50],
        ['Дары паствы', 'booster', 1],
        ['Сокровищница культа', 'gold-stack', 260],
        ['Свечи бдения', 'energyCells', 25],
        ['Слеза Спящего', 'essence', 25],
        ['Кандалы фанатиков', 'steel', 40],
        ['Келья неофитов', 'booster', 1],
        ['Запретный свиток', 'essence', 90],
        ['Око Спящего', 'card-back', 'Улучшенная рубашка Хора'],
        ['Десятина', 'gold', 50],
        ['Ковчег паствы', 'booster', 1],
        ['Лампады глубин', 'energyCells', 20],
        ['Клад жрецов', 'gold-stack', 180],
        ['Храм Спящего', 'battlefield', 'Поле Хора'],
      ]),
      chapter('captains', 'Вольная гавань', captains, [
        ['Долговая расписка', 'gold', 45],
        ['Трофейный ящик', 'booster', 1],
        ['Краденые чертежи', 'essence', 35],
        ['Доля в рейде', 'gold', 70],
        ['Груз с абордажа', 'booster', 1],
        ['Пиратская казна', 'gold-stack', 240],
        ['Обшивка трофея', 'steel', 60],
        ['Карта тайников', 'essence', 50],
        ['Ящик контрабанды', 'booster', 1],
        ['Сундук капитана', 'gold-stack', 260],
        ['Батареи шлюпа', 'energyCells', 25],
        ['Метка гончей', 'essence', 25],
        ['Цепи должника', 'steel', 40],
        ['Награда за голову', 'booster', 1],
        ['Судовой журнал', 'essence', 90],
        ['Чёрная метка', 'card-back', 'Улучшенная рубашка Капитанов'],
        ['Портовый сбор', 'gold', 50],
        ['Склад гавани', 'booster', 1],
        ['Аккумуляторы дока', 'energyCells', 20],
        ['Добыча флотилии', 'gold-stack', 180],
        ['Палуба флагмана', 'battlefield', 'Поле Капитанов'],
      ]),
      chapter('neutral', 'Дальние Врата', neutral, [
        ['Маяк на выходе', 'gold', 50],
        ['Груз без метки', 'booster', 1],
        ['Перекрёсток', 'essence', 35],
        ['Вольный док', 'gold', 80],
        ['Обменный пост', 'essence', 65],
        ['Караванный резерв', 'gold-stack', 280],
        ['Металлолом каравана', 'steel', 60],
        ['Дрейфующий контейнер', 'booster', 1],
        ['Мастерская Врат', 'essence', 80],
        ['Архив переходов', 'booster', 2],
        ['Осколок Дальних Врат', 'gateShards', 2],
        ['Буй навигации', 'gold', 40],
        ['Торговый контейнер', 'booster', 1],
        ['Отражатель сигнала', 'essence', 55],
        ['Аванс каравана', 'gold-stack', 200],
        ['Звёздный компас', 'card-back', 'Улучшенная нейтральная рубашка'],
        ['Аварийный канал', 'essence', 25],
        ['Капсула без номера', 'booster', 1],
        ['Ремонтный док', 'gold', 75],
        ['Обломок Врат', 'essence', 110],
        ['Приют на орбите', 'battlefield', 'Нейтральное поле'],
      ]),
    ],
  },
  {
    id: 'far-frontier', title: 'Дальний рубеж',
    chapters: [
      chapter('debris-belt', 'Заброшенный пояс', neutral, [
        ['Запись разведчика', 'essence', 25],
        ['Контейнер у обломков', 'booster', 1],
        ['Страховка грузовика', 'gold', 50],
        ['Внешний маяк', 'gold', 75],
        ['Контрабандный груз', 'booster', 1],
        ['Казна спасателей', 'gold-stack', 230],
        ['Корпусная сталь', 'steel', 65],
        ['Мастерская сборщиков', 'essence', 45],
        ['Аварийная шлюпка', 'booster', 1],
        ['Запечатанный отсек', 'gold-stack', 250],
        ['Аккумуляторы спасателей', 'energyCells', 30],
        ['Фрагмент антенны', 'essence', 30],
        ['Малый склад', 'gold', 60],
        ['Ретранслятор пояса', 'booster', 1],
        ['Ядро памяти', 'essence', 90],
        ['Осколки старых Врат', 'gateShards', 2],
        ['Кольцо антенн', 'gold', 55],
        ['Забытый контейнер', 'booster', 1],
        ['Осколки ядра', 'essence', 60],
        ['Запас экспедиции', 'gold-stack', 185],
        ['Туман обломков', 'battlefield', 'Туман обломков'],
      ], 'gate-relic.webp'),
      chapter('border-station', 'Пограничная станция', protectorate, [
        ['Сигнал дозора', 'gold', 45],
        ['Ящик снабжения', 'booster', 1],
        ['Шифры караула', 'essence', 35],
        ['Дежурный пост', 'gold', 70],
        ['Груз с орбиты', 'booster', 1],
        ['Казна станции', 'gold-stack', 225],
        ['Броневые плиты', 'steel', 65],
        ['Окно связи', 'essence', 40],
        ['Резервный шлюз', 'booster', 1],
        ['Запас экспедиции', 'gold-stack', 270],
        ['Генератор станции', 'energyCells', 30],
        ['Ближняя антенна', 'essence', 20],
        ['Топливный склад', 'gold', 65],
        ['Ангар разведки', 'booster', 1],
        ['Сигнальный архив', 'essence', 100],
        ['Зал пограничной станции', 'battlefield', 'Зал пограничной станции'],
        ['Капсула связи', 'gold', 50],
        ['Запасной контейнер', 'booster', 1],
        ['Пульт защиты', 'essence', 65],
        ['Касса снабжения', 'gold-stack', 190],
        ['На границе сектора', 'battlefield', 'На границе сектора'],
      ], 'orbital-shield.webp'),
      chapter('dead-colony', 'Мёртвая колония', neutral, [
        ['Журнал колониста', 'essence', 30],
        ['Контейнер снабжения', 'booster', 1],
        ['Страховой фонд', 'gold', 55],
        ['Обломки купола', 'steel', 50],
        ['Медицинский склад', 'booster', 1],
        ['Казна колонии', 'gold-stack', 230],
        ['Генератор купола', 'energyCells', 25],
        ['Образцы почвы', 'essence', 50],
        ['Спасательная капсула', 'booster', 1],
        ['Хранилище колонии', 'gold-stack', 250],
        ['Опоры терраформера', 'steel', 70],
        ['Записи биолога', 'essence', 30],
        ['Зарплатный фонд', 'gold', 60],
        ['Склад шахтёров', 'booster', 1],
        ['Ядро терраформера', 'essence', 90],
        ['Осколок древних Врат', 'gateShards', 2],
        ['Ящик инструментов', 'gold', 55],
        ['Карантинный отсек', 'booster', 1],
        ['Батареи маяка', 'energyCells', 30],
        ['Запас переселенцев', 'gold-stack', 190],
        ['Мёртвая колония', 'battlefield', 'Мёртвая колония'],
      ], 'rot-giant.webp'),
    ],
  },
  {
    id: 'free-routes', title: 'Вольные трассы',
    chapters: [
      chapter('black-market', 'Чёрный рынок', captains, [
        ['Шёпот перекупщика', 'essence', 30],
        ['Ящик без маркировки', 'booster', 1],
        ['Залог за товар', 'gold', 55],
        ['Краденая броня', 'steel', 50],
        ['Партия с орбиты', 'booster', 1],
        ['Касса скупщика', 'gold-stack', 230],
        ['Ворованные батареи', 'energyCells', 25],
        ['Поддельные печати', 'essence', 50],
        ['Контрабандный груз', 'booster', 1],
        ['Сейф ростовщика', 'gold-stack', 250],
        ['Слитки с переплавки', 'steel', 70],
        ['Каталог редкостей', 'essence', 30],
        ['Выручка торгов', 'gold', 60],
        ['Тайный заказ', 'booster', 1],
        ['Лавка диковин', 'essence', 90],
        ['Осколок под прилавком', 'gateShards', 2],
        ['Взятка таможне', 'gold', 55],
        ['Груз с чёрного входа', 'booster', 1],
        ['Батареи из-под полы', 'energyCells', 30],
        ['Доля барона', 'gold-stack', 190],
        ['Чёрный рынок', 'battlefield', 'Чёрный рынок'],
      ], 'stolen-goods-fence.webp'),
      chapter('pirate-cove', 'Пиратская бухта', captains, [
        ['Сигнал маяка', 'essence', 30],
        ['Добыча шлюпа', 'booster', 1],
        ['Карта бухты', 'gold', 55],
        ['Броня абордажников', 'steel', 50],
        ['Трюм рейдера', 'booster', 1],
        ['Пиратский клад', 'gold-stack', 230],
        ['Батареи корсаров', 'energyCells', 25],
        ['Ром и порох', 'essence', 50],
        ['Ящик абордажа', 'booster', 1],
        ['Сундук адмирала', 'gold-stack', 250],
        ['Якорные цепи', 'steel', 70],
        ['Судовой амулет', 'essence', 30],
        ['Выкуп за пленных', 'gold', 60],
        ['Груз с призового судна', 'booster', 1],
        ['Тайник боцмана', 'essence', 90],
        ['Осколок с затонувшего', 'gateShards', 2],
        ['Доля юнги', 'gold', 55],
        ['Пушечный погреб', 'booster', 1],
        ['Генератор форта', 'energyCells', 30],
        ['Казна флотилии', 'gold-stack', 190],
        ['Пиратская бухта', 'battlefield', 'Пиратская бухта'],
      ], 'debtor.webp'),
      chapter('smuggler-nebula', 'Туманность контрабандистов', captains, [
        ['Тайный курс', 'essence', 30],
        ['Груз в тумане', 'booster', 1],
        ['Карта течений', 'gold', 55],
        ['Обшивка из тумана', 'steel', 50],
        ['Контейнер-призрак', 'booster', 1],
        ['Тайник в астероиде', 'gold-stack', 230],
        ['Батареи навигатора', 'energyCells', 25],
        ['Пыль туманности', 'essence', 50],
        ['Спрятанный трюм', 'booster', 1],
        ['Казна контрабандистов', 'gold-stack', 250],
        ['Металл из обломков', 'steel', 70],
        ['Шифр лоцмана', 'essence', 30],
        ['Плата за проводку', 'gold', 60],
        ['Ящик со дна', 'booster', 1],
        ['Сердце туманности', 'essence', 90],
        ['Осколок в пыли', 'gateShards', 2],
        ['Пошлина лоцмана', 'gold', 55],
        ['Груз-невидимка', 'booster', 1],
        ['Энергия туманности', 'energyCells', 30],
        ['Добыча тумана', 'gold-stack', 190],
        ['Туманность контрабандистов', 'battlefield', 'Туманность контрабандистов'],
      ], 'smuggler.webp'),
    ],
  },
];

const chapters = REWARD_SECTIONS.flatMap((section) => section.chapters);
const nodesById = new Map(chapters.flatMap(({ nodes }) => nodes.map((node) => [node.id, node])));

const routeOpen = (node, unlocked) => !node.parents.length || node.parents.some((parent) => unlocked.has(parent));

export function readRewardBookProgress(ids, keys) {
  const unlocked = new Set();
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const node = nodesById.get(id);
      if (!node || unlocked.has(id) || node.cost > keys || (!routeOpen(node, unlocked) && !node.legacyParents.some((parent) => unlocked.has(parent)))) continue;
      unlocked.add(id);
      keys += (node.keyReward ?? 0) - node.cost;
    }
  }
  return { keys, unlocked };
}

export function rewardState(node, { keys, unlocked }) {
  if (unlocked.has(node.id)) return 'unlocked';
  if (!routeOpen(node, unlocked)) return 'locked';
  return keys >= node.cost ? 'available' : 'unaffordable';
}

export function findRewardNode(id) {
  return nodesById.get(id);
}

const resourcesByKind = { gold: 'gold', 'gold-stack': 'gold', essence: 'essence', booster: 'boosters' };
// Base materials are credited once on purchase (like ranks and the Tavern), not recomputed from the unlocked set.
export const REWARD_MATERIALS = Object.freeze(['steel', 'energyCells', 'gateShards']);

export function rewardForNode(node) {
  const reward = { keys: node.keyReward ?? 0 };
  const resource = resourcesByKind[node.kind] ?? (REWARD_MATERIALS.includes(node.kind) ? node.kind : null);
  if (resource) reward[resource] = node.value;
  return reward;
}

export function addRewardBookBalances(unlocked, { gold, essence, boosters }) {
  const balance = { gold, essence, boosters: { ...boosters } };
  for (const { faction, nodes } of chapters) {
    for (const { id, kind, value } of nodes) {
      if (!unlocked.has(id)) continue;
      const resource = resourcesByKind[kind];
      if (resource === 'boosters') balance.boosters[faction] += value;
      else if (resource) balance[resource] += value;
    }
  }
  return balance;
}
