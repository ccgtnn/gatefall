export const ROWS = Object.freeze(['orbit', 'surface']);

export const ROW_LABELS = Object.freeze({
  orbit: 'Орбита',
  surface: 'Поверхность',
});

export const CARD_TYPES = Object.freeze({ unit: 'Отряд', effect: 'Эффект', artifact: 'Артефакт' });
export const NEUTRAL = 'neutral';
export const RARITY_LABELS = Object.freeze({ bronze: 'Обычная', epic: 'Эпическая', gold: 'Легендарная' });
export const KEYWORDS = Object.freeze({
  'Урон': 'Если есть Силовой щит, первый удар сбивает его. Иначе урон снимает сначала броню, затем силу. Отряд с нулевой силой гибнет.',
  'Броня': 'Каждая единица поглощает 1 урон.',
  'Силовой щит': 'Полностью поглощает первый удар или тик Заражения, затем исчезает. Уничтожение обходит щит.',
  'Усиление': 'Увеличивает текущую силу отряда.',
  'Порождение': 'Добавляет новую карту в ряд, если есть место.',
  'Призыв': 'Перемещает существующую карту из указанной стопки на поле. Способности «При розыгрыше» не срабатывают.',
  'Поглощение': 'Своя жертва гибнет, её текущая сила переходит поглотившему, если карта не задаёт иное.',
  'Счётчик': 'В конце каждого хода владельца уменьшается на 1. При достижении нуля эффект срабатывает один раз.',
  'Уязвимость': 'Эффект срабатывает, когда карта теряет последнюю единицу брони.',
  'Инициатива': 'Бонус, если розыгрыш этой карты — твоё первое действие в раунде. Лидер и Приказы тоже считаются действиями.',
  'Уничтожение': 'Удаляет карту из игры без Завещания.',
  'Расправа': 'Дополнительный эффект срабатывает, если отряд погиб от этого удара.',
  'Завещание': 'Срабатывает при гибели от урона, поглощения, Заражения или таймера.',
  'Заражение': 'В конце хода владельца отряд теряет 1 силу в обход брони. Силовой щит поглощает один тик и исчезает. После каждого тика счётчик уменьшается на 1.',
  'Обречённость': 'При гибели карта уходит из игры, а её Завещание срабатывает.',
  'Приказ': 'Готов со следующего хода владельца. После применения в этом ходу нельзя пасовать.',
  'Рвение': 'Приказ готов сразу после появления карты на поле.',
  'Соседи': 'Две ближайшие позиции слева и справа в том же ряду. Артефакты тоже занимают позиции.',
  'Гниение': 'В начале хода владельца ряда случайный отряд получает Заражение 2 либо 2 урона, если уже заражён. Длительность уменьшается и обнуляется в конце раунда.',
  'Псионная буря': 'В начале твоего хода каждая молния выбирает случайный вражеский отряд и наносит ему 1 урон. Цели могут повторяться.',
  'Стойкость': 'Карта один раз остаётся в своём ряду до следующего раунда и сохраняет состояние.',
  'Сценарий': 'Пролог срабатывает при розыгрыше. Условие карты открывает по одной главе. После последней главы сценарий остаётся на поле до конца раунда. Стойкость может перенести его в следующий раунд.',
  'Конец хода': 'Эффект срабатывает в конце хода владельца карты, в том числе после паса.',
  'Цель': 'Постоянная метка на вражеском отряде. Удары её не снимают, повторная метка не складывается.',
  'Тяжёлый корабль': 'Особые способности Тяжёлых кораблей действуют только на Орбите.',
  'Таймер': 'Считается в конце твоего хода, включая ход розыгрыша и пас.',
});

export const LARVA = Object.freeze({
  id: 'larva', name: 'Личинка', type: 'unit', power: 1, text: 'Обречённая.',
  art: 'larva.webp', categories: ['Выводок'], doomed: true, token: true, keywords: ['Обречённость'],
});

