import { FACTIONS, NEUTRAL, NEUTRAL_CARDS } from './cards.js?v=world-gates-premium-1-nc1';
import { CAPTAIN_CARDS } from './captains.js?v=captains-independent-1';
import { copyLimit } from './decks.js?v=world-gates-premium-1-nc1';

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

export const BOOSTER_FACTIONS = [
  { id: 'protectorate', name: FACTIONS.protectorate.name, image: 'bastion.webp' },
  { id: 'growth', name: FACTIONS.growth.name, image: 'incubator.webp' },
  { id: NEUTRAL, name: 'Нейтральные', image: 'world-gates.webp' },
];

const pools = new Map(BOOSTER_FACTIONS.map(({ id }) => [id, id === NEUTRAL ? NEUTRAL_CARDS : FACTIONS[id].pool]));
const definitions = new Map([
  ...Object.values(FACTIONS).flatMap(({ pool }) => pool), ...NEUTRAL_CARDS, ...CAPTAIN_CARDS,
].map((card) => [card.id, card]));

const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;

function countsFor(keys, values) {
  return Object.fromEntries([...keys].map((id) => [id, count(values?.[id])]));
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
  const revealed = Array.isArray(pack.revealed) ? cards.filter((card) => pack.revealed.includes(card)) : [];
  // Packs started with the old rules already paid their entire dismantling reward.
  const prepaid = pack.prepaid === true || !Array.isArray(pack.revealed);
  return { id, faction: pack.faction, cards, essenceByCard: countsFor(cards, pack.essenceByCard), revealed, prepaid };
}

function revealPackCard(state, cardId) {
  const pack = state.pendingPack;
  if (pack.revealed.includes(cardId)) return 0;
  const essence = pack.prepaid ? 0 : (pack.essenceByCard[cardId] ?? 0);
  state.dismantlingEssence += essence;
  pack.revealed.push(cardId);
  return essence;
}

export function readCollection(snapshot) {
  // Older saves keep their resource balances and receive a fresh copy ledger.
  const hasFullCollection = snapshot.fullCollection === true;
  return {
    fullCollection: true,
    purchased: countsFor(pools.keys(), snapshot.purchased),
    opened: countsFor(pools.keys(), snapshot.opened),
    earnedCards: countsFor(definitions.keys(), hasFullCollection ? snapshot.earnedCards : undefined),
    dismantledCards: countsFor(definitions.keys(), hasFullCollection ? snapshot.dismantledCards : undefined),
    pendingPack: readPack(snapshot.pendingPack),
  };
}

export function collectionInventory({ purchased, opened, earnedCards, dismantledCards }) {
  const boosters = Object.fromEntries(BOOSTER_FACTIONS.map(({ id }) => [id, purchased[id] - opened[id]]));
  const owned = {};
  for (const [id, card] of definitions) {
    const initial = copyLimit(card);
    owned[id] = Math.max(0, initial + earnedCards[id] - dismantledCards[id]);
  }
  return { boosters, owned };
}

export function createCollectionActions({ transact, balances, random, onPackOpened }) {
  return {
    buyPack(id) {
      if (!pools.has(id)) return Promise.resolve('unknown');
      return transact((state, _previousAt, _time, enqueueReward) => {
        if (balances(state).gold < BOOSTER_PRICE) return 'unaffordable';
        state.purchased[id] += 1;
        state.goldSpent += BOOSTER_PRICE;
        enqueueReward({ title: 'Бустер куплен', source: 'Магазин бустеров', reward: { boosters: 1 } });
        return 'done';
      });
    },
    openPack(id) {
      if (!pools.has(id)) return Promise.resolve('unknown');
      return transact((state, _previousAt, time) => {
        if (state.pendingPack) return 'pending';
        const { boosters, owned } = balances(state);
        if (!boosters[id]) return 'empty';
        const cards = drawBoosterCards(pools.get(id), random);
        const essenceByCard = {};
        state.opened[id] += 1;
        for (const card of cards) {
          if (owned[card.id] < copyLimit(card)) state.earnedCards[card.id] += 1;
          else essenceByCard[card.id] = dismantleValue(card);
        }
        const number = Object.values(state.opened).reduce((sum, value) => sum + value, 0);
        state.pendingPack = { id: number, faction: id, cards: cards.map((card) => card.id), essenceByCard, revealed: [] };
        onPackOpened(state, time);
        return 'done';
      });
    },
    revealPack(id, cardId) {
      return transact((state, _previousAt, _time, enqueueReward) => {
        const pack = state.pendingPack;
        if (pack?.id !== id || (cardId !== undefined && !pack.cards.includes(cardId))) return 'unknown';
        const cards = cardId === undefined ? pack.cards : [cardId];
        if (cards.every((card) => pack.revealed.includes(card))) return 'revealed';
        const essence = cards.reduce((sum, card) => sum + revealPackCard(state, card), 0);
        enqueueReward({ title: 'Эссенция за лишние копии', source: 'Открытие бустера', reward: { essence } });
        return 'done';
      });
    },
    finishPack(id) {
      return transact((state, _previousAt, _time, enqueueReward) => {
        if (state.pendingPack?.id !== id) return 'unknown';
        const essence = state.pendingPack.cards.reduce((sum, card) => sum + revealPackCard(state, card), 0);
        state.pendingPack = null;
        enqueueReward({ title: 'Эссенция за лишние копии', source: 'Открытие бустера', reward: { essence } });
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
      return transact((state, _previousAt, _time, enqueueReward) => {
        if (!balances(state).owned[id]) return 'empty';
        state.dismantledCards[id] += 1;
        const essence = dismantleValue(card);
        state.dismantlingEssence += essence;
        enqueueReward({ title: 'Эссенция получена', source: 'Распыление карты', reward: { essence } });
        return 'done';
      });
    },
  };
}
