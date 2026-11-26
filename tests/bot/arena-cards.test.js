import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCards, summarizeOverload } from '../../tools/arena-cards.mjs';

test('card statistics count repeated copies once per game and separate faction win rates', () => {
  const played = [
    { side: 'human', id: 'neutral', name: 'Нейтральная', points: 8, lead: -1 },
    { side: 'human', id: 'neutral', name: 'Нейтральная', points: 2, lead: 7 },
    { side: 'bot', id: 'neutral', name: 'Нейтральная', points: 4, lead: -3 },
  ];
  const totals = summarizeCards([
    { faction: 'protectorate', result: 'win', played },
    { faction: 'protectorate', result: 'draw', played },
  ]);
  assert.deepEqual(totals.map(({ faction, plays, games, winPct, pointsPerPlay }) =>
    [faction, plays, games, winPct, pointsPerPlay]), [
    ['growth', 2, 2, 0, 4],
    ['protectorate', 4, 2, 50, 5],
  ]);
});

test('only a preceding Colonel in the same row and round counts as the Overload combo', () => {
  const overload = { side: 'human', id: 'shield-overload', row: 'orbit', round: 2, at: 10, points: 6, damage: 10, lead: -2 };
  const colonel = { side: 'human', id: 'colonel', row: 'orbit', round: 2, at: 9 };
  const played = [
    [colonel, overload],
    [{ ...colonel, row: 'surface' }, overload],
    [{ ...colonel, at: 11 }, overload],
    [{ ...colonel, round: 1 }, overload],
  ];
  const summary = summarizeOverload(played.map((played) => ({ faction: 'protectorate', result: 'win', played })));
  assert.deepEqual(summary.map(({ category, games, damage, points }) => [category, games, damage, points]), [
    ['colonel-before-overload-same-row', 1, 10, 6],
    ['overload-without-same-row-colonel', 3, 30, 18],
  ]);
});