const self = { scope: 'source' };
const adjacent = { scope: 'neighbors', type: 'unit' };
const allies = { scope: 'ally', type: 'unit' };
const enemies = { scope: 'enemy', type: 'unit' };
const larvae = { ...allies, definitionId: LARVA.id };
const otherAlly = { ...allies, exclude: 'source' };
const allyRow = { ...allies, row: 'source' };
const chosen = (ref) => ({ scope: 'ref', ref });
const action = (action, target, amount) => ({ action, target, amount });
const ability = (steps, select = []) => ({ steps, select });
const choice = (ref, targets, prompt, hint) => ({ ref, targets, prompt, ...hint });
const enemyChoice = (amount) => choice('enemy', enemies,
  'Выбери врага для урона.', { kind: 'damage', amount });
const spawn = (position, row = 'source', amount = 1) => ({ action: 'spawn', card: LARVA, position, row, amount });
const summonFromDeck = (position, provision) => ({ action: 'summon-from-deck', position, filter: { provision } });
const absorb = (target, options = {}) => ({ action: 'consume', target, receiver: self, ...options });
const armorNeighbors = (amount) => ability([action('armor', adjacent, amount)]);
const infect = (target, amount) => ({ ...action('status', target, amount), status: 'infection' });
const infectionChoice = (amount) => choice('enemy', enemies,
  `Выбери врага для Заражения ${amount}.`, { kind: 'infection-target', amount });
const armorRemoved = { result: 'armor' };
const victimPower = { stat: 'power', ref: 'victim' };
const salvoDamage = { row: 'surface', then: 5, otherwise: 3 };
const golemDamage = { playedCategory: 'Голем', base: 4, scale: 1 };
const emperorStatueBonus = { playedCategory: 'Голем', base: 1, scale: 1 };
const mountainDamage = { playedCategory: 'Голем', base: 10, scale: -1 };

export const FIRST_SIGNAL = Object.freeze({
  id: 'first-signal', name: 'Первый сигнал', type: 'artifact', stratagem: true, token: true,
  art: 'first-signal.webp?v=art-24', zeal: true, doomed: true,
  text: 'Рвение. Обречённый. Приказ: усилить свой отряд на 5. После применения или в конце первого раунда уходит из игры.',
  keywords: ['Приказ', 'Рвение', 'Усиление', 'Обречённость'],
  order: {
    ...ability([action('boost', chosen('ally'), 5), action('destroy', self)],
      [choice('ally', allies, 'Выбери свой отряд для усиления на 5.', { kind: 'boost', amount: 5 })]),
  },
});

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

