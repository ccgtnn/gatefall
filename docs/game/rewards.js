import { rankRewards, syncRanks } from './ranks.js?v=monthly-ranks-1';
import { advanceTavern, questComplete, replaceTavernQuest, syncTavern, TAVERN_QUEST_BY_ID, tavernEventAmounts, trackTavernMatch } from './tavern.js?v=world-gates-premium-1-nc1';
import { createLeague, DIAMOND, finishLeagueMatch, leagueStake, needsLeagueReset, reserveLeagueMatch, resetLeagueWeek, upgradeLeague } from './league.js?v=world-gates-premium-1-nc1';
import { victoryGold, weeklyReward } from './outpost.js?v=base-outpost-1';
import { advanceProduction, productionView, readProduction, takeProduction } from './base-production.js?v=tavern-1';
import { buildingPrice, buildingSlot, constructionShortages, creditMaterials, readBase } from './base.js?v=match-rewards-1';
import { NEUTRAL } from './cards.js?v=world-gates-premium-1-nc1';
import { inspectDeck } from './decks.js?v=world-gates-premium-1-nc1';
import { BOOSTER_FACTIONS, collectionInventory, createCollectionActions, readCollection } from './collection-economy.js';

export { BOOSTER_FACTIONS, BOOSTER_PRICE, BOOSTER_RARITY_WEIGHTS, BOOSTER_SIZE, craftPrice, dismantleValue, drawBoosterCards }
  from './collection-economy.js';

export const STARTING_KEYS = 0;
export const STARTING_GOLD = 0;
export const STARTING_ESSENCE = 0;
const LEGACY_STARTING_KEYS = 25;
const LEGACY_STARTING_ESSENCE = 800;
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

