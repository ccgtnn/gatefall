export const HOUND_CATEGORY = 'Гончая';

const hound = { faction: 'captains', type: 'unit', categories: [HOUND_CATEGORY] };
export const HOUND = Object.freeze({
  ...hound, id: 'hound', name: 'Гончая', power: 2, text: 'Боец Чёрных гончих.', token: true,
  art: 'hound.webp', artCrop: 'hound-crop.webp',
});
export const REINFORCED_HOUND = Object.freeze({
  ...hound, id: 'reinforced-hound', name: 'Усиленная гончая', power: 3, armor: 1, text: 'Броня 1.', keywords: ['Броня'], token: true,
  art: 'reinforced-hound.webp', artCrop: 'reinforced-hound-crop.webp',
});

const source = { scope: 'source' };
const victim = { scope: 'ref', ref: 'hound' };
const ability = (steps, select = []) => ({ steps, select });
const profit = (amount) => ability([{ action: 'coins', amount }]);
const adjacent = (card = HOUND, amount = 1) => ({ action: 'spawn', card, row: 'source', position: 'right', amount });
const fee = (coins, steps, conditions = {}) => ({ coins, steps, ...conditions });
const houndChoice = { ref: 'hound', targets: { scope: 'ally', type: 'unit', category: HOUND_CATEGORY },
  kind: 'destroy', prompt: 'Выбери свою Гончую для уничтожения.' };
const fang = {
  power: 5, provision: 7, rarity: 'epic', requiredRow: 'orbit', preferredRow: 'orbit',
  keywords: ['Прибыль', 'Орбита', 'Приказ', 'Уничтожение', 'Плата'],
  deploy: profit(2),
  fee: fee(5, [{ action: 'ready-order', target: source }], { needsExhaustedOrder: true }),
};
const destroyHound = { action: 'destroy', target: victim };
const claw = Object.freeze({
  ...hound, id: 'hound-claw', name: 'Коготь', power: 4, provision: 5, rarity: 'bronze',
  art: 'hound-claw.webp',
  shipClass: 'Лёгкий корабль',
  text: 'В конце твоего хода: усиль себя на 1, если на поле есть «Чёрная гончая» или все твои отряды на поле принадлежат категории «Гончая».',
  keywords: ['Конец хода', 'Усиление'],
  endTurn: ability([{ action: 'boost', target: source, amount: 1,
    when: { targets: { scope: 'field', definitionId: 'black-hound' }, orAlliesCategory: HOUND_CATEGORY } }]),
});

