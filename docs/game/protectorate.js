import { ability, action, adjacent, allies, choice, chosen, enemies, enemyChoice, self } from './card-abilities.js';

const allyRow = { ...allies, row: 'source' };
const armorNeighbors = (amount) => ability([action('armor', adjacent, amount)]);
const armorRemoved = { result: 'armor' };
const salvoDamage = { row: 'surface', then: 5, otherwise: 3 };
const emperorStatueBonus = { playedCategory: 'Голем', base: 1, scale: 1 };

const protectorate = [
  ['shield-generator', 'Генератор щита', 6, null, 'В конце хода: дать 1 броню соседям.',
    { type: 'artifact', art: 'shield-generator.webp', endTurn: armorNeighbors(1), keywords: ['Броня', 'Соседи'] }],
  ['infantry', 'Пехотинец линии', 4, 2, 'При розыгрыше: соседи получают 2 брони.',
    { art: 'infantry.webp?v=art-25', deploy: armorNeighbors(2), keywords: ['Броня', 'Соседи'] }],
  ['engineer', 'Инженер укреплений', 5, 3, 'При розыгрыше: дать 3 брони своей карте.',
    { art: 'engineer.webp?v=art-24', deploy: ability([action('armor', chosen('ally'), 3)],
      [choice('ally', allies, 'Выбери свой отряд для 3 брони.', { kind: 'armor' })]), keywords: ['Броня'] }],
  ['assault', 'Тяжёлый штурмовик', 5, 5, 'Броня 3.', { art: 'assault.webp?v=art-25', armor: 3, keywords: ['Броня'] }],
  ['orbital-shield', 'Орбитальный щит', 6, 4, 'В конце хода: дать 1 броню соседям.',
    { art: 'orbital-shield.webp', endTurn: armorNeighbors(1), keywords: ['Броня', 'Соседи'] }],
  ['standard', 'Знаменосец', 6, 4, 'При розыгрыше: усилить бронированных соседей на 2.',
    { art: 'standard.webp?v=art-25', deploy: ability([action('boost', { ...adjacent, armorAtLeast: 1 }, 2)]), keywords: ['Усиление', 'Броня', 'Соседи'] }],
  ['warden', 'Страж врат', 6, 6, 'Броня 3. Нельзя сдвинуть.', { art: 'warden.webp?v=art-24', armor: 3, immovable: true, keywords: ['Броня'] }],
  ['anvil', 'Таран «Наковальня»', 8, 4, 'При розыгрыше: снять всю броню со своей карты и нанести столько же урона вражеской.',
    { rarity: 'epic', art: 'anvil.webp?v=art-24', artCrop: 'anvil-crop.webp?v=art-24', deploy: ability([
      { action: 'armor', target: chosen('payer'), amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('damage', chosen('enemy'), armorRemoved),
    ], [
      choice('payer', { ...allies, armorAtLeast: 1 }, 'Выбери свою карту, с которой снять всю броню.', { kind: 'spend-armor' }),
      enemyChoice({ stat: 'armor', ref: 'payer' }),
    ]), keywords: ['Броня', 'Урон'] }],
  ['smelter', 'Переплавщик', 5, 2, 'При розыгрыше: снять броню с соседей и усилить себя на столько же.',
    { art: 'smelter.webp?v=art-24', deploy: ability([
      { action: 'armor', target: adjacent, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('boost', self, armorRemoved),
    ]), keywords: ['Броня', 'Усиление', 'Соседи'] }],
  ['reinforcements', 'Подкрепление', 6, null, 'Покажи 3 случайных обычных отряда из своей колоды. Выбери один и сыграй его.',
    { art: 'reinforcements.webp', type: 'effect', deploy: ability([{ action: 'play-from-deck', filter: { rarity: 'bronze' }, choose: 3 }]) }],
  ['orbital-salvo', 'Орбитальный залп', 5, null, 'Нанести 3 урона вражескому отряду. Если цель на Поверхности, нанести 5 урона.',
    { removalReserve: 4, type: 'effect', art: 'orbital-salvo.webp', deploy: ability([action('damage', chosen('enemy'), salvoDamage)],
      [enemyChoice(salvoDamage)]), keywords: ['Урон'] }],
  ['colonel', 'Октавиан Рейн', 10, 5, 'При розыгрыше: удвоить броню своих отрядов в этом ряду.',
    { art: 'colonel.webp?v=art-24', deploy: ability([action('armor', allyRow, { stat: 'armor' })]), keywords: ['Броня'] }],
  ['bastion', 'Бастион «Рубеж»', 11, 7, 'Броня 6. При розыгрыше: дать 3 брони соседям.',
    { art: 'bastion.webp?v=art-24', armor: 6, deploy: armorNeighbors(3), keywords: ['Броня', 'Соседи'] }],
  ['commander', 'Кассия Фульмина', 8, 5, 'Приказ: снять 2 брони со своей карты и нанести 3 урона вражеской. Перезарядка: 2 хода.',
    { rarity: 'epic', art: 'commander.webp?v=art-24', order: {
      cooldown: 2,
      cost: ability([action('armor', chosen('payer'), -2)], [
        choice('payer', { ...allies, armorAtLeast: 2 },
          'Выбери свою карту, с которой снять 2 брони.', { kind: 'spend-armor', amount: 2 }),
      ]),
      ...ability([action('damage', chosen('enemy'), 3)], [enemyChoice(3)]),
    }, keywords: ['Приказ', 'Броня', 'Урон'] }],
  ['shield-overload', 'Перегрузка щитов', 12, null, 'Выбери свой ряд. Сними всю броню со своих карт в нём. За каждую снятую единицу брони нанеси 1 урон случайному вражескому отряду.',
    { removalReserve: 5, art: 'shield-overload.webp', type: 'effect', deploy: ability([
      { action: 'select-row', ref: 'row', filter: 'armor', prompt: 'Выбери свой ряд, с которого снять броню.' },
      { action: 'armor', target: { ...allies, rowRef: 'row' }, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      { action: 'scatter', amount: armorRemoved },
    ]), keywords: ['Броня', 'Урон'] }],
];

const heavyShip = 'Тяжёлый корабль';
const markedEnemy = { ...enemies, marked: true };
const unmarkedEnemy = { ...enemies, marked: false };
const mark = (target) => ({ ...action('status', target, 1), status: 'target' });
const markEnemy = ability([mark(chosen('enemy'))], [
  choice('enemy', unmarkedEnemy, 'Отметь вражеский отряд Целью.', { kind: 'target-mark' }),
]);
const onRow = (sourceRow, effect) => ({ ...effect, sourceRow });
const ship = { categories: [heavyShip], preferredRow: 'orbit' };
const shipPlay = (row, effect) => ({ friendly: true, category: heavyShip, ability: onRow(row, effect) });
const randomHit = (target, amount) => ({ ...action('damage', target, amount), mode: 'random' });
const aggressorFire = ability([randomHit(enemies, 1)]);

const protectorateExtras = [
  ['imperial-golem', 'Статуя Императора', 9, 6,
    'Броня 2. При розыгрыше: дай каждому соседнему отряду по 1 брони и 1 силы. Увеличь оба бонуса на 1 за каждого Голема, которого ты разыграл ранее в этом матче.', {
      rarity: 'gold', categories: ['Голем'], art: 'imperial-golem.webp?v=emperor-statue-1', armor: 2,
      deploy: ability([action('armor', adjacent, emperorStatueBonus), action('boost', adjacent, emperorStatueBonus)]),
      keywords: ['Броня', 'Усиление', 'Соседи'],
  }],
  ['spotter', 'Корректировщик', 4, 4, 'При розыгрыше: отметь вражеский отряд Целью.',
    { art: 'spotter.webp', rarity: 'bronze', deploy: markEnemy, keywords: ['Цель'] }],
  ['fleet-gunner', 'Канонир флота', 5, 3,
    'Поверхность: Рвение. Приказ: нанеси 3 урона Цели. Перезарядка: 2 хода. Орбита: без эффекта.',
    { art: 'fleet-gunner.webp', rarity: 'bronze', preferredRow: 'surface', zeal: true,
      order: onRow('surface', { ...ability([action('damage', chosen('enemy'), 3)], [
        choice('enemy', markedEnemy, 'Выбери Цель для 3 урона.', { kind: 'damage', amount: 3 }),
      ]), cooldown: 2 }), keywords: ['Цель', 'Рвение', 'Приказ', 'Урон'] }],
  ['scout-frigate', 'Разведфрегат', 5, 1,
    'Силовой щит. Поверхность: Рвение. Приказ: отметь вражеский отряд Целью. Перезарядка: 3 хода. Когда ты играешь Тяжёлый корабль, сократи текущую перезарядку на 1. Орбита: только Силовой щит.',
    { art: 'scout-frigate.webp', rarity: 'bronze', preferredRow: 'surface', shield: true, zeal: true,
      order: onRow('surface', { ...markEnemy, cooldown: 3 }),
      fieldEvents: { play: shipPlay('surface', ability([action('reduce-order-cooldown', self, 1)])) },
      keywords: ['Цель', 'Тяжёлый корабль', 'Силовой щит', 'Рвение', 'Приказ'] }],
  ['spear-battery', 'Батарея «Копьё»', 6, null,
    'Поверхность: в конце хода нанеси 2 урона случайной Цели. Орбита: в конце хода усили случайный свой отряд на 2, если у противника есть Цель.',
    { art: 'spear-battery.webp', rarity: 'bronze', type: 'artifact', endTurn: ability([
      onRow('surface', randomHit(markedEnemy, 2)),
      onRow('orbit', { ...action('boost', allies, 2), mode: 'random', when: { targets: markedEnemy } }),
    ]), keywords: ['Цель', 'Урон', 'Усиление'] }],
  ['destruction-protocol', 'Протокол уничтожения', 9, null, 'Нанеси 3 урона каждой Цели.',
    { art: 'destruction-protocol.webp', rarity: 'epic', type: 'effect', deploy: { ...ability([action('damage', markedEnemy, 3)]),
      when: { targets: markedEnemy } }, keywords: ['Цель', 'Урон'] }],
  ['aggressor', 'Агрессор', 8, 5,
    'Силовой щит. Орбита: нанеси 1 урон случайному врагу каждый раз, когда ты играешь Тяжёлый корабль или ставишь новую метку Цель. Поверхность: только Силовой щит.',
    { art: 'aggressor.webp', ...ship, rarity: 'epic', shield: true, fieldEvents: {
      play: shipPlay('orbit', aggressorFire),
      'target-marked': { friendly: true, ability: onRow('orbit', aggressorFire) },
    }, keywords: ['Цель', 'Тяжёлый корабль', 'Силовой щит', 'Урон'] }],
  ['aurelian', 'Флагман «Аврелиан»', 11, 6,
    'Орбита, при розыгрыше: усили себя на 2 за каждый вражеский отряд, впервые отмеченный тобой Целью за матч. Поверхность: без эффекта.',
    { art: 'flagship-aurelian.webp?v=flagship-art-2', ...ship, rarity: 'gold', deploy: onRow('orbit', ability([action('boost', self, { markedThisMatch: 2 })])),
      keywords: ['Цель', 'Тяжёлый корабль', 'Усиление'] }],
  ['tiberius', 'Флагман «Тиберий»', 10, 4,
    'Орбита, при розыгрыше: отметь Целью все отряды в выбранном вражеском ряду. Поверхность: без эффекта.',
    { art: 'flagship-tiberius.webp?v=flagship-art-2', ...ship, rarity: 'gold', deploy: onRow('orbit', ability([
      { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для меток Цель.' },
      mark({ ...unmarkedEnemy, rowRef: 'row' }),
    ])), keywords: ['Цель', 'Тяжёлый корабль'] }],

];

const protectorateLeaders = Object.freeze([
  {
    id: 'marshal', provisionBonus: 15, name: 'Маршал Строя', art: 'marshal.webp?v=art-24', text: 'Дать 3 брони выбранному своему отряду и его соседям.',
    ability: ability([
      action('armor', chosen('ally'), 3), action('armor', { ...adjacent, of: 'ally' }, 3),
    ], [choice('ally', allies, 'Выбери отряд для брони Маршала и его соседей.', { kind: 'marshal' })]),
  },
  {
    id: 'supreme-commander', provisionBonus: 15, name: 'Верховный командор', art: 'supreme-commander.webp?v=art-24', text: 'Усилить свою карту на 2. Если у неё есть Приказ, сделать его готовым.',
    ability: ability([
      action('boost', chosen('ally'), 2), action('ready-order', chosen('ally')),
    ], [choice('ally', { scope: 'ally', unitOrOrder: true }, 'Выбери свою карту для усиления и подготовки Приказа.', { kind: 'ready-order' })]),
  },
  {
    id: 'fleet-admiral', provisionBonus: 15, name: 'Адмирал флота', art: 'fleet-admiral.webp?v=art-24', text: 'Нанести 4 урона вражескому отряду на Поверхности.',
    ability: ability([action('damage', chosen('enemy'), 4)], [
      choice('enemy', { ...enemies, row: 'surface' }, 'Выбери врага на Поверхности для 4 урона.', { kind: 'damage', amount: 4 }),
    ]),
  },
]);

export const PROTECTORATE = {
  name: 'Протекторат', strategy: 'Строй', entries: protectorate, leaders: protectorateLeaders, extras: protectorateExtras,
};
