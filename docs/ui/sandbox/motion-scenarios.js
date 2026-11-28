import { findCardDefinition } from '../../game/cards/card-registry.js';
import {
  applyStatus, boost, capture, changeCoins, cleanse, consume, createCard, damage, findUnit, heal,
  setRowEffect, spawnCards, takeCards, tickInfection, transformUnit, weaken,
} from '../../game/engine/board.js';
import { applyAction } from '../../game/engine/match.js';
import { motionFixture } from './fixtures.js';

const random = () => 0;
const enemy = { scope: 'enemy', type: 'unit' };
const source = { scope: 'source' };
const unit = (match, side = 'bot', index = 0) => findUnit(match, match.players[side].board.orbit[index].id);

export function applyMotionAction(match, action) {
  return applyAction(match, match.pending?.side ?? match.turn, action, { random });
}

function play(match) {
  const side = match.turn;
  const { hand, board } = match.players[side];
  return applyMotionAction(match, { type: 'play', cardId: hand[0].id, row: 'orbit', position: board.orbit.length });
}

function selection(match) {
  const { kind, options, selectionSide, side } = match.pending;
  if (kind === 'deck-placement') {
    const [row] = options;
    return { type: 'place', row, position: match.players[selectionSide ?? side].board[row].length };
  }
  return { type: 'target', cardId: options[0] };
}

function resolve(next) {
  for (let remaining = 32; next.pending && remaining; remaining -= 1) {
    next = applyMotionAction(next, selection(next));
  }
  if (next.pending) throw new Error('Не удалось завершить выбор для сценария.');
  return next;
}

function useCard(match, definition) {
  const { hand } = match.players[match.turn];
  hand[0] = createCard(hand[0].id, definition);
}

const realCard = (id) => (match) => useCard(match, findCardDefinition(id));
const effect = (name, steps) => (match) => useCard(match, {
  ...findCardDefinition('orbital-salvo'), name, deploy: { steps },
});
const prepareOrder = (match) => {
  const { card } = unit(match, 'human');
  card.definition = { ...card.definition, order: { steps: [{ action: 'boost', target: source, amount: 3 }] } };
};

function shot(match, amount, visual) {
  const attacker = unit(match, 'human');
  damage(match, unit(match), amount, attacker.card.definition.id, {
    scattered: true, visual, sourceId: attacker.card.id, sourceRow: attacker.row, attacker: 'human',
  });
}

function draw(match, side, amount, reason) {
  const cards = takeCards(match.players[side], amount);
  match.log.push({ type: 'draw', side, count: cards.length, cards, ...(reason && { reason, extraSwaps: 0 }) });
}

function round(winner) {
  return (match) => {
    match.players.bot.passed = true;
    if (winner) boost(match, unit(match, winner), 2);
  };
}

function finish(winner) {
  return (match) => {
    round(winner)(match);
    match.players[winner === 'human' ? 'bot' : 'human'].lives = 1;
  };
}

function prepareBotAim(match) {
  match.turn = 'bot';
  effect('Прицельный удар', [
    { action: 'choose-unit', target: enemy, ref: 'victim', kind: 'damage', prompt: 'Выбери цель.' },
    { action: 'damage', target: { scope: 'ref', ref: 'victim' }, amount: 2 },
  ])(match);
  return play(match);
}

function mulligan(match, roundNumber) {
  match.phase = 'mulligan';
  match.turn = null;
  match.round = roundNumber;
  match.mulligan = { used: 0, excluded: [] };
}

function turnStart(match, side, empty = false) {
  match.turn = side;
  match.log.push({ type: 'turn-start', side, empty });
}

const botPassed = (match) => { match.players.bot.passed = true; };
const pass = (match) => applyMotionAction(match, { type: 'pass' });
const activate = (type, cardId) => (match) => resolve(applyMotionAction(match, { type, cardId: cardId?.(match) }));

