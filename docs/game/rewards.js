import { FACTIONS, NEUTRAL, NEUTRAL_CARDS } from './cards.js?v=orbital-strike-1';
import { copyLimit, PRESETS } from './decks.js?v=orbital-strike-1';

export const STARTING_KEYS = 25;
export const STARTING_ESSENCE = 800;
export const BOOSTER_PRICE = 100;
export const BOOSTER_SIZE = 5;
export const BOOSTER_RARITY_WEIGHTS = Object.freeze({ bronze: 75, epic: 20, gold: 5 });

const ESSENCE_COSTS = {
  bronze: { craft: 100, dismantle: 20 },
  epic: { craft: 400, dismantle: 100 },
  gold: { craft: 800, dismantle: 200 },
};

export function craftPrice(card) {
  return ESSENCE_COSTS[card.rarity]?.craft ?? ESSENCE_COSTS.bronze.craft;
}
export function dismantleValue(card) {
  return ESSENCE_COSTS[card.rarity]?.dismantle ?? ESSENCE_COSTS.bronze.dismantle;
}

export const REWARD_STORAGE_KEY = 'gatefall.reward-book';

// Preserve reward IDs, prices, and the original prerequisites for saved purchases.
const stops = [
  ['signal', null, 1],
  ['supply', 'signal', 2],
  ['junction', 'supply', 2],
  ['upper-cache', 'junction', 2],
  ['upper-relay', 'upper-cache', 3],
  ['upper-vault', 'upper-relay', 4],
  ['upper-finish', 'upper-vault', 6],
  ['lower-cache', 'junction', 2],
  ['lower-relay', 'lower-cache', 3],
  ['lower-vault', 'lower-relay', 4],
  ['lower-finish', 'lower-vault', 6],
  ['upper-conduit', 'upper-relay', 1],
  ['upper-watch', 'upper-conduit', 2],
  ['upper-depot', 'upper-watch', 2],
  ['upper-beacon', 'upper-depot', 3],
  ['upper-horizon', 'upper-beacon', 5],
  ['lower-conduit', 'lower-relay', 1],
  ['lower-watch', 'lower-conduit', 2],
  ['lower-depot', 'lower-watch', 2],
  ['lower-beacon', 'lower-depot', 3],
  ['lower-horizon', 'lower-beacon', 5],
];

export const BOOSTER_FACTIONS = [
  { id: 'protectorate', name: FACTIONS.protectorate.name, image: 'bastion.webp' },
  { id: 'growth', name: FACTIONS.growth.name, image: 'incubator.webp' },
  { id: NEUTRAL, name: 'Нейтральные', image: 'world-gates.webp' },
];

// Columns run from entry to finale. A null leaves a gap between lanes.
const layouts = {
  protectorate: {
    columns: [[0], [1], [2], [3, 7], [4, 8], [5, 11, 16, 9], [6, 12, 17, 10],
      [null, 13, 18, null], [null, 14, 19, null], [15, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 15], [4, 11, 12, 13, 14, 15],
      [2, 7, 8, 9, 10, 20], [8, 16, 17, 18, 19, 20]],
  },
  growth: {
    columns: [[0], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11, 16], [6, 12, 17],
      [null, 13, 18], [null, 14, 19], [15, 20, null]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 15, 20], [3, 11, 12, 13, 14, 20],
      [0, 7, 8, 9, 10, 16, 17, 18, 19, 20]],
  },
  neutral: {
    columns: [[0], [1], [2, 3, 7], [11, 4, 8], [12, 5, 9], [13, 6, 10],
      [14, 16, 17], [null, 18, 19], [15, null, 20]],
    paths: [[0, 1, 2, 11, 12, 13, 14, 15], [1, 3, 4, 5, 6, 16, 18, 15],
      [1, 7, 8, 9, 10, 17, 19, 20], [7, 8, 16, 18, 20]],
  },
  'debris-belt': {
    columns: [[0], [1], [2], [3, 7], [4, 8], [5, 9], [6, 16, 11, 10],
      [12, 13, 17, 18], [14, 15, 19, null], [null, null, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 12, 14, 20], [4, 11, 13, 15, 20],
      [2, 7, 8, 9, 10, 17, 19, 20], [8, 16, 18, 20]],
  },
  'border-station': {
    columns: [[0], [1, 7], [2, 8], [3, 9], [4, 10, 16], [5, 11, 17],
      [6, 12, 18], [13, 14, 19], [15, 20]],
    paths: [[0, 1, 2, 3, 4, 5, 6, 13, 15], [3, 11, 12, 14, 15],
      [0, 7, 8, 9, 10, 11], [9, 16, 17, 18, 19, 20], [12, 20]],
  },
};

