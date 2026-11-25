import { FACTIONS, LARVA } from './cards.js';
import { NEUTRAL } from './card-metadata.js';

export const TAVERN_REWARDS = Object.freeze({
  normal: Object.freeze({ keys: 2, gold: 100 }),
  hard: Object.freeze({ keys: 3, gold: 150, steel: 50 }),
});

export const TAVERN_QUESTS = Object.freeze([
  ['wins', 'Выиграй 2 матча', 2, 'hard'],
  ['matches', 'Сыграй 3 матча', 3],
  ['cards-growth', 'Сыграй 10 карт Поросли', 10, 'hard'],
  ['cards-protectorate', 'Сыграй 10 карт Протектората', 10, 'hard'],
  ['cards-neutral', 'Сыграй 10 нейтральных карт', 10, 'hard'],
  ['win-growth', 'Победи с колодой Поросли', 1, 'hard'],
  ['win-protectorate', 'Победи с колодой Протектората', 1, 'hard'],
  ['damage', 'Нанеси 30 урона', 30],
  ['targets', 'Наложи 5 меток «Цель»', 5],
  ['larvae', 'Породи 10 личинок', 10],
  ['league', 'Сыграй матч в Лиге', 1],
  ['booster', 'Открой 1 бустер', 1],
  ['collect', 'Собери ресурсы на базе', 1],
].map(([id, title, goal, difficulty = 'normal']) =>
  Object.freeze({ id, title, goal, reward: TAVERN_REWARDS[difficulty] })));

export const TAVERN_QUEST_BY_ID = new Map(TAVERN_QUESTS.map((quest) => [quest.id, quest]));
export const questComplete = ({ id, progress }) => progress >= TAVERN_QUEST_BY_ID.get(id).goal;

function localDay(time) {
  const midnight = new Date(time);
  midnight.setHours(0, 0, 0, 0);
  const day = [midnight.getFullYear(), midnight.getMonth() + 1, midnight.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
  midnight.setDate(midnight.getDate() + 1);
  return { day, resetAt: midnight.getTime() };
}

function drawQuest(tavern, random) {
  const excluded = new Set([...tavern.slots.map(({ id }) => id), tavern.replaced]);
  const pool = TAVERN_QUESTS.filter(({ id }) => !excluded.has(id));
  const { id } = pool[Math.floor(random() * pool.length)];
  return { id, key: `${tavern.day}/${id}`, progress: 0, claimed: false };
}

export function syncTavern(state, level, time, random) {
  if (!level) return null;
  const calendar = localDay(time);
  let next = state;
  if (!state || calendar.day > state.day) {
    const saved = state?.slots.filter((quest) => questComplete(quest) && !quest.claimed) ?? [];
    next = { ...calendar, slots: [], pending: [...(state?.pending ?? []), ...saved], replaced: null, cursors: {}, finished: [] };
  }
  if (next.slots.length >= level) return next;
  if (next === state) next = { ...state, slots: [...state.slots] };
  while (next.slots.length < level) next.slots.push(drawQuest(next, random));
  return next;
}

export function replaceTavernQuest(state, key, random) {
  if (!state || state.replaced) return false;
  const index = state.slots.findIndex((quest) => quest.key === key && !questComplete(quest));
  if (index < 0) return false;
  state.replaced = state.slots[index].id;
  state.slots[index] = drawQuest(state, random);
  return true;
}

export function advanceTavern(state, amounts) {
  let changed = false;
  for (const quest of state?.slots ?? []) {
    const next = Math.min(TAVERN_QUEST_BY_ID.get(quest.id).goal, quest.progress + (amounts[quest.id] ?? 0));
    if (next === quest.progress) continue;
    quest.progress = next;
    changed = true;
  }
  return changed;
}

export function tavernEventAmounts(events) {
  const amounts = {};
  const add = (id, value = 1) => { amounts[id] = (amounts[id] ?? 0) + value; };
  for (const event of events) {
    const { side, attacker, type, status, amount } = event;
    if (type === 'play' && side === 'human') {
      const faction = event.card?.definition.faction;
      if (faction === NEUTRAL || Object.hasOwn(FACTIONS, faction)) add('cards-' + faction);
    }
    if (type === 'spawn' && side === 'human' && !event.from) {
      for (const card of event.cards) if (card.definition.id === LARVA.id) add('larvae');
    }
    if (side !== 'bot' || attacker !== 'human') continue;
    if (type === 'damage') add('damage', event.lost + event.absorbed);
    if (type === 'status' && status === 'target' && amount > 0) add('targets', amount);
    if (type === 'status' && status === 'infection' && event.tick && !event.blocked) add('damage');
  }
  return amounts;
}

export function trackTavernMatch(state, id, result, factionId, league) {
  if (!state || !Object.hasOwn(FACTIONS, factionId) || state.finished.includes(id)) return false;
  const win = result === 'win';
  advanceTavern(state, { matches: 1, league: Number(league), wins: Number(win), ['win-' + factionId]: Number(win) });
  state.finished.push(id);
  return true;
}