const growth = [
  ['cocoon', 'Кокон', 4, 3, 'При розыгрыше: породить по личинке с каждой стороны. Завещание: усилить поглотившего на 2.',
    { art: 'cocoon.webp?v=3', categories: ['Выводок'], deploy: ability([spawn('left'), spawn('right')]),
      deathwish: ability([action('boost', chosen('consumer'), 2)]), keywords: ['Порождение', 'Завещание', 'Поглощение'] }],
  ['feast', 'Пиршество', 4, null, 'Выбранный свой отряд поглощает одну другую свою личинку и получает ещё +4 силы.',
    { art: 'feast.webp', categories: ['Выводок'], type: 'effect', deploy: ability([
      absorb(chosen('victim'), { receiver: chosen('ally'), extra: 4 }),
    ], [
      choice('ally', allies, 'Выбери свой отряд для Пиршества.', { kind: 'boost' }),
      choice('victim', { ...larvae, exclude: 'ally' }, 'Выбери личинку для поглощения.', { kind: 'consume' }),
    ]), keywords: ['Поглощение', 'Усиление'] }],
  ['vine', 'Ползучая лоза', 4, 2, 'При розыгрыше: породить личинку на Орбите. Завещание: наложить Заражение 1 на три случайных вражеских отряда.',
    { art: 'vine.webp?v=art-27', categories: ['Росток'], deploy: ability([spawn('right', 'orbit')]),
      deathwish: ability([{ ...infect(enemies, 1), mode: 'random', count: 3 }]), keywords: ['Порождение', 'Завещание', 'Заражение'] }],
  ['spore-sac', 'Споровый мешок', 4, 4, 'Завещание: породить 3 личинки на месте погибшей карты.',
    { art: 'spore-sac.webp?v=3', categories: ['Росток'], deathwish: ability([spawn('death', 'death', 3)]), keywords: ['Завещание', 'Порождение'] }],
  ['incubator', 'Инкубатор', 6, null, 'В конце хода: породить личинку справа.',
    { type: 'artifact', art: 'incubator.webp?v=art-27', categories: ['Выводок'], endTurn: ability([spawn('right')]), keywords: ['Порождение', 'Конец хода'] }],
  ['acid-gland', 'Кислотная железа', 4, 3, 'Завещание: наложить Заражение 4 на сильнейший вражеский отряд.',
    { art: 'acid-gland.webp?v=art-27', categories: ['Гниль'], deathwish: ability([{ ...infect({ ...enemies, strongest: true }, 4), mode: 'random' }]), keywords: ['Завещание', 'Заражение'] }],
  ['scavenger', 'Трупоед', 5, 3, 'Рвение. Приказ: поглотить другой свой отряд. Перезарядка: 2 хода.',
    { art: 'scavenger.webp?v=3', categories: ['Выводок'], zeal: true, order: {
      cooldown: 2,
      ...ability([absorb(chosen('victim'))],
        [choice('victim', otherAlly, 'Выбери другой свой отряд для поглощения.', { kind: 'consume' })]),
    }, keywords: ['Рвение', 'Приказ', 'Поглощение'] }],
  ['gulper', 'Глотатель', 6, 4, 'При розыгрыше: поглотить все личинки в своём ряду.',
    { art: 'gulper.webp?v=3', categories: ['Выводок'], deploy: ability([absorb({ ...larvae, row: 'source' })]), keywords: ['Поглощение'] }],
  ['spitter', 'Кислотный плевун', 5, 3, 'При розыгрыше: поглотить свою личинку и наложить Заражение 3 на выбранный вражеский отряд. Приказ: наложить Заражение 3 на выбранный вражеский отряд. Перезарядка: 2 хода.',
    { art: 'spitter.webp?v=3', categories: ['Гниль'], deploy: ability([absorb(chosen('victim')), infect(chosen('enemy'), 3)], [
      choice('victim', larvae, 'Выбери личинку для поглощения.', { kind: 'consume' }), infectionChoice(3),
    ]), order: { cooldown: 2, ...ability([infect(chosen('enemy'), 3)], [infectionChoice(3)]) },
      keywords: ['Поглощение', 'Заражение', 'Приказ'] }],
  ['predator', 'Хищный побег', 5, 4, 'Когда рядом кого-то поглощают: усилить себя на 2.',
    { art: 'predator.webp?v=art-26', categories: ['Росток'], neighborEvents: { consume: ability([action('boost', self, 2)]) }, keywords: ['Соседи', 'Поглощение', 'Усиление'] }],
  ['swarm-call', 'Зов роя', 5, null, 'Сыграй из колоды случайный обычный отряд Поросли и породи личинку рядом с ним.',
    { art: 'swarm-call.webp', categories: ['Выводок'], type: 'effect', deploy: ability([{ action: 'play-from-deck',
      filter: { rarity: 'bronze', faction: 'growth' }, after: spawn('right') }]), keywords: ['Порождение'] }],
  ['nest', 'Гнездо-мать', 9, 3, 'В конце хода: породить по личинке в каждом своём ряду.',
    { rarity: 'epic', art: 'nest.webp?v=art-25', categories: ['Выводок'], endTurn: ability([spawn('right', 'all')]), keywords: ['Порождение'] }],
  ['colossus', 'Колосс', 11, 5, 'При розыгрыше: поглотить всех своих соседей.',
    { art: 'colossus.webp?v=art-25', categories: ['Выводок'], deploy: ability([absorb(adjacent)]), keywords: ['Соседи', 'Поглощение'] }],
  ['ravager', 'Выводок-разоритель', 9, 4, 'При розыгрыше: поглотить свой отряд и нанести урон врагу в размере силы жертвы.',
    { rarity: 'epic', art: 'ravager.webp?v=art-25', categories: ['Выводок'], deploy: ability([
      absorb(chosen('victim'), { multiplier: 0, save: 'strength' }),
      action('damage', chosen('enemy'), { result: 'strength' }),
    ], [
      choice('victim', otherAlly, 'Выбери отряд для поглощения.', { kind: 'consume' }), enemyChoice(victimPower),
    ]), keywords: ['Поглощение', 'Урон'] }],
  ['broodlord', 'Владыка выводка', 11, 4, 'При розыгрыше: поглоти всех личинок в своём ряду и получи удвоенную их силу.',
    { art: 'broodlord.webp', categories: ['Выводок'], deploy: ability([absorb({ ...allies, row: 'source', definitionId: LARVA.id }, { multiplier: 2, grouped: true })]),
      keywords: ['Поглощение'] }],
];

