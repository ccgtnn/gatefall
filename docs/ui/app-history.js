export const HOME_SCREEN = 'decks';

export function decideBack({ openDialog, inMatch, screen, previous }) {
  if (openDialog) return 'close-dialog';
  if (inMatch) return 'confirm-leave';
  if (screen !== HOME_SCREEN && previous) return 'show-previous';
  return 'browser';
}

export function createAppHistory({ window, document, inMatch, confirmLeave, showMenu }) {
  const { history } = window;
  const session = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
  const dialogs = [];
  let current = { screen: HOME_SCREEN, depth: 0 };

  function write(entry, push) {
    current = entry;
    const state = { ...history.state, gatefall: { session, ...entry } };
    if (push) history.pushState(state, '');
    else history.replaceState(state, '');
  }

  write(current, false);
  document.addEventListener('beforetoggle', (event) => {
    const dialog = event.target;
    if (dialog.localName !== 'dialog') return;
    const index = dialogs.indexOf(dialog);
    if (index !== -1) dialogs.splice(index, 1);
    if (event.newState !== 'open') return;
    dialogs.push(dialog);
    // A modal opened from the initial menu needs a same-document Back destination.
    if (current.depth === 0) write({ ...current, depth: 1 }, true);
  }, true);

  window.addEventListener('popstate', (event) => {
    const state = event.state?.gatefall;
    const previous = state?.session === session ? state : undefined;
    const dialog = dialogs.findLast((item) => item.isConnected && item.open);
    const action = decideBack({ openDialog: dialog, inMatch: inMatch(), screen: current.screen, previous });
    if (action === 'close-dialog' || action === 'confirm-leave') {
      write(current, true);
      if (dialog) dialog.close('');
      else confirmLeave();
    } else if (previous && (action === 'show-previous' || previous.depth > current.depth)) {
      current = previous;
      showMenu(previous);
    } else if (previous) {
      // Skip Gatefall entries behind a home screen reached from an in-game Back button.
      current = { screen: HOME_SCREEN, depth: previous.depth };
      history.go(-previous.depth - 1);
    }
  });

  return {
    navigate(screen, data) {
      const push = current.screen !== screen;
      if (push && current.data) write(current, false);
      write({ screen, data, depth: current.depth + Number(push) }, push);
    },
    replace(screen, data) {
      write({ screen, data, depth: current.depth }, false);
    },
  };
}
