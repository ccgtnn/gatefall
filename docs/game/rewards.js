export const STARTING_KEYS = 25;
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

export function createRewardProgress(storage, locks) {
  let ids = [];

  function get() {
    if (storage) {
      try { ids = JSON.parse(storage.getItem(REWARD_STORAGE_KEY))?.unlocked ?? []; } catch {}
    }
    return readProgress(ids);
  }

  async function unlock(id) {
    const node = nodesById.get(id);
    if (!node) return 'unknown';
    const commit = () => {
      const progress = get();
      const state = rewardState(node, progress);
      if (state !== 'available') return state;
      const next = [...progress.unlocked, id];
      try {
        storage?.setItem(REWARD_STORAGE_KEY, JSON.stringify({ unlocked: next }));
      } catch {
        return 'unavailable';
      }
      ids = next;
      return 'opened';
    };
    if (!locks) return commit();
    try { return await locks.request(REWARD_STORAGE_KEY, commit); } catch { return 'unavailable'; }
  }

  return { get, unlock };
}
