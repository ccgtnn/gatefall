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
    paths: [[0, 1, 2, 3, 4, 5, 6, 15, 20], [3, 11, 12, 13, 14, 20],
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
      ['drift-banner', 5, 'Знамя пустотников', 'card-back', 'Знамя пустотников'],
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
      ['bastion-deck', 5, 'Палуба бастиона', 'battlefield', 'Палуба бастиона'],
    ],
  },
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

const { protectorate, growth, neutral } = Object.fromEntries(BOOSTER_FACTIONS.map((faction) => [faction.id, faction]));

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
        ['Стальной штандарт', 'card-back', 'Стальной штандарт'],
        ['Плавильня', 'essence', 55],
        ['Штаб флота', 'booster', 1],
        ['Хранилище флота', 'gold-stack', 300],
        ['Орбитальный рубеж', 'battlefield', 'Орбитальный рубеж'],
        ['Зонд наблюдения', 'essence', 25],
        ['Склад дозора', 'gold', 65],
        ['Резерв эскадры', 'booster', 1],
        ['Архив шифров', 'essence', 90],
        ['Герб эскадры', 'card-back', 'Герб эскадры'],
        ['Тыловой пост', 'gold', 45],
        ['Патрульный ангар', 'booster', 1],
        ['Верфь', 'essence', 60],
        ['Контракт флота', 'gold-stack', 180],
        ['Ночная верфь', 'battlefield', 'Ночная верфь'],
      ]),
      chapter('growth', 'Сады под куполом', growth, [
        ['Живая искра', 'essence', 25],
        ['Кладка', 'booster', 1],
        ['Корневой узел', 'gold', 60],
        ['Светящиеся споры', 'essence', 45],
        ['Камера роста', 'booster', 1],
        ['Кристаллическая жила', 'gold-stack', 240],
        ['Споровый герб', 'card-back', 'Споровый герб'],
        ['Затерянный тайник', 'gold', 85],
        ['Подземное гнездо', 'essence', 70],
        ['Семенной резерв', 'booster', 2],
        ['Сады под куполом', 'battlefield', 'Сады под куполом'],
        ['Ядро споры', 'essence', 30],
        ['Банк пыльцы', 'gold', 45],
        ['Теплица', 'booster', 1],
        ['Зелёный янтарь', 'essence', 95],
        ['Цветущий рой', 'card-back', 'Цветущий рой'],
        ['Хранилище семян', 'gold', 65],
        ['Споровая колыбель', 'booster', 1],
        ['Глубокие корни', 'essence', 50],
        ['Клад под куполом', 'gold-stack', 170],
        ['Мицелиевая долина', 'battlefield', 'Мицелиевая долина'],
      ]),
      chapter('neutral', 'Дальние Врата', neutral, [
        ['Маяк на выходе', 'gold', 50],
        ['Груз без метки', 'booster', 1],
        ['Перекрёсток', 'essence', 35],
        ['Вольный док', 'gold', 80],
        ['Обменный пост', 'essence', 65],
        ['Караванный резерв', 'gold-stack', 280],
        ['Компас странника', 'card-back', 'Компас странника'],
        ['Дрейфующий контейнер', 'booster', 1],
        ['Мастерская Врат', 'essence', 80],
        ['Архив переходов', 'booster', 2],
        ['Дальние Врата', 'battlefield', 'Дальние Врата'],
        ['Буй навигации', 'gold', 40],
        ['Торговый контейнер', 'booster', 1],
        ['Отражатель сигнала', 'essence', 55],
        ['Аванс каравана', 'gold-stack', 200],
        ['Звёздный компас', 'card-back', 'Звёздный компас'],
        ['Аварийный канал', 'essence', 25],
        ['Капсула без номера', 'booster', 1],
        ['Ремонтный док', 'gold', 75],
        ['Обломок Врат', 'essence', 110],
        ['Приют на орбите', 'battlefield', 'Приют на орбите'],
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
        ['Метка спасателя', 'card-back', 'Метка спасателя'],
        ['Мастерская сборщиков', 'essence', 45],
        ['Аварийная шлюпка', 'booster', 1],
        ['Запечатанный отсек', 'gold-stack', 250],
        ['Кладбище кораблей', 'battlefield', 'Кладбище кораблей'],
        ['Фрагмент антенны', 'essence', 30],
        ['Малый склад', 'gold', 60],
        ['Ретранслятор пояса', 'booster', 1],
        ['Ядро памяти', 'essence', 90],
        ['Знак сборщиков', 'card-back', 'Знак сборщиков'],
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
        ['Печать дозора', 'card-back', 'Печать дозора'],
        ['Окно связи', 'essence', 40],
        ['Резервный шлюз', 'booster', 1],
        ['Запас экспедиции', 'gold-stack', 270],
        ['Зал пограничной станции', 'battlefield', 'Зал пограничной станции'],
        ['Ближняя антенна', 'essence', 20],
        ['Топливный склад', 'gold', 65],
        ['Ангар разведки', 'booster', 1],
        ['Сигнальный архив', 'essence', 100],
        ['Герб станции', 'card-back', 'Герб станции'],
        ['Капсула связи', 'gold', 50],
        ['Запасной контейнер', 'booster', 1],
        ['Пульт защиты', 'essence', 65],
        ['Касса снабжения', 'gold-stack', 190],
        ['На границе сектора', 'battlefield', 'На границе сектора'],
      ], 'orbital-shield.webp'),
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

export function rewardForNode(node) {
  const reward = { keys: node.keyReward ?? 0 };
  const resource = resourcesByKind[node.kind];
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