// The longer chapters award some keys along the way to fund later stops.
const frontier = {
  'debris-belt': {
    columns: [[0], [null, 21], [1], [22, null], [2], [3, null, null, 7],
      [null, 23, null, 25], [4, null, 8, null], [null, 24, null, 9],
      [5, null, 26, null], [6, null, null, 10], [27], [null, 11, null, 16],
      [12, null, 17, null], [13, null, null, 18], [null, 14, 19, null],
      [15, null, null, 28], [20]],
    paths: [[0, 21, 1, 22, 2, 3, 23, 4, 24, 5, 6, 27, 11, 12, 13, 14, 15, 20],
      [2, 7, 25, 8, 9, 26, 10, 27, 16, 17, 18, 19, 28, 20], [4, 9], [12, 18]],
    rewards: [
      ['drift-cache', 1, 'Тайник в обшивке', 'gold', 45, 8],
      ['scrap-bin', 1, 'Кладовая сборщиков', 'essence', 35],
      ['rescue-locker', 2, 'Шкаф спасателей', 'booster', 1, 6],
      ['lost-manifest', 3, 'Утерянная ведомость', 'gold-stack', 150],
      ['smuggler-cache', 2, 'Тайник контрабандистов', 'essence', 50, 6],
      ['silent-beacon', 3, 'Безмолвный маяк', 'booster', 1],
      ['salvage-hub', 5, 'Биржа обломков', 'gold-stack', 240, 18],
      ['drift-banner', 5, 'Знамя пустотников', 'card-back', 'Знамя пустотников'],
    ],
  },
  'border-station': {
    columns: [[0], [21, null], [null, 1], [2], [null, 22], [3, null, 7],
      [null, 4, null, 8], [23, null, 9, null], [5, null, null, 24],
      [null, 6, 10, null], [null, 11], [25], [12, null], [13, null, null, 16],
      [null, 26, 17, null], [null, 14, null, 18], [27, null, 19], [15, null, 20]],
    paths: [[0, 21, 1, 2, 22, 3, 4, 23, 5, 6, 11, 25, 12, 13, 26, 14, 27, 15],
      [22, 7, 8, 9, 24, 10, 11], [12, 16, 17, 18, 19, 20], [4, 9], [26, 18]],
    rewards: [
      ['recon-cache', 1, 'Запас разведчиков', 'gold', 50, 8],
      ['escort-dock', 2, 'Шлюз эскорта', 'booster', 1, 5],
      ['encrypted-log', 2, 'Шифрованный журнал', 'essence', 50],
      ['reserve-warehouse', 3, 'Резервный склад', 'gold-stack', 150],
      ['dispatch-center', 4, 'Диспетчерский узел', 'booster', 2, 19],
      ['customs-lockbox', 4, 'Сейф таможни', 'essence', 75],
      ['bastion-deck', 5, 'Палуба бастиона', 'battlefield', 'Палуба бастиона'],
    ],
  },
};

function chapter(id, title, faction, rewards, image = faction.image) {
  const extension = frontier[id];
  const { columns, paths } = extension ?? layouts[id];
  const fullId = (stop) => id + ':' + stop;
  const nodes = stops.map(([stop, legacyParent, cost], index) => {
    const [label, kind, value] = rewards[index];
    return { id: fullId(stop), legacyParents: legacyParent ? [fullId(legacyParent)] : [],
      parents: [], finale: true, cost, label, kind, value };
  });
  if (extension) {
    for (const path of layouts[id].paths) {
      for (let i = 1; i < path.length; i++) nodes[path[i]].legacyParents.push(nodes[path[i - 1]].id);
    }
    for (const [stop, cost, label, kind, value, keyReward = 0] of extension.rewards) {
      nodes.push({ id: fullId(stop), legacyParents: [], parents: [], finale: true, cost, label, kind, value, keyReward });
    }
  }
  columns.forEach((column, x) => column.forEach((index, y) => {
    if (index === null) return;
    nodes[index].x = 6 + 88 * x / (columns.length - 1);
    nodes[index].y = 12 + 76 * (y + .5) / column.length;
  }));
  for (const path of paths) {
    for (let index = 1; index < path.length; index++) {
      const parent = nodes[path[index - 1]];
      const child = nodes[path[index]];
      if (!child.parents.includes(parent.id)) child.parents.push(parent.id);
      parent.finale = false;
    }
  }
  return { id, title, faction: faction.id, image, nodes, tall: Boolean(extension) };
}

