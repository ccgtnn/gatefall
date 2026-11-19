export const ROWS = Object.freeze(['orbit', 'surface']);

export const ROW_LABELS = Object.freeze({
  orbit: 'Орбита',
  surface: 'Поверхность',
});

function defineDeck(prefix, entries) {
  return Object.freeze(entries.map(([name, power, row, provision], index) =>
    Object.freeze({ id: `${prefix}-${index + 1}`, name, power, row, provision }),
  ));
}

export const DECKS = Object.freeze({
  human: defineDeck('relay', [
    ['Маяк касания', 1, 'orbit', 4],
    ['Дежурный картограф', 2, 'surface', 4],
    ['Зонд «Иней»', 2, 'orbit', 4],
    ['Станция перехвата', 3, 'orbit', 4],
    ['Караульный мех', 3, 'surface', 4],
    ['Мастер шлюза', 3, 'surface', 4],
    ['Рой отражателей', 4, 'orbit', 5],
    ['Пилот челнока', 4, 'orbit', 5],
    ['Канатный подъёмник', 4, 'surface', 5],
    ['Колонна техников', 4, 'surface', 5],
    ['Теневой спутник', 5, 'orbit', 5],
    ['Фрегат «Стык»', 5, 'orbit', 5],
    ['Полевой ретранслятор', 5, 'surface', 5],
    ['Купол убежища', 5, 'surface', 5],
    ['Ремонтный док', 6, 'orbit', 6],
    ['Радарный пояс', 6, 'orbit', 6],
    ['Караван реакторов', 6, 'surface', 6],
    ['Группа буровиков', 6, 'surface', 6],
    ['Крейсер «Гелиограф»', 7, 'orbit', 7],
    ['Рельсовый бастион', 7, 'surface', 7],
    ['Узел «Параллакс»', 7, 'surface', 7],
    ['Кольцо наблюдения', 8, 'orbit', 8],
    ['Гранитная колонна', 8, 'surface', 8],
    ['Эскадра «Зенит»', 9, 'orbit', 9],
    ['Опора горизонта', 10, 'surface', 10],
  ]),
  bot: defineDeck('drift', [
    ['Сборщик пепла', 1, 'surface', 4],
    ['Зонд «Рябь»', 2, 'orbit', 4],
    ['Метеопост', 2, 'surface', 4],
    ['Ловец импульсов', 3, 'orbit', 4],
    ['Грузовой катер', 3, 'orbit', 4],
    ['Забойный ровер', 3, 'surface', 4],
    ['Буй скольжения', 4, 'orbit', 5],
    ['Склад под реголитом', 4, 'surface', 5],
    ['Архивная станция', 4, 'orbit', 5],
    ['Резчик льда', 4, 'surface', 5],
    ['Баржа «Вектор»', 5, 'orbit', 5],
    ['Внешний буй', 5, 'orbit', 5],
    ['Лёдоступ', 5, 'surface', 5],
    ['Станция осадки', 5, 'surface', 5],
    ['Патруль «Меридиан»', 6, 'orbit', 6],
    ['Магнитная сеть', 6, 'orbit', 6],
    ['Пустынные следопыты', 6, 'surface', 6],
    ['Купол подземников', 6, 'surface', 6],
    ['Крейсер «Уступ»', 7, 'orbit', 7],
    ['Кольцевой буксир', 7, 'orbit', 7],
    ['Тяжёлый землерой', 7, 'surface', 7],
    ['Тихая флотилия', 8, 'orbit', 8],
    ['Врата шахты', 8, 'surface', 8],
    ['Глубинный цех', 9, 'surface', 9],
    ['Цитадель дрейфа', 10, 'orbit', 10],
  ]),
});

const protectorate = [
  ['shieldbearer', 'Щитоносец', 4, 'surface', 3, 'Броня 2.', { armor: 2 }],
  ['infantry', 'Пехотинец линии', 4, 'surface', 2, 'При розыгрыше: соседи получают 1 броню.', { deploy: 'armor-neighbors' }],
  ['engineer', 'Инженер укреплений', 5, 'surface', 3, 'При розыгрыше: дать 3 брони своей карте.', { deploy: 'engineer' }],
  ['assault', 'Тяжёлый штурмовик', 5, 'surface', 5, 'Броня 3.', { armor: 3 }],
  ['orbital-shield', 'Орбитальный щит', 6, 'orbit', 4, 'В конце хода: дать 1 броню соседям.', { endTurn: 'armor-neighbors' }],
  ['standard', 'Знаменосец', 6, 'surface', 4, 'При розыгрыше: усилить бронированных соседей на 2.', { deploy: 'standard' }],
  ['warden', 'Страж врат', 6, 'surface', 6, 'Броня 4. Нельзя сдвинуть.', { armor: 4, immovable: true }],
  ['anvil', 'Таран «Наковальня»', 6, 'surface', 4, 'При розыгрыше: снять всю броню со своей карты и нанести столько же урона вражеской.', { deploy: 'anvil' }],
  ['smelter', 'Переплавщик', 5, 'orbit', 3, 'При розыгрыше: снять броню с соседей и усилить себя на столько же.', { deploy: 'smelter' }],
  ['relay', 'Наводчик щитов', 4, 'orbit', 3, 'При розыгрыше: дать 2 брони своей карте на Поверхности.', { deploy: 'relay' }],
  ['frigate', 'Патрульный фрегат', 4, 'orbit', 4, 'Без эффекта.', {}],
  ['colonel', 'Полковник Стены', 9, 'surface', 5, 'При розыгрыше: удвоить броню своих карт в этом ряду.', { deploy: 'colonel' }],
  ['bastion', 'Бастион «Рубеж»', 11, 'surface', 7, 'Броня 6. При розыгрыше: дать 3 брони соседям.', { armor: 6, deploy: 'bastion' }],
  ['commander', 'Командор щитов', 10, 'surface', 5, 'Приказ: снять 2 брони со своей карты и нанести 3 урона вражеской. Перезарядка: 2 хода.', { order: { effect: 'commander', cooldown: 2 } }],
];