function readProgress(ids, keys) {
  const unlocked = new Set();
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

const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
const startingBalance = (value, legacyAmount) => Number.isSafeInteger(value) && value >= 0 ? value : legacyAmount;

export function createRewardProgress(storage, locks, { random = Math.random, now = Date.now, enqueueReward: publishReward } = {}) {
  const listeners = new Set();
  let saved = null;
  let latestTime = 0;

  function observedTime(time = now()) {
    latestTime = Math.max(latestTime, time);
    return latestTime;
  }

  function read() {
    if (storage) {
      try { saved = JSON.parse(storage.getItem(REWARD_STORAGE_KEY)); } catch {}
    }
    const snapshot = saved ?? {};
    const fresh = saved === null;
    const base = readBase(snapshot.base, fresh);
    const startingKeys = fresh ? STARTING_KEYS : startingBalance(snapshot.startingKeys, LEGACY_STARTING_KEYS);
    const producedKeys = count(snapshot.producedKeys);
    const tavernKeys = count(snapshot.tavernKeys);
    const rankKeys = count(snapshot.rankKeys);
    return {
      startingGold: fresh ? STARTING_GOLD : count(snapshot.startingGold),
      startingKeys,
      startingEssence: fresh ? STARTING_ESSENCE : startingBalance(snapshot.startingEssence, LEGACY_STARTING_ESSENCE),
      progress: readProgress(snapshot.unlocked, startingKeys + producedKeys + tavernKeys + rankKeys),
      producedKeys, tavernKeys, rankKeys,
      ranks: snapshot.ranks ?? null,
      tavern: snapshot.tavern?.slots ? snapshot.tavern : null,
      ...readCollection(snapshot),
      dismantlingEssence: count(snapshot.dismantlingEssence),
      essenceSpent: count(snapshot.essenceSpent),
      goldSpent: count(snapshot.goldSpent),
      base,
      production: readProduction(snapshot.production, base.buildings),
      producedGold: count(snapshot.producedGold),
      rewardGold: count(snapshot.rewardGold),
      rewardedMatches: Array.isArray(snapshot.rewardedMatches) ? snapshot.rewardedMatches : [],
      lastWeeklyClaim: Number.isSafeInteger(snapshot.lastWeeklyClaim) ? snapshot.lastWeeklyClaim : null,
      league: snapshot.league?.season ? upgradeLeague(snapshot.league) : null,
    };
  }

  function balances(state) {
    const { progress, dismantlingEssence, essenceSpent, goldSpent, startingGold, startingEssence,
      producedGold, rewardGold, pendingPack } = state;
    let gold = startingGold + producedGold + rewardGold;
    let essence = startingEssence + dismantlingEssence;
    const { boosters, owned } = collectionInventory(state);
    for (const { faction, nodes } of chapters) {
      for (const node of nodes) {
        if (!progress.unlocked.has(node.id)) continue;
        if (node.kind === 'gold' || node.kind === 'gold-stack') gold += node.value;
        if (node.kind === 'essence') essence += node.value;
        if (node.kind === 'booster') boosters[faction] += node.value;
      }
    }
    for (const id of Object.keys(boosters)) boosters[id] = Math.max(0, boosters[id]);
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
      const rewards = [];
      const previousProductionAt = state.production.at;
      const time = now();
      advanceProduction(state.production, state.base.buildings, observedTime(time));
      const outcome = change(state, previousProductionAt, time, (entry) => rewards.push(entry));
      if (outcome !== 'opened' && outcome !== 'done') return outcome;
      const { progress, ...economy } = state;
      const next = { unlocked: [...progress.unlocked], ...economy };
      try { storage?.setItem(REWARD_STORAGE_KEY, JSON.stringify(next)); }
      catch { return 'unavailable'; }
      saved = next;
      // Publish in commit order, only after the balances and claim markers are saved.
      if (publishReward) for (const entry of rewards) {
        if (!Object.values(entry.reward).some((amount) => amount > 0)) continue;
        try { publishReward(entry); }
        catch (error) { console.warn('Reward reveal could not be queued', error); }
      }
      return outcome;
    };
    let outcome;
    try { outcome = locks ? await locks.request(REWARD_STORAGE_KEY, commit) : commit(); }
    catch { return 'unavailable'; }
    if (outcome === 'opened' || outcome === 'done') refresh();
    return outcome;
  }

  function keysWith(state, award) {
    return state.startingKeys + state.producedKeys + state.tavernKeys + state.rankKeys + award;
  }

  function creditRankRounds(state, id, rounds, time, enqueueReward) {
    if (!rounds) return true;
    const current = syncRanks(state.ranks, time);
    if (current.matches.includes(id)) return true;
    const next = current.rounds + rounds;
    if (!Number.isSafeInteger(next)) return false;
    const { keys, ...materials } = rankRewards(current.rounds, next);
    if (!Number.isSafeInteger(keysWith(state, keys)) ||
      !creditMaterials(state.base.materials, materials)) return false;
    state.ranks = { ...current, rounds: next, matches: [...current.matches, id] };
    state.rankKeys += keys;
    enqueueReward({ title: 'Награда за ранг', source: 'Месячные ранги', reward: { keys, ...materials } });
    return true;
  }

  function rollTavern(state, time) {
    const level = state.base.buildings[buildingSlot('tavern')]?.level;
    const next = syncTavern(state.tavern, level, time, random);
    if (next === state.tavern) return false;
    state.tavern = next;
    return true;
  }

  function rollLeague(state, time, enqueueReward) {
    const next = state.league ? resetLeagueWeek(state.league, time, random) : createLeague(time);
    if (!next) return 'current';
    const reward = next.lastReward;
    if (reward) {
      if (!creditMaterials(state.base.materials, { gateShards: reward.gateShards ?? 0 })) return 'unavailable';
      state.rewardGold += reward.gold;
      state.purchased[NEUTRAL] += reward.boosters ?? 0;
      const { gold, gateShards, boosters } = reward;
      enqueueReward({ title: 'Недельная награда Лиги', source: 'Лига', reward: { gold, gateShards, boosters } });
    }
    state.league = next;
    return 'done';
  }

  function buildLevel(slot, kind, previousLevel) {
    const level = previousLevel + 1;
    const cost = buildingPrice(kind, level);
    return transact((state, _previousAt, time) => {
      const { materials, buildings } = state.base;
      const currentLevel = buildings[slot]?.level ?? 0;
      if (currentLevel !== previousLevel) return previousLevel ? 'stale' : 'occupied';
      if (!cost) return 'max-level';
      if (constructionShortages(cost, balances(state).gold, materials).length) return 'unaffordable';
      state.goldSpent += cost.gold;
      for (const [key, price] of Object.entries(cost)) {
        if (key !== 'gold') materials[key] -= price;
      }
      buildings[slot] = { kind, level };
      if (kind === 'tavern') rollTavern(state, time);
      return 'done';
    });
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
      return transact(({ progress }, _previousAt, _time, enqueueReward) => {
        const state = rewardState(node, progress);
        if (state !== 'available') return state;
        progress.unlocked.add(id);
        const reward = { keys: node.keyReward ?? 0 };
        if (node.kind === 'gold' || node.kind === 'gold-stack') reward.gold = node.value;
        if (node.kind === 'essence') reward.essence = node.value;
        if (node.kind === 'booster') reward.boosters = node.value;
        enqueueReward({ title: node.label, source: 'Книга наград', reward });
        return 'opened';
      });
    },
    base: () => read().base,
    production() {
      const { base, production } = read();
      advanceProduction(production, base.buildings, observedTime());
      return productionView(production, base.buildings);
    },
    checkpointProduction() {
      return transact(({ production }, previousAt) =>
        previousAt !== production.at && Object.keys(production.stock).length ? 'done' : 'empty');
    },
    collect(kind) {
      return transact((state, _previousAt, time, enqueueReward) => {
        const { gold = 0, keys = 0, ...materials } = takeProduction(state.production, kind);
        const hasMaterials = Object.keys(materials).length > 0;
        if (!gold && !keys && !hasMaterials) return 'empty';
        if (!Number.isSafeInteger(state.producedGold + gold) ||
          !Number.isSafeInteger(keysWith(state, keys))) return 'unavailable';
        if (hasMaterials && !creditMaterials(state.base.materials, materials)) return 'unavailable';
        state.producedGold += gold;
        state.producedKeys += keys;
        rollTavern(state, time);
        advanceTavern(state.tavern, { collect: 1 });
        enqueueReward({ title: 'Сбор с базы', source: 'Сбор с базы', reward: { gold, keys, ...materials } });
        return 'done';
      });
    },
    weeklyOutpost() {
      const state = read();
      const time = now();
      return weeklyReward(state.base.buildings.outpost?.level, state.lastWeeklyClaim,
        time, Math.max(observedTime(time), state.production.at ?? 0));
    },
    claimOutpost() {
      return transact((state, _previousAt, time, enqueueReward) => {
        const weekly = weeklyReward(state.base.buildings.outpost?.level, state.lastWeeklyClaim,
          time, state.production.at);
        if (!weekly) return 'empty';
        if (weekly.remaining) return 'cooldown';
        const { gold, ...materials } = weekly.bundle;
        if (!Number.isSafeInteger(state.rewardGold + gold) || !creditMaterials(state.base.materials, materials)) {
          return 'unavailable';
        }
        state.rewardGold += gold;
        state.lastWeeklyClaim = time;
        enqueueReward({ title: 'Недельное снабжение', source: 'Форпост', reward: weekly.bundle });
        return 'done';
      });
    },
    tavern: () => read().tavern,
    checkpointTavern() {
      return transact((state, _previousAt, time) => rollTavern(state, time) ? 'done' : 'current');
    },
    changeTavernQuest(key) {
      return transact((state, _previousAt, time) => {
        rollTavern(state, time);
        return replaceTavernQuest(state.tavern, key, random) ? 'done' : 'stale';
      });
    },
    claimTavernQuest(key) {
      return transact((state, _previousAt, time, enqueueReward) => {
        rollTavern(state, time);
        const tavern = state.tavern;
        const quest = [...(tavern?.pending ?? []), ...(tavern?.slots ?? [])].find((entry) => entry.key === key);
        if (!quest || quest.claimed || !questComplete(quest)) return 'stale';
        const { title, reward } = TAVERN_QUEST_BY_ID.get(quest.id);
        const { keys, gold, steel } = reward;
        if (!Number.isSafeInteger(keysWith(state, keys)) ||
          !Number.isSafeInteger(state.rewardGold + gold) ||
          (steel && !creditMaterials(state.base.materials, { steel }))) return 'unavailable';
        state.tavernKeys += keys;
        state.rewardGold += gold;
        quest.claimed = true;
        tavern.pending = tavern.pending.filter((entry) => entry !== quest);
        enqueueReward({ title, source: 'Таверна', reward });
        return 'done';
      });
    },
    recordTavernEvents(id, offset, events) {
      const amounts = tavernEventAmounts(events);
      if (!Object.keys(amounts).length || !read().base.buildings[buildingSlot('tavern')]) return Promise.resolve('empty');
      return transact((state, _previousAt, time) => {
        const rolled = rollTavern(state, time);
        const tavern = state.tavern;
        if (!tavern) return 'empty';
        const cursor = Object.hasOwn(tavern.cursors, id) ? tavern.cursors[id] : 0;
        const skip = Math.max(0, cursor - offset);
        if (skip >= events.length) return rolled ? 'done' : 'empty';
        const progress = skip ? tavernEventAmounts(events.slice(skip)) : amounts;
        advanceTavern(tavern, progress);
        tavern.cursors = { ...tavern.cursors, [id]: offset + events.length };
        return 'done';
      });
    },
    ranks: () => syncRanks(read().ranks, now()),
    rankResetAt: () => read().ranks?.resetAt ?? 0,
    checkpointRanks() {
      return transact((state, _previousAt, time) => {
        const next = syncRanks(state.ranks, time);
        if (next === state.ranks) return 'current';
        state.ranks = next;
        return 'done';
      });
    },
    league: () => read().league,
    checkpointLeague() {
      return transact((state, _previousAt, time, enqueueReward) => rollLeague(state, time, enqueueReward));
    },
    beginLeagueMatch(ticket, id, deck) {
      return transact((state, _previousAt, time) => {
        if (!state.league || needsLeagueReset(state.league, time)) return 'stale';
        const inventory = balances(state);
        if (!inspectDeck(deck, inventory.owned).valid) return 'invalid-deck';
        const outcome = reserveLeagueMatch(state.league, ticket, id, inventory.gold);
        if (outcome === 'done') state.goldSpent += leagueStake(state.league);
        return outcome;
      });
    },
    settleLeagueMatch(id, result, difference, factionId, rounds) {
      const opposingRounds = rounds - difference;
      if (!['win', 'loss', 'draw'].includes(result) || !Number.isInteger(difference) || Math.abs(difference) > 2 ||
        Math.sign(difference) !== { win: 1, loss: -1, draw: 0 }[result] ||
        (rounds !== undefined && (!Number.isInteger(rounds) || rounds < 0 || rounds > 2 ||
          opposingRounds < 0 || opposingRounds > 2))) {
        return Promise.resolve('invalid-result');
      }
      return transact((state, _previousAt, time, enqueueReward) => {
        if (!state.league) return 'stale';
        const settled = finishLeagueMatch(state.league, id, result, difference, random, rounds);
        if (!settled) return 'stale';
        const regularGold = result === 'win' && settled.tier !== DIAMOND ? victoryGold(state.base.buildings.outpost?.level) : 0;
        state.rewardGold += settled.payout + regularGold;
        if (regularGold) enqueueReward({ title: 'Золото за победу', source: 'Итоги матча', reward: { gold: regularGold } });
        if (settled.payout) enqueueReward({ title: 'Выплата Алмазной лиги', source: 'Алмазная лига', reward: { gold: settled.payout } });
        if (!creditRankRounds(state, id, rounds ?? 0, time, enqueueReward)) return 'unavailable';
        rollTavern(state, time);
        trackTavernMatch(state.tavern, id, result, factionId, true);
        const rollover = rollLeague(state, time, enqueueReward);
        return rollover === 'unavailable' ? rollover : 'done';
      });
    },
    rewardMatch(matchId, result, factionId, rounds = 0) {
      if (!['win', 'loss', 'draw'].includes(result) || typeof matchId !== 'string' || !matchId ||
        (result !== 'win' && !factionId) || !Number.isInteger(rounds) || rounds < 0 || rounds > 2) return Promise.resolve('empty');
      return transact((state, _previousAt, time, enqueueReward) => {
        if (state.rewardedMatches.includes(matchId) || state.tavern?.finished.includes(matchId) ||
          state.ranks?.matches.includes(matchId)) return 'claimed';
        if (result === 'win') {
          const gold = victoryGold(state.base.buildings.outpost?.level);
          if (!Number.isSafeInteger(state.rewardGold + gold)) return 'unavailable';
          state.rewardGold += gold;
          state.rewardedMatches = [...state.rewardedMatches, matchId];
          enqueueReward({ title: 'Золото за победу', source: 'Итоги матча', reward: { gold } });
        }
        if (!creditRankRounds(state, matchId, rounds, time, enqueueReward)) return 'unavailable';
        const rolled = rollTavern(state, time);
        const tracked = trackTavernMatch(state.tavern, matchId, result, factionId, false);
        return result === 'win' || rolled || tracked || rounds ? 'done' : 'empty';
      });
    },
    grantMaterials(reward, { title = 'Материалы получены', source = 'Снабжение' } = {}) {
      return transact(({ base }, _previousAt, _time, enqueueReward) => {
        if (!creditMaterials(base.materials, reward)) return 'unknown';
        enqueueReward({ title, source, reward });
        return 'done';
      });
    },
    build(slot, kind) {
      if (!slot || buildingSlot(kind) !== slot) return Promise.resolve('unknown');
      return buildLevel(slot, kind, 0);
    },
    upgrade(kind, previousLevel) {
      const slot = buildingSlot(kind);
      if (!slot || !Number.isInteger(previousLevel) || previousLevel < 1) return Promise.resolve('unknown');
      return buildLevel(slot, kind, previousLevel);
    },
    ...createCollectionActions({
      transact, balances, random,
      onPackOpened(state, time) {
        rollTavern(state, time);
        advanceTavern(state.tavern, { booster: 1 });
      },
    }),
  };
}
