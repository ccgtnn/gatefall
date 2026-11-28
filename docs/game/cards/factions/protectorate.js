import { ability, action, adjacent, allies, choice, chosen, enemies, enemyChoice, firestormRow, self } from '../card-abilities.js';

const allyRow = { ...allies, row: 'source' };
const armorNeighbors = (amount) => ability([action('armor', adjacent, amount)]);
const armorRemoved = { result: 'armor' };
const salvoDamage = { row: 'surface', then: 5, otherwise: 3 };
const emperorStatueBonus = { playedCategory: 'Голем', base: 1, scale: 1 };

const protectorate = [
  {
    id: 'shield-generator', name: 'Генератор щита', provision: 4,
    type: 'artifact', rarity: 'bronze', faction: 'protectorate',
    text: 'Приказ (3 заряда): дай выбранному своему отряду 2 брони.',
    art: 'shield-generator.webp',
    order: {
      charges: 3,
      ...ability([action('armor', chosen('ally'), 2)],
        [choice('ally', allies, 'Выбери свой отряд для 2 брони.', { kind: 'armor', amount: 2 })]),
    },
    keywords: ['Приказ', 'Заряды', 'Броня'],
  },
  {
    id: 'infantry', name: 'Пехотинец линии', provision: 4, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Броня 2. При розыгрыше: дай соседям 2 брони.',
    art: 'infantry.webp',
    armor: 2,
    deploy: armorNeighbors(2),
    keywords: ['Броня', 'Соседи'],
  },
  {
    id: 'engineer', name: 'Инженер укреплений', provision: 4, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'При розыгрыше: дай 3 брони выбранному своему отряду.',
    art: 'engineer.webp',
    deploy: ability([action('armor', chosen('ally'), 3)],
      [choice('ally', allies, 'Выбери свой отряд для 3 брони.', { kind: 'armor' })]),
    keywords: ['Броня'],
  },
  {
    id: 'assault', name: 'Тяжёлый штурмовик', provision: 5, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Броня 1. Поверхность: Приказ (1 заряд): нанеси 3 урона выбранному вражескому отряду. Орбита: без эффекта.',
    art: 'assault.webp', artCrop: 'assault-crop.webp',
    armor: 1,
    preferredRow: 'surface',
    // Same shape as onRow('surface', …), which is declared further down this module.
    order: { charges: 1, sourceRow: 'surface', ...ability([action('damage', chosen('enemy'), 3)], [
      choice('enemy', enemies, 'Выбери вражеский отряд для 3 урона.', { kind: 'damage', amount: 3 }),
    ]) },
    keywords: ['Броня', 'Приказ', 'Заряды', 'Урон'],
  },
  {
    id: 'orbital-shield', name: 'Орбитальный щит', provision: 6, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Броня 2. В конце твоего хода: дай соседям 1 броню.',
    art: 'orbital-shield.webp',
    artCrop: 'orbital-shield-crop.webp',
    armor: 2,
    endTurn: armorNeighbors(1),
    keywords: ['Броня', 'Соседи'],
  },
  {
    id: 'standard', name: 'Знаменосец', provision: 4, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'При розыгрыше: усиль бронированных соседей на 2.',
    art: 'standard.webp',
    aiHints: { placement: 'armored-neighbors' },
    deploy: ability([action('boost', { ...adjacent, armorAtLeast: 1 }, 2)]),
    keywords: ['Усиление', 'Броня', 'Соседи'],
  },
  {
    id: 'warden', name: 'Страж врат', provision: 5, power: 5,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Броня 3. Неподвижность.',
    art: 'warden.webp',
    armor: 3,
    immovable: true,
    keywords: ['Броня', 'Неподвижность'],
  },
  {
    id: 'anvil', name: 'Таран «Наковальня»', provision: 8, power: 4,
    type: 'unit', rarity: 'epic', faction: 'protectorate',
    text: 'При розыгрыше: сними всю броню с выбранного своего отряда и нанеси столько же урона выбранному вражескому отряду.',
    art: 'anvil.webp',
    artCrop: 'anvil-crop.webp',
    deploy: ability([
      { action: 'armor', target: chosen('payer'), amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('damage', chosen('enemy'), armorRemoved),
    ], [
      choice('payer', { ...allies, armorAtLeast: 1 }, 'Выбери свою карту, с которой снять всю броню.', { kind: 'spend-armor' }),
      enemyChoice({ stat: 'armor', ref: 'payer' }),
    ]),
    keywords: ['Броня', 'Урон'],
  },
  {
    id: 'smelter', name: 'Переплавщик', provision: 5, power: 2,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'При розыгрыше: сними всю броню с соседей и усиль себя на суммарное число снятых единиц.',
    art: 'smelter.webp',
    deploy: ability([
      { action: 'armor', target: adjacent, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('boost', self, armorRemoved),
    ]),
    keywords: ['Броня', 'Усиление', 'Соседи'],
  },
  {
    id: 'reinforcements', name: 'Подкрепление', provision: 5,
    type: 'effect', rarity: 'bronze', faction: 'protectorate',
    text: 'Покажи 3 случайных обычных отряда из своей колоды. Выбери один и сыграй его.',
    art: 'reinforcements.webp',
    deploy: ability([{ action: 'play-from-deck', filter: { rarity: 'bronze' }, choose: 3 }]),
  },
  {
    id: 'orbital-salvo', name: 'Орбитальный залп', provision: 4,
    type: 'effect', rarity: 'bronze', faction: 'protectorate',
    text: 'Нанеси выбранному вражескому отряду 5 урона, если он на Поверхности, или 3 урона в ином случае.',
    removalReserve: 4,
    art: 'orbital-salvo.webp',
    deploy: ability([action('damage', chosen('enemy'), salvoDamage)],
      [enemyChoice(salvoDamage)]),
    keywords: ['Урон'],
  },
  {
    id: 'colonel', name: 'Октавиан Рейн', provision: 10, power: 5,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'При розыгрыше: удвой броню своих отрядов в этом ряду.',
    art: 'colonel.webp',
    aiHints: { placement: 'armored-neighbors' },
    deploy: ability([action('armor', allyRow, { stat: 'armor' })]),
    keywords: ['Броня'],
  },
  {
    id: 'bastion', name: 'Бастион «Рубеж»', provision: 11, power: 7,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'Броня 6. При розыгрыше: дай соседям 3 брони.',
    art: 'bastion.webp',
    armor: 6,
    deploy: armorNeighbors(3),
    keywords: ['Броня', 'Соседи'],
  },
  {
    id: 'commander', name: 'Кассия Фульмина', provision: 8, power: 5,
    type: 'unit', rarity: 'epic', faction: 'protectorate',
    text: 'Приказ: сними 2 брони с выбранного своего отряда и нанеси 3 урона выбранному вражескому отряду. Перезарядка: 2 хода.',
    art: 'commander.webp',
    order: {
      cooldown: 2,
      cost: ability([action('armor', chosen('payer'), -2)], [
        choice('payer', { ...allies, armorAtLeast: 2 },
          'Выбери свою карту, с которой снять 2 брони.', { kind: 'spend-armor', amount: 2 }),
      ]),
      ...ability([action('damage', chosen('enemy'), 3)], [enemyChoice(3)]),
    },
    keywords: ['Приказ', 'Броня', 'Урон'],
  },
  {
    id: 'shield-overload', name: 'Перегрузка щитов', provision: 12,
    type: 'effect', rarity: 'gold', faction: 'protectorate',
    text: 'Выбери свой ряд и сними всю броню со своих отрядов в нём. Затем выбери ряд противника. За каждую снятую единицу брони нанеси 1 урон случайному вражескому отряду в этом ряду.',
    removalReserve: 5,
    art: 'shield-overload.webp',
    aiHints: { handPotential: 11, spendsRowArmor: true },
    deploy: ability([
      { action: 'select-row', ref: 'row', filter: 'armor', prompt: 'Выбери свой ряд, с которого снять броню.' },
      { action: 'armor', target: { ...allies, rowRef: 'row' }, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      { action: 'select-row', ref: 'enemyRow', filter: 'units', prompt: 'Выбери вражеский ряд для ударов.' },
      { action: 'scatter', rowRef: 'enemyRow', amount: armorRemoved },
    ]),
    keywords: ['Броня', 'Урон'],
  },
];

const heavyShip = 'Тяжёлый корабль';
const lightShip = 'Лёгкий корабль';
const armoredVehicles = 'Бронетехника';
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
  {
    id: 'imperial-golem', name: 'Статуя Императора', provision: 10, power: 6,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'Броня 2. При розыгрыше: дай каждому соседнему отряду по 1 брони и 1 силы. Увеличь оба бонуса на 1 за каждого Голема, которого ты разыграл ранее в этом матче.',
    categories: ['Голем'],
    art: 'imperial-golem.webp',
    armor: 2,
    deploy: ability([action('armor', adjacent, emperorStatueBonus), action('boost', adjacent, emperorStatueBonus)]),
    keywords: ['Броня', 'Усиление', 'Соседи'],
  },
  {
    id: 'spotter', name: 'Корректировщик', provision: 4, power: 5,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'При розыгрыше: отметь вражеский отряд Целью.',
    art: 'spotter.webp',
    deploy: markEnemy,
    keywords: ['Цель'],
  },
  {
    id: 'fleet-gunner', name: 'Канонир флота', provision: 5, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Поверхность: Рвение. Приказ: нанеси 3 урона Цели. Перезарядка: 2 хода. Орбита: без эффекта.',
    art: 'fleet-gunner.webp',
    preferredRow: 'surface',
    zeal: true,
    order: onRow('surface', { ...ability([action('damage', chosen('enemy'), 3)], [
      choice('enemy', markedEnemy, 'Выбери Цель для 3 урона.', { kind: 'damage', amount: 3 }),
    ]), cooldown: 2 }),
    keywords: ['Цель', 'Рвение', 'Приказ', 'Урон'],
  },
  {
    id: 'scout-frigate', name: 'Разведфрегат', provision: 4, power: 2,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Силовой щит. Поверхность: Рвение. Приказ: отметь вражеский отряд Целью. Перезарядка: 3 хода. Когда ты играешь Тяжёлый корабль, сократи текущую перезарядку на 1. Орбита: только Силовой щит.',
    art: 'scout-frigate.webp',
    shipClass: lightShip,
    preferredRow: 'surface',
    shield: true,
    zeal: true,
    order: onRow('surface', { ...markEnemy, cooldown: 3 }),
    fieldEvents: { play: shipPlay('surface', ability([action('reduce-order-cooldown', self, 1)])) },
    keywords: ['Цель', 'Тяжёлый корабль', 'Силовой щит', 'Рвение', 'Приказ'],
  },
  {
    id: 'spear-battery', name: 'Батарея «Копьё»', provision: 6,
    type: 'artifact', rarity: 'bronze', faction: 'protectorate',
    text: 'Поверхность: в конце хода нанеси 2 урона случайной Цели. Орбита: в конце хода усили случайный свой отряд на 2, если у противника есть Цель.',
    art: 'spear-battery.webp',
    aiHints: { endTurnNeedsMarkedEnemy: true },
    endTurn: ability([
      onRow('surface', randomHit(markedEnemy, 2)),
      onRow('orbit', { ...action('boost', allies, 2), mode: 'random', when: { targets: markedEnemy } }),
    ]),
    keywords: ['Цель', 'Урон', 'Усиление'],
  },
  {
    id: 'destruction-protocol', name: 'Протокол уничтожения', provision: 9,
    type: 'effect', rarity: 'epic', faction: 'protectorate',
    text: 'Нанеси 1 урон каждому вражескому отряду, затем ещё 2 урона каждому отряду с меткой Цель.',
    art: 'destruction-protocol.webp',
    deploy: { ...ability([action('damage', enemies, 1), action('damage', markedEnemy, 2)]),
    when: { targets: enemies } },
    keywords: ['Цель', 'Урон'],
  },
  {
    id: 'aggressor', name: 'Агрессор', provision: 8, power: 5,
    type: 'unit', rarity: 'epic', faction: 'protectorate',
    text: 'Силовой щит. Орбита: нанеси 1 урон случайному вражескому отряду каждый раз, когда ты играешь Тяжёлый или Лёгкий корабль или ставишь новую метку Цель. Поверхность: только Силовой щит.',
    art: 'aggressor.webp',
    ...ship,
    shield: true,
    fieldEvents: {
      play: shipPlay('orbit', aggressorFire, [heavyShip, lightShip]),
      'target-marked': { friendly: true, ability: onRow('orbit', aggressorFire) },
    },
    keywords: ['Цель', 'Тяжёлый корабль', 'Лёгкий корабль', 'Силовой щит', 'Урон'],
  },
  {
    id: 'aurelian', name: 'Флагман «Аврелиан»', provision: 12, power: 6,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'Орбита, при розыгрыше: усили себя на 2 за каждую метку Цель, поставленную тобой на вражеские отряды за матч. Поверхность: без эффекта.',
    art: 'flagship-aurelian.webp',
    ...ship,
    deploy: onRow('orbit', ability([action('boost', self, { markedThisMatch: 2 })])),
    keywords: ['Цель', 'Тяжёлый корабль', 'Усиление'],
  },
  {
    id: 'tiberius', name: 'Флагман «Тиберий»', provision: 10, power: 4,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'Орбита, при розыгрыше: отметь Целью все отряды в выбранном вражеском ряду. Поверхность: без эффекта.',
    art: 'flagship-tiberius.webp',
    ...ship,
    deploy: onRow('orbit', ability([
      { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для меток Цель.' },
      mark({ ...unmarkedEnemy, rowRef: 'row' }),
    ])),
    keywords: ['Цель', 'Тяжёлый корабль'],
  },
  {
    id: 'emperors-hand', name: 'Длань Императора', provision: 13, power: 4,
    type: 'unit', rarity: 'gold', faction: 'protectorate',
    text: 'Орбита, при розыгрыше: наложи Огненный шторм на выбранный вражеский ряд на 3 хода. Приказ (2 заряда): выбери вражеский отряд — когда он погибнет, наложи Огненный шторм на его ряд на 2 хода. Поверхность: без эффекта и приказа.',
    art: 'emperors-hand.webp', artCrop: 'emperors-hand-crop.webp',
    ...ship,
    deploy: onRow('orbit', firestormRow(3)),
    order: {
      charges: 2,
      ...onRow('orbit', ability([{
        action: 'grant-deathwish', target: chosen('enemy'),
        deathwish: ability([{ action: 'row-effect', effect: 'firestorm', row: 'death', amount: 2 }]),
      }], [choice('enemy', enemies, 'Выбери вражеский отряд для метки Огненного шторма.', { kind: 'weather-deathwish' })])),
    },
    keywords: ['Тяжёлый корабль', 'Приказ', 'Заряды', 'Завещание', 'Огненный шторм', 'Погода'],
  },
  {
    id: 'brander', name: 'Брандер', provision: 6, power: 2,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Поверхность: Рвение. Приказ (1 заряд): наложи Огненный шторм на выбранный вражеский ряд на 2 хода. Орбита: без эффекта.',
    art: 'brander.webp', artCrop: 'brander-crop.webp',
    categories: [lightShip], shipClass: lightShip, preferredRow: 'surface', zeal: true,
    order: { charges: 1, ...onRow('surface', firestormRow(2)) },
    keywords: ['Лёгкий корабль', 'Рвение', 'Приказ', 'Заряды', 'Огненный шторм', 'Погода'],
  },
  {
    id: 'flame-inquisitor', name: 'Инквизитор Пламени', provision: 5, power: 2,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Когда Огненный шторм наносит урон вражескому отряду, Инквизитор Пламени получает столько же силы. Не больше +5 за ход.',
    art: 'flame-inquisitor.webp', artCrop: 'flame-inquisitor-crop.webp',
    firestormGrowthCap: 5,
    keywords: ['Огненный шторм', 'Усиление'],
  },
  {
    id: 'assault-tank', name: 'Штурмовой танк', provision: 5, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'protectorate',
    text: 'Броня 2. Поверхность: Приказ: нанеси 1 урон выбранному вражескому отряду. Орбита: без эффекта.',
    art: 'assault-tank.webp', artCrop: 'assault-tank-crop.webp',
    armor: 2,
    categories: [armoredVehicles],
    preferredRow: 'surface',
    order: onRow('surface', ability([action('damage', chosen('enemy'), 1)], [
      choice('enemy', enemies, 'Выбери вражеский отряд для 1 урона.', { kind: 'damage', amount: 1 }),
    ])),
    aiHints: { preferShieldDamage: true },
    keywords: ['Броня', 'Приказ', 'Урон'],
  },
];

const protectorateLeaders = Object.freeze([
  {
    id: 'marshal', provisionBonus: 15, name: 'Маршал Строя', art: 'marshal.webp', text: 'Приказ (1 заряд): дай 3 брони выбранному своему отряду и его соседям.',
    charges: 1, order: { cooldown: 0, usesCharges: true },
    aiHints: { leaderChargeValue: 3 },
    ability: ability([
      action('armor', chosen('ally'), 3), action('armor', { ...adjacent, of: 'ally' }, 3),
    ], [choice('ally', allies, 'Выбери отряд для брони Маршала и его соседей.', { kind: 'marshal' })]),
  },
  {
    id: 'supreme-commander', provisionBonus: 15, name: 'Верховный командор', art: 'supreme-commander.webp',
    text: 'Приказ (2 заряда): усиль выбранную свою карту на 2 и дай ей Рвение.',
    charges: 2, order: { cooldown: 0, usesCharges: true }, keywords: ['Рвение'], aiHints: { leaderZeal: true, leaderChargeValue: 3 },
    ability: ability([
      action('boost', chosen('ally'), 2), action('grant-zeal', chosen('ally')),
    ], [choice('ally', { scope: 'ally' }, 'Выбери свою карту для усиления и Рвения.', { kind: 'zeal' })]),
  },
  {
    id: 'fleet-admiral', provisionBonus: 15, name: 'Адмирал флота', art: 'fleet-admiral.webp',
    text: 'Приказ (3 заряда): усиль выбранный свой отряд на 1 и дай ему Силовой щит.',
    charges: 3, order: { cooldown: 0, usesCharges: true }, aiHints: { leaderShield: true, leaderChargeValue: 3 },
    ability: ability([
      action('boost', chosen('ally'), 1), { ...action('status', chosen('ally'), 1), status: 'shield' },
    ], [choice('ally', allies, 'Выбери свой отряд для усиления и Силового щита.', { kind: 'shield' })]),
  },
]);

export const PROTECTORATE = {
  name: 'Протекторат', strategy: 'Строй', entries: protectorate, leaders: protectorateLeaders, extras: protectorateExtras,
};