const strongest = { scope: 'field', type: 'unit', strongest: true };
const strongestPresent = { targets: strongest };
const annihilate = { action: 'destroy', target: strongest, visual: 'annihilation' };

export const ANNIHILATION = Object.freeze({
  id: 'annihilation', name: 'Аннигиляция', art: 'annihilation.webp?v=neutral-palette-1', removalReserve: 8, faction: NEUTRAL, type: 'effect', rarity: 'gold', provision: 12,
  text: 'Уничтожь сильнейший отряд на поле, свой или чужой. При равенстве выбери случайный из сильнейших. Инициатива: уничтожь все отряды с наибольшей силой.',
  deploy: { ...ability([{ ...annihilate, mode: 'random' }]), when: strongestPresent },
  initiative: { ...ability([annihilate]), when: strongestPresent },
  keywords: ['Уничтожение', 'Инициатива'],
});

export const SHADOW = Object.freeze({
  id: 'shadow', name: 'Тень', faction: NEUTRAL, type: 'unit', power: 2,
  art: 'shadow.webp',
  text: 'Обречённая. Пока на твоей стороне поля есть хотя бы одна Тень, Приказ лидера от Фалуры готов каждый твой ход.',
  categories: ['Пустота'], doomed: true, token: true, keywords: ['Обречённость'],
});

const faluraOrder = {
  text: 'Приказ: нанести 2 урона выбранному вражескому отряду. Перезарядка 1 ход. Если на твоём поле есть Тень, готов каждый твой ход.',
  cooldown: 1,
  quickenedBy: SHADOW.id,
  ability: ability([action('damage', chosen('enemy'), 2)], [enemyChoice(2)]),
};

