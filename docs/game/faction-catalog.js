import { FACTIONS } from './cards.js?v=hounds-1';

export const UPCOMING_FACTIONS = Object.freeze({
  flawless: { name: 'Безупречные', description: 'Инопланетная цивилизация с передовыми технологиями.' },
  captains: { name: 'Вольные капитаны', description: 'Бродяги, аферисты, пираты и независимые капитаны.' },
  core: { name: 'Ядро', description: 'Роботы и искусственные интеллекты.' },
  void: { name: 'Пустота', description: 'Загадочный народ из глубин космоса.' },
  choir: { name: 'Безмолвный хор', description: 'Псионики-аскеты, черпающие силу в космосе' },
});

export const FACTION_CATALOG = Object.freeze({ ...FACTIONS, ...UPCOMING_FACTIONS });
