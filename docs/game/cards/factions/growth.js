import { ability, action, adjacent, allies, choice, chosen, enemies, enemyChoice, self } from '../card-abilities.js';

export const LARVA = Object.freeze({
  id: 'larva', name: 'Личинка', type: 'unit', power: 1, text: 'Обречённая.',
  art: 'larva.webp', aiHints: { boardBonus: .12, sacrificeBonus: .8 }, categories: ['Выводок'], doomed: true, token: true, keywords: ['Обречённость'],
});

export const DEVOURER_SPAWN = Object.freeze({
  id: 'devourer-spawn', name: 'Порождение пожирателя', faction: 'growth', type: 'unit',
  token: true, rarity: 'bronze', power: 0, provision: 0,
  art: 'devourer-spawn.webp', artCrop: 'devourer-spawn-crop.webp',
});

const larvae = { ...allies, definitionId: LARVA.id };
const otherAlly = { ...allies, exclude: 'source' };
const spawn = (position, row = 'source', amount = 1) => ({ action: 'spawn', card: LARVA, position, row, amount });
const absorb = (target, options = {}) => ({ action: 'consume', target, receiver: self, ...options });
const infect = (target, amount) => ({ ...action('status', target, amount), status: 'infection' });
const infectionChoice = (amount) => choice('enemy', enemies,
  `Выбери врага для Заражения ${amount}.`, { kind: 'infection-target', amount });
const victimPower = { stat: 'power', ref: 'victim' };

const grow = ability([action('advance-growth', self, 1)]);
const grownValue = { growth: true, base: 1 };
const deathSpawn = (amount = 1) => spawn('death', 'death', amount);
const chooseLarvaRow = (amount, prompt) => ability([
  { action: 'select-row', ref: 'row', filter: 'space', prompt },
  { ...spawn('right', undefined, amount), rowRef: 'row' },
]);
const acidGland = Object.freeze({
  id: 'acid-gland', name: 'Кислотная железа', faction: 'growth', type: 'unit',
  power: 2, provision: 4, rarity: 'bronze', art: 'acid-gland.webp', categories: ['Гниль'],
  text: 'Завещание: наложи Заражение 4 на сильнейший вражеский отряд.',
  deathwish: ability([{ ...infect({ ...enemies, strongest: true }, 4), mode: 'random' }]), keywords: ['Завещание', 'Заражение'],
});
const rotRow = ability([
  { action: 'select-row', ref: 'rotRow', filter: 'any', side: 'enemy', prompt: 'Выбери вражеский ряд для Гниения.' },
  { action: 'row-effect', effect: 'rot', side: 'enemy', rowRef: 'rotRow', amount: 3 },
]);

