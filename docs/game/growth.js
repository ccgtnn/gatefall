import { ability, action, adjacent, allies, choice, chosen, enemies, enemyChoice, self } from './card-abilities.js';

export const LARVA = Object.freeze({
  id: 'larva', name: 'Личинка', type: 'unit', power: 1, text: 'Обречённая.',
  art: 'larva.webp', aiHints: { boardBonus: .12, sacrificeBonus: .8 }, categories: ['Выводок'], doomed: true, token: true, keywords: ['Обречённость'],
});

const larvae = { ...allies, definitionId: LARVA.id };
const otherAlly = { ...allies, exclude: 'source' };
const spawn = (position, row = 'source', amount = 1) => ({ action: 'spawn', card: LARVA, position, row, amount });
const absorb = (target, options = {}) => ({ action: 'consume', target, receiver: self, ...options });
const infect = (target, amount) => ({ ...action('status', target, amount), status: 'infection' });
const infectionChoice = (amount) => choice('enemy', enemies,
  `Выбери врага для Заражения ${amount}.`, { kind: 'infection-target', amount });
const victimPower = { stat: 'power', ref: 'victim' };

const growth = [
  ['cocoon', 'Кокон', 4, 3, 'При розыгрыше: породить по личинке с каждой стороны. Завещание: усилить поглотившего на 2.',
    { art: 'cocoon.webp', categories: ['Выводок'], deploy: ability([spawn('left'), spawn('right')]),
      deathwish: ability([action('boost', chosen('consumer'), 2)]), keywords: ['Порождение', 'Завещание', 'Поглощение'] }],
  ['feast', 'Пиршество', 4, null, 'Породи 4 личинки в выбранном своём ряду.',
    { art: 'feast.webp', categories: ['Выводок'], type: 'effect', deploy: ability([
      { action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для четырёх личинок.' },
      { ...spawn('right', undefined, 4), rowRef: 'row' },
    ]), keywords: ['Порождение'] }],
  ['vine', 'Ползучая лоза', 4, 2, 'При розыгрыше: породить личинку на Орбите. Завещание: наложить Заражение 1 на три случайных вражеских отряда.',
    { art: 'vine.webp', categories: ['Росток'], deploy: ability([spawn('right', 'orbit')]),
      deathwish: ability([{ ...infect(enemies, 1), mode: 'random', count: 3 }]), keywords: ['Порождение', 'Завещание', 'Заражение'] }],
  ['spore-sac', 'Споровый мешок', 4, 4, 'Завещание: породить 3 личинки на месте погибшей карты.',
    { art: 'spore-sac.webp', categories: ['Росток'], deathwish: ability([spawn('death', 'death', 3)]), keywords: ['Завещание', 'Порождение'] }],
  ['incubator', 'Инкубатор', 7, null, 'Стойкость. В конце хода: породить личинку справа.',
    { type: 'artifact', rarity: 'epic', resilience: true, art: 'incubator.webp', categories: ['Выводок'], endTurn: ability([spawn('right')]), keywords: ['Стойкость', 'Порождение', 'Конец хода'] }],
  ['acid-gland', 'Кислотная железа', 4, 3, 'Завещание: наложить Заражение 4 на сильнейший вражеский отряд.',
    { art: 'acid-gland.webp', categories: ['Гниль'], deathwish: ability([{ ...infect({ ...enemies, strongest: true }, 4), mode: 'random' }]), keywords: ['Завещание', 'Заражение'] }],
  ['scavenger', 'Трупоед', 5, 3, 'Рвение. Приказ: поглотить другой свой отряд. Перезарядка: 2 хода.',
    { art: 'scavenger.webp', categories: ['Выводок'], zeal: true, order: {
      cooldown: 2,
      ...ability([absorb(chosen('victim'))],
        [choice('victim', otherAlly, 'Выбери другой свой отряд для поглощения.', { kind: 'consume' })]),
    }, keywords: ['Рвение', 'Приказ', 'Поглощение'] }],
  ['gulper', 'Пожиратель личинок', 6, 4, 'При розыгрыше: поглотить все личинки в своём ряду.',
    { art: 'gulper.webp', categories: ['Выводок'],
      aiHints: { placement: 'consume-row' }, deploy: ability([absorb({ ...larvae, row: 'source' })]), keywords: ['Поглощение'] }],
  ['spitter', 'Кислотный плевун', 5, 3, 'При розыгрыше: поглотить свою личинку и наложить Заражение 3 на выбранный вражеский отряд. Приказ: наложить Заражение 3 на выбранный вражеский отряд. Перезарядка: 2 хода.',
    { art: 'spitter.webp', categories: ['Гниль'],
      aiHints: { placement: 'consume-row' }, deploy: ability([absorb(chosen('victim')), infect(chosen('enemy'), 3)], [
      choice('victim', larvae, 'Выбери личинку для поглощения.', { kind: 'consume' }), infectionChoice(3),
    ]), order: { cooldown: 2, ...ability([infect(chosen('enemy'), 3)], [infectionChoice(3)]) },
      keywords: ['Поглощение', 'Заражение', 'Приказ'] }],
  ['predator', 'Хищный побег', 5, 4, 'Когда рядом кого-то поглощают: усилить себя на 2.',
    { art: 'predator.webp', categories: ['Росток'], neighborEvents: { consume: ability([action('boost', self, 2)]) }, keywords: ['Соседи', 'Поглощение', 'Усиление'] }],
  ['swarm-call', 'Зов роя', 5, null, 'Сыграй из колоды случайный обычный отряд Поросли и породи личинку рядом с ним.',
    { art: 'swarm-call.webp', categories: ['Выводок'], type: 'effect', deploy: ability([{ action: 'play-from-deck',
      filter: { rarity: 'bronze', faction: 'growth' }, after: spawn('right') }]), keywords: ['Порождение'] }],
  ['nest', 'Гнездо-мать', 9, 3, 'В конце хода: породить по личинке в каждом своём ряду.',
    { rarity: 'epic', art: 'nest.webp', categories: ['Выводок'], endTurn: ability([spawn('right', 'all')]), keywords: ['Порождение'] }],
  ['colossus', 'Колосс', 8, 5, 'При розыгрыше: поглотить всех своих соседей.',
    { art: 'colossus.webp', categories: ['Выводок'],
      aiHints: { placement: 'consume-neighbors' }, deploy: ability([absorb(adjacent)]), keywords: ['Соседи', 'Поглощение'] }],
  ['ravager', 'Выводок-разоритель', 9, 4, 'При розыгрыше: поглотить свой отряд и нанести урон врагу в размере силы жертвы.',
    { rarity: 'epic', art: 'ravager.webp', categories: ['Выводок'], deploy: ability([
      absorb(chosen('victim'), { multiplier: 0, save: 'strength' }),
      action('damage', chosen('enemy'), { result: 'strength' }),
    ], [
      choice('victim', otherAlly, 'Выбери отряд для поглощения.', { kind: 'consume' }), enemyChoice(victimPower),
    ]), keywords: ['Поглощение', 'Урон'] }],
  ['broodlord', 'Владыка выводка', 9, 4, 'При розыгрыше: поглоти всех личинок в своём ряду и получи удвоенную их силу.',
    { art: 'broodlord.webp', categories: ['Выводок'],
      aiHints: { handPotential: 11, placement: 'consume-row', preferRowWith: LARVA.id },
      deploy: ability([absorb({ ...allies, row: 'source', definitionId: LARVA.id }, { multiplier: 2, grouped: true })]),
      keywords: ['Поглощение'] }],
];

const infectedEnemies = { ...enemies, infected: true };
const rot = (row, amount, rowRef) => ({ action: 'row-effect', effect: 'rot', side: 'enemy', row, rowRef, amount });
const plague = [
  ['rot-midge', 'Гнилостная мошка', 4, 3, 'Рвение. Приказ: наложить Заражение 1 на выбранный вражеский отряд. Перезарядка: 2 хода.', {
    art: 'rot-midge.webp',
    zeal: true,
    order: { cooldown: 2, ...ability([infect(chosen('enemy'), 1)], [infectionChoice(1)]) },
    keywords: ['Рвение', 'Приказ', 'Заражение'],
  }],
  ['plague-carrier', 'Разносчик', 5, 1, 'Играется на сторону противника. При розыгрыше: наложи Заражение 3 на своих соседей и Заражение 1 на себя.', {
    art: 'plague-carrier.webp',
    enemySide: true, deploy: ability([infect(adjacent, 3), infect(self, 1)]), keywords: ['Соседи', 'Заражение'],
  }],
  ['rot-scavenger', 'Падальщик гнили', 4, 3, 'При розыгрыше: усилить себя на 1 за каждый заражённый вражеский отряд.', {
    art: 'rot-scavenger.webp',
    deploy: ability([action('boost', self, { count: infectedEnemies })]), keywords: ['Усиление', 'Заражение'],
  }],
  ['boil', 'Нарывник', 4, 3, 'Когда гибнет заражённый вражеский отряд, усилить себя на 2.', {
    art: 'boil.webp',
    fieldEvents: { death: { enemy: true, infected: true, ability: ability([action('boost', self, 2)]) } },
    keywords: ['Усиление', 'Заражение'],
  }],
  ['rot', 'Гниение', 4, null, 'Наложить Гниение на выбранный вражеский ряд на 3 хода.', {
    art: 'rot.webp',
    type: 'effect', deploy: ability([
      { action: 'select-row', ref: 'rotRow', filter: 'any', side: 'enemy', prompt: 'Выбери вражеский ряд для Гниения.' },
      rot(undefined, 3, 'rotRow'),
    ]), keywords: ['Гниение'],
  }],
  ['rot-giant', 'Гнилой исполин', 11, 3, 'Пока в колоде или руке: +1 к базовой силе за каждое первое Заражение вражеского отряда. При розыгрыше: 1 урон каждому заражённому вражескому отряду.', {
    art: 'rot-giant.webp',
    rarity: 'gold',
    pileEvents: { 'first-infection': { enemy: true, ability: ability([action('base-power', self, 1)]) } },
    deploy: ability([action('damage', infectedEnemies, 1)]), keywords: ['Заражение', 'Урон'],
  }],
  ['pestilence', 'Мор', 9, null, 'Наложить Гниение на оба вражеских ряда на 3 хода.', {
    art: 'pestilence.webp',
    rarity: 'gold', type: 'effect', deploy: ability([rot('all', 3)]), keywords: ['Гниение'],
  }],
  ['plague-burst', 'Чумной всплеск', 7, null, 'Увеличь Заражение на 2 у всех уже заражённых отрядов на обеих сторонах поля.', {
    art: 'plague-burst.webp',
    rarity: 'epic', type: 'effect',
    deploy: ability([infect({ scope: 'field', type: 'unit', infected: true }, 2)]), keywords: ['Заражение'],
  }],
  ['spore-season', 'Сезон спор', 12, null, 'Стойкость. Главы открываются по одной, когда ты разыгрываешь карту категории Гниль. Пролог: Заражение 2 случайному вражескому отряду. Глава 1: Заражение 2 двум случайным незаражённым вражеским отрядам. Глава 2: Гниение на сильнейший вражеский ряд на 2 хода. Глава 3: 2 урона всем заражённым вражеским отрядам.', {
    art: 'spore-season.webp',
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

const rebirth = [
  ['thorn-screecher', 'Шипастый крикун', 4, 3, 'Завещание: призови из своей колоды Шипастого крикуна, если он там есть.', {
    art: 'thorn-screecher.webp',
    deathwish: ability([{ action: 'summon-from-deck', position: 'death', filter: { definitionId: 'thorn-screecher' } }]),
  }],
  ['synaptic-parasite', 'Синаптический паразит', 5, 4,
    'При розыгрыше: выбери свою обычную карту с Завещанием на поле и активируй её Завещание. Карта остаётся на поле.', {
      art: 'synaptic-parasite.webp', keywords: ['Завещание'],
      deploy: ability([action('activate-deathwish', chosen('ally'))],
        [choice('ally', { scope: 'ally', rarity: 'bronze', deathwish: true }, 'Выбери обычную карту, чьё Завещание сработает.', { kind: 'deathwish' })]),
    }],
  ['acid-capsule', 'Кислотная капсула', 5, 3, 'Завещание: нанеси 5 урона случайному вражескому отряду.', {
    art: 'acid-capsule.webp', keywords: ['Урон'],
    deathwish: ability([{ ...action('damage', enemies, 5), mode: 'random' }]),
  }],
  ['xylaris-bloom', 'Цветение Ксилларис', 8, 4, 'Завещание: уничтожь слабейший вражеский отряд. При равенстве выбери случайного из слабейших.', {
    art: 'xylaris-bloom.webp', rarity: 'epic', keywords: ['Уничтожение'],
    deathwish: ability([{ ...action('destroy', { ...enemies, weakest: true }), mode: 'random' }]),
  }],
  ['bioreactor', 'Биореактор', 11, 4, 'Неуязвимость. При розыгрыше: поочерёдно поглоти до 3 других своих отрядов, выбирая их по одному.', {
    art: 'bioreactor.webp', rarity: 'gold', immune: true, keywords: ['Неуязвимость', 'Поглощение'],
    deploy: ability([1, 2, 3].flatMap((number) => {
      const ref = 'victim' + number;
      return [
        { action: 'choose-unit', ref, target: otherAlly, kind: 'consume', prompt: `Поглощение ${number} из 3. Выбери свой отряд.` },
        absorb(chosen(ref)),
      ];
    })),
  }],
  ['genome-keeper', 'Хранитель генома', 13, 1, 'При розыгрыше: получи все уникальные Завещания обычных карт из своего сброса.', {
    art: 'genome-keeper.webp', categories: [], rarity: 'gold', keywords: ['Завещание'],
    deploy: ability([{ action: 'inherit-deathwishes' }]),
  }],
].map(([id, name, provision, power, text, rules]) =>
  [id, name, provision, power, text, { categories: ['Росток'], rarity: 'bronze', ...rules }]);

const growthLeaders = Object.freeze([
  {
    id: 'devourer', provisionBonus: 15, name: 'Пожиратель', art: 'devourer.webp', text: 'Поглотить свой отряд и передать удвоенную силу одному из его соседей.',
    ability: ability([
      absorb(chosen('victim'), { receiver: chosen('ally'), multiplier: 2 }),
    ], [
      choice('victim', allies, 'Выбери жертву для Пожирателя.', { kind: 'consume' }),
      choice('ally', { ...adjacent, of: 'victim' }, 'Выбери соседа, который получит удвоенную силу.', { kind: 'boost' }),
    ]),
  },
  {
    id: 'brood-mother', provisionBonus: 15, name: 'Матка', art: 'brood-mother.webp', text: 'Породить 3 личинки в выбранном своём ряду.',
    ability: ability([
      { action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для трёх личинок.' },
      { ...spawn('right', 'source', 3), rowRef: 'row' },
    ]),
  },
  {
    id: 'carrier', provisionBonus: 15, name: 'Носитель', art: 'carrier.webp', text: 'Наложить Заражение 3 на вражеский отряд и его соседей.',
    ability: ability([
      { ...action('status', chosen('enemy'), 3), status: 'infection' },
      { ...action('status', { ...adjacent, of: 'enemy' }, 3), status: 'infection' },
    ], [choice('enemy', enemies, 'Выбери вражеский отряд для Заражения 3 у него и его соседей.', { kind: 'infection' })]),
  },
]);

const plagueCards = plague.map(([cardId, label, provision, power, description, rules]) =>
  [cardId, label, provision, power, description, { categories: ['Гниль'], rarity: 'bronze', ...rules }]);

export const GROWTH = {
  name: 'Поросль', strategy: 'Пожирание', entries: growth, leaders: growthLeaders, extras: [...plagueCards, ...rebirth],
};
