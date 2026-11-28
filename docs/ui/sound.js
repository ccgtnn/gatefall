import { feedbackKind } from './card-motion-feedback.js';
import { impactTier } from './motion-tokens.js';

export const CUES = {
  play: { wave: 'triangle', notes: [[440, 320, 0, .085]] },
  damage: { wave: 'sine', notes: [[165, 85, 0, .12]] },
  'damage-heavy': { wave: 'triangle', notes: [[102, 45, 0, .19], [76, 34, 0, .17]] },
  heal: { wave: 'sine', notes: [[475, 640, 0, .19]] },
  'armor-break': { wave: 'triangle', notes: [[900, 270, 0, .11], [680, 320, .035, .095]] },
  capture: { wave: 'sine', notes: [[260, 490, 0, .16]] },
  'target-marked': { wave: 'triangle', notes: [[800, 600, 0, .065], [900, 850, .065, .06]] },
  'row-effect': { wave: 'sine', notes: [[180, 410, 0, .23]] },
  'power-loss': { wave: 'sine', notes: [[560, 235, 0, .14]] },
  growth: { wave: 'sine', notes: [[340, 530, 0, .16]] },
  counter: { wave: 'triangle', notes: [[700, 520, 0, .06]] },
  'order-ready': { wave: 'sine', notes: [[550, 820, 0, .12]] },
  'match-win': { wave: 'triangle', notes: [[392, 392, 0, .18], [523, 523, .09, .18], [659, 659, .18, .21], [784, 784, .28, .32]] },
  'match-loss': { wave: 'sine', notes: [[330, 275, 0, .18], [262, 220, .14, .24], [196, 165, .29, .35]] },
  pass: { wave: 'sine', notes: [[330, 240, 0, .13]] },
  win: { wave: 'triangle', notes: [[440, 440, 0, .095], [554, 554, .075, .095], [659, 659, .15, .16]] },
};

export const DEFAULT_VOLUME = .3;

export function createSoundEffects(initiallyEnabled, AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  initialVolume = DEFAULT_VOLUME) {
  let enabled = initiallyEnabled;
  let context;
  let volume;
  let level = initialVolume;
  const lastPlayed = new Map();

  function setEnabled(value) {
    enabled = value;
    if (volume) volume.gain.setValueAtTime(value ? level : 0, context.currentTime);
  }

  function setVolume(value) {
    level = value;
    setEnabled(enabled);
  }

  function unlock() {
    if (!enabled || !AudioContext) return;
    try {
      if (!context) {
        context = new AudioContext();
        volume = context.createGain();
        volume.gain.value = level;
        volume.connect(context.destination);
      }
      if (context.state !== 'running') return context.resume().catch(() => {});
    } catch {
      // Sound is optional when the browser cannot open an audio output.
    }
  }

  function play(event) {
    if (!enabled || context?.state !== 'running') return;
    let kind = feedbackKind(event);
    if (kind === 'round-end' && event.winner === 'human') kind = 'win';
    if (kind === 'match-end') kind = 'match-' + event.result;
    if (kind === 'damage' && impactTier(event.amount) === 'heavy') kind = 'damage-heavy';
    if (!Object.hasOwn(CUES, kind)) return;
    const { wave, notes } = CUES[kind];
    const now = context.currentTime;
    if (now - (lastPlayed.get(kind) ?? -Infinity) < .075) return;
    lastPlayed.set(kind, now);
    for (const [pitch, endPitch, delay, duration] of notes) {
      const start = now + delay + .006;
      const end = start + duration;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(pitch, start);
      oscillator.frequency.exponentialRampToValueAtTime(endPitch, end);
      envelope.gain.setValueAtTime(.001, start);
      envelope.gain.linearRampToValueAtTime(.7, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.001, end);
      oscillator.connect(envelope);
      envelope.connect(volume);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end);
    }
  }

  async function testSound() {
    await unlock();
    play({ type: 'round-end', winner: 'human' });
  }

  return { setEnabled, setVolume, unlock, play, testSound };
}
