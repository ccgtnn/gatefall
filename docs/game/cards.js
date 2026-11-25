import { ability, action, allies, choice, chosen, self } from './card-abilities.js';
import { CAPTAIN_CARDS, SKARA_REINHOLD } from './captains.js';
import { CHOIR_CARDS, HIGH_PRIEST } from './choir.js';
import { ANNIHILATION, NEUTRAL_CARDS } from './neutral-cards.js';
import { GROWTH } from './growth.js';
import { PROTECTORATE } from './protectorate.js';

export { KEYWORDS } from './card-keywords.js';
export { CARD_TYPES, NEUTRAL, RARITY_LABELS, ROWS, ROW_LABELS } from './card-metadata.js';
export { LARVA } from './growth.js';
export { ANNIHILATION, NEUTRAL_CARDS, SHADOW } from './neutral-cards.js';

export const FIRST_SIGNAL = Object.freeze({
  id: 'first-signal', name: 'Первый сигнал', type: 'artifact', stratagem: true, token: true,
  art: 'first-signal.webp', zeal: true, doomed: true,
  text: 'Рвение. Обречённый. Приказ: усилить свой отряд на 5. После применения или в конце первого раунда уходит из игры.',
  keywords: ['Приказ', 'Рвение', 'Усиление', 'Обречённость'],
  order: {
    ...ability([action('boost', chosen('ally'), 5), action('destroy', self)],
      [choice('ally', allies, 'Выбери свой отряд для усиления на 5.', { kind: 'boost', amount: 5 })]),
  },
});

const presetNeutrals = {
  protectorate: ['recon-drone', 'smuggler', 'gate-relic', 'gate-guardian'],
  growth: ['veteran-mercenary', 'gravity-pulse', 'liaison', 'field-medic'],
};

const singleBronzes = {
  protectorate: ['shield-generator', 'orbital-shield', 'standard', 'warden', 'reinforcements'],
  growth: ['spore-sac', 'incubator', 'gulper', 'swarm-call'],
};

function factionCards(entries, faction) {
  return Object.freeze(entries.map(([id, name, provision, power, text, rules], index) => {
    const rarity = index < 11 ? 'bronze' : 'gold';
    const stats = power === null ? {} : { power };
    return Object.freeze({ id, name, provision, type: 'unit', text, rarity, faction, ...stats, ...rules });
  }));
}

function presetCards(pool, faction) {
  return Object.freeze([
    ...pool.filter(({ id }) => faction !== 'protectorate' || id !== 'orbital-shield')
      .flatMap((definition) => definition.rarity === 'bronze' && !singleBronzes[faction].includes(definition.id)
        ? [definition, definition] : [definition]),
    ...NEUTRAL_CARDS.filter(({ id }) => id === ANNIHILATION.id || presetNeutrals[faction].includes(id))
      .flatMap((definition) => faction === 'protectorate' && definition.id === 'recon-drone'
        ? [definition, definition] : [definition]),
  ]);
}

function faction(id, { name, strategy, entries, leaders, extras }) {
  const pool = factionCards(entries, id);
  return { name, strategy, pool: Object.freeze([...pool, ...factionCards(extras, id)]),
    deck: presetCards(pool, id), leader: leaders[0], leaders };
}

const choirPool = Object.freeze(CHOIR_CARDS.filter(({ token }) => !token));
const choirCardsById = new Map([...choirPool, ...NEUTRAL_CARDS].map((card) => [card.id, card]));
const choirDeck = Object.freeze([
  'whisper-interpreter', 'whisper-interpreter', 'forbidden-scroll-keeper', 'ulmarin-fanatic', 'ulmarin-fanatic',
  'depth-neophyte', 'depth-neophyte', 'cult-dreamer', 'abyss-shepherd', 'altar-guardian',
  'alien-dream', 'sleeper-revelation', 'minor-offering', 'great-sacrifice', 'call-of-the-deep',
  'mind-strike', 'sleeper-litany', 'ulmarin-awakening', 'annihilation',
  'suppressor', 'veteran-mercenary', 'veteran-mercenary', 'fugitive-monk', 'recon-drone', 'recon-drone',
].map((id) => choirCardsById.get(id)));

const captainCardsById = new Map([...CAPTAIN_CARDS, ...NEUTRAL_CARDS].map((card) => [card.id, card]));
const captainDeck = Object.freeze([
  'hound-foreman', 'hound-foreman', 'hound-captain', 'hound-recruiter', 'hound-pack', 'hound-pack',
  'hound-good-deal', 'hound-good-deal', 'black-hound', 'hound-claw', 'hound-claw', 'hound-right-fang',
  'hound-left-fang', 'hound-eyes', 'debtor', 'debtor', 'scrapped-pilot', 'scrapped-pilot', 'broken-turret',
  'broken-turret', 'suppressor', 'armor-piercing-shot', 'field-medic', 'resurrection', 'annihilation',
].map((id) => captainCardsById.get(id)));

export const FACTIONS = Object.freeze({
  protectorate: faction('protectorate', PROTECTORATE),
  growth: faction('growth', GROWTH),
  choir: { name: 'Безмолвный хор', strategy: 'Псионика', description: 'Псионики-аскеты, черпающие силу в космосе',
    pool: choirPool, deck: choirDeck,
    leader: HIGH_PRIEST, leaders: Object.freeze([HIGH_PRIEST]) },
  captains: { name: 'Вольные капитаны', strategy: 'Чёрные гончие', description: 'Независимые капитаны, корабли и боевые монеты.',
    pool: CAPTAIN_CARDS, deck: captainDeck,
    leader: SKARA_REINHOLD, leaders: Object.freeze([SKARA_REINHOLD]) },
});
