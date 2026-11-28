export const MOTION = Object.freeze({
  pace: Object.freeze({
    opponentReveal: 4.2,
    coinToss: 3.6,
    turnBanner: 3.4,
    compactTurnBanner: 2,
    turnBannerEntrance: .3,
    passStamp: 2.2,
    passPulse: .65,
    passDustDelay: .15,
    skippedTurn: 1.2,
    lifeLoss: 1.5,
    score: .88,
    journalFeedback: .8,
    rowRecoil: .48,
    botAim: .35,
    roundWinner: 2,
    matchWin: 2.2,
    matchLoss: 2.8,
    projectile: .43,
    firestormDrop: .58,
    lightning: .54,
    afterProjectile: .52,
    handStep: 1 / 6,
    handPulse: 2,
    draw: 1.7,
    drawStep: .3,
    drawFeedback: .65,
    handReturn: 1.4,
    deal: 1.4,
    dealStep: .14,
    mulliganOut: .45,
    mulliganIn: .65,
    landingDust: .5,
    landingDustDelay: .53,
    departureParticles: .78,
    departureParticlesDelay: .18,
    annihilationParticles: .8,
    spawnParticles: .82,
    spawnParticlesDelay: .13,
    choiceBackdrop: .6,
    choicePanel: .9,
    choiceCard: 1.4,
    choiceStep: .14,
    choiceConfirm: 1.3,
  }),
  ms: Object.freeze({
    drawMax: 1100,
    orderPulse: 1550,
    orderPulseFast: 950,
    normal: 320,
    fast: 200,
    roundResult: 1500,
    roundTitle: 360,
    roundTitleReduced: 600,
    turnNotice: 1000,
    botNoticeDelay: 1000,
    targetConfirm: 180,
    targetConfirmReduced: 90,
    choiceConfirmStep: 20,
    passShake: 120,
    phoneBannerMax: 700,
    scoreTimeoutMargin: 50,
    coinNoticeMinimum: 1500,
    coinNoticeExtra: 1000,
    coinNoticeFadeIn: 170,
    coinNoticeFadeOut: 250,
  }),
  hand: Object.freeze({
    arc: 16,
    flipStart: .3,
    flipEnd: .75,
    revealAt: .82,
    landAt: .92,
    squeezeX: 1.06,
    squeezeY: .94,
    botWidth: 24,
    botHeight: 36,
    counterPulse: 1.18,
    mulliganDrop: 20,
  }),
  ease: Object.freeze({
    draw: 'cubic-bezier(.2,.8,.2,1)',
    out: 'cubic-bezier(.22,.61,.36,1)',
    back: 'cubic-bezier(.2,.9,.25,1.12)',
    inOut: 'cubic-bezier(.65,0,.35,1)',
    cssOut: 'ease-out',
    cssIn: 'ease-in',
  }),
});

export function respectReducedMotion(duration, view = globalThis) {
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : duration;
}

export function impactTier(amount) {
  const magnitude = Math.abs(amount);
  return magnitude >= 5 ? 'heavy' : magnitude >= 3 ? 'medium' : 'light';
}

export function orderPulsePhase(speed, now) {
  const period = speed === 'fast' ? MOTION.ms.orderPulseFast : MOTION.ms.orderPulse;
  return { period, delay: -(now % period) };
}

export function scaleMotion(duration, scale = 1) {
  return duration * scale;
}

export function motionDuration(speed, reduced, scale = 1) {
  if (speed === 'off' || (speed === 'system' && reduced)) return 0;
  return scaleMotion(speed === 'fast' ? MOTION.ms.fast : MOTION.ms.normal, scale);
}

export function coinTimings(duration, scale = 1) {
  const toss = duration * MOTION.pace.coinToss;
  return {
    toss,
    notice: Math.max(scaleMotion(MOTION.ms.coinNoticeMinimum, scale), toss + scaleMotion(MOTION.ms.coinNoticeExtra, scale)),
  };
}
