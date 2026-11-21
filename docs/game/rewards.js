import { FACTIONS, NEUTRAL, NEUTRAL_CARDS } from './cards.js?v=storm-eye-1';
import { copyLimit, PRESETS } from './decks.js?v=collection-2';

export const STARTING_KEYS = 25;
export const STARTING_ESSENCE = 800;
export const BOOSTER_PRICE = 100;
export const BOOSTER_SIZE = 5;

export function craftPrice(card) {
  return card.rarity === 'gold' ? 800 : 100;
}
export function dismantleValue(card) {
  return card.rarity === 'gold' ? 200 : 20;
}

export const REWARD_STORAGE_KEY = 'gatefall.reward-book';

const route = [
  ['signal', null, 9, 50, 1],
  ['supply', 'signal', 23, 50, 2],
  ['junction', 'supply', 37, 50, 2],
  ['upper-cache', 'junction', 48, 23, 2],
  ['upper-relay', 'upper-cache', 62, 16, 3],
  ['upper-vault', 'upper-relay', 75, 30, 4],
  ['upper-finish', 'upper-vault', 90, 17, 6],
  ['lower-cache', 'junction', 49, 77, 2],
  ['lower-relay', 'lower-cache', 62, 85, 3],
  ['lower-vault', 'lower-relay', 76, 63, 4],
  ['lower-finish', 'lower-vault', 90, 79, 6],
];

function page(id, name, title, image, rewards) {
  return {
    id, name, title, image,
    nodes: route.map(([stop, parent, x, y, cost], index) => {
      const [label, kind, value] = rewards[index];
      return { id: id + ':' + stop, parent: parent ? id + ':' + parent : null, x, y, cost, label, kind, value };
    }),
  };
}

export const REWARD_PAGES = [
  page('protectorate', 'Протекторат', 'Орбитальный рубеж', 'bastion.webp', [
    ['Первый сигнал', 'gold', 40],
    ['Склад гарнизона', 'booster', 1],
    ['Ретранслятор', 'essence', 30],
    ['Патрульный пост', 'gold', 75],
    ['Арсенал', 'booster', 1],
    ['Казна сектора', 'gold-stack', 250],
    ['Стальной штандарт', 'card-back', 'Стальной штандарт'],
    ['Плавильня', 'essence', 55],
    ['Штаб флота', 'booster', 1],
    ['Хранилище флота', 'gold-stack', 300],
    ['Орбитальный рубеж', 'battlefield', 'Орбитальный рубеж'],
  ]),
  page('growth', 'Поросль', 'Сады под куполом', 'incubator.webp', [
    ['Живая искра', 'essence', 25],
    ['Кладка', 'booster', 1],
    ['Корневой узел', 'gold', 60],
    ['Светящиеся споры', 'essence', 45],
    ['Камера роста', 'booster', 1],
    ['Кристаллическая жила', 'gold-stack', 240],
    ['Споровый герб', 'card-back', 'Споровый герб'],
    ['Затерянный тайник', 'gold', 85],
    ['Подземное гнездо', 'essence', 70],
    ['Семенной резерв', 'booster', 2],
    ['Сады под куполом', 'battlefield', 'Сады под куполом'],
  ]),
  page('neutral', 'Нейтральные', 'Дальние Врата', 'world-gates.webp', [
    ['Маяк на выходе', 'gold', 50],
    ['Груз без метки', 'booster', 1],
    ['Перекрёсток', 'essence', 35],
    ['Вольный док', 'gold', 80],
    ['Обменный пост', 'essence', 65],
    ['Караванный резерв', 'gold-stack', 280],
    ['Компас странника', 'card-back', 'Компас странника'],
    ['Дрейфующий контейнер', 'booster', 1],
    ['Мастерская Врат', 'essence', 80],
    ['Архив переходов', 'booster', 2],
    ['Дальние Врата', 'battlefield', 'Дальние Врата'],
  ]),
];

const nodesById = new Map(REWARD_PAGES.flatMap(({ nodes }) => nodes.map((node) => [node.id, node])));

function readProgress(ids) {
  const unlocked = new Set();
  let keys = STARTING_KEYS;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const node = nodesById.get(id);
      if (!node || unlocked.has(id) || node.cost > keys || (node.parent && !unlocked.has(node.parent))) continue;
      unlocked.add(id);
      keys -= node.cost;
    }
  }
  return { keys, unlocked };
}

export function rewardState(node, { keys, unlocked }) {
  if (unlocked.has(node.id)) return 'unlocked';
  if (node.parent && !unlocked.has(node.parent)) return 'locked';
  return keys >= node.cost ? 'available' : 'unaffordable';
}

const pools = new Map(Object.entries(FACTIONS).map(([id, { pool }]) => [id, pool]));
pools.set(NEUTRAL, NEUTRAL_CARDS);
const definitions = new Map([...pools.values()].flat().map((card) => [card.id, card]));
const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;

function countsFor(keys, values) {
  return Object.fromEntries([...keys].map((id) => [id, count(values?.[id])]));
}

function starterCards(decks) {
  const cards = {};
  for (const { cardIds } of decks) {
    const quantities = new Map();
    for (const id of cardIds) {
      if (definitions.has(id)) quantities.set(id, (quantities.get(id) ?? 0) + 1);
    }
    for (const [id, quantity] of quantities) {
      cards[id] = Math.max(cards[id] ?? 0, Math.min(quantity, copyLimit(definitions.get(id))));
    }
  }
  return cards;
}

function packCards(id, random) {
  const pool = [...pools.get(id)];
  return Array.from({ length: BOOSTER_SIZE }, () =>
    pool.splice(Math.floor(random() * pool.length), 1)[0].id);
}

