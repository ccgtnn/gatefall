// Plot order is also the drawing order, from farthest to nearest.
export const BASE_PLOTS = Object.freeze(['1', '2', '3', '4', '5', '6']);
export const MATERIALS = Object.freeze({
  steel: 'Сталь',
  energyCells: 'Энергоячейки',
  gateShards: 'Осколки врат',
});
const LEGACY_MATERIALS = Object.freeze({ steel: 200, energyCells: 100, gateShards: 5 });
export const STARTING_MATERIALS = Object.freeze({ steel: 0, energyCells: 0, gateShards: 0 });
export const MAX_BUILDING_LEVEL = 5;
export const BUILDINGS = Object.freeze({
  outpost: { name: 'Форпост', art: 'outpost', cost: { gold: 500, steel: 150, energyCells: 100 }, production: { keys: 1 / 8 } },
  tavern: { name: 'Таверна', plot: '5', art: 'tavern', cost: { gold: 300, steel: 150, energyCells: 50 }, effect: (level) => `Ежедневные задания · слотов: ${level}` },
  mine: { name: 'Шахта', plot: '2', art: 'mine', cost: { gold: 400, steel: 100, energyCells: 50 }, production: { steel: 20, gold: 10 } },
  power: { name: 'Энергостанция', art: 'power', cost: { gold: 350, steel: 75, energyCells: 25 }, production: { energyCells: 10 } },
  warehouse: { name: 'Склад', art: 'warehouse', cost: { gold: 250, steel: 80, energyCells: 25 }, effect: (level) => `Запас производства · ${productionHours(level)} ч на здание` },
  gate: { name: 'Врата', art: 'gate', cost: { gold: 600, steel: 150, energyCells: 75, gateShards: 5 }, effect: (level) => `Испытания в неделю: ${level >= 3 ? 2 : 1}${level >= 5 ? ' · бонусные модификаторы и награды' : ''} · скоро`, details: 'Испытание против особых противников.' },
});
export const BUILDING_BY_PLOT = Object.freeze(Object.fromEntries(
  Object.entries(BUILDINGS).filter(([, { plot }]) => plot).map(([kind, { plot }]) => [plot, kind]),
));

export function buildingSlot(kind) {
  return Object.hasOwn(BUILDINGS, kind) ? BUILDINGS[kind].plot ?? kind : undefined;
}

export function buildingPrice(kind, level) {
  if (!Object.hasOwn(BUILDINGS, kind) || !Number.isInteger(level) || level < 1 || level > MAX_BUILDING_LEVEL) return;
  const { cost } = BUILDINGS[kind];
  if (level === 1) return cost;
  const multiplier = 1.5 ** (level - 1);
  const price = {
    gold: Math.ceil(cost.gold * multiplier / 4),
    steel: Math.ceil(cost.steel * multiplier),
    energyCells: Math.ceil(cost.energyCells * multiplier),
  };
  if (level >= 4) price.gateShards = level === 4 ? 2 : 5;
  return price;
}

export function productionHours(warehouseLevel = 0) {
  return warehouseLevel ? 12 + 6 * (warehouseLevel - 1) : 8;
}

export function productionRates(kind, level) {
  const rates = BUILDINGS[kind]?.production;
  return rates && Object.fromEntries(Object.entries(rates).map(([key, rate]) => [key, rate * 1.5 ** (level - 1)]));
}

const outputNames = { gold: 'золота', steel: 'стали', energyCells: 'энергоячеек' };
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 4 });
const intervalNumber = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });

export function buildingEffect(kind, level = 1) {
  const rates = productionRates(kind, level);
  if (kind === 'outpost') {
    return `1 ключ за ${intervalNumber.format(1 / rates.keys)} ч · +${level * 5}% золота за победу`;
  }
  if (rates) {
    return Object.entries(rates).map(([key, rate]) => number.format(rate) + ' ' + outputNames[key]).join(' + ') + ' / ч';
  }
  const { effect } = BUILDINGS[kind];
  return typeof effect === 'function' ? effect(level) : effect;
}

const amount = (value) => Number.isSafeInteger(value) && value >= 0;

export function readBase(saved, fresh = false) {
  const materials = Object.fromEntries(Object.entries(fresh ? STARTING_MATERIALS : LEGACY_MATERIALS).map(([key, initial]) => {
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
