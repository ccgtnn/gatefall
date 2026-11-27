export const MOTION = Object.freeze({
  pace: Object.freeze({
    opponentReveal: 4.2,
    coinToss: 3.6,
    turnSparks: 1.8,
    lifeLoss: 1.5,
    score: .88,
    projectile: .43,
    lightning: .54,
    afterProjectile: .52,
    handStep: 1 / 6,
    handPulse: 2,
    landingDust: .5,
    landingDustDelay: .53,
    departureParticles: .78,
    departureParticlesDelay: .18,
    annihilationParticles: .8,
    spawnParticles: .82,
    spawnParticlesDelay: .13,
  }),
  ms: Object.freeze({
    normal: 320,
    fast: 200,
    roundResult: 1500,
    roundTitle: 360,
    roundTitleReduced: 600,
    turnNotice: 1000,
    botNoticeDelay: 1000,
    targetConfirm: 180,
    targetConfirmReduced: 90,
    turnSparkStagger: 35,
    scoreTimeoutMargin: 50,
    coinNoticeMinimum: 1500,
    coinNoticeExtra: 1000,
    coinNoticeFadeIn: 170,
    coinNoticeFadeOut: 250,
  }),
  ease: Object.freeze({
    out: 'cubic-bezier(.22,.61,.36,1)',
    back: 'cubic-bezier(.2,.9,.25,1.12)',
    inOut: 'cubic-bezier(.65,0,.35,1)',
    cssOut: 'ease-out',
    cssIn: 'ease-in',
  }),
});

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
