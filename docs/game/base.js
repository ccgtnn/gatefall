// Plot order is also the drawing order, from farthest to nearest.
export const BASE_PLOTS = Object.freeze(['1', '2', '3', '4', '5', '6']);
export const MATERIALS = Object.freeze({
  steel: 'Сталь',
  energyCells: 'Энергоячейки',
  gateShards: 'Осколки врат',
});
export const STARTING_MATERIALS = Object.freeze({ steel: 200, energyCells: 100, gateShards: 5 });
export const MAX_BUILDING_LEVEL = 5;
export const BUILDINGS = Object.freeze({
  tavern: { name: 'Таверна', plot: '5', art: 'tavern', cost: { gold: 300, steel: 150, energyCells: 50 }, effect: (level) => `Ежедневные задания · слотов: ${level} · скоро` },
  mine: { name: 'Шахта', plot: '2', art: 'mine', cost: { gold: 400, steel: 100, energyCells: 50 }, effect: 'Добыча стали и золота · скоро' },
  power: { name: 'Энергостанция', art: 'power', cost: { gold: 350, steel: 75, energyCells: 25 }, effect: 'Добыча энергоячеек · скоро' },
  warehouse: { name: 'Склад', art: 'warehouse', cost: { gold: 250, steel: 80, energyCells: 25 }, effect: 'Лимит хранения материалов · скоро' },
  gate: { name: 'Врата', art: 'gate', cost: { gold: 600, steel: 150, energyCells: 75, gateShards: 5 }, effect: 'Еженедельное испытание · скоро', details: 'Испытание против особых противников.' },
});
export const BUILDING_BY_PLOT = Object.freeze(Object.fromEntries(
  Object.entries(BUILDINGS).filter(([, { plot }]) => plot).map(([kind, { plot }]) => [plot, kind]),
));

export function buildingSlot(kind) {
  return Object.hasOwn(BUILDINGS, kind) ? BUILDINGS[kind].plot ?? kind : undefined;
}

export function buildingPrice(kind, level) {
  if (!Object.hasOwn(BUILDINGS, kind) || !Number.isInteger(level) || level < 1 || level > MAX_BUILDING_LEVEL) return;
  const multiplier = 1.5 ** (level - 1);
  return Object.fromEntries(Object.entries(BUILDINGS[kind].cost).map(([key, price]) => [key, Math.ceil(price * multiplier)]));
}

export function buildingEffect(kind, level = 1) {
  const { effect } = BUILDINGS[kind];
  return typeof effect === 'function' ? effect(level) : effect;
}

const amount = (value) => Number.isSafeInteger(value) && value >= 0;

export function readBase(saved) {
  const materials = Object.fromEntries(Object.entries(STARTING_MATERIALS).map(([key, initial]) => {
    const value = saved?.materials?.[key];
    return [key, amount(value) ? value : initial];
  }));
  const buildings = {};
  for (const kind of Object.keys(BUILDINGS)) {
    const slot = buildingSlot(kind);
    // Legacy saves can contain the same building on several lots. Keep its highest level.
    const savedSlots = new Set([...BASE_PLOTS, slot]);
    const valid = [...savedSlots].map((id) => saved?.buildings?.[id])
      .filter((building) => building?.kind === kind && amount(building.level))
      .map(({ level }) => level);
    const level = Math.max(0, ...valid);
    if (level > 0) buildings[slot] = { kind, level };
  }
  return { materials, buildings };
}

export function constructionShortages(cost, gold, materials) {
  const balances = { ...materials, gold };
  return Object.entries(cost).flatMap(([key, price]) =>
    price > balances[key] ? [[key, price - balances[key]]] : []);
}

export function creditMaterials(materials, reward) {
  const entries = Object.entries(reward ?? {});
  if (!entries.length || entries.some(([key, value]) =>
    !Object.hasOwn(MATERIALS, key) || !amount(value) || !amount(materials[key] + value))) return false;
  for (const [key, value] of entries) materials[key] += value;
  return true;
}
