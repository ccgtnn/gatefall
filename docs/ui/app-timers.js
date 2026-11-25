const TICK_MS = 1000;
const RETRY_MS = 15000;

export function createAppTimers(progress, onLeagueTick) {
  let interval;
  let unsubscribe;
  let tavernResetAt;
  let rankResetAt;
  let checkingTavern = false;
  let checkingRanks = false;
  let retryTavernAt = 0;
  let retryRanksAt = 0;

  function readResetTimes() {
    tavernResetAt = progress.tavern()?.resetAt;
    rankResetAt = progress.rankResetAt();
  }

  async function checkpointTavern() {
    if (checkingTavern) return;
    checkingTavern = true;
    try {
      const outcome = await progress.checkpointTavern();
      retryTavernAt = outcome === 'unavailable' ? Date.now() + RETRY_MS : 0;
    } finally {
      checkingTavern = false;
    }
  }

  async function checkpointRanks() {
    if (checkingRanks) return;
    checkingRanks = true;
    try {
      const outcome = await progress.checkpointRanks();
      retryRanksAt = outcome === 'done' ? 0 : Date.now() + RETRY_MS;
    } finally {
      checkingRanks = false;
    }
  }

  function tick() {
    onLeagueTick();
    const time = Date.now();
    if (tavernResetAt && time >= Math.max(tavernResetAt, retryTavernAt)) void checkpointTavern();
    if (time >= Math.max(rankResetAt, retryRanksAt)) void checkpointRanks();
  }

  function start() {
    if (interval !== undefined) return;
    interval = setInterval(tick, TICK_MS);
    if (progress.league()) void progress.checkpointLeague();
    unsubscribe = progress.subscribe(readResetTimes);
    readResetTimes();
    void checkpointTavern();
    void checkpointRanks();
  }

  function stop() {
    if (interval === undefined) return;
    clearInterval(interval);
    interval = undefined;
    unsubscribe();
    unsubscribe = undefined;
  }

  return { start, stop };
}
