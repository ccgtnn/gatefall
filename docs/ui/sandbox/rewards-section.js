import { createBoosterOpening } from '../booster-opening.js';
import { button, element } from '../dom.js';
import { createRewardReveal, enqueueReward } from '../reward-reveal.js';
import { factionCards, factionOptions } from './fixtures.js';

function fixtureProgress(factionId) {
  const cards = factionCards(factionId).slice(0, 5).map(({ id }) => id);
  const pendingPack = {
    id: 'sandbox-pack', faction: factionId, cards,
    revealed: cards.slice(0, 2), essenceByCard: { [cards[0]]: 5 },
  };
  const boosters = Object.fromEntries(factionOptions.map(([id]) => [id, 0]));
  boosters[factionId] = 1;
  const inventory = { boosters, packCount: 1, pendingPack };
  return {
    inventory: () => inventory,
    subscribe: () => {},
    openPack: async () => 'done',
    revealPack: async (_packId, id) => {
      const revealed = id === undefined ? cards : [...pendingPack.revealed, id];
      pendingPack.revealed = [...new Set(revealed)];
      return 'done';
    },
    finishPack: async () => 'done',
  };
}

export function createRewardsSection() {
  const section = element('section', 'sandbox-section');
  section.dataset.section = 'rewards';
  let canShowReward = false;
  const reward = createRewardReveal({ motion: () => 0, canShow: () => canShowReward });
  enqueueReward({
    title: 'Награда песочницы', source: 'Фиктивные данные',
    reward: { gold: 125, keys: 2, steel: 40 },
  });
  const showReward = button('Показать экран награды', () => {
    canShowReward = true;
    reward.refresh();
  }, 'button primary');
  const boosterMount = element('div', 'sandbox-booster-mount');
  section.append(element('h2', null, 'Награды и бустер'), showReward, boosterMount);

  function update(factionId) {
    const view = createBoosterOpening(fixtureProgress(factionId), () => {});
    view.prepare();
    view.dialog.open = true;
    view.dialog.classList.add('sandbox-inline-dialog');
    boosterMount.replaceChildren(view.dialog);
  }

  return { section, update };
}