const houndCards = [
  {
    id: 'hound-foreman', name: 'Бригадир гончих', power: 3, provision: 5, rarity: 'bronze',
    art: 'hound-foreman.webp', artCrop: 'hound-foreman-crop.webp',
    text: 'Плата 2: призови Гончую справа.', keywords: ['Плата', 'Соседи'],
    fee: fee(2, [adjacent()], { needsSourceSpace: true }),
  },
  {
    id: 'hound-captain', name: 'Капитан гончих', power: 4, provision: 8, rarity: 'epic',
    art: 'hound-captain.webp', artCrop: 'hound-captain-crop.webp',
    text: 'При розыгрыше: усиль всех Гончих на своей стороне на 1.', keywords: ['Усиление'],
    deploy: ability([{ action: 'boost', target: { scope: 'ally', type: 'unit', category: HOUND_CATEGORY }, amount: 1 }]),
  },
  {
    id: 'hound-recruiter', name: 'Вербовщик гончих', power: 3, provision: 8, rarity: 'epic',
    art: 'hound-recruiter.webp', artCrop: 'hound-recruiter-crop.webp',
    text: 'Взнос 3: призови 2 Гончие справа. Взнос 6: призови 4 Гончие справа.',
    keywords: ['Взнос', 'Соседи'],
    deploy: ability([{ action: 'choose-tribute', tiers: { 3: 2, 6: 4 }, spawn: adjacent() }]),
  },
  {
    id: 'hound-pack', name: 'Стая', provision: 4, rarity: 'bronze', type: 'effect',
    art: 'hound-pack.webp',
    text: 'Призови в выбранный свой ряд 3 Гончие.', keywords: ['Порождение'],
    deploy: ability([{ action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для трёх Гончих.' },
      { action: 'spawn', rowRef: 'row', amount: 3, card: HOUND }]),
  },
  {
    id: 'hound-good-deal', name: 'Удачное дельце', provision: 4, rarity: 'bronze', type: 'effect',
    art: 'hound-good-deal.webp',
    text: 'Прибыль 5.', keywords: ['Прибыль'], deploy: profit(5),
  },
  {
    id: 'black-hound', name: 'Чёрная гончая', power: 6, provision: 12, rarity: 'gold',
    art: 'black-hound.webp', artCrop: 'black-hound-crop.webp',
    shipClass: 'Тяжёлый корабль', shield: true, requiredRow: 'orbit', preferredRow: 'orbit',
    text: 'Прибыль 6. Орбита. Силовой щит. Плата 4: призови справа корабль «Коготь».',
    keywords: ['Прибыль', 'Орбита', 'Силовой щит', 'Плата', 'Тяжёлый корабль'],
    deploy: profit(6),
    fee: fee(4, [adjacent(claw)], { needsSourceSpace: true }),
  },
  claw,
  {
    ...fang, id: 'hound-right-fang', name: 'Правый Клык', shipClass: 'Лёгкий корабль',
    art: 'hound-right-fang.webp',
    text: 'Прибыль 2. Орбита. Приказ: уничтожь выбранную свою Гончую, возьми карту, затем помести выбранную карту из руки на дно колоды. Плата 5: восстанови Приказ.',
    order: ability([destroyHound, { action: 'draw', amount: 1 }, { action: 'choose-hand-bottom' }], [houndChoice]),
  },
  {
    ...fang, id: 'hound-left-fang', name: 'Левый Клык', shipClass: 'Лёгкий корабль',
    art: 'hound-left-fang.webp',
    text: 'Прибыль 2. Орбита. Приказ: уничтожь выбранную свою Гончую и нанеси 1 урон каждому отряду в выбранном вражеском ряду. Плата 5: восстанови Приказ.',
    order: ability([destroyHound,
      { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для 1 урона каждому отряду.' },
      { action: 'damage', target: { scope: 'enemy', type: 'unit', rowRef: 'row' }, amount: 1 }], [houndChoice]),
  },
  {
    id: 'hound-eyes', name: 'Глаза гончей', power: 6, provision: 10, rarity: 'gold',
    art: 'hound-eyes.webp', artCrop: 'hound-eyes-crop.webp',
    shipClass: 'Лёгкий корабль', text: 'Прибыль 4. Плата 1: преврати выбранную свою Гончую в Усиленную гончую.',
    keywords: ['Прибыль', 'Плата'],
    deploy: profit(4),
    fee: fee(1, [{ action: 'transform', target: victim, card: REINFORCED_HOUND }], { select: [{
      ref: 'hound', targets: { scope: 'ally', definitionId: HOUND.id }, kind: 'transform',
      prompt: 'Выбери Гончую для превращения в Усиленную гончую.',
    }] }),
  },
].map((card) => ({ ...hound, ...card }));

export const SKARA_REINHOLD = Object.freeze({
  id: 'skara-reinhold', name: 'Скара Райнхольд', provisionBonus: 15, art: 'skara-reinhold.webp', artFocus: '50% 27%', artZoom: 1.45,
  text: 'Приказ (1 заряд): выбери свой ряд и призови в него 2 Гончие. Прибыль 3.',
  charges: 1, order: { cooldown: 0, usesCharges: true }, keywords: ['Прибыль'],
  aiHints: { leaderCoinsAtMost: 6, leaderChargeValue: 5 },
  ability: ability([
    { action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для Гончих Скары.' },
    { action: 'spawn', rowRef: 'row', amount: 2, card: HOUND },
    { action: 'coins', amount: 3 },
  ]),
});

export const CAPTAIN_CARDS = Object.freeze([
  ...houndCards,
  {
    id: 'stolen-goods-fence', name: 'Скупщик краденого', faction: 'captains', type: 'unit',
    rarity: 'epic', provision: 8, power: 5,
    art: 'stolen-goods-fence.webp', artCrop: 'stolen-goods-fence-crop.webp',
    text: 'Счётчик 3: Прибыль 9.', keywords: ['Счётчик', 'Прибыль'],
    counter: { amount: 3, effect: profit(9) },
  },
  {
    id: 'debtor', name: 'Должник', faction: 'captains', type: 'unit', rarity: 'bronze', provision: 4, power: 6,
    art: 'debtor.webp',
    text: 'При розыгрыше: потеряй 2 боевые монеты. Если их меньше 2, вместо этого потеряй 3 силы.',
    deploy: ability([
      { action: 'weaken', target: source, amount: 3, when: { coinsBelow: 2 } },
      { action: 'coins', amount: -2, when: { coinsAtLeast: 2 } },
    ]),
  },
  {
    id: 'scrapped-pilot', name: 'Списанный пилот', faction: 'captains', type: 'unit', rarity: 'bronze', provision: 4, power: 3,
    art: 'scrapped-pilot.webp',
    rowPower: { key: 'shipRowBonus', amount: 3, requires: { field: 'shipClass', values: ['Лёгкий корабль', 'Тяжёлый корабль'] } },
    text: 'Пока в его ряду есть твой Лёгкий или Тяжёлый корабль, получает +3 силы.',
    keywords: ['Усиление'],
  },
  {
    id: 'broken-turret', name: 'Сломанная турель', faction: 'captains', type: 'artifact', rarity: 'bronze', provision: 4,
    art: 'broken-turret.webp', artStates: { failing: 'broken-turret-failing.webp' }, timer: 1,
    text: 'При розыгрыше: 5 раз нанеси 1 урон случайному вражескому отряду. Цели могут повторяться. В начале твоего следующего хода нанеси 1 урон случайному своему отряду, если он есть. Затем турель ломается и остаётся на поле без эффектов до конца раунда.',
    keywords: ['Урон'],
    deploy: ability([{ action: 'scatter', amount: 5, visual: 'turret' }]),
    timerNextTurn: ability([
      { action: 'scatter', side: 'ally', amount: 1, visual: 'turret' },
      { action: 'art-state', target: source, state: 'failing' },
    ]),
  },
].map((card) => Object.freeze(card)));
