import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeckStorage, deckAutosave } from '../../docs/ui/deck-storage.js';
import { createAppHistory, decideBack } from '../../docs/ui/app-history.js';

const backCases = [
  ['an open dialog takes priority over a match', { openDialog: true, inMatch: true, screen: 'match' }, 'close-dialog'],
  ['an active match asks for confirmation', { inMatch: true, screen: 'match' }, 'confirm-leave'],
  ['a menu screen restores the previous menu', { screen: 'leader', previous: { screen: 'faction' } }, 'show-previous'],
  ['the home screen leaves Back to the browser', { screen: 'decks', previous: { screen: 'league' } }, 'browser'],
];

for (const [name, state, expected] of backCases) {
  test(name, () => assert.equal(decideBack(state), expected));
}

function historyFixture(onMenu) {
  const stack = [null, null];
  let index = 1;
  let active = false;
  let pushes = 0;
  let pop;
  let toggle;
  const seen = [];
  const history = {
    get state() { return stack[index]; },
    replaceState(state) { stack[index] = structuredClone(state); },
    pushState(state) { pushes++; stack.splice(++index, Infinity, structuredClone(state)); },
    back() { this.go(-1); },
    go(delta) {
      if (!stack[index + delta] && index + delta !== 0) return;
      index += delta;
      pop({ state: stack[index] });
    },
  };
  const navigation = createAppHistory({
    window: { history, addEventListener: (_event, listener) => { pop = listener; } },
    document: { addEventListener: (_event, listener) => { toggle = listener; } },
    inMatch: () => active,
    confirmLeave: () => seen.push('confirm'),
    showMenu: onMenu ?? (({ screen, data }) => seen.push([screen, data])),
  });
  function dialog(id) {
    const node = {
      localName: 'dialog', isConnected: true, open: true,
      close(value) {
        assert.equal(value, '');
        this.open = false;
        toggle({ target: this, newState: 'closed' });
        seen.push(id);
      },
    };
    toggle({ target: node, newState: 'open' });
  }
  return { history, navigation, seen, dialog, get pushes() { return pushes; }, activate: () => { active = true; } };
}

test('Back closes nested dialogs in opening order, then leaves the home screen normally', () => {
  const { history, dialog, seen } = historyFixture();
  dialog('base');
  dialog('preview');
  history.go(-1);
  history.go(-1);
  assert.deepEqual(seen, ['preview', 'base']);
  assert.equal(history.state.gatefall.screen, 'decks');
  history.go(-1);
  assert.equal(history.state, null);
});

test('a match keeps its Back entry after repeated confirmation requests', () => {
  const { activate, history, navigation, seen } = historyFixture();
  navigation.navigate('match');
  activate();
  history.go(-1);
  history.go(-1);
  assert.deepEqual(seen, ['confirm', 'confirm']);
  assert.equal(history.state.gatefall.screen, 'match');
});

test('menu history restores the faction needed to render the leader selection', () => {
  const { history, navigation, seen } = historyFixture();
  navigation.navigate('leader', { faction: 'growth' });
  navigation.navigate('edit', { deckId: 'local' });
  history.go(-1);
  assert.deepEqual(seen, [['leader', { faction: 'growth' }]]);
});

test('results Back restores the previous menu without pushing another match entry', () => {
  let result = true;
  const seen = [];
  const fixture = historyFixture((entry) => {
    if (result) result = false;
    seen.push(entry.screen);
  });
  fixture.navigation.navigate('league');
  fixture.navigation.navigate('match');
  fixture.history.back();
  assert.equal(fixture.pushes, 2);
  assert.equal(fixture.history.state.gatefall.screen, 'league');
  fixture.history.back();
  assert.deepEqual(seen, ['league', 'decks']);
});

test('a result that cannot exit yet keeps its existing history entry', () => {
  const fixture = historyFixture(({ screen }) => screen === 'match');
  fixture.navigation.navigate('league');
  fixture.navigation.navigate('match');
  fixture.history.back();
  assert.equal(fixture.history.state.gatefall.screen, 'match');
  assert.equal(fixture.pushes, 2);
});

test('screen Back uses the prior entry or replaces the current one', () => {
  const fixture = historyFixture();
  fixture.navigation.navigate('all-decks');
  fixture.navigation.navigate('faction');
  fixture.navigation.navigate('leader', { faction: 'growth' });
  fixture.navigation.backTo('faction');
  fixture.history.back();
  assert.deepEqual(fixture.seen.map(([screen]) => screen), ['faction', 'all-decks']);
  fixture.navigation.navigate('leader', { faction: 'growth' });
  fixture.navigation.backTo('ranks');
  assert.equal(fixture.pushes, 4);
  assert.equal(fixture.history.state.gatefall.screen, 'ranks');
  fixture.history.back();
  assert.deepEqual(fixture.seen.slice(-2).map(([screen]) => screen), ['ranks', 'all-decks']);
});

test('leaving the deck editor autosaves and Forward loads the latest deck by id', () => {
  const values = new Map();
  const store = createDeckStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  store.stageDraft({ id: 'draft', name: 'Draft', factionId: 'growth', leaderId: 'devourer', cardIds: [] });
  let editor;
  let opened;
  let life;
  function render({ screen, data }) {
    life?.abort();
    if (screen !== 'edit') return;
    const deck = opened = store.get(data.deckId);
    life = new AbortController();
    editor = deckAutosave(deck, store.save);
    life.signal.addEventListener('abort', editor.flush, { once: true });
    return deck;
  }
  const fixture = historyFixture(render);
  fixture.navigation.navigate('all-decks');
  fixture.navigation.navigate('edit', { deckId: 'draft' });
  const deck = render(fixture.history.state.gatefall);
  assert.deepEqual(fixture.history.state.gatefall.data, { deckId: 'draft' });
  assert.deepEqual(store.list(), []);
  deck.name = 'Edited';
  editor.changed();
  fixture.history.back();
  assert.equal(store.get('draft').name, 'Edited');
  store.save({ ...store.get('draft'), name: 'Newest' });
  fixture.history.go(1);
  assert.equal(opened.name, 'Newest');
  assert.deepEqual(fixture.history.state.gatefall.data, { deckId: 'draft' });
});
