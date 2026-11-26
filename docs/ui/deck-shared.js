import { MIN_CARDS, MIN_UNITS } from '../game/decks.js';

export const byProvision = (a, b) => b.provision - a.provision || a.name.localeCompare(b.name, 'ru');

export function violations(result) {
  const messages = {
    name: 'Укажи название колоды.',
    cards: 'Нужно минимум ' + MIN_CARDS + ' карт.',
    units: 'Нужно минимум ' + MIN_UNITS + ' отрядов.',
    provisions: 'Лимит провизии ' + result.budget + ' превышен.',
    copies: 'Лимит копий: обычные ×2, эпические и легендарные ×1.',
    ownership: 'В коллекции отсутствуют копии · ' + [...result.missing.values()].reduce((sum, copies) => sum + copies, 0) + '.',
    foreign: 'Убери карты, недоступные этой фракции.',
    leader: 'Выбери лидера своей фракции.',
  };
  return Object.keys(messages).filter((key) => result.issues[key]).map((key) => messages[key]);
}
