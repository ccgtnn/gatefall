import { ROWS } from './card-metadata.js';

export function rowScore(player, row) {
  return player.board[row].reduce((score, card) => score + (card.power ?? 0), 0);
}

export function totalScore(player) {
  return ROWS.reduce((score, row) => score + rowScore(player, row), 0);
}

export function shuffle(cards, random) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
  return cards;
}
