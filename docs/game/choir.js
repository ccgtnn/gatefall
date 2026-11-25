export const PSIONICS = 'Псионика';
export const CULTIST = 'Культист Спящего';
export const TENTACLE_CATEGORY = 'Щупальце';

const self = { scope: 'source' };
const allies = { scope: 'ally', type: 'unit' };
const enemies = { scope: 'enemy', type: 'unit' };
const fieldUnits = { scope: 'field', type: 'unit' };
const nearby = { scope: 'neighbors', type: 'unit' };
const ref = (ref) => ({ scope: 'ref', ref });
const obsession = { startingCategory: PSIONICS, every: 3 };
const ability = (steps, select) => ({ steps, ...(select && { select }) });
const damage = (target, amount) => ({ action: 'damage', target, amount });
const boost = (amount) => ({ action: 'boost', target: self, amount });
const spawn = (card, row, amount = 1, position) => ({ action: 'spawn', card, row, amount, position });
const sacrifice = (ref, prompt) => ({ ref, targets: allies, kind: 'sacrifice', prompt });
const card = (definition) => Object.freeze({ faction: 'choir', type: 'unit', ...definition });
const psionic = (definition) => card({ type: 'effect', categories: [PSIONICS], ...definition });

function tentacle(id, name, power, hit, stats = {}) {
  return card({
    id, name, power, token: true, categories: [TENTACLE_CATEGORY], ...stats,
    text: `В конце твоего хода: ${hit} урона своему отряду справа. Получив урон и выжив, усиливается на 2.`,
    keywords: ['Конец хода', 'Соседи', 'Урон', 'Усиление'],
    endTurn: ability([damage({ ...nearby, direction: 'right' }, hit)]),
    events: { damage: ability([boost(2)]) },
  });
}

export const TENTACLE = tentacle('ulmarin-tentacle', 'Щупальце Спящего', 2, 1, {
  art: 'sleeper-tentacle.webp', artCrop: 'sleeper-tentacle-crop.webp',
  rarity: 'bronze', provision: 4,
});
export const LARGE_TENTACLE = tentacle('ulmarin-large-tentacle', 'Большое щупальце Спящего', 8, 2, {
  art: 'sleeper-great-tentacle.webp', artCrop: 'sleeper-great-tentacle-crop.webp',
});

export const FANATIC = card({
  id: 'ulmarin-fanatic', name: 'Фанатик Спящего', rarity: 'bronze', provision: 4, power: 4, categories: [CULTIST],
  art: 'sleeper-fanatic.webp', artCrop: 'sleeper-fanatic-crop.webp',
  text: 'Когда сила падает до 2 или ниже и отряд выживает, превращается в Щупальце Спящего с базовой силой.',
  events: { 'power-loss': { ...ability([{ action: 'transform', target: self, card: TENTACLE }]),
    when: { targets: { ...self, powerAtMost: 2 } } } },
});
const fanaticToken = card({ ...FANATIC, token: true });

export const SLEEPER = card({
  id: 'ulmarin-sleeper', name: 'Спящий под Вратами', rarity: 'gold', power: 8, doomed: true, token: true,
  art: 'sleeper-under-gates.webp', artCrop: 'sleeper-under-gates-crop.webp',
  text: 'Обречённость. В конце твоего хода: нанеси 1 урон каждому соседу. Если нанёс урон, усиль себя на суммарный урон и восстанови Приказ. Приказ: нанеси сильнейшему вражескому отряду урон, равный числу твоих культистов Спящего и Щупалец.',
  keywords: ['Обречённость', 'Конец хода', 'Соседи', 'Урон', 'Усиление', 'Приказ'],
  endTurn: ability([
    { ...damage(nearby, 1), save: 'dealt', measureDamage: true },
    boost({ result: 'dealt' }),
    { action: 'ready-order', target: self, requiresResult: 'dealt' },
  ]),
  order: {
    ...ability([damage(ref('strongest'), { count: { ...allies, anyCategory: [CULTIST, TENTACLE_CATEGORY] } })],
      [{ ref: 'strongest', targets: { ...enemies, strongest: true }, mode: 'random' }]),
    when: { targets: { ...allies, anyCategory: [CULTIST, TENTACLE_CATEGORY] } },
  },
});