export const motionGroups = [
  ['Розыгрыш', [
    { id: 'play', label: 'Своя карта', run: play },
    { id: 'opponent-play', label: 'Карта соперника', prepare: (match) => { match.turn = 'bot'; }, run: play },
    { id: 'bot-aim', label: 'Прицел соперника', presentation: 'bot-aim', prepare: prepareBotAim, run: resolve },
    { id: 'effect', label: 'Эффект', prepare: effect('Усиление отряда', [{ action: 'boost', target: { scope: 'ally' }, amount: 2 }]), run: play },
    { id: 'from-deck', label: 'Из колоды', prepare: realCard('reinforcements'), run: (match) => resolve(play(match)) },
    { id: 'from-discard', label: 'Из сброса', prepare: realCard('resurrection'), run: (match) => resolve(play(match)) },
    { id: 'create', label: 'Сотворение', prepare: effect('Сотворение', [
      { action: 'create-play', rarity: 'bronze', type: 'unit', amount: 3 },
    ]), run: (match) => resolve(play(match)) },
  ]],
  ['Бой', [
    { id: 'damage-light', label: 'Лёгкий удар', run: (match) => { damage(match, unit(match), 2); } },
    { id: 'damage-heavy', label: 'Тяжёлый удар', run: (match) => { damage(match, unit(match), 5); } },
    { id: 'damage', label: 'Средний удар', run: (match) => { damage(match, unit(match), 3); } },
    { id: 'armor-hit', label: 'Разрушение брони', prepare: (match) => { unit(match).card.armor = 3; },
      run: (match) => { damage(match, unit(match), 3); } },
    { id: 'projectile', label: 'Снаряд', run: (match) => { shot(match, 2, 'turret'); } },
    { id: 'lightning', label: 'Молния', run: (match) => { shot(match, 2, 'lightning'); } },
    { id: 'firestorm-tick', label: 'Огненный шторм (тик)', prepare: realCard('firestorm'), run: (match) => {
      const cast = resolve(play(match));
      return cast.turn === match.turn ? resolve(applyMotionAction(cast, { type: 'end-turn' })) : cast;
    } },
    { id: 'salvo', label: 'Залп', prepare: realCard('orbital-salvo'), run: (match) => resolve(play(match)) },
    { id: 'death', label: 'Гибель', run: (match) => { damage(match, unit(match), 8); } },
    { id: 'annihilation', label: 'Аннигиляция', prepare: realCard('annihilation'), run: play },
    { id: 'consume', label: 'Поглощение', run: (match) => { consume(match, unit(match, 'human', 1), unit(match, 'human')); } },
    { id: 'boost', label: 'Среднее усиление', run: (match) => { boost(match, unit(match, 'human'), 3); } },
    { id: 'boost-heavy', label: 'Сильное усиление', run: (match) => { boost(match, unit(match, 'human'), 5); } },
    { id: 'weaken', label: 'Ослабление', run: (match) => { weaken(match, unit(match), 2); } },
    { id: 'heal', label: 'Лечение', prepare: (match) => { unit(match, 'human').card.power -= 3; },
      run: (match) => { heal(match, unit(match, 'human')); } },
    { id: 'armor', label: 'Броня', run: (match) => { applyStatus(match, unit(match, 'human'), 'armor', 3); } },
    { id: 'shield', label: 'Щит', run: (match) => { applyStatus(match, unit(match, 'human'), 'shield', 1); } },
    { id: 'infection', label: 'Заражение и тик', run: (match) => {
      const target = unit(match);
      applyStatus(match, target, 'infection', 2);
      tickInfection(match, target);
    } },
    { id: 'mark', label: 'Штамп прицела', run: (match) => { applyStatus(match, unit(match), 'target', 1, { attacker: 'human' }); } },
    { id: 'capture', label: 'Захват', run: (match) => { capture(match, 'human', unit(match)); } },
    { id: 'weather-rot', label: 'Волна Гниения', run: (match) => { setRowEffect(match, 'bot', 'orbit', { type: 'rot', remaining: 3 }); } },
    { id: 'weather-firestorm', label: 'Волна Огненного шторма', run: (match) => {
      setRowEffect(match, 'bot', 'orbit', { type: 'firestorm', remaining: 3 });
    } },
    { id: 'growth', label: 'Рост', prepare: (match) => {
      const { card } = unit(match, 'human');
      card.definition = { ...card.definition, growth: { label: 'Рост', base: 0 } };
      card.growth = 1;
    }, run: (match) => {
      const { card } = unit(match, 'human');
      card.growth += 2;
      match.log.push({ type: 'growth', side: 'human', cardId: card.id, growth: card.growth });
    } },
    { id: 'counter', label: 'Пульс счётчика', prepare: (match) => { unit(match, 'human').card.counter = 3; }, run: (match) => {
      const { card } = unit(match, 'human');
      card.counter -= 1;
      match.log.push({ type: 'counter', side: 'human', cardId: card.id, remaining: card.counter });
    } },
    { id: 'order-ready', label: 'Готовность приказа', prepare: (match) => {
      prepareOrder(match);
      unit(match, 'human').card.readyAt = match.players.human.turns + 1;
    }, run: (match) => {
      const { card } = unit(match, 'human');
      card.readyAt = match.players.human.turns;
      match.log.push({ type: 'order-ready', side: 'human', cardId: card.id, readyAt: card.readyAt });
    } },
    { id: 'deathwish', label: 'Завещание', prepare: (match) => {
      const { card } = unit(match);
      card.definition = { ...card.definition, deathwish: { steps: [{ action: 'coins', amount: 2 }] } };
      effect('Уничтожение', [{ action: 'destroy', target: { ...enemy, strongest: true } }])(match);
    }, run: play },
    { id: 'order', label: 'Приказ', prepare: prepareOrder, run: activate('order', (match) => unit(match, 'human').card.id) },
    { id: 'leader', label: 'Лидер', run: activate('leader') },
    { id: 'spawn', label: 'Порождение', run: (match) => {
      spawnCards(match, 'human', 'orbit', 1, 2, unit(match, 'human').card.definition);
    } },
    { id: 'summon', label: 'Призыв', prepare: realCard('forgotten-gates'), run: play },
    { id: 'coins', label: 'Монеты', run: (match) => { changeCoins(match, 'human', 3); changeCoins(match, 'human', -2); } },
  ]],
  ['Рука и муллиган', [
    { id: 'draw-one', label: 'Добор 1', run: (match) => { draw(match, 'human', 1); } },
    { id: 'draw-three', label: 'Добор 3', run: (match) => { draw(match, 'human', 3); } },
    { id: 'opponent-draw', label: 'Добор соперника', run: (match) => { draw(match, 'bot', 1); } },
    { id: 'return', label: 'Возврат в колоду', prepare: (match) => {
      effect('Возврат в колоду', [{ action: 'return-hand', amount: 1 }])(match);
      return play(match);
    }, run: resolve },
    { id: 'hand-bottom', label: 'На дно колоды', prepare: (match) => {
      effect('На дно колоды', [{ action: 'choose-hand-bottom' }])(match);
      return play(match);
    }, run: resolve },
    { id: 'deal-round-one', label: 'Раздача (раунд 1)', presentation: 'mulligan-deal', run: (match) => mulligan(match, 1) },
    { id: 'deal-round-two', label: 'Раздача (раунд 2)', presentation: 'mulligan-deal', run: (match) => {
      draw(match, 'human', 3, 'round');
      mulligan(match, 2);
    } },
    { id: 'mulligan-swap', label: 'Замена в муллигане', presentation: 'mulligan-swap', prepare: (match) => {
      mulligan(match, 1);
    }, run: () => undefined },
  ]],
  ['Пока без анимации', [
    { id: 'lock', label: 'Блокировка', run: (match) => { applyStatus(match, unit(match), 'lock', 2); } },
    { id: 'cleanse', label: 'Очищение', prepare: (match) => { unit(match, 'human').card.statuses = { lock: 2, infection: 2 }; },
      run: (match) => { cleanse(match, unit(match, 'human')); } },
    { id: 'transform', label: 'Превращение', run: (match) => {
      transformUnit(match, unit(match), unit(match, 'human', 1).card.definition);
    } },
  ]],
  ['Переход хода и пас', [
    { id: 'turn-human', label: 'Ход: твой', run: (match) => { turnStart(match, 'human'); } },
    { id: 'turn-bot', label: 'Ход противника', run: (match) => { turnStart(match, 'bot'); } },
    { id: 'pass', label: 'Пас (свой)', run: pass },
    { id: 'pass-bot', label: 'Пас (соперника)', prepare: (match) => { match.turn = 'bot'; }, run: pass },
    { id: 'turn-empty', label: 'Пустой ход', prepare: botPassed, run: (match) => { turnStart(match, 'bot', true); } },
    { id: 'turn-combined', label: 'Противник спасовал · снова твой ход', prepare: botPassed, run: (match) => {
      turnStart(match, 'bot', true);
      turnStart(match, 'human');
    } },
    { id: 'turn-compact', label: 'Компактный баннер после паса', prepare: botPassed, run: (match) => {
      turnStart(match, 'human');
    } },
  ]],
  ['Раунд', [
    { id: 'round-win', label: 'Победа', presentation: 'round-result', prepare: round('human'), run: pass },
    { id: 'round-loss', label: 'Поражение', presentation: 'round-result', prepare: round('bot'), run: pass },
    { id: 'round-draw', label: 'Ничья', presentation: 'round-result', prepare: round(), run: pass },
    { id: 'match-win', label: 'Победа в матче', presentation: 'match-result', prepare: finish('human'), run: pass },
    { id: 'match-loss', label: 'Поражение в матче', presentation: 'match-result', prepare: finish('bot'), run: pass },
    { id: 'round-title', label: 'Раунд N', presentation: 'round-title', prepare: round('human'), run: pass },
    { id: 'coin', label: 'Монетка', presentation: 'coin', run: () => undefined },
  ]],
  ['Диалог', [
    { id: 'offer-three', label: '3 из колоды', prepare: realCard('reinforcements'), run: play },
    { id: 'offer-all', label: 'Вся колода', prepare: realCard('world-gates'), run: play },
    { id: 'offer-all-phone', label: 'Вся колода (телефон, два касания)', phoneChoice: true, prepare: realCard('world-gates'), run: play },
    { id: 'offer-discard', label: 'Сброс', prepare: realCard('resurrection'), run: play },
    { id: 'offer-hand-return', label: 'Рука → колода', prepare: effect('Возврат в колоду', [{ action: 'return-hand', amount: 1 }]), run: play },
    { id: 'offer-deck-top', label: 'Верх колоды', prepare: effect('Верх колоды', [{ action: 'choose-deck-top' }]), run: play },
    { id: 'offer-tribute', label: 'Взнос', prepare: (match) => {
      realCard('hound-recruiter')(match);
      match.players.human.coins = 6;
    }, run: play },
  ]],
];

export function prepareMotionScenario(factionId, scenario) {
  const fixture = motionFixture(factionId);
  const before = scenario.prepare?.(fixture) ?? fixture;
  before.log.length = 0;
  const copy = structuredClone(before);
  return { before, next: scenario.run(copy) ?? copy };
}
