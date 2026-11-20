export const ROWS = Object.freeze(['orbit', 'surface']);

export const ROW_LABELS = Object.freeze({
  orbit: 'Орбита',
  surface: 'Поверхность',
});

export const CARD_TYPES = Object.freeze({ unit: 'Отряд', effect: 'Эффект', artifact: 'Артефакт' });
export const RARITY_LABELS = Object.freeze({ bronze: 'Бронза', gold: 'Золото' });
export const KEYWORDS = Object.freeze({
  'Урон': 'Сначала снимает броню, затем силу. Отряд с нулевой силой гибнет.',
  'Броня': 'Каждая единица поглощает 1 урон.',
  'Усиление': 'Увеличивает текущую силу отряда.',
  'Порождение': 'Добавляет новую карту в ряд, если есть место.',
  'Поглощение': 'Своя жертва гибнет, её текущая сила переходит поглотившему, если карта не задаёт иное.',
  'Уничтожение': 'Удаляет карту из игры без Завещания.',
  'Завещание': 'Срабатывает при гибели от урона, поглощения или таймера.',
  'Обречённость': 'При гибели карта уходит из игры, а её Завещание срабатывает.',
  'Приказ': 'Готов со следующего хода владельца. После применения в этом ходу нельзя пасовать.',
  'Рвение': 'Приказ готов сразу после появления карты на поле.',
  'Соседи': 'Две ближайшие позиции слева и справа в том же ряду. Артефакты тоже занимают позиции.',
  'Конец хода': 'Эффект срабатывает в конце хода владельца карты, в том числе после паса.',
  'Таймер': 'Считается в конце твоего хода, включая ход розыгрыша и пас.',
});

export const LARVA = Object.freeze({
  id: 'larva', name: 'Личинка', type: 'unit', power: 1, text: 'Обречённая.',
  doomed: true, token: true, keywords: ['Обречённость'],
});

const self = { scope: 'source' };
const adjacent = { scope: 'neighbors', type: 'unit' };
const allies = { scope: 'ally', type: 'unit' };
const enemies = { scope: 'enemy', type: 'unit' };
const larvae = { ...allies, token: true };
const otherAlly = { ...allies, exclude: 'source' };
const allyRow = { ...allies, row: 'source' };
const chosen = (ref) => ({ scope: 'ref', ref });
const action = (action, target, amount) => ({ action, target, amount });
const ability = (steps, select = []) => ({ steps, select });
const choice = (ref, targets, prompt, hint) => ({ ref, targets, prompt, ...hint });
const enemyChoice = (amount) => choice('enemy', enemies,
  'Выбери врага для урона.', { kind: 'damage', amount });
const spawn = (position, row = 'source', amount = 1) => ({ action: 'spawn', card: LARVA, position, row, amount });
const absorb = (target, options = {}) => ({ action: 'consume', target, receiver: self, ...options });
const armorNeighbors = (amount) => ability([action('armor', adjacent, amount)]);
const randomEnemy = choice('enemy', enemies, '', { mode: 'random' });
const armorRemoved = { result: 'armor' };
const victimPower = { stat: 'power', ref: 'victim' };
const salvoDamage = { row: 'surface', then: 5, otherwise: 3 };

