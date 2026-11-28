import assert from 'node:assert/strict';
import test from 'node:test';
import { findCardDefinition } from '../../docs/game/cards/card-registry.js';
import { createCard } from '../../docs/game/engine/board.js';
import { applyAction, confirmMulligan, createMatch } from '../../docs/game/engine/match.js';
import { progress } from '../../docs/game/engine/match-rounds.js';
import { bindTargeting, updatePendingAim } from '../../docs/ui/targeting.js';
import { TestNode } from '../helpers/test-node.js';

const listeners = new Map();
const body = new TestNode('body');
globalThis.document = {
  body,
  createElement: (tag) => new TestNode(tag),
  createElementNS: (_, tag) => {
    const svg = new TestNode(tag);
    svg.append(Object.assign(new TestNode('path'), { className: 'aim-curve' }));
    return svg;
  },
  addEventListener: (name, fn) => listeners.set(name, fn),
  querySelector: () => null,
};
globalThis.window = new EventTarget();
const { createBattlefield } = await import('../../docs/ui/field.js');
const { createFieldChoices } = await import('../../docs/ui/field-choices.js');

const click = (node, detail = 1) => node.dispatchEvent(Object.assign(new Event('click'), { detail }));
const namedButton = (root, name) => root.querySelectorAll('button').find(({ textContent }) => textContent === name);

function fixture(count = 3) {
  const match = confirmMulligan(createMatch({ random: () => 0 }), [], { random: () => 0 });
  const human = match.players.human;
  human.deck = Array.from({ length: count }, (_, index) => createCard('offer-' + index, {
    ...findCardDefinition('vine'), name: 'Карта ' + index, text: 'Способность ' + index,
  }));
  match.pending = { kind: 'deck-card', side: 'human', options: human.deck.map(({ id }) => id), prompt: 'Выбери карту' };
  return match;
}

test('choice overlay sits above the board, labels its cards and enters once per pending', () => {
  const match = fixture();
  let opponent;
  const battlefield = createBattlefield({
    getMatch: () => match, isReplaying: () => false, getSelectedCardId: () => undefined,
    isMulliganFieldVisible: () => false, setMulliganField() {}, playHuman() {},
    humanCanAct: () => false, placeSelected() {}, settingsButton: () => new TestNode('button'),
    showDrawer() {}, selectCard() {}, mulliganScreen() {}, getLeagueOpponent: () => opponent,
    getLeagueSpeech: () => undefined,
  });
  const game = battlefield();
  const overlay = game.querySelector('.choice-overlay');
  assert.equal(overlay.parent, game);
  assert.equal(game.querySelector('.match-board').inert, true);
  assert.equal(game.querySelector('.field-center').querySelector('.choice-overlay'), null);
  assert.equal(overlay.querySelector('.deck-offer').getAttribute('role'), 'dialog');
  assert.equal(overlay.querySelector('.deck-choice-cards').style.cssText, '--n:3');
  assert.equal(overlay.querySelector('.choice-subtitle').textContent, 'из колоды · 3');
  assert.equal(overlay.querySelector('.deck-choice-name').textContent, 'Карта 0');
  assert.equal(overlay.querySelector('.deck-choice-text').textContent, 'Способность 0');
  assert.ok(overlay.classList.contains('choice-enter'));
  assert.ok(!battlefield().querySelector('.choice-overlay').classList.contains('choice-enter'));
  match.pending = { ...match.pending };
  opponent = { name: 'Соперник' };
  const league = battlefield();
  assert.equal(league.querySelector('.choice-overlay').parent, league.querySelector('.league-battle-stage'));
  assert.ok(league.querySelector('.choice-overlay').classList.contains('choice-enter'));
});

test('whole-deck choices put eligible cards first and preview the full text under focus', () => {
  const match = fixture(7);
  match.pending.fullDeck = true;
  match.pending.options = ['offer-5', 'offer-3'];
  const actions = [];
  const { deckChoice } = createFieldChoices({ playHuman: (action) => actions.push(action) });
  const overlay = deckChoice(match);
  const cards = overlay.querySelector('.deck-choice-cards').querySelectorAll('.hand-card');
  assert.deepEqual(cards.map(({ dataset }) => dataset.cardId), ['offer-3', 'offer-5', 'offer-0', 'offer-1', 'offer-2', 'offer-4', 'offer-6']);
  assert.equal(cards[2].getAttribute('aria-disabled'), 'true');
  cards[2].dispatchEvent(new Event('focus'));
  assert.equal(overlay.querySelector('.choice-detail').querySelector('p').textContent, 'Способность 0');
  click(cards[2]);
  assert.deepEqual(actions, []);
  click(cards[1]);
  assert.deepEqual(actions, [{ type: 'target', cardId: 'offer-5' }]);
});

