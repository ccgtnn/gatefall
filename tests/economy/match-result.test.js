import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardProgress } from '../../docs/game/rewards.js';
import { describeFinishedMatch, settleFinishedMatch } from '../../docs/ui/match-result.js';

const humanRound = { type: 'round-end', winner: 'human' };
const botRound = { type: 'round-end', winner: 'bot' };
const match = {
  result: 'win', players: { human: { factionId: 'growth' } }, log: [humanRound, humanRound],
};
const regularMatch = { id: 'regular', league: false };

test('a regular win grants rewards and records the result in faction statistics', async () => {
  const values = new Map();
  const progress = createRewardProgress({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  assert.deepEqual(await settleFinishedMatch(match, progress, regularMatch), { status: 'done', recordStats: true });
  assert.equal(progress.ranks().rounds, 2);
  const gold = progress.inventory().gold;
  assert.ok(gold > 0);

  assert.deepEqual(await settleFinishedMatch(match, progress, regularMatch), { status: 'done', recordStats: false });
  assert.equal(progress.ranks().rounds, 2);
  assert.equal(progress.inventory().gold, gold);
});

test('League settlement counts round wins and the round difference', async () => {
  const leagueMatch = {
    ...match, result: 'loss', log: [botRound, humanRound, { type: 'play', winner: 'bot' }, botRound],
  };
  const progress = {
    settleLeagueMatch: (...args) => {
      assert.deepEqual(args, ['ticket', 'loss', -1, 'growth', 1]);
      return 'done';
    },
  };
  assert.deepEqual(await settleFinishedMatch(leagueMatch, progress, { id: 'ticket', league: true }), {
    status: 'done', recordStats: true,
  });
});

test('a League ticket that is already closed does not record another result', async () => {
  const progress = { settleLeagueMatch: () => 'stale' };
  const { status, recordStats } = await settleFinishedMatch(match, progress, { id: 'ticket', league: true });
  assert.equal(recordStats, false);
  assert.equal(describeFinishedMatch(match, status).notice, 'Этот тур уже закрыт.');
});

test('the results screen distinguishes saving from a failure that can be retried', async () => {
  const saving = describeFinishedMatch(match, 'saving');
  assert.equal(saving.saving, true);
  assert.equal(saving.notice, 'Сохраняем результат…');

  const { status, recordStats } = await settleFinishedMatch(match, { rewardMatch: () => 'unavailable' }, regularMatch);
  const failed = describeFinishedMatch(match, status);
  assert.equal(recordStats, false);
  assert.equal(failed.saving, false);
  assert.equal(failed.failed, true);
  assert.equal(failed.notice, 'Не удалось сохранить результат.');
});

test('finished League results include the last closing reply and monthly rank', () => {
  const reply = { type: 'league-speech', reason: 'loss' };
  const opponent = { id: 'opponent' };
  const result = describeFinishedMatch({
    ...match, log: [humanRound, humanRound, { type: 'league-speech', reason: 'win' }, reply, { type: 'league-speech' }],
  }, 'done', opponent, () => ({ rounds: 3 }));
  assert.deepEqual(result, {
    saving: false, failed: false, opponent, reply,
    notice: 'В месячный ранг зачтено: 2 · текущий ранг 3',
  });
});

test('a surrender does not display monthly rank credit for previously won rounds', () => {
  assert.equal(describeFinishedMatch({ ...match, surrendered: true }, 'done').notice, '');
});
