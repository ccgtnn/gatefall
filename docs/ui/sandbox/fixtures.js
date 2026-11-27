import { basePower, createCard, isUnit, ROW_LIMIT } from '../../game/engine/board.js';
import { cardsForFaction } from '../../game/cards/card-registry.js';
import { FACTIONS, NEUTRAL } from '../../game/cards/cards.js';
import { createMatch } from '../../game/engine/match.js';
import { createFieldRows } from '../field-rows.js';

export const factionOptions = [
  ...Object.entries(FACTIONS).map(([id, faction]) => [id, faction.name]),
  [NEUTRAL, 'Нейтральные'],
];

export function factionCards(factionId) {
  return cardsForFaction(factionId).filter(({ token }) => !token);
}

export function defaultCardId(factionId) {
  const cards = factionCards(factionId);
  const preferred = cards.find(({ id }) => id === 'commander') ??
    cards.find((definition) => definition.order && (definition.type ?? 'unit') === 'unit');
  return (preferred ?? cards[0])?.id;
}

export function fixtureMatch(factionId, side = 'human') {
  const fixtureFaction = FACTIONS[factionId] ? factionId : 'protectorate';
  const match = createMatch({ humanFaction: fixtureFaction, botFaction: fixtureFaction, random: () => 0 });
  match.phase = 'playing';
  match.turn = side;
  const player = match.players[side];
  player.hand = [];
  player.deck = [];
  return { match, player };
}

export function fieldSide(match, side, readyOrders = new Set()) {
  const { sideView } = createFieldRows({
    getSelectedCardId: () => undefined,
    humanCanAct: () => false,
    isReplaying: () => true,
    placeSelected: () => {},
    playHuman: () => {},
  });
  return sideView(match, side, readyOrders);
}

export function cardStateFixtures(definition) {
  const states = [];
  let serial = 0;
  const add = (key, label, kind = 'field', setup) => {
    const card = createCard(`sandbox-${definition.id}-${serial++}`, definition);
    setup?.(card);
    states.push({ key, label, kind, card });
  };
  add('hand', 'В руке', 'hand');
  add('field', 'На поле');
  add('ordinary', 'Обычная', 'face');
  add('armor', 'С бронёй', 'field', (card) => {
    if (isUnit(card)) card.armor = Math.max(4, (card.armor ?? 0) + 2);
  });
  add('shield', 'Силовой щит', 'field', (card) => { card.statuses = { shield: 1 }; });
  add('infection', 'Заражение 2', 'field', (card) => { card.statuses = { infection: 2 }; });
  add('lock', 'Блокировка', 'field', (card) => { card.statuses = { lock: 2 }; });
  add('target', 'Метка Цель', 'field', (card) => { card.statuses = { target: 1 }; });
  add('counter', 'Счётчик 3', 'field', (card) => { card.counter = 3; });
  if (definition.order) {
    add('order-ready', 'Приказ готов', 'field', (card) => { card.readyAt = 0; });
    add('order-cooldown', 'Приказ перезаряжается', 'field', (card) => { card.readyAt = 3; });
    add('order-charges', 'Заряды Приказа', 'field', (card) => { card.orderCharges = 2; });
  }
  add('boosted', 'Усилена', 'field', (card) => {
    if (isUnit(card)) card.power = basePower(card) + 3;
  });
  add('weakened', 'Ослаблена', 'field', (card) => {
    if (isUnit(card)) card.power = Math.max(0, basePower(card) - 2);
  });
  return states;
}

export function fillRowFixture(factionId) {
  const { match, player } = fixtureMatch(factionId, 'bot');
  const units = factionCards(factionId).filter((definition) => (definition.type ?? 'unit') === 'unit');
  player.board.surface = Array.from({ length: ROW_LIMIT }, (_, index) => {
    const definition = units[index % units.length];
    return createCard(`sandbox-row-${index}`, definition);
  });
  player.rowEffects.surface = { type: 'rot', remaining: 3 };
  player.passed = true;
  return { match, player };
}
