// Masked simulations have one placeholder per card, so engine mutations update the count.
export function handCount(player) {
  return player.handMasked ? player.hand.length : player.publicHandSize ?? player.hand.length;
}