const [protectorate, growth, neutral] = BOOSTER_FACTIONS;

export const REWARD_SECTIONS = [
  {
    id: 'gate-signals', title: 'Сигналы Врат',
    chapters: [
      chapter('protectorate', 'Орбитальный рубеж', protectorate, [
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
        ['Зонд наблюдения', 'essence', 25],
        ['Склад дозора', 'gold', 65],
        ['Резерв эскадры', 'booster', 1],
        ['Архив шифров', 'essence', 90],
        ['Герб эскадры', 'card-back', 'Герб эскадры'],
        ['Тыловой пост', 'gold', 45],
        ['Патрульный ангар', 'booster', 1],
        ['Верфь', 'essence', 60],
        ['Контракт флота', 'gold-stack', 180],
        ['Ночная верфь', 'battlefield', 'Ночная верфь'],
      ]),
      chapter('growth', 'Сады под куполом', growth, [
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
        ['Ядро споры', 'essence', 30],
        ['Банк пыльцы', 'gold', 45],
        ['Теплица', 'booster', 1],
        ['Зелёный янтарь', 'essence', 95],
        ['Цветущий рой', 'card-back', 'Цветущий рой'],
        ['Хранилище семян', 'gold', 65],
        ['Споровая колыбель', 'booster', 1],
        ['Глубокие корни', 'essence', 50],
        ['Клад под куполом', 'gold-stack', 170],
        ['Мицелиевая долина', 'battlefield', 'Мицелиевая долина'],
      ]),
      chapter('neutral', 'Дальние Врата', neutral, [
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
        ['Буй навигации', 'gold', 40],
        ['Торговый контейнер', 'booster', 1],
        ['Отражатель сигнала', 'essence', 55],
        ['Аванс каравана', 'gold-stack', 200],
        ['Звёздный компас', 'card-back', 'Звёздный компас'],
        ['Аварийный канал', 'essence', 25],
        ['Капсула без номера', 'booster', 1],
        ['Ремонтный док', 'gold', 75],
        ['Обломок Врат', 'essence', 110],
        ['Приют на орбите', 'battlefield', 'Приют на орбите'],
      ]),
    ],
  },
  {
    id: 'far-frontier', title: 'Дальний рубеж',
    chapters: [
      chapter('debris-belt', 'Заброшенный пояс', neutral, [
        ['Запись разведчика', 'essence', 25],
        ['Контейнер у обломков', 'booster', 1],
        ['Страховка грузовика', 'gold', 50],
        ['Внешний маяк', 'gold', 75],
        ['Контрабандный груз', 'booster', 1],
        ['Казна спасателей', 'gold-stack', 230],
        ['Метка спасателя', 'card-back', 'Метка спасателя'],
        ['Мастерская сборщиков', 'essence', 45],
        ['Аварийная шлюпка', 'booster', 1],
        ['Запечатанный отсек', 'gold-stack', 250],
        ['Кладбище кораблей', 'battlefield', 'Кладбище кораблей'],
        ['Фрагмент антенны', 'essence', 30],
        ['Малый склад', 'gold', 60],
        ['Ретранслятор пояса', 'booster', 1],
        ['Ядро памяти', 'essence', 90],
        ['Знак сборщиков', 'card-back', 'Знак сборщиков'],
        ['Кольцо антенн', 'gold', 55],
        ['Забытый контейнер', 'booster', 1],
        ['Осколки ядра', 'essence', 60],
        ['Запас экспедиции', 'gold-stack', 185],
        ['Туман обломков', 'battlefield', 'Туман обломков'],
      ], 'gate-relic.webp'),
      chapter('border-station', 'Пограничная станция', protectorate, [
        ['Сигнал дозора', 'gold', 45],
        ['Ящик снабжения', 'booster', 1],
        ['Шифры караула', 'essence', 35],
        ['Дежурный пост', 'gold', 70],
        ['Груз с орбиты', 'booster', 1],
        ['Казна станции', 'gold-stack', 225],
        ['Печать дозора', 'card-back', 'Печать дозора'],
        ['Окно связи', 'essence', 40],
        ['Резервный шлюз', 'booster', 1],
        ['Запас экспедиции', 'gold-stack', 270],
        ['Зал пограничной станции', 'battlefield', 'Зал пограничной станции'],
        ['Ближняя антенна', 'essence', 20],
        ['Топливный склад', 'gold', 65],
        ['Ангар разведки', 'booster', 1],
        ['Сигнальный архив', 'essence', 100],
        ['Герб станции', 'card-back', 'Герб станции'],
        ['Капсула связи', 'gold', 50],
        ['Запасной контейнер', 'booster', 1],
        ['Пульт защиты', 'essence', 65],
        ['Касса снабжения', 'gold-stack', 190],
        ['На границе сектора', 'battlefield', 'На границе сектора'],
      ], 'orbital-shield.webp'),
    ],
  },
];