test('cancel is conditional and hand is a read-only strip that can be toggled', () => {
  const match = fixture();
  let canCancel = false;
  let cancelled = 0;
  const actions = [];
  const { deckChoice } = createFieldChoices({
    playHuman: (action) => actions.push(action), canCancel: () => canCancel,
    cancelTargeting: () => { cancelled += 1; },
  });
  assert.equal(namedButton(deckChoice(match), 'Отмена'), undefined);
  canCancel = true;
  const overlay = deckChoice(match);
  const hand = overlay.querySelector('.choice-hand');
  const toggle = namedButton(overlay, 'Рука');
  assert.equal(hand.hidden, true);
  click(toggle);
  assert.equal(hand.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const cards = hand.querySelectorAll('.hand-card');
  assert.deepEqual(cards.map(({ dataset }) => dataset.cardId), match.players.human.hand.map(({ id }) => id));
  click(cards[0]);
  assert.deepEqual(actions, []);
  click(toggle);
  assert.equal(hand.hidden, true);
  click(namedButton(overlay, 'Отмена'));
  assert.equal(cancelled, 1);
});

test('dense touch offers confirm by second tap or button and three-card offers stay single-tap', () => {
  const actions = [];
  const { deckChoice } = createFieldChoices({ phoneChoice: () => true, playHuman: (action) => actions.push(action) });
  const overlay = deckChoice(fixture(6));
  const cards = overlay.querySelector('.deck-choice-cards').querySelectorAll('.hand-card');
  const confirm = namedButton(overlay, 'Выбрать');
  assert.equal(overlay.dataset.choicePhone, 'true');
  assert.equal(confirm.hidden, true);
  click(cards[0]);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true');
  assert.equal(confirm.hidden, false);
  assert.deepEqual(actions, []);
  click(cards[1]);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'false');
  assert.deepEqual(actions, []);
  click(cards[1], 2);
  assert.deepEqual(actions, [{ type: 'target', cardId: 'offer-1' }]);

  const second = deckChoice(fixture(6));
  click(second.querySelector('[data-choice-card="offer-4"]'));
  click(namedButton(second, 'Выбрать'));
  assert.deepEqual(actions.at(-1), { type: 'target', cardId: 'offer-4' });

  const small = deckChoice(fixture());
  click(small.querySelector('[data-choice-card="offer-2"]'));
  assert.deepEqual(actions.at(-1), { type: 'target', cardId: 'offer-2' });
});

test('a long phone strip scrolls inside the panel and has arrows; short offers have none', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../docs/field-effects.css', import.meta.url), 'utf8');
  // Regression: an auto grid track grew to the width of a 15-card nowrap strip, so the strip never scrolled
  // and the header controls («Рука», «Выбрать») were pushed off screen on phones.
  assert.match(css, /\.choice-overlay \{[^}]*grid-template: minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/);
  assert.match(css, /\.deck-offer \{[^}]*min-width: 0;/);

  const { deckChoice } = createFieldChoices({ phoneChoice: () => true, playHuman: () => {} });
  const scrolls = [];
  const overlay = deckChoice(fixture(15));
  const strip = overlay.querySelector('.deck-choice-cards');
  strip.clientWidth = 500;
  strip.scrollBy = (options) => scrolls.push(options.left);
  const arrows = overlay.querySelectorAll('.choice-scroll');
  assert.equal(arrows.length, 2);
  click(arrows[1]);
  click(arrows[0]);
  assert.deepEqual(scrolls, [400, -400]);
  assert.equal(deckChoice(fixture(5)).querySelectorAll('.choice-scroll').length, 0);
});

test('choice overlays have no aim curve and right click reaches card inspection without cancelling', () => {
  const screen = new TestNode('div');
  screen.after = () => {};
  let cancels = 0;
  const aim = bindTargeting(screen, () => { cancels += 1; return true; });
  const menu = listeners.get('contextmenu');
  const inside = { target: { closest: () => ({}) }, preventDefault: assert.fail, stopImmediatePropagation: assert.fail };
  aim.update(() => ({ x: 0, y: 0 }));
  menu(inside);
  assert.equal(cancels, 0);
  updatePendingAim(screen, aim, fixture(), {});
  assert.ok(!screen.classList.contains('is-aiming'));
  menu({ ...inside, target: { closest: () => null } });
  assert.equal(cancels, 0);
});

