import { ROWS } from './game/cards.js?v=neutral-art-15';

export function motionDuration(speed, reduced) {
  if (speed === 'system' && reduced) return 0;
  return speed === 'fast' ? 200 : 320;
}

function copyPlayer(player) {
  return {
    ...player,
    hand: [...player.hand],
    board: Object.fromEntries(ROWS.map((row) => [row, player.board[row].map((card) => ({ ...card }))])),
  };
}

export function createPlaybackState(previous) {
  return {
    ...previous,
    log: [...previous.log],
    pending: null,
    hiddenDuringPlayback: new Set(),
    players: {
      human: copyPlayer(previous.players.human),
      bot: copyPlayer(previous.players.bot),
    },
  };
}

export function applyJournalEvent(state, event) {
  const { side, cardId, row, type } = event;
  const player = state.players[side];
  state.log.push(event);

  if (type === 'round-end') {
    for (const player of Object.values(state.players)) {
      for (const row of ROWS) player.board[row] = [];
      player.passed = false;
    }
    return;
  }
  if (type === 'round-start') {
    state.phase = 'playing';
    state.round = event.round;
    state.turn = side;
    return;
  }
  if (!player) return;

  if (type === 'pass') player.passed = true;
  if (type === 'draw' && event.cards) {
    const drawn = new Set(event.cards.map(({ id }) => id));
    player.deck = player.deck.filter(({ id }) => !drawn.has(id));
    player.hand.push(...event.cards);
    return;
  }
  if (type === 'play') {
    const pile = event.from ?? 'hand';
    player[pile] = player[pile].filter(({ id }) => id !== cardId);
    if (row) player.board[row].splice(event.position, 0, { ...event.card });
    return;
  }
  if (type === 'spawn') {
    player.board[row].splice(event.position, 0, ...event.cards.map((card) => ({ ...card })));
    return;
  }
  if (type === 'consume-group') {
    for (const id of event.cardIds) state.hiddenDuringPlayback.add(id);
  }
  if (type === 'death') state.hiddenDuringPlayback.delete(cardId);
  if (!cardId) return;

  for (const row of ROWS) {
    const line = player.board[row];
    const index = line.findIndex(({ id }) => id === cardId);
    if (index === -1) continue;
    if (type === 'death' || type === 'destroy' || type === 'discard') {
      const [card] = line.splice(index, 1);
      const pile = event.exile ? 'exile' : 'discard';
      player[pile] = [...player[pile], card];
      break;
    }
    if (type === 'boost' || type === 'damage') line[index].power = event.power;
    if (type === 'armor') line[index].armor = event.armor;
    if (type === 'status') {
      const card = line[index];
      card.statuses = { ...card.statuses, [event.status]: event.count };
      if (event.status === 'infection' && !event.count) delete card.statuses.infection;
      if (event.tick) card.power = event.power;
    }
    if (type === 'order-ready') line[index].readyAt = event.readyAt;
    if (type === 'tick') line[index].timer = event.remaining;
    if (type === 'counter') line[index].counter = event.remaining;
    break;
  }
}

// The next actor may move only after this promise resolves.
export async function playJournal(previous, events, present) {
  const state = createPlaybackState(previous);
  for (const event of events) {
    await present(event, () => {
      applyJournalEvent(state, event);
      return state;
    }, state);
  }
}