const chapters = REWARD_SECTIONS.flatMap((section) => section.chapters);
const nodesById = new Map(chapters.flatMap(({ nodes }) => nodes.map((node) => [node.id, node])));

const routeOpen = (node, unlocked) => !node.parents.length || node.parents.some((parent) => unlocked.has(parent));

function readProgress(ids) {
  const unlocked = new Set();
  let keys = STARTING_KEYS;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const node = nodesById.get(id);
      if (!node || unlocked.has(id) || node.cost > keys || (!routeOpen(node, unlocked) && !node.legacyParents.some((parent) => unlocked.has(parent)))) continue;
      unlocked.add(id);
      keys += (node.keyReward ?? 0) - node.cost;
    }
  }
  return { keys, unlocked };
}

export function rewardState(node, { keys, unlocked }) {
  if (unlocked.has(node.id)) return 'unlocked';
  if (!routeOpen(node, unlocked)) return 'locked';
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

export function drawBoosterCards(pool, random = Math.random) {
  const available = Object.entries(BOOSTER_RARITY_WEIGHTS).map(([rarity, weight]) => ({
    rarity, weight, cards: pool.filter((card) => card.rarity === rarity),
  }));
  const pack = [];
  while (pack.length < BOOSTER_SIZE) {
    const remaining = available.filter(({ cards }) => cards.length);
    if (!remaining.length) break;
    const needsRare = pack.length === BOOSTER_SIZE - 1 && pack.every(({ rarity }) => rarity === 'bronze');
    const rare = needsRare ? remaining.filter(({ rarity }) => rarity !== 'bronze') : [];
    const eligible = rare.length ? rare : remaining;
    let roll = random() * eligible.reduce((total, { weight }) => total + weight, 0);
    const { cards } = eligible.find(({ weight }) => (roll -= weight) < 0) ?? eligible[0];
    pack.push(cards.splice(Math.floor(random() * cards.length), 1)[0]);
  }
  return pack;
}

function readPack(pack) {
  const faction = pools.get(pack?.faction);
  if (!faction || !count(pack.id) || !Array.isArray(pack.cards) || pack.cards.length !== BOOSTER_SIZE ||
      new Set(pack.cards).size !== BOOSTER_SIZE ||
      !pack.cards.every((id) => definitions.get(id)?.faction === pack.faction)) return null;
  const { id, cards } = pack;
  return { id, faction: pack.faction, cards, essenceByCard: countsFor(cards, pack.essenceByCard) };
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
    const boosters = Object.fromEntries(BOOSTER_FACTIONS.map(({ id }) => [id, purchased[id] - opened[id]]));
    for (const { faction, nodes } of chapters) {
      for (const node of nodes) {
        if (!progress.unlocked.has(node.id)) continue;
        if (node.kind === 'gold' || node.kind === 'gold-stack') gold += node.value;
        if (node.kind === 'essence') essence += node.value;
        if (node.kind === 'booster') boosters[faction] += node.value;
      }
    }
    for (const id of Object.keys(boosters)) boosters[id] = Math.max(0, boosters[id]);
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
        const { boosters, owned } = balances(state);
        if (!boosters[id]) return 'empty';
        const cards = drawBoosterCards(pools.get(id), random);
        const essenceByCard = {};
        state.opened[id] += 1;
        for (const card of cards) {
          if (owned[card.id] < copyLimit(card)) state.earnedCards[card.id] += 1;
          else {
            const essence = dismantleValue(card);
            state.dismantlingEssence += essence;
            essenceByCard[card.id] = essence;
          }
        }
        const number = Object.values(state.opened).reduce((sum, value) => sum + value, 0);
        state.pendingPack = { id: number, faction: id, cards: cards.map((card) => card.id), essenceByCard };
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