const targetKinds = [
  'armor', 'boost', 'capture', 'cleanse', 'consume', 'damage', 'deathwish', 'destroy', 'emp',
  'friendly-damage', 'infection', 'infection-target', 'leader-offering', 'lock', 'marshal',
  'sacrifice', 'shield', 'spend-armor', 'target-mark', 'transform', 'zeal',
];
const prompt = 'Выбери цель.';
const deckOffer = { action: 'play-from-deck', filter: { rarity: 'bronze' }, choose: 1 };
const selectRow = (filter) => ({ action: 'select-row', ref: 'row', filter, prompt });
const choices = [
  ...targetKinds.map((kind) => [kind, '.unit-face.effect-target', {
    steps: [], select: [{ kind, ref: 'unit', targets: { scope: 'field', type: 'unit' }, prompt }],
  }]),
  ...[
    ['armor-row', [selectRow('armor')]],
    ['enemy-row', [selectRow('units')]],
    ['mark-row', [selectRow('units'), { action: 'status', status: 'target', target: { scope: 'enemy', rowRef: 'row' } }]],
    ['row-effect', [{ ...selectRow('any'), side: 'enemy' }]],
    ['spawn-row', [selectRow('space')]],
  ].map(([kind, steps]) => [kind, '.row-label.effect-target', { steps }]),
  ['deck-card', '[data-choice-card]', { steps: [deckOffer] }],
  ['deck-top', '[data-choice-card]', { steps: [{ action: 'choose-deck-top' }] }],
  ['hand-bottom', '[data-choice-card]', { steps: [{ action: 'choose-hand-bottom' }] }],
  ['hand-return', '[data-choice-card]', { steps: [{ action: 'return-hand', amount: 1 }] }],
  ['deck-placement', '.placement-choice', { steps: [deckOffer] }],
  ['tribute', '.tribute-option', { steps: [{ action: 'choose-tribute', tiers: { 3: 1 } }] }],
];

function isAvailable(node) {
  for (let current = node; current; current = current.parent) {
    if (current.inert || current.disabled || current.hidden || current.getAttribute('aria-disabled') === 'true') return false;
  }
  return true;
}

for (const [kind, control, ability] of choices) {
  test(`human ${kind} renders an available control that advances the effect`, () => {
    let match = fixture();
    match.pending = null;
    const random = () => 0;
    const { human, bot } = match.players;
    const vine = findCardDefinition('vine');
    human.board.surface = [createCard('ally', { ...vine, armor: 1 })];
    bot.board.surface = [createCard('enemy', vine)];
    human.coins = 3;
    match.effects.push({
      side: 'human', sourceId: 'ally', ability,
      ...(kind === 'deck-placement' && { refs: { deckCard: human.deck[0].id } }),
    });
    progress(match, random);
    assert.equal(match.pending?.kind, kind);

    const battlefield = createBattlefield({
      getMatch: () => match, isReplaying: () => false, getSelectedCardId: () => undefined,
      playHuman: (action) => { match = applyAction(match, 'human', action, { random }); },
      humanCanAct: () => false, settingsButton: () => new TestNode('button'), getLeagueOpponent: () => undefined,
    });
    const game = battlefield();
    const continuation = game.querySelectorAll(control).find(isAvailable);
    assert.ok(continuation, `Expected an available ${control} for ${kind}`);
    const before = match;
    click(continuation);
    assert.notEqual(match, before, 'The engine must accept the action from the rendered control');
  });
}

test('board targeting offers a touch-accessible cancel button only when cancellation is allowed', () => {
  const match = fixture();
  match.pending = { kind: 'damage', side: 'human', options: [], prompt };
  let canCancel = false;
  let cancelled = 0;
  const battlefield = createBattlefield({
    getMatch: () => match, isReplaying: () => false, getSelectedCardId: () => undefined,
    humanCanAct: () => false, settingsButton: () => new TestNode('button'), getLeagueOpponent: () => undefined,
    canCancel: () => canCancel, cancelTargeting: () => { cancelled += 1; },
  });
  assert.equal(namedButton(battlefield(), 'Отмена'), undefined);
  canCancel = true;
  const game = battlefield();
  const cancel = namedButton(game.querySelector('.target-prompt'), 'Отмена');
  assert.ok(isAvailable(cancel));
  click(cancel);
  assert.equal(cancelled, 1);
});

test('the disabled turn button gives the actual reason to sighted and assistive users', () => {
  const match = fixture();
  let replaying = false;
  const battlefield = createBattlefield({
    getMatch: () => match, isReplaying: () => replaying, getSelectedCardId: () => undefined,
    humanCanAct: () => !replaying && !match.pending && match.turn === 'human',
    settingsButton: () => new TestNode('button'), getLeagueOpponent: () => undefined,
  });
  function check(text, reason) {
    const action = namedButton(battlefield(), text);
    assert.equal(action.disabled, Boolean(reason));
    if (reason) assert.equal(action.title, reason);
    assert.equal(action.getAttribute('aria-description'), reason);
  }
  check('Пас', 'Сначала выбери цель');
  replaying = true;
  check('Пас', 'Идёт анимация');
  replaying = false;
  match.pending = null;
  match.turn = 'bot';
  check('Пас', 'Ход соперника');
  match.turn = 'human';
  match.players.human.usedAbility = true;
  check('Пас', 'Сыграй карту после применения способности');
  match.players.human.usedAbility = false;
  check('Пас', null);
});