export const NEUTRAL_CARDS = Object.freeze([
  ANNIHILATION,
  ...[
    ['veteran-mercenary', 'Наёмник-ветеран', 'bronze', 4, 3, 'Нанеси 2 урона своему отряду. Усиль себя на 3.', {
      art: 'veteran-mercenary.webp?v=neutral-palette-1',
      deploy: ability([action('damage', chosen('ally'), 2), action('boost', self, 3)],
        [choice('ally', allies, 'Выбери свой отряд для 2 урона.', { kind: 'friendly-damage', amount: 2 })]),
      keywords: ['Урон', 'Усиление'],
    }],
    ['smuggler', 'Контрабандист', 'bronze', 4, 3, 'Инициатива: усиль себя на 3.', {
      art: 'smuggler.webp?v=neutral-palette-1',
      initiative: ability([action('boost', self, 3)]), keywords: ['Инициатива', 'Усиление'],
    }],
    ['recon-drone', 'Разведдрон', 'bronze', 4, 4, 'Посмотри свою колоду и выбери карту. Она становится верхней.', {
      art: 'recon-drone.webp?v=neutral-palette-1',
      deploy: ability([{ action: 'choose-deck-top' }]),
    }],
    ['emp-grenade', 'ЭМИ-граната', 'bronze', 5, null, 'Сними всю броню с вражеского отряда. Нанеси 2 урона плюс число снятых единиц брони.', {
      removalReserve: 4,
      art: 'emp-grenade.webp?v=neutral-palette-1',
      type: 'effect',
      deploy: ability([
        { ...action('armor', chosen('enemy'), { stat: 'armor', scale: -1 }), save: 'armor' },
        action('damage', chosen('enemy'), { result: 'armor', base: 2 }),
      ], [choice('enemy', enemies, 'Выбери вражеский отряд для ЭМИ-гранаты.', { kind: 'emp' })]),
      keywords: ['Броня', 'Урон'],
    }],
    ['gravity-pulse', 'Гравитационный импульс', 'bronze', 7, null, 'Выбери вражеский ряд: сними 1 броню и нанеси 1 урон всем отрядам в нём.', {
      removalReserve: 4,
      art: 'gravity-pulse.webp?v=neutral-palette-1',
      type: 'effect', deploy: ability([
        { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для Гравитационного импульса.' },
        action('armor', { ...enemies, rowRef: 'row' }, -1),
        action('damage', { ...enemies, rowRef: 'row' }, 1),
      ]), keywords: ['Броня', 'Урон'],
    }],
    ['liaison', 'Связной', 'gold', 9, 4, 'Счётчик 4: возьми карту.', {
      art: 'liaison.webp?v=neutral-palette-1',
      counter: { amount: 4, effect: ability([{ action: 'draw', amount: 1 }]) },
      keywords: ['Счётчик'],
    }],
    ['field-medic', 'Полевой реаниматор', 'gold', 9, 3, 'Сыграй обычный отряд из своего сброса.', {
      art: 'field-medic.webp?v=neutral-palette-1',
      deploy: ability([{ action: 'play-from-discard', filter: { rarity: 'bronze' } }]),
    }],
    ['gate-relic', 'Реликт врат', 'gold', 9, null, 'Приказ (перезарядка 2): усиль свой отряд на 3.', {
      art: 'gate-relic.webp?v=neutral-palette-1',
      type: 'artifact', order: {
        ...ability([action('boost', chosen('ally'), 3)],
          [choice('ally', allies, 'Выбери свой отряд для усиления на 3.', { kind: 'boost' })]),
        cooldown: 2,
      }, keywords: ['Приказ', 'Усиление'],
    }],
    ['bounty-hunter', 'Охотник за головами', 'gold', 10, 4, 'Нанеси 6 урона вражескому отряду. Если он погиб от этого удара, усиль себя на 2.', {
      removalReserve: 5,
      art: 'bounty-hunter.webp?v=neutral-palette-1',
      deploy: ability([
        { ...action('damage', chosen('enemy'), 6), save: 'kill' },
        action('boost', self, { result: 'kill', scale: 2 }),
      ], [enemyChoice(6)]), keywords: ['Урон', 'Усиление'],
    }],
    ['world-gates', 'Врата Миров', 'gold', 11, null, 'Посмотри свою колоду, выбери любую карту и сыграй её.', {
      type: 'effect', art: 'world-gates.webp', accent: 'gate', deploy: ability([{ action: 'play-from-deck', fullDeck: true }]),
    }],
    ['falura', 'Фалура, Пепел звёзд', 'gold', 19, null,
      'Замени способность лидера до конца матча Приказом: нанести 2 урона выбранному вражескому отряду. Перезарядка 1 ход. Породи 2 Тени. Пока на твоём поле есть Тень, Приказ готов каждый твой ход.', {
        type: 'artifact', art: 'falura.webp', categories: ['Пустота'],
        deploy: ability([{ action: 'replace-leader', order: faluraOrder },
          { ...spawn('right', 'source', 2), card: SHADOW, overflow: true }]),
        keywords: ['Приказ', 'Урон', 'Порождение'],
      }],
    ['gate-guardian', 'Хранитель врат', 'gold', 10, 12, 'Броня 4. Уязвимость: отправь эту карту в сброс.', {
      art: 'gate-guardian.webp?v=neutral-palette-1',
      armor: 4, events: { 'armor-break': ability([action('discard', self)]) },
      keywords: ['Броня', 'Уязвимость'],
    }],
    ['resurrection', 'Воскрешение', 'gold', 9, null, 'Выбери и сыграй карту из своего сброса с провизией 10 или меньше либо Пожирателя падали.', {
      type: 'effect', art: 'resurrection.webp',
      deploy: ability([{ action: 'play-from-discard', filter: { anyType: true, maxProvision: 10, provisionException: 'carrion-devourer' },
        prompt: 'Выбери карту из сброса за 10 провизии или меньше либо Пожирателя падали.' }]),
    }],
    ['forgotten-gates', 'Врата Забвения', 'gold', 10, null,
      'При розыгрыше: призови слева случайный отряд за 4 провизии из своей колоды. В начале твоего второго хода после розыгрыша призови справа ещё один такой отряд.', {
        type: 'artifact', art: 'forgotten-gates.webp', timer: 2, keywords: ['Призыв', 'Соседи'],
        deploy: ability([summonFromDeck('left', 4)]),
        startTurn: ability([summonFromDeck('right', 4)]),
      }],
    ['storm-eye', 'Глаз бури', 'bronze', 5, null,
      'При розыгрыше: создай Псионную бурю над вражескими рядами. В начале каждого из твоих следующих 3 ходов она бьёт 3 раза на 1 урон по случайным вражеским отрядам. Цели могут повторяться. После третьего хода бури Кристалл ломается и наносит ещё 1 урон случайному вражескому отряду.', {
        type: 'artifact', art: 'storm-eye.webp', categories: ['Кристалл'], keywords: ['Псионная буря', 'Урон'],
        fieldAura: 'psionic-storm', timer: 3,
        startTurnPulse: ability([{ action: 'scatter', amount: 3, visual: 'lightning' }]),
        startTurn: ability([{ action: 'break', target: self }, { action: 'scatter', amount: 1, visual: 'lightning' }]),
      }],
    ['old-golem', 'Старый голем', 'epic', 9, 9, 'Силовой щит. После розыгрыша тобой любого Голема, включая эту карту, усиливается на 1, пока находится на поле.', {
      art: 'old-golem.webp?v=force-sphere-1', categories: ['Голем'], shield: true, keywords: ['Силовой щит', 'Усиление'],
      fieldEvents: { play: { friendly: true, category: 'Голем', ability: ability([action('boost', self, 1)]) } },
    }],
    ['fire-golem', 'Огненный голем', 'epic', 9, 5,
      'При розыгрыше: нанеси 4 урона выбранному другому отряду. Урон увеличивается на 1 за каждого Голема, которого ты разыграл ранее в этом матче.', {
        art: 'fire-golem.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([action('damage', chosen('victim'), golemDamage)],
          [choice('victim', { scope: 'field', type: 'unit', exclude: 'source' },
            'Выбери отряд для урона.', { kind: 'damage', amount: golemDamage })]),
    }],
    ['sleeping-mountain', 'Спящая гора', 'epic', 9, 17,
      'При розыгрыше: нанеси себе 10 урона. Урон снижается на 1 за каждого Голема, которого ты разыграл ранее в этом матче, до 0.', {
        art: 'sleeping-mountain.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([action('damage', self, mountainDamage)]),
    }],
    ['mystic-golem', 'Мистический голем', 'gold', 10, 4,
      'При розыгрыше: распредели 4 удара по 1 урону между случайными отрядами выбранного вражеского ряда. За каждого Голема, которого ты разыграл раньше в этом матче, добавь ещё один удар.', {
        art: 'mystic-golem.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([
          { action: 'select-row', ref: 'targetRow', filter: 'units', prompt: 'Выбери вражеский ряд для ударов Мистического голема.' },
          { action: 'scatter', rowRef: 'targetRow', amount: golemDamage, visual: 'lightning' },
        ]),
    }],
    ['carrion-devourer', 'Пожиратель падали', 'gold', 11, 1,
      'В начале каждого твоего хода увеличивает базовую силу на 1 в колоде, руке, на поле или в сбросе. Сохраняет её между раундами и при воскрешении.', {
        art: 'carrion-devourer.webp', categories: ['Зверь'], startTurnGrowth: 1,
      }],
    ['armor-piercing-shot', 'Бронебойный выстрел', 'bronze', 6, null,
      'Нанеси 6 урона вражескому отряду. Расправа: нанеси остаток урона другому вражескому отряду на твой выбор один раз.', {
        type: 'effect', art: 'armor-piercing-shot.webp', removalReserve: 5, keywords: ['Урон', 'Расправа'],
        deploy: ability([{
          ...action('damage', chosen('enemy'), 6),
          slay: {
            ...ability([action('damage', chosen('enemy'), { result: 'overflow' })], [{
              ...enemyChoice({ result: 'overflow' }), targets: { ...enemies, exclude: 'slain' },
            }]),
            requiresResult: 'overflow',
          },
        }], [enemyChoice(6)]),
      }],
  ].map(([id, name, rarity, provision, power, text, rules]) => Object.freeze({
    id, name, rarity, faction: NEUTRAL, provision, type: 'unit', ...(power === null ? {} : { power }), text, ...rules,
  })),
]);

