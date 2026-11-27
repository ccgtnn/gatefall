import { recordCardPlay, spendResilience } from '../game/engine/board.js';
import { ROWS } from '../game/shared/card-metadata.js';

export { motionDuration } from './motion-tokens.js';

function copyPlayer(player) {
  return {
    ...player,
    hand: [...player.hand],
    rowEffects: { ...player.rowEffects },
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
      for (const row of ROWS) player.board[row] = player.board[row].filter(spendResilience);
      player.rowEffects = {};
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
  if (type === 'turn-start') {
    state.turn = side;
    return;
  }
  if (!player) return;

  if (type === 'coins') player.coins = event.coins;
  if (type === 'hand-bottom' || type === 'hand-return') {
    const card = player.hand.find(({ id }) => id === cardId);
    player.hand = player.hand.filter(({ id }) => id !== cardId);
    if (card) {
      player.deck = [...player.deck];
      player.deck.splice(event.position ?? player.deck.length, 0, card);
    }
    return;
  }
  if (type === 'pass') player.passed = true;
  if (type === 'leader-replaced') player.leader = event.leader;
  if (type === 'leader' && (event.lastUsedTurn !== undefined || event.charges !== undefined)) {
    player.leader = {
      ...player.leader,
      ...(event.lastUsedTurn !== undefined && { lastUsedTurn: event.lastUsedTurn }),
      ...(event.charges !== undefined && { charges: event.charges }),
    };
  }
  if (type === 'draw' && event.cards) {
    const drawn = new Set(event.cards.map(({ id }) => id));
    player.deck = player.deck.filter(({ id }) => !drawn.has(id));
    player.hand.push(...event.cards);
    if (event.reason === 'round') player.extraSwaps = event.extraSwaps;
    return;
  }
  if (type === 'play') {
    const pile = event.from ?? 'hand';
    if (pile !== 'created') player[pile] = player[pile].filter(({ id }) => id !== cardId);
    if (row) state.players[event.boardSide ?? side].board[row].splice(event.position, 0, { ...event.card });
    recordCardPlay(player, event.card);
    return;
  }
  if (type === 'capture') {
    const previous = state.players[event.fromSide].board[event.fromRow];
    const index = previous.findIndex(({ id }) => id === cardId);
    if (index >= 0) previous.splice(index, 1);
    player.board[row].splice(event.position, 0, { ...event.card });
    return;
  }
  if (type === 'row-effect') {
    if (event.effect) player.rowEffects[row] = event.effect;
    else delete player.rowEffects[row];
    return;
  }
  if (type === 'spawn') {
    if (event.from === 'deck') {
      const summoned = new Set(event.cards.map(({ id }) => id));
      player.deck = player.deck.filter(({ id }) => !summoned.has(id));
    }
    player.board[row].splice(event.position, 0, ...event.cards.map((card) => ({ ...card })));
    return;
  }
  if (type === 'status' && event.status === 'target' && event.count > 0 && event.attacker) {
    const attacker = state.players[event.attacker];
    attacker.marksPlaced = (attacker.marksPlaced ?? 0) + 1;
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
      const owner = state.players[event.owner ?? side];
      owner[pile] = [...owner[pile], card];
      break;
    }
    if (type === 'inherit-deathwishes') line[index].inheritedDeathwishes = event.inheritedDeathwishes;
    if (type === 'transform') line[index] = { ...event.card };
    if (type === 'art-state') line[index].artState = event.artState;
    if (type === 'aura-power') {
      line[index].power = event.power;
      const { sidePower, rowPower } = line[index].definition;
      for (const rule of [sidePower, rowPower]) {
        if (!rule) continue;
        const { key } = rule;
        if (event[key]) line[index][key] = event[key];
        else if (event[key] === 0) delete line[index][key];
      }
    }
    if (type === 'scenario-chapter') line[index].chapter = event.chapter;
    if (type === 'base-power') line[index].basePower = event.basePower;
    if (['boost', 'weaken', 'damage', 'base-power', 'heal'].includes(type)) line[index].power = event.power;
    if (type === 'armor') line[index].armor = event.armor;
    if (type === 'status') {
      const card = line[index];
      card.statuses = { ...card.statuses, [event.status]: event.count };
      if (event.status === 'infection' && !event.count) delete card.statuses.infection;
      if (event.tick) card.power = event.power;
    }
    if (type === 'cleanse') {
      const card = line[index];
      card.statuses = { ...event.statuses };
      if (event.removed.includes('infection')) delete card.infectionSource;
      if (event.inherited) delete card.inheritedDeathwishes;
    }
    if (type === 'order-ready' || (type === 'order' && event.readyAt !== undefined)) line[index].readyAt = event.readyAt;
    if (type === 'order' && event.orderCharges !== undefined) line[index].orderCharges = event.orderCharges;
    if (type === 'order' && event.orderUsedTurn !== undefined) line[index].orderUsedTurn = event.orderUsedTurn;
    if (type === 'growth') line[index].growth = event.growth;
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
