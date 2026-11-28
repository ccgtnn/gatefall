// @ts-check

/** @typedef {import('../../../types/contracts').Progress} Progress */
/** @typedef {import('../../../types/contracts').ProgressOptions} ProgressOptions */

import { rankRewards, syncRanks } from './ranks.js';
import { advanceTavern, questComplete, replaceTavernQuest, syncTavern, TAVERN_QUEST_BY_ID, tavernEventAmounts, trackTavernMatch } from './tavern.js';
import { createLeague, DIAMOND, finishLeagueMatch, leagueStake, needsLeagueReset, reserveLeagueMatch, resetLeagueWeek, upgradeLeague } from './league.js';
import { victoryGold, weeklyReward } from './outpost.js';
import { advanceProduction, productionView, readProduction, takeProduction } from './base-production.js';
import { buildingPrice, buildingSlot, constructionShortages, creditMaterials, readBase } from './base.js';
import { NEUTRAL } from '../shared/card-metadata.js';
import { REWARD_STORAGE_KEY } from '../shared/storage-keys.js';
import { inspectDeck } from '../cards/decks.js';
import { collectionInventory, createCollectionActions, readCollection } from './collection-economy.js';
import { addRewardBookBalances, findRewardNode, readRewardBookProgress, REWARD_MATERIALS, rewardForNode, rewardState } from './reward-book.js';

export { BOOSTER_FACTIONS, BOOSTER_PRICE, BOOSTER_RARITY_WEIGHTS, BOOSTER_SIZE, craftPrice, dismantleValue, drawBoosterCards }
  from './collection-economy.js';
export { REWARD_SECTIONS, rewardState } from './reward-book.js';
export { REWARD_STORAGE_KEY } from '../shared/storage-keys.js';

export const STARTING_KEYS = 0;
export const STARTING_GOLD = 0;
export const STARTING_ESSENCE = 0;
const LEGACY_STARTING_KEYS = 25;
const LEGACY_STARTING_ESSENCE = 800;

const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
const startingBalance = (value, legacyAmount) => Number.isSafeInteger(value) && value >= 0 ? value : legacyAmount;

/**
 * @param {Pick<Storage, 'getItem' | 'setItem'>} [storage]
 * @param {Pick<LockManager, 'request'>} [locks]
 * @param {ProgressOptions} [options]
 * @returns {Progress}
 */
export function createRewardProgress(storage, locks, { random = Math.random, now = Date.now, enqueueReward: publishReward } = {}) {
  const listeners = new Set();
  let saved = null;
  let lastSavedText;
  let inventorySnapshot;
  let latestTime = 0;

  function observedTime(time = now()) {
    latestTime = Math.max(latestTime, time);
    return latestTime;
  }

  function storedText() {
    try { return storage?.getItem(REWARD_STORAGE_KEY); } catch {}
  }

  function readState(text) {
    lastSavedText = undefined;
    if (text !== undefined) {
      try {
        saved = JSON.parse(text);
        lastSavedText = text;
      } catch {}
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
      progress: readRewardBookProgress(snapshot.unlocked, startingKeys + producedKeys + tavernKeys + rankKeys),
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

  const read = () => readState(storedText());

  function balances(state) {
    const { progress, dismantlingEssence, essenceSpent, goldSpent, startingGold, startingEssence,
      producedGold, rewardGold, pendingPack, purchased } = state;
    const { gold, essence, boosters: granted } = addRewardBookBalances(progress.unlocked, {
      gold: startingGold + producedGold + rewardGold,
      essence: startingEssence + dismantlingEssence,
      boosters: purchased,
    });
    const { boosters, owned } = collectionInventory({ ...state, purchased: granted });
    return {
      keys: progress.keys, gold: Math.max(0, gold - goldSpent), essence: Math.max(0, essence - essenceSpent),
      boosters, packCount: Object.values(boosters).reduce((sum, value) => sum + value, 0), owned, pendingPack,
    };
  }

  function inventory() {
    // Check the stored text even before another tab's storage event arrives.
    const text = storedText();
    if (text === undefined || lastSavedText !== text || inventorySnapshot?.text !== text) {
      const result = balances(readState(text));
      if (text === undefined || lastSavedText !== text) return result;
      inventorySnapshot = { text, result };
    }
    const { owned, boosters, pendingPack } = inventorySnapshot.result;
    return { ...inventorySnapshot.result, owned: { ...owned }, boosters: { ...boosters }, pendingPack: structuredClone(pendingPack) };
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
      lastSavedText = undefined;
      inventorySnapshot = undefined;
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
    inventory,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unlock(id) {
      const node = findRewardNode(id);
      if (!node) return Promise.resolve('unknown');
      return transact(({ progress, base }, _previousAt, _time, enqueueReward) => {
        const state = rewardState(node, progress);
        if (state !== 'available') return state;
        if (REWARD_MATERIALS.includes(node.kind) && !creditMaterials(base.materials, { [node.kind]: node.value })) return 'unavailable';
        progress.unlocked.add(id);
        enqueueReward({ title: node.label, source: 'Книга наград', reward: rewardForNode(node) });
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