const growth = [
  ['cocoon', 'Кокон', 4, 'surface', 1, 'При розыгрыше: породить по личинке с каждой стороны. Завещание: усилить поглотившего на 2.', { deploy: 'cocoon', deathwish: 'cocoon-wish' }],
  ['crawler', 'Ползун', 4, 'surface', 3, 'При розыгрыше: породить личинку справа.', { deploy: 'spawn-right' }],
  ['vine', 'Ползучая лоза', 4, 'orbit', 2, 'При розыгрыше: породить личинку на Орбите. Завещание: 2 урона случайной вражеской карте.', { deploy: 'spawn-right', deathwish: 'vine-wish' }],
  ['spore-sac', 'Споровый мешок', 5, 'orbit', 2, 'Завещание: породить 3 личинки на месте погибшей карты.', { deathwish: 'spore-wish' }],
  ['nursery', 'Рассадник', 6, 'orbit', 3, 'В конце хода: породить личинку справа.', { endTurn: 'spawn-right' }],
  ['acid-gland', 'Кислотная железа', 4, 'orbit', 3, 'Завещание: нанести 4 урона выбранной вражеской карте.', { deathwish: 'acid-wish' }],
  ['scavenger', 'Трупоед', 5, 'surface', 2, 'При розыгрыше: поглотить своего соседа.', { deploy: 'scavenger' }],
  ['gulper', 'Глотатель', 6, 'surface', 3, 'При розыгрыше: поглотить все личинки в своём ряду.', { deploy: 'gulper' }],
  ['spitter', 'Кислотный плевун', 5, 'orbit', 3, 'При розыгрыше: поглотить свою личинку и нанести 4 урона вражеской карте.', { deploy: 'spitter' }],
  ['predator', 'Хищный побег', 5, 'surface', 4, 'Когда рядом кого-то поглощают: усилить себя на 2.', { onNeighborConsumed: true }],
  ['mutant', 'Мутант', 4, 'surface', 2, 'При розыгрыше: поглотить личинку-соседа и получить дополнительно 3 силы.', { deploy: 'mutant' }],
  ['nest', 'Гнездо-мать', 9, 'orbit', 3, 'В конце хода: породить по личинке в каждом своём ряду.', { endTurn: 'nest' }],
  ['colossus', 'Колосс', 11, 'surface', 5, 'При розыгрыше: поглотить всех своих соседей.', { deploy: 'colossus' }],
  ['ravager', 'Выводок-разоритель', 10, 'surface', 4, 'При розыгрыше: поглотить свою карту и нанести урон вражеской в размере силы жертвы.', { deploy: 'ravager' }],
];

function factionCards(entries) {
  return Object.freeze(entries.flatMap(([id, name, provision, row, power, text, rules], index) => {
    const rarity = index < 11 ? 'bronze' : 'gold';
    const definition = Object.freeze({ id, name, provision, row, power, text, rarity, ...rules });
    return rarity === 'bronze' ? [definition, definition] : [definition];
  }));
}

export const FACTIONS = Object.freeze({
  protectorate: {
    name: 'Протекторат', strategy: 'Строй', deck: factionCards(protectorate),
    leader: { name: 'Маршал Строя', effect: 'marshal', text: 'Дать 3 брони выбранной своей карте и её соседям.' },
  },
  growth: {
    name: 'Поросль', strategy: 'Пожирание', deck: factionCards(growth),
    leader: { name: 'Пожиратель', effect: 'devourer', text: 'Поглотить свою карту и передать удвоенную силу одному из её соседей.' },
  },
});

export const LARVA = Object.freeze({
  id: 'larva', name: 'Личинка', power: 1, text: 'Обречённая.', doomed: true, token: true,
});
