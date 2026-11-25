import { ability, action, allies, choice, chosen, enemies, enemyChoice, self } from './card-abilities.js?v=neutral-catalog-1';

export const NEUTRAL = 'neutral';

const fieldUnits = { scope: 'field', type: 'unit' };
const summonFromDeck = (position, provision) => ({ action: 'summon-from-deck', position, filter: { provision } });
const golemDamage = { playedCategory: 'Голем', base: 4, scale: 1 };
const mountainDamage = { playedCategory: 'Голем', base: 10, scale: -1 };

const strongest = { scope: 'field', type: 'unit', strongest: true };
const strongestPresent = { targets: strongest };
const annihilate = { action: 'destroy', target: strongest, visual: 'annihilation' };

export const ANNIHILATION = Object.freeze({
  id: 'annihilation', name: 'Аннигиляция', art: 'annihilation.webp?v=neutral-palette-1', removalReserve: 8, faction: NEUTRAL, type: 'effect', rarity: 'gold', provision: 12,
  text: 'Уничтожь сильнейший отряд на поле, свой или чужой. При равенстве выбери случайный из сильнейших. Инициатива: уничтожь все отряды с наибольшей силой.',
  deploy: { ...ability([{ ...annihilate, mode: 'random' }]), when: strongestPresent },
  initiative: { ...ability([annihilate]), when: strongestPresent },
  keywords: ['Уничтожение', 'Инициатива'],
});

export const SHADOW = Object.freeze({
  id: 'shadow', name: 'Тень', faction: NEUTRAL, type: 'unit', power: 2,
  art: 'shadow.webp',
  text: 'Обречённая. Пока на твоей стороне поля есть хотя бы одна Тень, Приказ лидера от Файлуры готов каждый твой ход.',
  categories: ['Пустота'], doomed: true, token: true, keywords: ['Обречённость'],
});

const faluraOrder = {
  text: 'Приказ: нанести 2 урона выбранному вражескому отряду. Перезарядка 1 ход. Если на твоём поле есть Тень, готов каждый твой ход.',
  cooldown: 1,
  quickenedBy: SHADOW.id,
  ability: ability([action('damage', chosen('enemy'), 2)], [enemyChoice(2)]),
};

