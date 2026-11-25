export const HOUND_CATEGORY = 'Гончая';

const hound = { faction: 'captains', type: 'unit', categories: [HOUND_CATEGORY],
  sidePower: { group: HOUND_CATEGORY, key: 'houndBonus' } };
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
const adjacent = (card = HOUND, amount = 1) => ({ action: 'spawn', card, row: 'source', position: 'right', amount });
const fee = (coins, steps, conditions = {}) => ({ coins, steps, ...conditions });
const houndChoice = { ref: 'hound', targets: { scope: 'ally', type: 'unit', category: HOUND_CATEGORY },
  kind: 'destroy', prompt: 'Выбери свою Гончую для уничтожения.' };
const fang = {
  power: 5, provision: 7, rarity: 'epic', requiredRow: 'orbit', preferredRow: 'orbit',
  keywords: ['Орбита', 'Приказ', 'Уничтожение', 'Плата'],
  fee: fee(5, [{ action: 'ready-order', target: source }], { needsExhaustedOrder: true }),
};
const destroyHound = { action: 'destroy', target: victim };
const claw = Object.freeze({
  ...hound, id: 'hound-claw', name: 'Коготь', power: 5, provision: 5, rarity: 'bronze',
  art: 'hound-claw.webp',
  shipClass: 'Лёгкий корабль',
  text: 'В конце твоего хода: усилить себя на 1, если на поле есть «Чёрная гончая» или на твоём поле только карты категории «Гончая».',
  keywords: ['Конец хода', 'Усиление'],
  endTurn: ability([{ action: 'boost', target: source, amount: 1,
    when: { targets: { scope: 'field', definitionId: 'black-hound' }, orAlliesCategory: HOUND_CATEGORY } }]),
});

const houndCards = [
  {
    id: 'hound-foreman', name: 'Бригадир гончих', power: 3, provision: 5, rarity: 'bronze',
    art: 'hound-foreman.webp', artCrop: 'hound-foreman-crop.webp',
    text: 'Плата 2: призвать Гончую рядом.', keywords: ['Плата', 'Соседи'],
    fee: fee(2, [adjacent()], { needsSourceSpace: true }),
  },
  {
    id: 'hound-captain', name: 'Капитан гончих', power: 4, provision: 8, rarity: 'epic',
    art: 'hound-captain.webp', artCrop: 'hound-captain-crop.webp',
    text: 'Пока на поле, все твои Гончие получают +1 к силе.', sidePowerAura: 1,
  },
  {
    id: 'hound-recruiter', name: 'Вербовщик гончих', power: 3, provision: 8, rarity: 'epic',
    art: 'hound-recruiter.webp', artCrop: 'hound-recruiter-crop.webp',
    text: 'Взнос 3: призвать 2 Гончие рядом. Взнос 6: призвать 4 Гончие рядом.',
    keywords: ['Взнос', 'Соседи'],
    deploy: ability([{ action: 'choose-tribute', tiers: { 3: 2, 6: 4 }, spawn: adjacent() }]),
  },
  {
    id: 'hound-pack', name: 'Стая', provision: 4, rarity: 'bronze', type: 'effect',
    art: 'hound-pack.webp',
    text: 'Призвать в выбранный свой ряд 3 Гончие.', keywords: ['Порождение'],
    deploy: ability([{ action: 'select-row', ref: 'row', filter: 'space', prompt: 'Выбери свой ряд для трёх Гончих.' },
      { action: 'spawn', rowRef: 'row', amount: 3, card: HOUND }]),
  },
  {
    id: 'hound-good-deal', name: 'Удачное дельце', provision: 4, rarity: 'bronze', type: 'effect',
    art: 'hound-good-deal.webp',
    text: 'Прибыль 5.', keywords: ['Прибыль'], deploy: ability([{ action: 'coins', amount: 5 }]),
  },
  {
    id: 'black-hound', name: 'Чёрная гончая', power: 5, provision: 12, rarity: 'gold',
    art: 'black-hound.webp', artCrop: 'black-hound-crop.webp',
    shipClass: 'Тяжёлый корабль', shield: true, requiredRow: 'orbit', preferredRow: 'orbit',
    text: 'Орбита. Силовой щит. Плата 4: призвать справа корабль «Коготь».',
    keywords: ['Орбита', 'Силовой щит', 'Плата', 'Тяжёлый корабль'],
    fee: fee(4, [adjacent(claw)], { needsSourceSpace: true }),
  },
  claw,
  {
    ...fang, id: 'hound-right-fang', name: 'Правый Клык', shipClass: 'Лёгкий корабль',
    art: 'hound-right-fang.webp',
    text: 'Орбита. Приказ: уничтожить свою Гончую, взять карту, затем поместить выбранную карту из руки на дно колоды. Плата 5: восстановить Приказ.',
    order: ability([destroyHound, { action: 'draw', amount: 1 }, { action: 'choose-hand-bottom' }], [houndChoice]),
  },
  {
    ...fang, id: 'hound-left-fang', name: 'Левый Клык', shipClass: 'Лёгкий корабль',
    art: 'hound-left-fang.webp',
    text: 'Орбита. Приказ: уничтожить свою Гончую и нанести 1 урон каждому отряду в выбранном ряду противника. Плата 5: восстановить Приказ.',
    order: ability([destroyHound,
      { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для 1 урона каждому отряду.' },
      { action: 'damage', target: { scope: 'enemy', type: 'unit', rowRef: 'row' }, amount: 1 }], [houndChoice]),
  },
  {
    id: 'hound-eyes', name: 'Глаза гончей', power: 6, provision: 10, rarity: 'gold',
    art: 'hound-eyes.webp', artCrop: 'hound-eyes-crop.webp',
    shipClass: 'Лёгкий корабль', text: 'Плата 2: превратить выбранную свою Гончую в Усиленную гончую.',
    keywords: ['Плата'],
    fee: fee(2, [{ action: 'transform', target: victim, card: REINFORCED_HOUND }], { select: [{
      ref: 'hound', targets: { scope: 'ally', definitionId: HOUND.id }, kind: 'transform',
      prompt: 'Выбери Гончую для превращения в Усиленную гончую.',
    }] }),
  },
].map((card) => ({ ...hound, ...card }));

export const CAPTAIN_CARDS = Object.freeze([
  ...houndCards,
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
    text: 'При размещении: 5 раз нанеси 1 урон случайному вражескому отряду. Цели могут повторяться. В начале твоего следующего хода нанеси 1 урон случайному союзному отряду и уничтожь турель.',
    keywords: ['Урон', 'Уничтожение'],
    deploy: ability([{ action: 'scatter', amount: 5, visual: 'turret' }]),
    startTurn: ability([
      { action: 'art-state', target: source, state: 'failing' },
      { action: 'scatter', side: 'ally', amount: 1, visual: 'turret' },
      { action: 'destroy', target: source },
    ]),
  },
].map((card) => Object.freeze(card)));
