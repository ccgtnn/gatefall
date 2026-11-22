export const BASE_PLOTS = Object.freeze(['1', '2', '3', '4', '5', '6']);
export const MATERIALS = Object.freeze({
  steel: 'Сталь',
  energyCells: 'Энергоячейки',
  gateShards: 'Осколки врат',
});
export const STARTING_MATERIALS = Object.freeze({ steel: 200, energyCells: 100, gateShards: 5 });
export const BUILDINGS = Object.freeze({
  tavern: Object.freeze({
    name: 'Таверна',
    description: 'Место встречи командиров и наёмников. На первом уровне открывает один слот ежедневных заданий.',
    cost: Object.freeze({ gold: 300, steel: 150, energyCells: 50 }),
    dailySlots: Object.freeze([1]),
  }),
});

const amount = (value) => Number.isSafeInteger(value) && value >= 0;

export function readBase(saved) {
  const materials = Object.fromEntries(Object.entries(STARTING_MATERIALS).map(([key, initial]) => {
    const value = saved?.materials?.[key];
    return [key, amount(value) ? value : initial];
  }));
  const buildings = {};
  for (const plot of BASE_PLOTS) {
    const building = saved?.buildings?.[plot];
    if (Object.hasOwn(BUILDINGS, building?.kind) && amount(building.level) && building.level > 0) {
      buildings[plot] = { kind: building.kind, level: building.level };
    }
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
