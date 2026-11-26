import assert from 'node:assert/strict';
import test from 'node:test';
import { botLevelLabel } from '../../docs/game/bot-levels.js';
import { PRESETS } from '../../docs/game/decks.js';
import { createLeague, leagueOpponent, leagueTable } from '../../docs/game/league.js';
import { emit } from '../../docs/ui/app-events.js';
import { BOT_DIFFICULTY_KEY, createBotDifficulty } from '../../docs/ui/bot-difficulty.js';
import { deckHomeScreen } from '../../docs/ui/deck-list.js';
import { createDeckStorage, DECK_STORAGE_KEY } from '../../docs/ui/deck-storage.js';
import { homeTiles } from '../../docs/ui/home-tiles.js';
import { createMatchSession } from '../../docs/ui/match-session.js';
import { QUICK_MATCH_KEY } from '../../docs/ui/quick-match-panel.js';

class Node extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = '';
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  focus() {}
}

globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag) };

const tree = (node) => [node, ...node.children.filter((child) => child instanceof Node).flatMap(tree)];
const byClass = (node, name) => tree(node).find((entry) => entry.className.split(' ').includes(name));
const label = (node) => [node.textContent ?? '', ...node.children.map((entry) =>
  entry instanceof Node ? label(entry) : entry)].join('');
const press = (node) => node.dispatchEvent(new Event('click'));
const actions = Object.fromEntries(['base', 'league', 'ranks', 'catalog', 'decorations', 'all'].map((name) => [name, () => {}]));
function select(node, value) {
  node.value = value;
  node.dispatchEvent(new Event('change'));
}

function fixture(signal) {
  const [preset, growth] = PRESETS;
  const own = { ...preset, id: 'my-human', name: 'Моя колода' };
  const rival = { ...growth, id: 'my-bot', name: 'Колода соперника' };
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const deckStore = createDeckStorage(storage);
  deckStore.save(own);
  deckStore.save(rival);
  deckStore.recordPlay(own.id, 1);
  const owned = {};
  for (const deck of PRESETS) {
    const copies = {};
    for (const id of deck.cardIds) copies[id] = (copies[id] ?? 0) + 1;
    for (const [id, count] of Object.entries(copies)) owned[id] = Math.max(owned[id] ?? 0, count);
  }
  const difficulty = createBotDifficulty(storage);
  const inventory = () => ({ owned });
  const phase = new Node('p');
  const view = (play) => deckHomeScreen(phase, actions, {}, { deckStore, inventory, storage, difficulty, play }, signal);
  return { own, rival, saved, deckStore, owned, difficulty, inventory, actions, view };
}

test('home has quick match and All Decks tile, with the last played deck and all bot presets', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const { own, view } = fixture(scope.signal);
  const home = view(() => {});
  const panel = byClass(home, 'quick-match');
  const [player, bot, difficulty] = tree(panel).filter(({ tag }) => tag === 'select');
  assert.equal(label(panel.children[0]), 'Быстрый матч');
  assert.deepEqual(byClass(home, 'home-tiles-collection').children.map(label), ['Все карты', 'Украшения', 'Все колоды']);
  assert.equal(byClass(home, 'deck-list'), undefined);
  assert.equal(player.value, own.id);
  assert.equal(bot.value, '');
  assert.equal(label(bot.children[0]), 'Случайная');
  assert.ok(PRESETS.every(({ id }) => bot.children.some(({ value }) => value === id)));
  assert.deepEqual(difficulty.children.map(label), [1, 2, 3, 4, 5, 6, 7].map(botLevelLabel));
});

test('difficulty settings and quick match share updates and one saved level', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const { difficulty, saved, view } = fixture(scope.signal);
  const controls = new Node('select');
  difficulty.bind(controls, scope.signal);
  const quick = tree(view(() => {})).filter(({ tag }) => tag === 'select').at(-1);
  select(quick, '6');
  assert.equal(controls.value, '6');
  assert.equal(difficulty.read(), 6);
  assert.equal(saved.get(BOT_DIFFICULTY_KEY), '6');
  select(controls, '2');
  assert.equal(quick.value, '2');
  assert.equal(saved.get(BOT_DIFFICULTY_KEY), '2');
  saved.set(BOT_DIFFICULTY_KEY, 'hard');
  difficulty.refresh();
  assert.equal(quick.value, '6');
  assert.equal(saved.get(BOT_DIFFICULTY_KEY), '6');
});

