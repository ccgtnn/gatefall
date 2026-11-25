import { ability, action, adjacent, allies, choice, chosen, enemies, enemyChoice, self } from './card-abilities.js';

const allyRow = { ...allies, row: 'source' };
const armorNeighbors = (amount) => ability([action('armor', adjacent, amount)]);
const armorRemoved = { result: 'armor' };
const salvoDamage = { row: 'surface', then: 5, otherwise: 3 };
const emperorStatueBonus = { playedCategory: 'Голем', base: 1, scale: 1 };

const protectorate = [
  ['shield-generator', 'Генератор щита', 4, null, 'Приказ (3 заряда): дай выбранному своему отряду 2 брони.',
    { type: 'artifact', art: 'shield-generator.webp', order: {
      charges: 3,
      ...ability([action('armor', chosen('ally'), 2)],
        [choice('ally', allies, 'Выбери свой отряд для 2 брони.', { kind: 'armor', amount: 2 })]),
    }, keywords: ['Приказ', 'Заряды', 'Броня'] }],
  ['infantry', 'Пехотинец линии', 4, 3, 'Броня 2. При розыгрыше: соседи получают 2 брони.',
    { art: 'infantry.webp', armor: 2, deploy: armorNeighbors(2), keywords: ['Броня', 'Соседи'] }],
  ['engineer', 'Инженер укреплений', 4, 3, 'При розыгрыше: дать 3 брони своей карте.',
    { art: 'engineer.webp', deploy: ability([action('armor', chosen('ally'), 3)],
      [choice('ally', allies, 'Выбери свой отряд для 3 брони.', { kind: 'armor' })]), keywords: ['Броня'] }],
  ['assault', 'Тяжёлый штурмовик', 5, 5, 'Броня 3.', { art: 'assault.webp', armor: 3, keywords: ['Броня'] }],
  ['orbital-shield', 'Орбитальный щит', 6, 4, 'Броня 2. В конце хода: дать 1 броню соседям.',
    { art: 'orbital-shield.webp', artCrop: 'orbital-shield-crop.webp', armor: 2, endTurn: armorNeighbors(1), keywords: ['Броня', 'Соседи'] }],
  ['standard', 'Знаменосец', 4, 3, 'При розыгрыше: усилить бронированных соседей на 2.',
    { art: 'standard.webp', aiHints: { placement: 'armored-neighbors' },
      deploy: ability([action('boost', { ...adjacent, armorAtLeast: 1 }, 2)]), keywords: ['Усиление', 'Броня', 'Соседи'] }],
  ['warden', 'Страж врат', 5, 5, 'Броня 3. Нельзя сдвинуть.', { art: 'warden.webp', armor: 3, immovable: true, keywords: ['Броня'] }],
  ['anvil', 'Таран «Наковальня»', 8, 4, 'При розыгрыше: снять всю броню со своей карты и нанести столько же урона вражеской.',
    { rarity: 'epic', art: 'anvil.webp', artCrop: 'anvil-crop.webp', deploy: ability([
      { action: 'armor', target: chosen('payer'), amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('damage', chosen('enemy'), armorRemoved),
    ], [
      choice('payer', { ...allies, armorAtLeast: 1 }, 'Выбери свою карту, с которой снять всю броню.', { kind: 'spend-armor' }),
      enemyChoice({ stat: 'armor', ref: 'payer' }),
    ]), keywords: ['Броня', 'Урон'] }],
  ['smelter', 'Переплавщик', 5, 2, 'При розыгрыше: снять броню с соседей и усилить себя на столько же.',
    { art: 'smelter.webp', deploy: ability([
      { action: 'armor', target: adjacent, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('boost', self, armorRemoved),
    ]), keywords: ['Броня', 'Усиление', 'Соседи'] }],
  ['reinforcements', 'Подкрепление', 5, null, 'Покажи 3 случайных обычных отряда из своей колоды. Выбери один и сыграй его.',
    { art: 'reinforcements.webp', type: 'effect', deploy: ability([{ action: 'play-from-deck', filter: { rarity: 'bronze' }, choose: 3 }]) }],
  ['orbital-salvo', 'Орбитальный залп', 4, null, 'Нанести 3 урона вражескому отряду. Если цель на Поверхности, нанести 5 урона.',
    { removalReserve: 4, type: 'effect', art: 'orbital-salvo.webp', deploy: ability([action('damage', chosen('enemy'), salvoDamage)],
      [enemyChoice(salvoDamage)]), keywords: ['Урон'] }],
  ['colonel', 'Октавиан Рейн', 10, 5, 'При розыгрыше: удвоить броню своих отрядов в этом ряду.',
    { art: 'colonel.webp', aiHints: { placement: 'armored-neighbors' },
      deploy: ability([action('armor', allyRow, { stat: 'armor' })]), keywords: ['Броня'] }],
  ['bastion', 'Бастион «Рубеж»', 11, 7, 'Броня 6. При розыгрыше: дать 3 брони соседям.',
    { art: 'bastion.webp', armor: 6, deploy: armorNeighbors(3), keywords: ['Броня', 'Соседи'] }],
  ['commander', 'Кассия Фульмина', 8, 5, 'Приказ: снять 2 брони со своей карты и нанести 3 урона вражеской. Перезарядка: 2 хода.',
    { rarity: 'epic', art: 'commander.webp', order: {
      cooldown: 2,
      cost: ability([action('armor', chosen('payer'), -2)], [
        choice('payer', { ...allies, armorAtLeast: 2 },
          'Выбери свою карту, с которой снять 2 брони.', { kind: 'spend-armor', amount: 2 }),
      ]),
      ...ability([action('damage', chosen('enemy'), 3)], [enemyChoice(3)]),
    }, keywords: ['Приказ', 'Броня', 'Урон'] }],
  ['shield-overload', 'Перегрузка щитов', 12, null, 'Выбери свой ряд и сними всю броню со своих отрядов в нём. Затем выбери ряд противника. За каждую снятую единицу брони нанеси 1 урон случайному вражескому отряду в этом ряду.',
    { removalReserve: 5, art: 'shield-overload.webp', type: 'effect',
      aiHints: { handPotential: 11, spendsRowArmor: true }, deploy: ability([
      { action: 'select-row', ref: 'row', filter: 'armor', prompt: 'Выбери свой ряд, с которого снять броню.' },
      { action: 'armor', target: { ...allies, rowRef: 'row' }, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      { action: 'select-row', ref: 'enemyRow', filter: 'units', prompt: 'Выбери вражеский ряд для ударов.' },
      { action: 'scatter', rowRef: 'enemyRow', amount: armorRemoved },
    ]), keywords: ['Броня', 'Урон'] }],
];

const heavyShip = 'Тяжёлый корабль';
const lightShip = 'Лёгкий корабль';
const markedEnemy = { ...enemies, marked: true };
const unmarkedEnemy = { ...enemies, marked: false };
const mark = (target) => ({ ...action('status', target, 1), status: 'target' });
const markEnemy = ability([mark(chosen('enemy'))], [
  choice('enemy', unmarkedEnemy, 'Отметь вражеский отряд Целью.', { kind: 'target-mark' }),
]);
const onRow = (sourceRow, effect) => ({ ...effect, sourceRow });
const ship = { categories: [heavyShip], shipClass: heavyShip, preferredRow: 'orbit' };
const shipPlay = (row, effect, shipClasses = [heavyShip]) => ({ friendly: true, shipClasses, ability: onRow(row, effect) });
const randomHit = (target, amount) => ({ ...action('damage', target, amount), mode: 'random' });
const aggressorFire = ability([randomHit(enemies, 1)]);

const protectorateExtras = [
  ['imperial-golem', 'Статуя Императора', 10, 6,
    'Броня 2. При розыгрыше: дай каждому соседнему отряду по 1 брони и 1 силы. Увеличь оба бонуса на 1 за каждого Голема, которого ты разыграл ранее в этом матче.', {
      rarity: 'gold', categories: ['Голем'], art: 'imperial-golem.webp', armor: 2,
      deploy: ability([action('armor', adjacent, emperorStatueBonus), action('boost', adjacent, emperorStatueBonus)]),
      keywords: ['Броня', 'Усиление', 'Соседи'],
  }],
  ['spotter', 'Корректировщик', 4, 5, 'При розыгрыше: отметь вражеский отряд Целью.',
    { art: 'spotter.webp', rarity: 'bronze', deploy: markEnemy, keywords: ['Цель'] }],
  ['fleet-gunner', 'Канонир флота', 5, 3,
    'Поверхность: Рвение. Приказ: нанеси 3 урона Цели. Перезарядка: 2 хода. Орбита: без эффекта.',
    { art: 'fleet-gunner.webp', rarity: 'bronze', preferredRow: 'surface', zeal: true,
      order: onRow('surface', { ...ability([action('damage', chosen('enemy'), 3)], [
        choice('enemy', markedEnemy, 'Выбери Цель для 3 урона.', { kind: 'damage', amount: 3 }),
      ]), cooldown: 2 }), keywords: ['Цель', 'Рвение', 'Приказ', 'Урон'] }],
  ['scout-frigate', 'Разведфрегат', 4, 2,
    'Силовой щит. Поверхность: Рвение. Приказ: отметь вражеский отряд Целью. Перезарядка: 3 хода. Когда ты играешь Тяжёлый корабль, сократи текущую перезарядку на 1. Орбита: только Силовой щит.',
    { art: 'scout-frigate.webp', shipClass: lightShip, rarity: 'bronze', preferredRow: 'surface', shield: true, zeal: true,
      order: onRow('surface', { ...markEnemy, cooldown: 3 }),
      fieldEvents: { play: shipPlay('surface', ability([action('reduce-order-cooldown', self, 1)])) },
      keywords: ['Цель', 'Тяжёлый корабль', 'Силовой щит', 'Рвение', 'Приказ'] }],
  ['spear-battery', 'Батарея «Копьё»', 6, null,
    'Поверхность: в конце хода нанеси 2 урона случайной Цели. Орбита: в конце хода усили случайный свой отряд на 2, если у противника есть Цель.',
    { art: 'spear-battery.webp', rarity: 'bronze', type: 'artifact',
      aiHints: { endTurnNeedsMarkedEnemy: true }, endTurn: ability([
      onRow('surface', randomHit(markedEnemy, 2)),
      onRow('orbit', { ...action('boost', allies, 2), mode: 'random', when: { targets: markedEnemy } }),
    ]), keywords: ['Цель', 'Урон', 'Усиление'] }],
  ['destruction-protocol', 'Протокол уничтожения', 9, null, 'Нанеси 1 урон каждому вражескому отряду, затем ещё 2 урона каждому отряду с меткой Цель.',
    { art: 'destruction-protocol.webp', rarity: 'epic', type: 'effect',
      deploy: { ...ability([action('damage', enemies, 1), action('damage', markedEnemy, 2)]),
        when: { targets: enemies } }, keywords: ['Цель', 'Урон'] }],
  ['aggressor', 'Агрессор', 8, 5,
    'Силовой щит. Орбита: нанеси 1 урон случайному врагу каждый раз, когда ты играешь Тяжёлый или Лёгкий корабль или ставишь новую метку Цель. Поверхность: только Силовой щит.',
    { art: 'aggressor.webp', ...ship, rarity: 'epic', shield: true, fieldEvents: {
      play: shipPlay('orbit', aggressorFire, [heavyShip, lightShip]),
      'target-marked': { friendly: true, ability: onRow('orbit', aggressorFire) },
    }, keywords: ['Цель', 'Тяжёлый корабль', 'Лёгкий корабль', 'Силовой щит', 'Урон'] }],
  ['aurelian', 'Флагман «Аврелиан»', 12, 6,
    'Орбита, при розыгрыше: усили себя на 2 за каждую метку Цель, поставленную тобой на вражеские отряды за матч. Поверхность: без эффекта.',
    { art: 'flagship-aurelian.webp', ...ship, rarity: 'gold', deploy: onRow('orbit', ability([action('boost', self, { markedThisMatch: 2 })])),
      keywords: ['Цель', 'Тяжёлый корабль', 'Усиление'] }],
  ['tiberius', 'Флагман «Тиберий»', 10, 4,
    'Орбита, при розыгрыше: отметь Целью все отряды в выбранном вражеском ряду. Поверхность: без эффекта.',
    { art: 'flagship-tiberius.webp', ...ship, rarity: 'gold', deploy: onRow('orbit', ability([
      { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для меток Цель.' },
      mark({ ...unmarkedEnemy, rowRef: 'row' }),
    ])), keywords: ['Цель', 'Тяжёлый корабль'] }],

];

const protectorateLeaders = Object.freeze([
  {
    id: 'marshal', provisionBonus: 15, name: 'Маршал Строя', art: 'marshal.webp', text: 'Дать 3 брони выбранному своему отряду и его соседям.',
    ability: ability([
      action('armor', chosen('ally'), 3), action('armor', { ...adjacent, of: 'ally' }, 3),
    ], [choice('ally', allies, 'Выбери отряд для брони Маршала и его соседей.', { kind: 'marshal' })]),
  },
  {
    id: 'supreme-commander', provisionBonus: 15, name: 'Верховный командор', art: 'supreme-commander.webp',
    text: 'Приказ (2 заряда): усиль выбранную свою карту на 2 и дай ей Рвение.',
    charges: 2, order: { cooldown: 0, usesCharges: true }, aiHints: { leaderReadyOrder: true },
    ability: ability([
      action('boost', chosen('ally'), 2), action('ready-order', chosen('ally')),
    ], [choice('ally', { scope: 'ally', unitOrOrder: true }, 'Выбери свою карту для усиления и подготовки Приказа.', { kind: 'ready-order' })]),
  },
  {
    id: 'fleet-admiral', provisionBonus: 15, name: 'Адмирал флота', art: 'fleet-admiral.webp',
    text: 'Приказ (3 заряда): усиль выбранный свой отряд на 1 и дай ему Силовой щит.',
    charges: 3, order: { cooldown: 0, usesCharges: true }, aiHints: { leaderShield: true },
    ability: ability([
      action('boost', chosen('ally'), 1), { ...action('status', chosen('ally'), 1), status: 'shield' },
    ], [choice('ally', allies, 'Выбери свой отряд для усиления и Силового щита.', { kind: 'shield' })]),
  },
]);

export const PROTECTORATE = {
  name: 'Протекторат', strategy: 'Строй', entries: protectorate, leaders: protectorateLeaders, extras: protectorateExtras,
};