export const FIRST_SIGNAL = Object.freeze({
  id: 'first-signal', name: 'Первый сигнал', type: 'artifact', stratagem: true, token: true,
  zeal: true, doomed: true,
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
  ['infantry', 'Пехотинец линии', 4, 2, 'При розыгрыше: соседи получают 1 броню.',
    { art: 'infantry.webp', deploy: armorNeighbors(1), keywords: ['Броня', 'Соседи'] }],
  ['engineer', 'Инженер укреплений', 5, 3, 'При розыгрыше: дать 3 брони своей карте.',
    { art: 'engineer.webp', deploy: ability([action('armor', chosen('ally'), 3)],
      [choice('ally', allies, 'Выбери свой отряд для 3 брони.', { kind: 'armor' })]), keywords: ['Броня'] }],
  ['assault', 'Тяжёлый штурмовик', 5, 5, 'Броня 3.', { art: 'assault.webp', armor: 3, keywords: ['Броня'] }],
  ['orbital-shield', 'Орбитальный щит', 6, 4, 'В конце хода: дать 1 броню соседям.',
    { endTurn: armorNeighbors(1), keywords: ['Броня', 'Соседи'] }],
  ['standard', 'Знаменосец', 6, 4, 'При розыгрыше: усилить бронированных соседей на 2.',
    { art: 'standard.webp', deploy: ability([action('boost', { ...adjacent, armorAtLeast: 1 }, 2)]), keywords: ['Усиление', 'Броня', 'Соседи'] }],
  ['warden', 'Страж врат', 6, 6, 'Броня 4. Нельзя сдвинуть.', { armor: 4, immovable: true, keywords: ['Броня'] }],
  ['anvil', 'Таран «Наковальня»', 6, 4, 'При розыгрыше: снять всю броню со своей карты и нанести столько же урона вражеской.',
    { deploy: ability([
      { action: 'armor', target: chosen('payer'), amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('damage', chosen('enemy'), armorRemoved),
    ], [
      choice('payer', { ...allies, armorAtLeast: 1 }, 'Выбери свою карту, с которой снять всю броню.', { kind: 'spend-armor' }),
      enemyChoice({ stat: 'armor', ref: 'payer' }),
    ]), keywords: ['Броня', 'Урон'] }],
  ['smelter', 'Переплавщик', 5, 3, 'При розыгрыше: снять броню с соседей и усилить себя на столько же.',
    { deploy: ability([
      { action: 'armor', target: adjacent, amount: { stat: 'armor', scale: -1 }, save: 'armor' },
      action('boost', self, armorRemoved),
    ]), keywords: ['Броня', 'Усиление', 'Соседи'] }],
  ['relay', 'Наводчик щитов', 4, 3, 'При розыгрыше: дать 2 брони своему отряду на Поверхности.',
    { deploy: ability([action('armor', chosen('ally'), 2)],
      [choice('ally', { ...allies, row: 'surface' }, 'Выбери свой отряд на Поверхности для 2 брони.', { kind: 'armor' })]), keywords: ['Броня'] }],
  ['orbital-salvo', 'Орбитальный залп', 5, null, 'Нанести 3 урона вражескому отряду. Если цель на Поверхности, нанести 5 урона.',
    { type: 'effect', art: 'orbital-salvo.webp', deploy: ability([action('damage', chosen('enemy'), salvoDamage)],
      [enemyChoice(salvoDamage)]), keywords: ['Урон'] }],
  ['colonel', 'Полковник Стены', 9, 5, 'При розыгрыше: удвоить броню своих отрядов в этом ряду.',
    { deploy: ability([action('armor', allyRow, { stat: 'armor' })]), keywords: ['Броня'] }],
  ['bastion', 'Бастион «Рубеж»', 11, 7, 'Броня 6. При розыгрыше: дать 3 брони соседям.',
    { art: 'bastion.webp', armor: 6, deploy: armorNeighbors(3), keywords: ['Броня', 'Соседи'] }],
  ['commander', 'Командор щитов', 10, 5, 'Приказ: снять 2 брони со своей карты и нанести 3 урона вражеской. Перезарядка: 2 хода.',
    { order: {
      cooldown: 2,
      cost: ability([action('armor', chosen('payer'), -2)], [
        choice('payer', { ...allies, armorAtLeast: 2 },
          'Выбери свою карту, с которой снять 2 брони.', { kind: 'spend-armor', amount: 2 }),
      ]),
      ...ability([action('damage', chosen('enemy'), 3)], [enemyChoice(3)]),
    }, keywords: ['Приказ', 'Броня', 'Урон'] }],
];

const growth = [
  ['cocoon', 'Кокон', 4, 1, 'При розыгрыше: породить по личинке с каждой стороны. Завещание: усилить поглотившего на 2.',
    { art: 'cocoon.webp', deploy: ability([spawn('left'), spawn('right')]),
      deathwish: ability([action('boost', chosen('consumer'), 2)]), keywords: ['Порождение', 'Завещание', 'Поглощение'] }],
  ['feast', 'Пиршество', 4, null, 'Выбранный свой отряд поглощает одну другую свою личинку и получает ещё +2 силы.',
    { type: 'effect', deploy: ability([
      absorb(chosen('victim'), { receiver: chosen('ally'), extra: 2 }),
    ], [
      choice('ally', allies, 'Выбери свой отряд для Пиршества.', { kind: 'boost' }),
      choice('victim', { ...larvae, exclude: 'ally' }, 'Выбери личинку для поглощения.', { kind: 'consume' }),
    ]), keywords: ['Поглощение', 'Усиление'] }],
  ['vine', 'Ползучая лоза', 4, 2, 'При розыгрыше: породить личинку на Орбите. Завещание: 2 урона случайному вражескому отряду.',
    { art: 'vine.webp', deploy: ability([spawn('right', 'orbit')]),
      deathwish: ability([action('damage', chosen('enemy'), 2)], [randomEnemy]), keywords: ['Порождение', 'Завещание', 'Урон'] }],
  ['spore-sac', 'Споровый мешок', 5, 2, 'Завещание: породить 3 личинки на месте погибшей карты.',
    { art: 'spore-sac.webp', deathwish: ability([spawn('death', 'death', 3)]), keywords: ['Завещание', 'Порождение'] }],
  ['incubator', 'Инкубатор', 6, null, 'В конце хода: породить личинку справа. На третьем своём конце хода после порождения погибает.',
    { type: 'artifact', art: 'incubator.webp', timer: 3, endTurn: ability([spawn('right'), action('tick', self)]), keywords: ['Порождение', 'Таймер'] }],
  ['acid-gland', 'Кислотная железа', 4, 3, 'Завещание: нанести 4 урона выбранному вражескому отряду.',
    { deathwish: ability([action('damage', chosen('enemy'), 4)], [enemyChoice(4)]), keywords: ['Завещание', 'Урон'] }],
  ['scavenger', 'Трупоед', 5, 2, 'При розыгрыше: поглотить своего соседа.',
    { deploy: ability([absorb(chosen('victim'))],
      [choice('victim', adjacent, 'Выбери соседа для поглощения.', { kind: 'consume' })]), keywords: ['Соседи', 'Поглощение'] }],
  ['gulper', 'Глотатель', 6, 3, 'При розыгрыше: поглотить все личинки в своём ряду.',
    { art: 'gulper.webp', deploy: ability([absorb({ ...larvae, row: 'source' })]), keywords: ['Поглощение'] }],
  ['spitter', 'Кислотный плевун', 5, 3, 'При розыгрыше: поглотить свою личинку и нанести 4 урона вражескому отряду.',
    { art: 'spitter.webp', deploy: ability([absorb(chosen('victim')), action('damage', chosen('enemy'), 4)], [
      choice('victim', larvae, 'Выбери личинку для поглощения.', { kind: 'consume' }), enemyChoice(4),
    ]), keywords: ['Поглощение', 'Урон'] }],
  ['predator', 'Хищный побег', 5, 4, 'Когда рядом кого-то поглощают: усилить себя на 2.',
    { neighborConsumed: ability([action('boost', self, 2)]), keywords: ['Соседи', 'Поглощение', 'Усиление'] }],
  ['mutant', 'Мутант', 4, 2, 'При розыгрыше: поглотить личинку-соседа и получить дополнительно 3 силы.',
    { deploy: ability([absorb(chosen('victim'), { extra: 3 })],
      [choice('victim', { ...adjacent, token: true }, 'Выбери личинку-соседа.', { kind: 'consume' })]), keywords: ['Соседи', 'Поглощение'] }],
  ['nest', 'Гнездо-мать', 9, 3, 'В конце хода: породить по личинке в каждом своём ряду.',
    { endTurn: ability([spawn('right', 'all')]), keywords: ['Порождение'] }],
  ['colossus', 'Колосс', 11, 5, 'При розыгрыше: поглотить всех своих соседей.',
    { art: 'colossus.webp', deploy: ability([absorb(adjacent)]), keywords: ['Соседи', 'Поглощение'] }],
  ['ravager', 'Выводок-разоритель', 10, 4, 'При розыгрыше: поглотить свой отряд и нанести урон врагу в размере силы жертвы.',
    { deploy: ability([
      absorb(chosen('victim'), { multiplier: 0, save: 'strength' }),
      action('damage', chosen('enemy'), { result: 'strength' }),
    ], [
      choice('victim', otherAlly, 'Выбери отряд для поглощения.', { kind: 'consume' }), enemyChoice(victimPower),
    ]), keywords: ['Поглощение', 'Урон'] }],
];

function factionCards(entries) {
  return Object.freeze(entries.flatMap(([id, name, provision, power, text, rules], index) => {
    const rarity = index < 11 ? 'bronze' : 'gold';
    const stats = power === null ? {} : { power };
    const definition = Object.freeze({ id, name, provision, type: 'unit', text, rarity, ...stats, ...rules });
    return rarity === 'bronze' ? [definition, definition] : [definition];
  }));
}

export const FACTIONS = Object.freeze({
  protectorate: {
    name: 'Протекторат', strategy: 'Строй', deck: factionCards(protectorate),
    leader: {
      name: 'Маршал Строя', text: 'Дать 3 брони выбранному своему отряду и его соседям.',
      ability: ability([
        action('armor', chosen('ally'), 3),
        action('armor', { ...adjacent, of: 'ally' }, 3),
      ], [choice('ally', allies, 'Выбери отряд для брони Маршала и его соседей.', { kind: 'marshal' })]),
    },
  },
  growth: {
    name: 'Поросль', strategy: 'Пожирание', deck: factionCards(growth),
    leader: {
      name: 'Пожиратель', text: 'Поглотить свой отряд и передать удвоенную силу одному из его соседей.',
      ability: ability([
        absorb(chosen('victim'), { receiver: chosen('ally'), multiplier: 2 }),
      ], [
        choice('victim', allies, 'Выбери жертву для Пожирателя.', { kind: 'consume' }),
        choice('ally', { ...adjacent, of: 'victim' }, 'Выбери соседа, который получит удвоенную силу.', { kind: 'boost' }),
      ]),
    },
  },
});