test('Play starts a real session with the selected bot deck and remembers it', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const { own, rival, deckStore, inventory, saved, view } = fixture(scope.signal);
  const turns = { reset(match) { this.match = match; }, warmBot() {} };
  const session = createMatchSession({
    turns, progress: { inventory, league: () => undefined }, deckStore,
    screen: { querySelector: () => new Node('h2') }, settings: { motion: () => 0 },
    notices: { coinNotice: new Node('aside') }, announcement: new Node('p'),
    showNotice() {}, onStart() {}, render() {},
  });
  const home = view(session.start);
  const [, bot] = tree(home).filter(({ tag }) => tag === 'select');
  select(bot, rival.id);
  press(byClass(home, 'quick-match-play'));
  assert.equal(turns.match.players.bot.factionId, rival.factionId);
  assert.equal(turns.match.players.bot.leader.id, rival.leaderId);
  assert.deepEqual(turns.match.players.bot.startingDeck.map(({ definition }) => definition.id).sort(),
    [...rival.cardIds].sort());
  assert.deepEqual(JSON.parse(saved.get(QUICK_MATCH_KEY)), { player: own.id, bot: rival.id });
  assert.equal(tree(view(() => {})).filter(({ tag }) => tag === 'select')[1].value, rival.id);
});

test('quick match falls back when a saved deck is deleted or no longer owned', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const { own, rival, deckStore, owned, saved, view } = fixture(scope.signal);
  saved.set(QUICK_MATCH_KEY, JSON.stringify({ player: own.id, bot: rival.id }));
  const [player, bot] = tree(view(() => {})).filter(({ tag }) => tag === 'select');
  saved.set(DECK_STORAGE_KEY, JSON.stringify([rival]));
  deckStore.refresh();
  emit('collection-change');
  assert.equal(player.value, PRESETS[0].id);
  assert.equal(bot.value, rival.id);
  delete owned[rival.cardIds[0]];
  emit('collection-change');
  assert.equal(bot.value, '');
  assert.ok(!bot.children.some(({ value }) => value === rival.id));
  assert.deepEqual(JSON.parse(saved.get(QUICK_MATCH_KEY)), { player: PRESETS[0].id, bot: '' });
  for (const id of Object.keys(owned)) delete owned[id];
  emit('collection-change');
  assert.ok(player.disabled);
});

test('home tiles show production, tavern rewards, next League opponent and rank rewards', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const league = createLeague(Date.now());
  const opponent = leagueOpponent(league.season);
  const table = leagueTable(league.season);
  const place = table.findIndex(({ id }) => id === 'human') + 1;
  let rounds = 9;
  let buildings = { mine: { outputs: { gold: { stored: 120 } } }, workshop: { outputs: { gold: { stored: 12 }, steel: { stored: 4 } } } };
  const tiles = homeTiles({
    production: () => buildings,
    tavern: () => ({ pending: [{}, {}, {}], slots: [] }),
    league: () => league,
    ranks: () => ({ rounds }),
  }, actions, scope.signal);
  const [base, ladder, ranks] = tiles.children;
  assert.equal(base.attributes['aria-label'], 'База · к сбору: Золото 132, Сталь 4 · награды Таверны: 3');
  assert.equal(label(byClass(base, 'tavern-badge')), '3');
  assert.ok(byClass(ladder, 'league-avatar'));
  assert.ok(label(ladder).includes(opponent.name));
  assert.ok(label(ladder).includes(opponent.lines.start[0]));
  assert.ok(label(ladder).includes(`Ты ${place}-й из ${table.length}`));
  assert.match(ranks.attributes['aria-label'], /Ранги · 9 · ранг 10: Ключи 5, Сталь 20, Энергоячейки 2, Осколки врат 1/);
  buildings = {};
  league.resetAt = 0;
  rounds = 105;
  emit('collection-change');
  assert.equal(base.attributes['aria-label'], 'База · награды Таверны: 3');
  assert.equal(label(ladder), 'Лига');
  assert.equal(label(ranks), 'Ранги · 25');
});

test('home tiles have plain labels when progress data is absent', (t) => {
  const scope = new AbortController();
  t.after(() => scope.abort());
  const tiles = homeTiles({}, actions, scope.signal);
  assert.deepEqual(tiles.children.map(label), ['База', 'Лига', 'Ранги']);
});