export const NEUTRAL_CARDS = Object.freeze([
  ANNIHILATION,
  ...[
    ['suppressor', 'Подавитель', 'epic', 6, 5, 'При розыгрыше: наложи Блокировку на выбранный отряд любой стороны.', {
      art: 'suppressor.webp',
      deploy: ability([{ ...action('status', chosen('locked'), 1), status: 'lock' }],
        [choice('locked', fieldUnits, 'Выбери отряд для Блокировки.', { kind: 'lock' })]),
      keywords: ['Блокировка'],
    }],
    ['veteran-mercenary', 'Наёмник-ветеран', 'bronze', 4, 3, 'Нанеси 2 урона своему отряду. Усиль себя на 3.', {
      art: 'veteran-mercenary.webp?v=neutral-palette-1',
      deploy: ability([action('damage', chosen('ally'), 2), action('boost', self, 3)],
        [choice('ally', allies, 'Выбери свой отряд для 2 урона.', { kind: 'friendly-damage', amount: 2 })]),
      keywords: ['Урон', 'Усиление'],
    }],
    ['fugitive-monk', 'Монах-беглец', 'bronze', 5, 3, 'При розыгрыше: Очищение выбранного отряда любой стороны.', {
      art: 'fugitive-monk.webp',
      deploy: {
        ...ability([{ action: 'cleanse', target: chosen('cleansed') }],
          [choice('cleansed', fieldUnits, 'Выбери отряд для Очищения.', { kind: 'cleanse' })]),
        when: { targets: { ...fieldUnits, cleansable: true }, selectable: true },
      },
      keywords: ['Очищение'],
    }],
    ['smuggler', 'Контрабандист', 'bronze', 4, 3, 'Инициатива: усиль себя на 3.', {
      art: 'smuggler.webp?v=neutral-palette-1',
      initiative: ability([action('boost', self, 3)]), keywords: ['Инициатива', 'Усиление'],
    }],
    ['recon-drone', 'Разведдрон', 'bronze', 4, 4, 'Посмотри свою колоду и выбери карту. Она становится верхней.', {
      art: 'recon-drone.webp?v=neutral-palette-1',
      deploy: ability([{ action: 'choose-deck-top' }]),
    }],
    ['emp-grenade', 'ЭМИ-граната', 'bronze', 5, null, 'Сними всю броню с вражеского отряда. Нанеси 2 урона плюс число снятых единиц брони.', {
      removalReserve: 4,
      art: 'emp-grenade.webp?v=neutral-palette-1',
      type: 'effect',
      deploy: ability([
        { ...action('armor', chosen('enemy'), { stat: 'armor', scale: -1 }), save: 'armor' },
        action('damage', chosen('enemy'), { result: 'armor', base: 2 }),
      ], [choice('enemy', enemies, 'Выбери вражеский отряд для ЭМИ-гранаты.', { kind: 'emp' })]),
      keywords: ['Броня', 'Урон'],
    }],
    ['gravity-pulse', 'Гравитационный импульс', 'bronze', 7, null, 'Выбери вражеский ряд: сними 1 броню и нанеси 1 урон всем отрядам в нём.', {
      removalReserve: 4,
      art: 'gravity-pulse.webp?v=neutral-palette-1',
      type: 'effect', deploy: ability([
        { action: 'select-row', ref: 'row', filter: 'units', prompt: 'Выбери вражеский ряд для Гравитационного импульса.' },
        action('armor', { ...enemies, rowRef: 'row' }, -1),
        action('damage', { ...enemies, rowRef: 'row' }, 1),
      ]), keywords: ['Броня', 'Урон'],
    }],
    ['liaison', 'Связной', 'gold', 9, 4, 'Счётчик 4: возьми карту.', {
      art: 'liaison.webp?v=neutral-palette-1',
      counter: { amount: 4, effect: ability([{ action: 'draw', amount: 1 }]) },
      keywords: ['Счётчик'],
    }],
    ['field-medic', 'Полевой реаниматор', 'gold', 9, 3, 'Сыграй обычный отряд из своего сброса.', {
      art: 'field-medic.webp?v=neutral-palette-1',
      deploy: ability([{ action: 'play-from-discard', filter: { rarity: 'bronze' } }]),
    }],
    ['gate-relic', 'Реликт врат', 'gold', 9, null, 'Приказ (перезарядка 2): усиль свой отряд на 3.', {
      art: 'gate-relic.webp?v=neutral-palette-1',
      type: 'artifact', order: {
        ...ability([action('boost', chosen('ally'), 3)],
          [choice('ally', allies, 'Выбери свой отряд для усиления на 3.', { kind: 'boost' })]),
        cooldown: 2,
      }, keywords: ['Приказ', 'Усиление'],
    }],
    ['bounty-hunter', 'Охотник за головами', 'gold', 10, 4, 'Нанеси 6 урона вражескому отряду. Если он погиб от этого удара, усиль себя на 2.', {
      removalReserve: 5,
      art: 'bounty-hunter.webp?v=neutral-palette-1',
      deploy: ability([
        { ...action('damage', chosen('enemy'), 6), save: 'kill' },
        action('boost', self, { result: 'kill', scale: 2 }),
      ], [enemyChoice(6)]), keywords: ['Урон', 'Усиление'],
    }],
    ['world-gates', 'Врата Миров', 'gold', 11, null, 'Посмотри свою колоду, выбери любую карту и сыграй её.', {
      type: 'effect', art: 'world-gates.webp', accent: 'gate', deploy: ability([{ action: 'play-from-deck', fullDeck: true }]),
    }],
    ['falura', 'Файлура, Пепел Звезд', 'gold', 19, null,
      'Замени способность лидера до конца матча Приказом: нанести 2 урона выбранному вражескому отряду. Перезарядка 1 ход. Породи 2 Тени. Пока на твоём поле есть Тень, Приказ готов каждый твой ход.', {
        type: 'artifact', art: 'falura.webp', categories: ['Пустота'],
        deploy: ability([{ action: 'replace-leader', order: faluraOrder },
          { action: 'spawn', card: SHADOW, position: 'right', row: 'source', amount: 2, overflow: true }]),
        keywords: ['Приказ', 'Урон', 'Порождение'],
      }],
    ['gate-guardian', 'Хранитель врат', 'gold', 10, 12, 'Броня 4. Уязвимость: отправь эту карту в сброс.', {
      art: 'gate-guardian.webp?v=neutral-palette-1',
      armor: 4, events: { 'armor-break': ability([action('discard', self)]) },
      keywords: ['Броня', 'Уязвимость'],
    }],
    ['resurrection', 'Воскрешение', 'gold', 9, null, 'Выбери и сыграй карту из своего сброса с провизией 10 или меньше либо Пожирателя падали.', {
      type: 'effect', art: 'resurrection.webp',
      deploy: ability([{ action: 'play-from-discard', filter: { anyType: true, maxProvision: 10, provisionException: 'carrion-devourer' },
        prompt: 'Выбери карту из сброса за 10 провизии или меньше либо Пожирателя падали.' }]),
    }],
    ['forgotten-gates', 'Врата Забвения', 'gold', 10, null,
      'При розыгрыше: призови слева случайный отряд за 4 провизии из своей колоды. В начале твоего второго хода после розыгрыша призови справа ещё один такой отряд.', {
        type: 'artifact', art: 'forgotten-gates.webp', timer: 2, keywords: ['Призыв', 'Соседи'],
        deploy: ability([summonFromDeck('left', 4)]),
        startTurn: ability([summonFromDeck('right', 4)]),
      }],
    ['storm-eye', 'Глаз бури', 'bronze', 5, null,
      'При розыгрыше: создай Псионную бурю над вражескими рядами. В начале каждого из твоих следующих 3 ходов она бьёт 3 раза на 1 урон по случайным вражеским отрядам. Цели могут повторяться. После третьего хода бури Кристалл ломается и наносит ещё 1 урон случайному вражескому отряду.', {
        type: 'artifact', art: 'storm-eye.webp', categories: ['Кристалл'], keywords: ['Псионная буря', 'Урон'],
        fieldAura: 'psionic-storm', timer: 3,
        startTurnPulse: ability([{ action: 'scatter', amount: 3, visual: 'lightning' }]),
        startTurn: ability([{ action: 'break', target: self }, { action: 'scatter', amount: 1, visual: 'lightning' }]),
      }],
    ['old-golem', 'Старый голем', 'epic', 9, 9, 'Силовой щит. После розыгрыша тобой любого Голема, включая эту карту, усиливается на 1, пока находится на поле.', {
      art: 'old-golem.webp?v=force-sphere-1', categories: ['Голем'], shield: true, keywords: ['Силовой щит', 'Усиление'],
      fieldEvents: { play: { friendly: true, category: 'Голем', ability: ability([action('boost', self, 1)]) } },
    }],
    ['fire-golem', 'Огненный голем', 'epic', 9, 5,
      'При розыгрыше: нанеси 4 урона выбранному другому отряду. Урон увеличивается на 1 за каждого Голема, которого ты разыграл ранее в этом матче.', {
        art: 'fire-golem.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([action('damage', chosen('victim'), golemDamage)],
          [choice('victim', { scope: 'field', type: 'unit', exclude: 'source' },
            'Выбери отряд для урона.', { kind: 'damage', amount: golemDamage })]),
    }],
    ['sleeping-mountain', 'Спящая гора', 'epic', 9, 17,
      'При розыгрыше: нанеси себе 10 урона. Урон снижается на 1 за каждого Голема, которого ты разыграл ранее в этом матче, до 0.', {
        art: 'sleeping-mountain.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([action('damage', self, mountainDamage)]),
    }],
    ['mystic-golem', 'Мистический голем', 'gold', 10, 4,
      'При розыгрыше: распредели 4 удара по 1 урону между случайными отрядами выбранного вражеского ряда. За каждого Голема, которого ты разыграл раньше в этом матче, добавь ещё один удар.', {
        art: 'mystic-golem.webp', categories: ['Голем'], keywords: ['Урон'],
        deploy: ability([
          { action: 'select-row', ref: 'targetRow', filter: 'units', prompt: 'Выбери вражеский ряд для ударов Мистического голема.' },
          { action: 'scatter', rowRef: 'targetRow', amount: golemDamage, visual: 'lightning' },
        ]),
    }],
    ['carrion-devourer', 'Пожиратель падали', 'gold', 11, 1,
      'В начале каждого твоего хода увеличивает базовую силу на 1 в колоде, руке, на поле или в сбросе. Сохраняет её между раундами и при воскрешении.', {
        art: 'carrion-devourer.webp', categories: ['Зверь'], startTurnGrowth: 1,
      }],
    ['armor-piercing-shot', 'Бронебойный выстрел', 'bronze', 6, null,
      'Нанеси 6 урона вражескому отряду. Расправа: нанеси остаток урона другому вражескому отряду на твой выбор один раз.', {
        type: 'effect', art: 'armor-piercing-shot.webp', removalReserve: 5, keywords: ['Урон', 'Расправа'],
        deploy: ability([{
          ...action('damage', chosen('enemy'), 6),
          slay: {
            ...ability([action('damage', chosen('enemy'), { result: 'overflow' })], [{
              ...enemyChoice({ result: 'overflow' }), targets: { ...enemies, exclude: 'slain' },
            }]),
            requiresResult: 'overflow',
          },
        }], [enemyChoice(6)]),
      }],
    ['helper-robot', 'Робот-помощник', 'epic', 8, 4,
      'Когда ты впервые за матч разыгрываешь легендарную карту, призови Робота-помощника из колоды в случайный свой ряд, где есть место.', {
        art: 'helper-robot.webp?v=art-28', categories: ['Робот'], keywords: ['Призыв'],
        pileEvents: { play: { friendly: true, pile: 'deck', firstLegendary: true,
          ability: ability([{ action: 'summon-from-deck', row: 'random' }]) } },
      }],
  ].map(([id, name, rarity, provision, power, text, rules]) => Object.freeze({
    id, name, rarity, faction: NEUTRAL, provision, type: 'unit', ...(power === null ? {} : { power }), text, ...rules,
  })),
]);
