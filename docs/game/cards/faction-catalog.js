import { FACTIONS } from './cards.js';

export const UPCOMING_FACTIONS = Object.freeze({
  flawless: { name: 'Безупречные', description: 'Инопланетная цивилизация с передовыми технологиями.' },
  void: { name: 'Пустота', description: 'Загадочный народ из глубин космоса.' },
});

export const FACTION_CATALOG = Object.freeze({ ...FACTIONS, ...UPCOMING_FACTIONS });