export const AWAKENING = psionic({
  id: 'ulmarin-awakening', name: 'Пробуждение Спящего', type: 'artifact', rarity: 'gold', provision: 12, resilience: true,
  art: 'sleeper-awakening.webp', artCrop: 'sleeper-awakening-crop.webp',
  text: 'Стойкость. Главы открываются по одной при появлении нового Щупальца на твоей стороне. Пролог: призови по Фанатику Спящего слева и справа. Глава 1: усиль на 1 всех культистов Спящего в своей колоде. Глава 2: выбери свой отряд. Когда он погибнет или будет уничтожен, призови Большое щупальце Спящего на Поверхность. Глава 3: если за матч сыграно хотя бы 7 эффектов Псионики, призови Спящего под Вратами в ряд сценария.',
  keywords: ['Стойкость', 'Сценарий', PSIONICS, TENTACLE_CATEGORY],
  scenario: {
    trigger: 'appearance', category: TENTACLE_CATEGORY,
    countPlayedEffects: PSIONICS, finalChapterMinimum: 7,
    prologue: ability([spawn(fanaticToken, 'source', 1, 'left'), spawn(fanaticToken, 'source', 1, 'right')]),
    chapters: [
      ability([{ action: 'boost-deck', category: CULTIST, amount: 1 }]),
      ability([{ action: 'watch-sacrifice', ref: 'victim' }],
        [sacrifice('victim', 'Выбери свой отряд в жертву для сценария.')]),
      ability([spawn(SLEEPER, 'source', 1, 'right')]),
    ],
    onSacrifice: ability([spawn(LARGE_TENTACLE, 'surface')]),
  },
});

const offering = ref('offering');
export const HIGH_PRIEST = Object.freeze({
  id: 'high-priest', legacyId: 'choir-leader', name: 'Верховный жрец', provisionBonus: 15, charges: 2,
  order: { cooldown: 0, usesCharges: true }, art: 'high-priest.webp', artFocus: '50% 24%', artZoom: 1.85,
  text: 'Приказ (2 заряда): нанеси 2 урона выбранному своему отряду. Призови Щупальце Спящего справа от него или на его месте, если отряд погиб.',
  aiHints: { leaderOffering: true },
  ability: ability([
    { ...damage(offering, 2), savePosition: 'offeringPosition' },
    { ...spawn(TENTACLE, 'source', 1, 'right'), of: 'offering', fallbackPosition: 'offeringPosition' },
  ], [{ ref: 'offering', targets: allies, kind: 'leader-offering', amount: 2,
    prompt: 'Выбери свой отряд для 2 урона и призыва Щупальца Спящего.' }]),
});

const victim = ref('victim');

