export const other = (side) => side === 'bot' ? 'human' : 'bot';

const swap = (side) => side == null ? side : other(side);
const reverseSides = ({ bot, human }) => ({ human: bot, bot: human });
const mirrorEvent = (event) => ({
  ...event, side: swap(event.side), winner: swap(event.winner), attacker: swap(event.attacker),
  ...(event.boardSide && { boardSide: swap(event.boardSide) }),
  ...(event.owner && { owner: swap(event.owner) }),
  ...(event.scores && { scores: reverseSides(event.scores) }),
});
function mirrorPlayer(player) {
  const mirrorCard = (card) => card.owner || card.infectionSource?.attacker || card.inheritedDeathwishes?.some(({ grantedBy }) => grantedBy)
    ? { ...card, ...(card.owner && { owner: swap(card.owner) }),
      ...(card.infectionSource && { infectionSource: { ...card.infectionSource, attacker: swap(card.infectionSource.attacker) } }),
      ...(card.inheritedDeathwishes && { inheritedDeathwishes: card.inheritedDeathwishes.map((wish) =>
        wish.grantedBy ? { ...wish, grantedBy: swap(wish.grantedBy) } : wish) }) } : card;
  return { ...player,
    board: Object.fromEntries(Object.entries(player.board).map(([row, cards]) => [row, cards.map(mirrorCard)])),
    rowEffects: Object.fromEntries(Object.entries(player.rowEffects ?? {}).map(([row, effect]) =>
      [row, { ...effect, attacker: swap(effect.attacker) }])),
  };
}

export function mirrorMatch(match) {
  return {
    ...match,
    turn: swap(match.turn), starter: swap(match.starter),
    players: { human: mirrorPlayer(match.players.bot), bot: mirrorPlayer(match.players.human) },
    log: match.log.map(mirrorEvent),
    effects: match.effects.map(mirrorEvent),
    pending: match.pending && {
      ...mirrorEvent(match.pending), selectionSide: swap(match.pending.selectionSide),
      job: mirrorEvent(match.pending.job),
    },
  };
}