function readPack(pack) {
  const faction = pools.get(pack?.faction);
  if (!faction || !count(pack.id) || !Array.isArray(pack.cards) || pack.cards.length !== BOOSTER_SIZE ||
      new Set(pack.cards).size !== BOOSTER_SIZE ||
      !pack.cards.every((id) => definitions.get(id)?.faction === pack.faction)) return null;
  return pack;
}

export function createRewardProgress(storage, locks, { legacyDecks = [], random = Math.random } = {}) {
  const listeners = new Set();
  const starter = starterCards(PRESETS);
  const legacy = starterCards(legacyDecks);
  let saved = {};

  function read() {
    if (storage) {
      try { saved = JSON.parse(storage.getItem(REWARD_STORAGE_KEY)) ?? {}; } catch {}
    }
    return {
      progress: readProgress(saved.unlocked),
      legacy: saved.legacy ?? legacy,
      purchased: countsFor(pools.keys(), saved.purchased),
      opened: countsFor(pools.keys(), saved.opened),
      earnedCards: countsFor(definitions.keys(), saved.earnedCards),
      dismantledCards: countsFor(definitions.keys(), saved.dismantledCards),
      dismantlingEssence: count(saved.dismantlingEssence),
      essenceSpent: count(saved.essenceSpent),
      goldSpent: count(saved.goldSpent),
      pendingPack: readPack(saved.pendingPack),
    };
  }

  function balances({ progress, legacy, purchased, opened, earnedCards, dismantledCards, dismantlingEssence,
    essenceSpent, goldSpent, pendingPack }) {
    let gold = 0;
    let essence = STARTING_ESSENCE + dismantlingEssence;
    const boosters = {};
    for (const { id, nodes } of REWARD_PAGES) {
      boosters[id] = purchased[id] - opened[id];
      for (const node of nodes) {
        if (!progress.unlocked.has(node.id)) continue;
        if (node.kind === 'gold' || node.kind === 'gold-stack') gold += node.value;
        if (node.kind === 'essence') essence += node.value;
        if (node.kind === 'booster') boosters[id] += node.value;
      }
      boosters[id] = Math.max(0, boosters[id]);
    }
    const owned = {};
    for (const [id, card] of definitions) {
      const initial = Math.min(copyLimit(card), Math.max(starter[id] ?? 0, count(legacy[id])));
      owned[id] = Math.max(0, initial + earnedCards[id] - dismantledCards[id]);
    }
    return {
      keys: progress.keys, gold: Math.max(0, gold - goldSpent), essence: Math.max(0, essence - essenceSpent),
      boosters, packCount: Object.values(boosters).reduce((sum, value) => sum + value, 0), owned, pendingPack,
    };
  }

  function refresh() {
    for (const listener of listeners) listener();
  }

  async function transact(change) {
    const commit = () => {
      const state = read();
      const outcome = change(state);
      if (outcome !== 'opened' && outcome !== 'done') return outcome;
      const { progress, ...economy } = state;
      const next = { unlocked: [...progress.unlocked], ...economy };
      try { storage?.setItem(REWARD_STORAGE_KEY, JSON.stringify(next)); }
      catch { return 'unavailable'; }
      saved = next;
      return outcome;
    };
    let outcome;
    try { outcome = locks ? await locks.request(REWARD_STORAGE_KEY, commit) : commit(); }
    catch { return 'unavailable'; }
    if (outcome === 'opened' || outcome === 'done') refresh();
    return outcome;
  }

  return {
    get: () => read().progress,
    inventory: () => balances(read()),
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unlock(id) {
      const node = nodesById.get(id);
      if (!node) return Promise.resolve('unknown');
      return transact(({ progress }) => {
        const state = rewardState(node, progress);
        if (state !== 'available') return state;
        progress.unlocked.add(id);
        return 'opened';
      });
    },
    buyPack(id) {
      if (!pools.has(id)) return Promise.resolve('unknown');
      return transact((state) => {
        if (balances(state).gold < BOOSTER_PRICE) return 'unaffordable';
        state.purchased[id] += 1;
        state.goldSpent += BOOSTER_PRICE;
        return 'done';
      });
    },
    openPack(id) {
      if (!pools.has(id)) return Promise.resolve('unknown');
      return transact((state) => {
        if (state.pendingPack) return 'pending';
        if (!balances(state).boosters[id]) return 'empty';
        const cards = packCards(id, random);
        state.opened[id] += 1;
        for (const cardId of cards) state.earnedCards[cardId] += 1;
        const number = Object.values(state.opened).reduce((sum, value) => sum + value, 0);
        state.pendingPack = { id: number, faction: id, cards };
        return 'done';
      });
    },
    finishPack(id) {
      return transact((state) => {
        if (state.pendingPack?.id !== id) return 'unknown';
        state.pendingPack = null;
        return 'done';
      });
    },
    craft(id) {
      const card = definitions.get(id);
      if (!card) return Promise.resolve('unknown');
      return transact((state) => {
        const { essence, owned } = balances(state);
        if (owned[id] >= copyLimit(card)) return 'owned';
        const price = craftPrice(card);
        if (essence < price) return 'unaffordable';
        state.essenceSpent += price;
        state.earnedCards[id] += 1;
        return 'done';
      });
    },
    dismantle(id) {
      const card = definitions.get(id);
      if (!card) return Promise.resolve('unknown');
      return transact((state) => {
        if (!balances(state).owned[id]) return 'empty';
        state.dismantledCards[id] += 1;
        state.dismantlingEssence += dismantleValue(card);
        return 'done';
      });
    },
  };
}
