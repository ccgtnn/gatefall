import { FACTIONS } from './cards.js';

export const UPCOMING_FACTIONS = Object.freeze({
  flawless: { name: 'Безупречные', description: 'Инопланетная цивилизация с передовыми технологиями.' },
  captains: { name: 'Вольные капитаны', description: 'Бродяги, аферисты, пираты и независимые капитаны.' },
  core: { name: 'Ядро', description: 'Роботы и искусственные интеллекты.' },
  void: { name: 'Пустота', description: 'Загадочный народ из глубин космоса.' },
});

export const FACTION_CATALOG = Object.freeze({ ...FACTIONS, ...UPCOMING_FACTIONS });