const growth = [
  {
    id: 'cocoon', name: 'Кокон', provision: 4, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: породи по личинке с каждой стороны. Завещание: породи 2 личинки.',
    art: 'cocoon.webp',
    categories: ['Выводок'],
    deploy: ability([spawn('left'), spawn('right')]),
    deathwish: ability([deathSpawn(2)]),
    keywords: ['Порождение', 'Завещание'],
  },
  {
    id: 'feast', name: 'Пиршество', provision: 4,
    type: 'effect', rarity: 'bronze', faction: 'growth',
    text: 'Породи 4 личинки в выбранном своём ряду.',
    art: 'feast.webp',
    categories: ['Выводок'],
    deploy: ability([
      { action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для четырёх личинок.' },
      { ...spawn('right', undefined, 4), rowRef: 'row' },
    ]),
    keywords: ['Порождение'],
  },
  {
    id: 'vine', name: 'Ползучая лоза', provision: 6, power: 2,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'В конце твоего хода: увеличь n на 1. Завещание: наложи Заражение 2 на 1 + n случайных вражеских отрядов.',
    art: 'vine.webp',
    categories: ['Росток'],
    growth: { label: 'n' },
    endTurn: grow,
    deathwish: ability([{ ...infect(enemies, 2), mode: 'random', count: grownValue }]),
    keywords: ['Конец хода', 'Завещание', 'Заражение'],
  },
  {
    id: 'spore-sac', name: 'Споровый мешок', provision: 4, power: 1,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Броня 1. Завещание: породи личинку. В конце твоего хода: увеличь силу будущей личинки на 1.',
    art: 'spore-sac.webp',
    armor: 1,
    categories: ['Росток'],
    growth: { label: 'Сила будущей личинки', base: 1 },
    endTurn: grow,
    deathwish: ability([{ ...deathSpawn(), power: grownValue }]),
    keywords: ['Броня', 'Завещание', 'Порождение', 'Конец хода'],
  },
  {
    id: 'incubator', name: 'Инкубатор', provision: 7,
    type: 'artifact', rarity: 'epic', faction: 'growth',
    text: 'Стойкость. В конце твоего хода: породи личинку справа. Приказ: породи 2 личинки в выбранном своём ряду.',
    resilience: true,
    art: 'incubator.webp',
    categories: ['Выводок'],
    endTurn: ability([spawn('right')]),
    aiHints: { useOrderWhenReady: true },
    order: { oncePerTurn: true, ...chooseLarvaRow(2, 'Выбери свой ряд для двух личинок.') },
    keywords: ['Стойкость', 'Порождение', 'Конец хода', 'Приказ'],
  },
  { ...acidGland },
  {
    id: 'scavenger', name: 'Трупоед', provision: 5, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Рвение. Приказ: поглоти выбранный другой свой отряд. Перезарядка: 2 хода.',
    art: 'scavenger.webp',
    categories: ['Выводок'],
    zeal: true,
    order: {
      cooldown: 2,
      ...ability([absorb(chosen('victim'))],
        [choice('victim', otherAlly, 'Выбери другой свой отряд для поглощения.', { kind: 'consume' })]),
    },
    keywords: ['Рвение', 'Приказ', 'Поглощение'],
  },
  {
    id: 'gulper', name: 'Пожиратель личинок', provision: 6, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: поглоти всех личинок в своём ряду.',
    art: 'gulper.webp',
    categories: ['Выводок'],
    aiHints: { placement: 'consume-row' },
    deploy: ability([absorb({ ...larvae, row: 'source' })]),
    keywords: ['Поглощение'],
  },
  {
    id: 'spitter', name: 'Кислотный плевун', provision: 5, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: поглоти выбранную свою личинку и наложи Заражение 3 на выбранный вражеский отряд. Приказ: наложи Заражение 3 на выбранный вражеский отряд. Перезарядка: 2 хода.',
    art: 'spitter.webp',
    categories: ['Гниль'],
    aiHints: { placement: 'consume-row' },
    deploy: ability([absorb(chosen('victim')), infect(chosen('enemy'), 3)], [
      choice('victim', larvae, 'Выбери личинку для поглощения.', { kind: 'consume' }), infectionChoice(3),
    ]),
    order: { cooldown: 2, ...ability([infect(chosen('enemy'), 3)], [infectionChoice(3)]) },
    keywords: ['Поглощение', 'Заражение', 'Приказ'],
  },
  {
    id: 'predator', name: 'Хищный побег', provision: 5, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: поглоти выбранный свой отряд.',
    art: 'predator.webp',
    categories: ['Росток'],
    deploy: ability([absorb(chosen('victim'))],
      [choice('victim', otherAlly, 'Выбери свой отряд для поглощения.', { kind: 'consume' })]),
    keywords: ['Поглощение'],
  },
  {
    id: 'swarm-call', name: 'Зов роя', provision: 5,
    type: 'effect', rarity: 'bronze', faction: 'growth',
    text: 'Сыграй из колоды случайный обычный отряд Поросли и породи личинку справа от него.',
    art: 'swarm-call.webp',
    categories: ['Выводок'],
    deploy: ability([{ action: 'play-from-deck',
    filter: { rarity: 'bronze', faction: 'growth' }, after: spawn('right') }]),
    keywords: ['Порождение'],
  },
  {
    id: 'nest', name: 'Гнездо-мать', provision: 9, power: 3,
    type: 'unit', rarity: 'epic', faction: 'growth',
    text: 'В конце твоего хода: породи по личинке в каждом своём ряду.',
    art: 'nest.webp',
    categories: ['Выводок'],
    endTurn: ability([spawn('right', 'all')]),
    keywords: ['Порождение'],
  },
  {
    id: 'colossus', name: 'Колосс', provision: 8, power: 5,
    type: 'unit', rarity: 'gold', faction: 'growth',
    text: 'При розыгрыше: поглоти всех своих соседей.',
    art: 'colossus.webp',
    categories: ['Выводок'],
    aiHints: { placement: 'consume-neighbors' },
    deploy: ability([absorb(adjacent)]),
    keywords: ['Соседи', 'Поглощение'],
  },
  {
    id: 'ravager', name: 'Выводок-разоритель', provision: 9, power: 4,
    type: 'unit', rarity: 'epic', faction: 'growth',
    text: 'При розыгрыше: поглоти выбранный другой свой отряд и нанеси выбранному вражескому отряду урон, равный силе жертвы.',
    art: 'ravager.webp',
    categories: ['Выводок'],
    deploy: ability([
      absorb(chosen('victim'), { multiplier: 0, save: 'strength' }),
      action('damage', chosen('enemy'), { result: 'strength' }),
    ], [
      choice('victim', otherAlly, 'Выбери отряд для поглощения.', { kind: 'consume' }), enemyChoice(victimPower),
    ]),
    keywords: ['Поглощение', 'Урон'],
  },
  {
    id: 'broodlord', name: 'Владыка выводка', provision: 10, power: 4,
    type: 'unit', rarity: 'gold', faction: 'growth',
    text: 'При розыгрыше: поглоти всех личинок в своём ряду и получи удвоенную их силу.',
    art: 'broodlord.webp',
    categories: ['Выводок'],
    aiHints: { handPotential: 11, placement: 'consume-row', preferRowWith: LARVA.id },
    deploy: ability([absorb({ ...allies, row: 'source', definitionId: LARVA.id }, { multiplier: 2, grouped: true })]),
    keywords: ['Поглощение'],
  },
];

const infectedEnemies = { ...enemies, infected: true };
const rot = (row, amount, rowRef) => ({ action: 'row-effect', effect: 'rot', side: 'enemy', row, rowRef, amount });
const plague = [
  {
    id: 'rot-midge', name: 'Гнилостная мошка', provision: 4, power: 3,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Рвение. Приказ: наложи Заражение 2 на выбранный вражеский отряд. Перезарядка: 2 хода.',
    categories: ['Гниль'],
    art: 'rot-midge.webp',
    zeal: true,
    order: { cooldown: 2, ...ability([infect(chosen('enemy'), 2)], [infectionChoice(2)]) },
    keywords: ['Рвение', 'Приказ', 'Заражение'],
  },
  {
    id: 'plague-carrier', name: 'Разносчик', provision: 5, power: 1,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Играется на сторону противника. При розыгрыше: наложи Заражение 3 на своих соседей и Заражение 1 на себя.',
    categories: ['Гниль'],
    art: 'plague-carrier.webp',
    enemySide: true,
    deploy: ability([infect(adjacent, 3), infect(self, 1)]),
    keywords: ['Соседи', 'Заражение'],
  },
  {
    id: 'rot-scavenger', name: 'Падальщик гнили', provision: 4, power: 5,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: усиль себя на 1 за каждый заражённый вражеский отряд.',
    categories: ['Гниль'],
    art: 'rot-scavenger.webp',
    deploy: ability([action('boost', self, { count: infectedEnemies })]),
    keywords: ['Усиление', 'Заражение'],
  },
  {
    id: 'boil', name: 'Нарывник', provision: 4, power: 1,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Броня 1. В конце твоего хода: усиль себя на 1. Уязвимость: погибает и оставляет на своём месте 3 личинки.',
    categories: ['Гниль'],
    art: 'boil.webp',
    artCrop: 'boil-crop.webp',
    armor: 1,
    endTurn: ability([action('boost', self, 1)]),
    events: { 'armor-break': { ...ability([action('kill', self), deathSpawn(3)]), survivesSource: true } },
    keywords: ['Броня', 'Конец хода', 'Усиление', 'Уязвимость', 'Порождение'],
  },
  {
    id: 'infected-carcass', name: 'Заражённая туша', faction: 'growth', type: 'unit',
    rarity: 'bronze', provision: 5, power: 5,
    art: 'infected-carcass.webp', artCrop: 'infected-carcass-crop.webp',
    text: 'Завещание: наложи Заражение 2 на 2 случайных вражеских отряда.',
    keywords: ['Завещание', 'Заражение'],
    aiHints: { sacrificeBonus: 1.5 },
    deathwish: ability([{ ...infect(enemies, 2), mode: 'random', count: 2 }]),
  },
  {
    id: 'rot', name: 'Гниение', provision: 4,
    type: 'effect', rarity: 'bronze', faction: 'growth',
    text: 'Наложи Гниение на выбранный вражеский ряд на 3 хода.',
    categories: ['Гниль'],
    art: 'rot.webp',
    deploy: rotRow,
    keywords: ['Гниение'],
  },
  {
    id: 'rot-giant', name: 'Гнилой исполин', provision: 11, power: 3,
    type: 'unit', rarity: 'gold', faction: 'growth',
    text: 'Пока в колоде или руке: +1 к базовой силе за каждое первое Заражение вражеского отряда. При розыгрыше: нанеси 1 урон каждому заражённому вражескому отряду.',
    categories: ['Гниль'],
    art: 'rot-giant.webp',
    pileEvents: { 'first-infection': { enemy: true, ability: ability([action('base-power', self, 1)]) } },
    deploy: ability([action('damage', infectedEnemies, 1)]),
    keywords: ['Заражение', 'Урон'],
  },
  {
    id: 'pestilence', name: 'Мор', provision: 8,
    type: 'effect', rarity: 'gold', faction: 'growth',
    text: 'Наложи Гниение на оба вражеских ряда на 3 хода.',
    categories: ['Гниль'],
    art: 'pestilence.webp',
    deploy: ability([rot('all', 3)]),
    keywords: ['Гниение'],
  },
  {
    id: 'plague-burst', name: 'Чумной всплеск', provision: 7,
    type: 'effect', rarity: 'epic', faction: 'growth',
    text: 'Увеличь Заражение на 3 у всех уже заражённых отрядов на обеих сторонах поля.',
    categories: ['Гниль'],
    art: 'plague-burst.webp',
    deploy: ability([infect({ scope: 'field', type: 'unit', infected: true }, 3)]),
    keywords: ['Заражение'],
  },
  {
    id: 'spore-season', name: 'Сезон спор', provision: 12,
    type: 'artifact', rarity: 'gold', faction: 'growth',
    text: [
      'Главы открываются по одной, когда ты разыгрываешь карту категории Гниль.',
      'Пролог: призови по Кислотной железе слева и справа.',
      'Глава 1: наложи Гниение на выбранный вражеский ряд на 3 хода.',
      'Глава 2: нанеси 2 урона всем заражённым вражеским отрядам.',
    ].join('\n'),
    art: 'spore-season.webp',
    categories: [],
    scenario: {
      category: 'Гниль',
      prologue: ability(['left', 'right'].map((position) => ({ ...spawn(position), card: acidGland }))),
      chapters: [rotRow, ability([action('damage', infectedEnemies, 2)])],
    },
    keywords: ['Сценарий', 'Порождение', 'Гниение', 'Урон'],
  },
];

const rebirth = [
  {
    id: 'thorn-screecher', name: 'Шипастый крикун', provision: 4, power: 5,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Завещание: призови из своей колоды Шипастого крикуна, если он там есть.',
    categories: ['Росток'],
    art: 'thorn-screecher.webp',
    deathwish: ability([{ action: 'summon-from-deck', position: 'death', filter: { definitionId: 'thorn-screecher' } }]),
  },
  {
    id: 'synaptic-parasite', name: 'Синаптический паразит', provision: 5, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'При розыгрыше: выбери свою обычную карту с Завещанием на поле и активируй её Завещание. Карта остаётся на поле.',
    categories: ['Росток'],
    art: 'synaptic-parasite.webp',
    keywords: ['Завещание'],
    deploy: ability([action('activate-deathwish', chosen('ally'))],
      [choice('ally', { scope: 'ally', rarity: 'bronze', deathwish: true }, 'Выбери обычную карту, чьё Завещание сработает.', { kind: 'deathwish' })]),
  },
  {
    id: 'acid-capsule', name: 'Кислотная капсула', provision: 5, power: 4,
    type: 'unit', rarity: 'bronze', faction: 'growth',
    text: 'Завещание: нанеси 5 урона случайному вражескому отряду.',
    categories: ['Росток'],
    art: 'acid-capsule.webp',
    keywords: ['Урон'],
    deathwish: ability([{ ...action('damage', enemies, 5), mode: 'random' }]),
  },
  {
    id: 'xylaris-bloom', name: 'Цветение Ксилларис', provision: 8, power: 4,
    type: 'unit', rarity: 'epic', faction: 'growth',
    text: 'Завещание: уничтожь слабейший вражеский отряд. При равенстве выбери случайного из слабейших.',
    categories: ['Росток'],
    art: 'xylaris-bloom.webp',
    keywords: ['Уничтожение'],
    deathwish: ability([{ ...action('destroy', { ...enemies, weakest: true }), mode: 'random' }]),
  },
  {
    id: 'bioreactor', name: 'Биореактор', provision: 8, power: 3,
    type: 'unit', rarity: 'gold', faction: 'growth',
    text: 'Неуязвимость. При розыгрыше: поочерёдно поглоти 3 других своих отрядов, выбирая их по одному.',
    categories: ['Росток'],
    art: 'bioreactor.webp',
    immune: true,
    keywords: ['Неуязвимость', 'Поглощение'],
    deploy: ability([1, 2, 3].flatMap((number) => {
      const ref = 'victim' + number;
      return [
        { action: 'choose-unit', ref, target: otherAlly, kind: 'consume', prompt: `Поглощение ${number} из 3. Выбери свой отряд.` },
        absorb(chosen(ref)),
      ];
    })),
  },
  {
    id: 'genome-keeper', name: 'Хранитель генома', provision: 13, power: 1,
    type: 'unit', rarity: 'gold', faction: 'growth',
    text: 'При розыгрыше: получи все уникальные Завещания обычных карт из своего сброса.',
    art: 'genome-keeper.webp',
    categories: [],
    keywords: ['Завещание'],
    deploy: ability([{ action: 'inherit-deathwishes' }]),
  },
];

const growthLeaders = Object.freeze([
  {
    id: 'devourer', provisionBonus: 15, name: 'Пожиратель', art: 'devourer.webp', charges: 3,
    text: 'Приказ (3 заряда): поглоти свой отряд. На его месте призови Порождение пожирателя с силой поглощённого отряда.',
    order: { cooldown: 0, usesCharges: true },
    aiHints: { leaderConsume: true, leaderChargeValue: 2 },
    ability: ability([{ action: 'consume', target: chosen('victim'), replacement: DEVOURER_SPAWN }],
      [choice('victim', allies, 'Выбери жертву для Пожирателя.', { kind: 'consume' })]),
  },
  {
    id: 'brood-mother', provisionBonus: 15, name: 'Матка', art: 'brood-mother.webp', charges: 5,
    text: 'Приказ (5 зарядов): породи личинку в выбранном своём ряду.',
    order: { cooldown: 0, usesCharges: true },
    aiHints: { leaderSpawn: true },
    ability: chooseLarvaRow(1, 'Выбери свой ряд для личинки Матки.'),
  },
  {
    id: 'carrier', provisionBonus: 15, name: 'Носитель', art: 'carrier.webp', keywords: ['Заражение'], charges: 1, order: { cooldown: 0, usesCharges: true }, text: 'Приказ (1 заряд): наложи Заражение 3 на выбранный вражеский отряд и его соседей.',
    aiHints: { leaderChargeValue: 4 },
    ability: ability([
      { ...action('status', chosen('enemy'), 3), status: 'infection' },
      { ...action('status', { ...adjacent, of: 'enemy' }, 3), status: 'infection' },
    ], [choice('enemy', enemies, 'Выбери вражеский отряд для Заражения 3 у него и его соседей.', { kind: 'infection' })]),
  },
]);

export const GROWTH = {
  name: 'Поросль', strategy: 'Пожирание', entries: growth, leaders: growthLeaders, extras: [...plague, ...rebirth],
};
