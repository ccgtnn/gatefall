import { rankStanding, wonRounds } from '../game/ranks.js';

export async function settleFinishedMatch(match, progress, { id, league }) {
  const { result, log } = match;
  const { factionId } = match.players.human;
  const rounds = wonRounds(log);
  let outcome;
  if (league) {
    const opposingRounds = log.filter(({ type, winner }) => type === 'round-end' && winner === 'bot').length;
    outcome = await progress.settleLeagueMatch(id, result, rounds - opposingRounds, factionId, rounds);
  } else {
    outcome = await progress.rewardMatch(id, result, factionId, rounds);
  }

  const recordStats = outcome === 'done' || outcome === 'empty';
  if (outcome === 'stale') return { status: 'stale', recordStats };
  const status = recordStats || outcome === 'claimed' ? 'done' : 'unavailable';
  return { status, recordStats };
}

export function describeFinishedMatch(match, status, opponent, readRanks) {
  const saving = !status || status === 'saving';
  const failed = status === 'unavailable';
  const reply = match.log.findLast(({ type, reason }) => type === 'league-speech' && (reason === 'win' || reason === 'loss'));
  let notice = '';
  if (saving) notice = 'Сохраняем результат…';
  else if (failed) notice = 'Не удалось сохранить результат.';
  else if (status === 'stale') notice = 'Этот тур уже закрыт.';
  else if (!match.surrendered) {
    const scored = wonRounds(match.log);
    if (scored) notice = `В месячный ранг зачтено: ${scored} · текущий ранг ${rankStanding(readRanks().rounds).rank}`;
  }
  return { saving, failed, opponent, reply, notice };
}
