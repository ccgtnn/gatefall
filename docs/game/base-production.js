import { BUILDINGS, productionHours, productionRates } from './base.js?v=base-production-1';

const HOUR = 3_600_000;
// Sixteenths keep every level's hourly rate exact while retaining fractional resources.
const TICKS_PER_RESOURCE = HOUR * 16;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

export function readProduction(saved, buildings) {
  const stock = {};
  for (const { kind } of Object.values(buildings)) {
    const rates = BUILDINGS[kind].production;
    if (!rates) continue;
    stock[kind] = Object.fromEntries(Object.keys(rates).map((key) => {
      const ticks = saved?.stock?.[kind]?.[key];
      return [key, isCount(ticks) ? ticks : 0];
    }));
  }
  return { at: isCount(saved?.at) ? saved.at : null, stock };
}

export function advanceProduction(production, buildings, now) {
  if (production.at === null) {
    production.at = now;
    return;
  }
  const hours = productionHours(buildings.warehouse?.level);
  const elapsed = Math.min(Math.max(0, now - production.at), hours * HOUR);
  production.at = Math.max(production.at, now);
  for (const { kind, level } of Object.values(buildings)) {
    const stock = production.stock[kind];
    if (!stock) continue;
    for (const [key, rate] of Object.entries(productionRates(kind, level))) {
      stock[key] = Math.min(rate * hours * TICKS_PER_RESOURCE, stock[key] + elapsed * rate * 16);
    }
  }
}

export function productionView(production, buildings) {
  const hours = productionHours(buildings.warehouse?.level);
  return Object.fromEntries(Object.values(buildings).filter(({ kind }) => production.stock[kind])
    .map(({ kind, level }) => {
      const stock = production.stock[kind];
      const rates = productionRates(kind, level);
      const outputs = Object.fromEntries(Object.entries(rates).map(([key, rate]) => [
        key, { stored: Math.floor(stock[key] / TICKS_PER_RESOURCE), capacity: rate * hours },
      ]));
      const fill = Math.min(...Object.entries(rates)
        .map(([key, rate]) => stock[key] / (rate * hours * TICKS_PER_RESOURCE)));
      return [kind, { outputs, fill, full: fill >= 1 }];
    }));
}

export function takeProduction(production, kind) {
  const rewards = {};
  const entries = kind === undefined ? Object.values(production.stock) : [production.stock[kind]];
  for (const stock of entries) {
    for (const [key, ticks] of Object.entries(stock ?? {})) {
      const units = Math.floor(ticks / TICKS_PER_RESOURCE);
      if (!units) continue;
      rewards[key] = (rewards[key] ?? 0) + units;
      stock[key] = ticks - units * TICKS_PER_RESOURCE;
    }
  }
  return rewards;
}
