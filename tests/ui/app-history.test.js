import assert from 'node:assert/strict';
import test from 'node:test';
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

function historyFixture() {
  const stack = [null, null];
  let index = 1;
  let active = false;
  let pop;
  let toggle;
  const seen = [];
  const history = {
    get state() { return stack[index]; },
    replaceState(state) { stack[index] = structuredClone(state); },
    pushState(state) { stack.splice(++index, Infinity, structuredClone(state)); },
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
    showMenu: ({ screen, data }) => seen.push([screen, data]),
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
  return { history, navigation, seen, dialog, activate: () => { active = true; } };
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
  navigation.navigate('edit', { deck: { id: 'local' } });
  history.go(-1);
  assert.deepEqual(seen, [['leader', { faction: 'growth' }]]);
});