export const CHOIR_CARDS = Object.freeze([
  card({
    id: 'whisper-interpreter', name: 'Толкователь шёпота', rarity: 'bronze', provision: 5, power: 1,
    art: 'whisper-interpreter.webp', artCrop: 'whisper-interpreter-crop.webp',
    text: 'При размещении: сыграй карту Псионики из руки, затем возьми карту.', keywords: [PSIONICS],
    deploy: ability([{ action: 'play-from-hand', filter: { anyType: true, category: PSIONICS },
      prompt: 'Выбери карту Псионики из руки.' }, { action: 'draw', amount: 1 }]),
  }),
  card({
    id: 'forbidden-scroll-keeper', name: 'Хранитель запретных свитков', rarity: 'epic', provision: 7, power: 1,
    art: 'forbidden-scroll-keeper.webp', artCrop: 'forbidden-scroll-keeper-crop.webp',
    text: 'При размещении: сыграй карту Псионики из колоды.', keywords: [PSIONICS],
    deploy: ability([{ action: 'play-from-deck', chooseAll: true, filter: { anyType: true, category: PSIONICS },
      prompt: 'Выбери карту Псионики из колоды.' }]),
  }),
  FANATIC,
  card({
    id: 'depth-neophyte', name: 'Неофит глубин', rarity: 'bronze', provision: 5, power: 4, categories: [CULTIST],
    art: 'depth-neophyte.webp', artCrop: 'depth-neophyte-crop.webp',
    text: 'Одержимость (Псионика): при размещении усиль себя на 1 за каждые 3 карты Псионики.',
    keywords: ['Одержимость', PSIONICS, 'Усиление'], deploy: ability([boost(obsession)]),
  }),
  card({
    id: 'cult-dreamer', name: 'Сновидец культа', rarity: 'epic', provision: 7, power: 3,
    art: 'cult-dreamer.webp', artCrop: 'cult-dreamer-crop.webp',
    text: 'Одержимость (Псионика): при размещении возьми по карте за каждые 3 карты Псионики. Верни столько же выбранных карт из руки в случайные места колоды.',
    keywords: ['Одержимость', PSIONICS],
    deploy: ability([{ action: 'draw', amount: obsession, save: 'drawn' },
      { action: 'return-hand', amount: { result: 'drawn' } }]),
  }),
  card({
    id: 'abyss-shepherd', name: 'Пастырь бездны', rarity: 'gold', provision: 12, power: 4,
    art: 'abyss-shepherd.webp', artCrop: 'abyss-shepherd-crop.webp',
    text: 'Одержимость (Псионика): при размещении захвати выбранный вражеский отряд с силой не выше 3 / 4 / 5 / 6 при 3 / 6 / 9 / 12 картах Псионики. При меньшем числе карт Захват не срабатывает.',
    keywords: ['Одержимость', PSIONICS, 'Захват'],
    deploy: ability([{ action: 'capture', target: victim }], [{
      ref: 'victim', kind: 'capture', prompt: 'Выбери вражеский отряд для Захвата.',
      targets: { ...enemies, capture: true, powerAtMost: { ...obsession, base: 2, cap: 4, minimum: 1 } },
    }]),
  }),
  psionic({
    id: 'alien-dream', name: 'Чужой сон', rarity: 'bronze', provision: 5,
    art: 'stranger-dream.webp', artCrop: 'stranger-dream-crop.webp',
    text: 'Покажи 3 случайные обычные карты фракции противника. Сотвори и сыграй одну из них.',
    keywords: [PSIONICS, 'Сотворение'],
    deploy: ability([{ action: 'create-play', faction: 'enemy', rarity: 'bronze', amount: 3 }]),
  }),
  psionic({
    id: 'sleeper-revelation', name: 'Откровение Спящего', rarity: 'gold', provision: 10,
    art: 'sleeper-revelation.webp', artCrop: 'sleeper-revelation-crop.webp',
    text: 'Одержимость (Псионика): покажи 1 / 2 / 3 / 4 случайных легендарных эффекта любой фракции при 3 / 6 / 9 / 12 картах Псионики. Сотвори и сыграй один из них.',
    keywords: ['Одержимость', PSIONICS, 'Сотворение'],
    deploy: ability([{ action: 'create-play', rarity: 'gold', type: 'effect', amount: { ...obsession, cap: 4 } }]),
  }),
  card({
    id: 'altar-guardian', name: 'Страж алтаря', rarity: 'epic', provision: 8, power: 4, armor: 2, categories: [CULTIST],
    art: 'altar-guardian.webp', artCrop: 'altar-guardian-crop.webp',
    text: 'Броня 2. Уязвимость. Одержимость (Псионика): усиль себя на 2 за каждые 3 карты Псионики.',
    keywords: ['Броня', 'Уязвимость', 'Одержимость', PSIONICS, 'Усиление'],
    events: { 'armor-break': ability([boost({ ...obsession, scale: 2 })]) },
  }),
  psionic({
    id: 'minor-offering', name: 'Малое подношение', rarity: 'bronze', provision: 4,
    art: 'lesser-offering.webp', artCrop: 'lesser-offering-crop.webp',
    text: 'Нанеси 2 урона выбранному своему отряду, затем призови Щупальце Спящего в тот же ряд.',
    keywords: [PSIONICS, 'Урон', 'Порождение'],
    deploy: ability([{ action: 'remember-row', target: victim, ref: 'victimRow' }, damage(victim, 2),
      { ...spawn(TENTACLE, undefined), rowRef: 'victimRow' }],
    [sacrifice('victim', 'Выбери свой отряд для Малого подношения.')]),
  }),
  psionic({
    id: 'great-sacrifice', name: 'Великая жертва', rarity: 'gold', provision: 9,
    art: 'great-sacrifice.webp', artCrop: 'great-sacrifice-crop.webp',
    text: 'Нанеси по 2 урона трём разным своим отрядам, затем призови по Щупальцу Спящего в ряду каждой жертвы. При нехватке места используй другой ряд.',
    keywords: [PSIONICS, 'Урон', 'Порождение'],
    deploy: ability([
      ...[1, 2, 3].map((i) => ({ action: 'remember-row', target: ref('victim' + i), ref: 'row' + i })),
      ...[1, 2, 3].map((i) => damage(ref('victim' + i), 2)),
      ...[1, 2, 3].map((i) => ({ ...spawn(TENTACLE, undefined), rowRef: 'row' + i, overflow: true })),
    ], [1, 2, 3].map((i) => ({
      ...sacrifice('victim' + i, `Выбери свою жертву ${i} из 3.`),
      targets: { ...allies, excludeRefs: ['victim1', 'victim2', 'victim3'] },
    }))),
  }),
  psionic({
    id: 'call-of-the-deep', name: 'Зов глубин', rarity: 'bronze', provision: 6,
    art: 'call-of-the-deep.webp', artCrop: 'call-of-the-deep-crop.webp',
    text: 'Преврати выбранный отряд в Щупальце Спящего с базовой силой на той же стороне и на том же месте, затем усиль его на 4.',
    keywords: [PSIONICS, TENTACLE_CATEGORY, 'Усиление'],
    deploy: ability([
      { action: 'transform', target: victim, card: TENTACLE },
      { action: 'boost', target: victim, amount: 4 },
    ], [{ ref: 'victim', kind: 'transform', prompt: 'Выбери отряд для превращения в Щупальце Спящего.', targets: fieldUnits }]),
  }),
  psionic({
    id: 'mind-strike', name: 'Ментальный удар', rarity: 'bronze', provision: 5,
    art: 'mind-strike.webp', artCrop: 'mind-strike-crop.webp',
    text: 'Нанеси 5 урона выбранному отряду.',
    keywords: [PSIONICS, 'Урон'],
    deploy: ability([damage(victim, 5)], [{ ref: 'victim', kind: 'damage', amount: 5, targets: fieldUnits }]),
  }),
  psionic({
    id: 'sleeper-litany', name: 'Литания Спящего', rarity: 'bronze', provision: 4,
    art: 'sleeper-litany.webp', artCrop: 'sleeper-litany-crop.webp',
    text: 'Усиль на 1 всех культистов Спящего на своей стороне.',
    keywords: [PSIONICS, CULTIST, 'Усиление'],
    deploy: ability([{ action: 'boost', target: { ...allies, category: CULTIST }, amount: 1 }]),
  }),
  TENTACLE, LARGE_TENTACLE, AWAKENING, SLEEPER,
]);