const presetNeutrals = {
  protectorate: ['recon-drone', 'smuggler', 'gate-relic', 'gate-guardian'],
  growth: ['veteran-mercenary', 'gravity-pulse', 'liaison', 'field-medic'],
};

const infectedEnemies = { ...enemies, infected: true };
const rot = (row, amount, rowRef) => ({ action: 'row-effect', effect: 'rot', side: 'enemy', row, rowRef, amount });
const plague = [
  ['rot-midge', 'Гнилостная мошка', 4, 3, 'Рвение. Приказ: наложить Заражение 1 на выбранный вражеский отряд. Перезарядка: 2 хода.', {
    art: 'rot-midge.webp?v=plague-art-1',
    zeal: true,
    order: { cooldown: 2, ...ability([infect(chosen('enemy'), 1)], [infectionChoice(1)]) },
    keywords: ['Рвение', 'Приказ', 'Заражение'],
  }],
  ['plague-carrier', 'Разносчик', 5, 1, 'Играется на сторону противника. При розыгрыше: наложить Заражение 3 на своих соседей.', {
    art: 'plague-carrier.webp?v=plague-art-2',
    enemySide: true, deploy: ability([infect(adjacent, 3)]), keywords: ['Соседи', 'Заражение'],
  }],
  ['rot-scavenger', 'Падальщик гнили', 6, 3, 'При розыгрыше: усилить себя на 1 за каждый заражённый вражеский отряд.', {
    art: 'rot-scavenger.webp?v=plague-art-1',
    deploy: ability([action('boost', self, { count: infectedEnemies })]), keywords: ['Усиление', 'Заражение'],
  }],
  ['boil', 'Нарывник', 4, 3, 'Когда гибнет заражённый вражеский отряд, усилить себя на 2.', {
    art: 'boil.webp?v=plague-art-1',
    fieldEvents: { death: { enemy: true, infected: true, ability: ability([action('boost', self, 2)]) } },
    keywords: ['Усиление', 'Заражение'],
  }],
  ['rot', 'Гниение', 5, null, 'Наложить Гниение на выбранный вражеский ряд на 3 хода.', {
    art: 'rot.webp?v=plague-art-1',
    type: 'effect', deploy: ability([
      { action: 'select-row', ref: 'rotRow', filter: 'any', side: 'enemy', prompt: 'Выбери вражеский ряд для Гниения.' },
      rot(undefined, 3, 'rotRow'),
    ]), keywords: ['Гниение'],
  }],
  ['rot-giant', 'Гнилой исполин', 11, 3, 'Пока в колоде или руке: +1 к базовой силе за каждое первое Заражение вражеского отряда. При розыгрыше: 1 урон каждому заражённому вражескому отряду.', {
    art: 'rot-giant.webp?v=plague-art-1',
    rarity: 'gold',
    pileEvents: { 'first-infection': { enemy: true, ability: ability([action('base-power', self, 1)]) } },
    deploy: ability([action('damage', infectedEnemies, 1)]), keywords: ['Заражение', 'Урон'],
  }],
  ['pestilence', 'Мор', 11, null, 'Наложить Гниение на оба вражеских ряда на 3 хода.', {
    art: 'pestilence.webp?v=plague-art-1',
    rarity: 'gold', type: 'effect', deploy: ability([rot('all', 3)]), keywords: ['Гниение'],
  }],
  ['plague-burst', 'Чумной всплеск', 9, null, 'Нанести каждому заражённому вражескому отряду урон по его счётчику Заражения, затем снять с них Заражение.', {
    art: 'plague-burst.webp?v=plague-art-2',
    rarity: 'gold', type: 'effect', deploy: ability([
      { ...action('damage', infectedEnemies, { status: 'infection' }), saveTargets: 'infected' },
      infect({ scope: 'ref-set', ref: 'infected' }, { status: 'infection', scale: -1 }),
    ]), keywords: ['Заражение', 'Урон'],
  }],
  ['spore-season', 'Сезон спор', 12, null, 'Стойкость. Главы открываются по одной, когда ты разыгрываешь карту категории Гниль. Пролог: Заражение 2 случайному вражескому отряду. Глава 1: Заражение 2 двум случайным незаражённым вражеским отрядам. Глава 2: Гниение на сильнейший вражеский ряд на 2 хода. Глава 3: 2 урона всем заражённым вражеским отрядам.', {
    art: 'spore-season.webp?v=plague-art-2',
    rarity: 'gold', type: 'artifact', resilience: true, categories: [],
    scenario: {
      category: 'Гниль',
      prologue: ability([{ ...infect(enemies, 2), mode: 'random' }]),
      chapters: [
        ability([{ ...infect({ ...enemies, infected: false }, 2), count: 2, mode: 'random' }]),
        ability([rot('strongest', 2)]),
        ability([action('damage', infectedEnemies, 2)]),
      ],
    },
    keywords: ['Стойкость', 'Сценарий', 'Гниение', 'Заражение', 'Урон'],
  }],
];

const singleBronzes = {
  protectorate: ['shield-generator', 'orbital-shield', 'standard', 'warden', 'reinforcements'],
  growth: ['spore-sac', 'incubator', 'gulper', 'swarm-call'],
};

function factionCards(entries, faction) {
  return Object.freeze(entries.map(([id, name, provision, power, text, rules], index) => {
    const rarity = index < 11 ? 'bronze' : 'gold';
    const stats = power === null ? {} : { power };
    return Object.freeze({ id, name, provision, type: 'unit', text, rarity, faction, ...stats, ...rules });
  }));
}

function presetCards(pool, faction) {
  return Object.freeze([
    ...pool.filter(({ id }) => faction !== 'protectorate' || id !== 'orbital-shield')
      .flatMap((definition) => definition.rarity === 'bronze' && !singleBronzes[faction].includes(definition.id)
        ? [definition, definition] : [definition]),
    ...NEUTRAL_CARDS.filter(({ id }) => id === ANNIHILATION.id || presetNeutrals[faction].includes(id))
      .flatMap((definition) => faction === 'protectorate' && definition.id === 'recon-drone'
        ? [definition, definition] : [definition]),
  ]);
}

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

const growthLeaders = Object.freeze([
  {
    id: 'devourer', provisionBonus: 15, name: 'Пожиратель', art: 'devourer.webp?v=art-25', text: 'Поглотить свой отряд и передать удвоенную силу одному из его соседей.',
    ability: ability([
      absorb(chosen('victim'), { receiver: chosen('ally'), multiplier: 2 }),
    ], [
      choice('victim', allies, 'Выбери жертву для Пожирателя.', { kind: 'consume' }),
      choice('ally', { ...adjacent, of: 'victim' }, 'Выбери соседа, который получит удвоенную силу.', { kind: 'boost' }),
    ]),
  },
  {
    id: 'brood-mother', provisionBonus: 15, name: 'Матка', art: 'brood-mother.webp?v=art-25', text: 'Породить 3 личинки в выбранном своём ряду.',
    ability: ability([
      { action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для трёх личинок.' },
      { ...spawn('right', 'source', 3), rowRef: 'row' },
    ]),
  },
  {
    id: 'carrier', provisionBonus: 15, name: 'Носитель', art: 'carrier.webp?v=art-25', text: 'Наложить Заражение 3 на вражеский отряд и его соседей.',
    ability: ability([
      { ...action('status', chosen('enemy'), 3), status: 'infection' },
      { ...action('status', { ...adjacent, of: 'enemy' }, 3), status: 'infection' },
    ], [choice('enemy', enemies, 'Выбери вражеский отряд для Заражения 3 у него и его соседей.', { kind: 'infection' })]),
  },
]);

function faction(id, name, strategy, entries, leaders, extras = []) {
  const pool = factionCards(entries, id);
  return { name, strategy, pool: Object.freeze([...pool, ...factionCards(extras, id)]),
    deck: presetCards(pool, id), leader: leaders[0], leaders };
}

const plagueCards = plague.map(([cardId, label, provision, power, description, rules]) =>
  [cardId, label, provision, power, description, { categories: ['Гниль'], rarity: 'bronze', ...rules }]);

export const FACTIONS = Object.freeze({
  protectorate: faction('protectorate', 'Протекторат', 'Строй', protectorate, protectorateLeaders, protectorateExtras),
  growth: faction('growth', 'Поросль', 'Пожирание', growth, growthLeaders, plagueCards),
});
